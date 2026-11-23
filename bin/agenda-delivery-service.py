#!/usr/bin/env python3
"""agenda delivery service: the one process that runs agenda.delivery's agents.

It keeps a NullClaw gateway running for every monitored organization, checks on each one, restarts
any that fail, schedules and queues their runs, runs every executable an agent needs (Chrome,
pdftotext, yt-dlp) under limits, and runs the housekeeping tick. The website and adtool reach it
through an HTTP API on a Unix socket. Standard library only; Python 3.10 or newer.
"""
import contextlib
import hashlib
import http.server
import json
import os
import queue
import re
import shutil
import secrets
import signal
import socketserver
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHP = os.environ.get("AGENDA_PHP", "php")
PATH = "/usr/local/bin:/usr/bin:/bin"


def load_config() -> dict:
    # The PHP side owns the settings and the schema; this also brings the schema up to date.
    out = subprocess.run([PHP, os.path.join(ROOT, "bin/config-json.php")], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


CFG = load_config()
DATA = CFG["data_dir"].rstrip("/")
DB_PATH = DATA + "/agenda.db"
SOCKET = CFG.get("service_socket") or "/run/agenda-delivery/service.sock"
PORT_BASE = int(CFG.get("gateway_port_base") or 3200)
# A fresh token each time the service starts; the gateways restart with it, since they are its children.
GATEWAY_TOKEN = secrets.token_hex(24)
RUN_LIMIT = int(CFG.get("agent_concurrency") or 2)       # agent runs at once
RUN_TIMEOUT = int(CFG.get("run_timeout") or 1800)        # seconds one run may take
BROWSER_SLOTS = int(CFG.get("browser_slots") or 2)
JOB_WAIT = int(CFG.get("browser_wait") or 600)           # seconds a job waits for its turn
NULLCLAW = CFG.get("nullclaw_bin") or "/usr/local/bin/nullclaw"
# WhatsApp destinations need the bridge's packages installed (npm ci in whatsapp/) and can be switched off in config.
WHATSAPP = CFG.get("whatsapp", True) is not False and os.path.isdir(os.path.join(ROOT, "whatsapp/node_modules"))
PYTHON = CFG.get("python_bin") or sys.executable
STARTED = time.time()


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def log(*parts) -> None:
    print(now(), *parts, flush=True)


# ---- database ----------------------------------------------------------------

def db() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout = 15000")
    c.execute("PRAGMA foreign_keys = ON")
    return c


def q(sql: str, args: tuple = ()) -> list:
    with contextlib.closing(db()) as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def ex(sql: str, args: tuple = ()) -> int:
    with contextlib.closing(db()) as c:
        return c.execute(sql, args).lastrowid


# ---- gateways ----------------------------------------------------------------

class Gateway:
    """One organization's NullClaw gateway: its home folder, config, process and health."""

    def __init__(self, mid: int, slug: str, home: str):
        self.mid, self.slug, self.home = mid, slug, home
        self.port = PORT_BASE + mid
        self.proc: subprocess.Popen | None = None
        self.started_at: str | None = None
        self.restarts = 0
        self.backoff = 5
        self.next_start = 0.0
        self.failed_checks = 0
        self.healthy = False
        self.busy = threading.Lock()  # held while a run is talking to this gateway

    @property
    def workspace(self) -> str:
        return os.path.join(self.home, ".nullclaw", "workspace")

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def write_home(self) -> bool:
        """Writes the agent's NullClaw config and instructions. Returns True when anything changed."""
        os.makedirs(self.workspace, mode=0o700, exist_ok=True)
        config = {
            "models": {"providers": {"ollama": {"api_key": CFG.get("ollama_key", ""), "base_url": CFG.get("ollama_base", "")}}},
            "agents": {"defaults": {"model": {"primary": "ollama/" + CFG.get("model", "")}}},
            # A steadier model writes tool calls properly more often and invents less.
            "default_temperature": 0.3,
            "autonomy": {
                "level": "full", "workspace_only": True, "allowed_commands": ["adtool", "adtool *"],
                "max_actions_per_hour": 300, "require_approval_for_medium_risk": False,
                # Off: with it on, a bare & passes the policy and runs a second command in the background
                # (adtool context & id ran id). Quoted URLs with & and ? still work, and the instructions say to quote them.
                "allow_raw_url_chars": False,
            },
            # Long runs are summarized as they go, to keep the tokens each model call resends down.
            "agent": {"compact_context": True, "message_timeout_secs": RUN_TIMEOUT, "default_queue_mode": "serial"},
            "diagnostics": {"token_usage_ledger_enabled": True},
            # Cost tracking writes the per-call token log the admin panel reads. The dollar limits are NullClaw's
            # own estimate; Ollama Cloud is a flat plan, so they're set high enough never to stop a run.
            "cost": {"enabled": True, "daily_limit_usd": 10000, "monthly_limit_usd": 100000},
            "reliability": {"provider_retries": 4, "provider_backoff_ms": 3000},
            # NullClaw's shell sandbox hides /opt/agenda and the database from adtool. The command allowlist
            # above already limits the shell to adtool, and file tools stay inside the workspace.
            "security": {"sandbox": {"backend": "none"}},
            # Loopback only, and only this service holds the token: a page open in Chrome or anything else on
            # the machine can't drive an agent. The gateway keeps only the token's hash.
            "gateway": {"host": "127.0.0.1", "port": self.port, "require_pairing": True,
                        "paired_tokens": [hashlib.sha256(GATEWAY_TOKEN.encode()).hexdigest()]},
            "a2a": {"enabled": True, "name": self.slug, "url": f"http://127.0.0.1:{self.port}", "version": "0.3.0"},
        }
        with open(os.path.join(ROOT, "src/agent_instructions.md"), encoding="utf-8") as f:
            instructions = f.read()
        changed = put_if_changed(os.path.join(self.home, ".nullclaw", "config.json"), json.dumps(config, indent=2))
        changed |= put_if_changed(os.path.join(self.workspace, "AGENTS.md"), instructions)
        return changed

    def start(self) -> None:
        self.write_home()
        log_file = os.path.join(self.home, "gateway.log")
        if os.path.exists(log_file) and os.path.getsize(log_file) > 5_000_000:
            os.replace(log_file, log_file + ".1")
        out = open(log_file, "ab")
        env = {"HOME": self.home, "PATH": PATH, "LANG": "C.UTF-8"}
        # Its own process group, so stopping it also stops any adtool or Chrome it started.
        self.proc = subprocess.Popen([NULLCLAW, "gateway"], cwd=self.workspace, env=env, stdout=out,
                                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        out.close()
        self.started_at = now()
        self.failed_checks = 0
        self.healthy = False
        log(f"started gateway {self.slug} pid {self.proc.pid} port {self.port}")

    def stop(self) -> None:
        if not self.alive():
            self.proc = None
            return
        stop_group(self.proc, grace=5)
        log(f"stopped gateway {self.slug}")
        self.proc = None
        self.healthy = False

    def check(self) -> bool:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=3) as r:
                self.healthy = json.loads(r.read()).get("status") == "ok"
        except (OSError, ValueError):
            self.healthy = False
        self.failed_checks = 0 if self.healthy else self.failed_checks + 1
        return self.healthy

    def rss_kb(self) -> int | None:
        try:
            with open(f"/proc/{self.proc.pid}/status") as f:
                m = re.search(r"VmRSS:\s+(\d+)", f.read())
                return int(m.group(1)) if m else None
        except (OSError, AttributeError):
            return None


def put_if_changed(path: str, body: str) -> bool:
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == body:
                return False
    except OSError:
        pass
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, 0o600)
    return True


def stop_group(proc: subprocess.Popen, grace: float) -> None:
    for sig, wait in ((signal.SIGTERM, grace), (signal.SIGKILL, 2)):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(wait)
            return
        except subprocess.TimeoutExpired:
            continue


GATEWAYS: dict[int, Gateway] = {}
GW_LOCK = threading.Lock()


# WhatsApp: one Baileys bridge (whatsapp/bridge.mjs) per WhatsApp destination, each with its session in a private
# folder and a Unix socket in the runtime directory that only the agenda user can reach.
NODE = shutil.which("node", path=PATH) or "node"
WA_DIR = DATA + "/whatsapp"


def wa_socket(tid: int) -> str:
    return os.path.join(os.path.dirname(SOCKET), f"wa-{tid}.sock")


def wa_call(tid: int, method: str, path: str, body: dict | None = None, timeout: float = 5) -> dict | None:
    """One request to a bridge over its socket, or None when it doesn't answer."""
    import http.client
    import socket as socketlib

    class Conn(http.client.HTTPConnection):
        def connect(self):
            self.sock = socketlib.socket(socketlib.AF_UNIX, socketlib.SOCK_STREAM)
            self.sock.settimeout(timeout)
            self.sock.connect(wa_socket(tid))
    try:
        c = Conn("bridge", timeout=timeout)
        c.request(method, path, json.dumps(body).encode() if body is not None else None, {"Content-Type": "application/json"})
        return json.loads(c.getresponse().read() or b"{}")
    except (OSError, ValueError, http.client.HTTPException):
        return None


class Bridge:
    def __init__(self, tid: int):
        self.tid = tid
        self.proc: subprocess.Popen | None = None
        self.backoff = 5
        self.next_start = 0.0

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self) -> None:
        os.makedirs(WA_DIR, mode=0o700, exist_ok=True)
        auth = os.path.join(WA_DIR, str(self.tid))
        os.makedirs(auth, mode=0o700, exist_ok=True)
        out = open(os.path.join(WA_DIR, f"{self.tid}.log"), "ab")
        self.proc = subprocess.Popen([NODE, os.path.join(ROOT, "whatsapp/bridge.mjs"), "--auth", auth, "--socket", wa_socket(self.tid)],
                                     cwd=os.path.join(ROOT, "whatsapp"), env={"HOME": WA_DIR, "PATH": PATH, "NODE_ENV": "production"},
                                     stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        out.close()
        log(f"started whatsapp bridge {self.tid} pid {self.proc.pid}")

    def stop(self, unlink: bool) -> None:
        if unlink and self.alive():
            wa_call(self.tid, "POST", "/logout")  # tells WhatsApp the device is gone, and deletes the session
        if self.alive():
            stop_group(self.proc, grace=5)
        self.proc = None
        if unlink:
            shutil.rmtree(os.path.join(WA_DIR, str(self.tid)), ignore_errors=True)
            for f in (wa_socket(self.tid), os.path.join(WA_DIR, f"{self.tid}.log")):
                try:
                    os.unlink(f)
                except OSError:
                    pass
            log(f"removed whatsapp bridge {self.tid}")


BRIDGES: dict[int, Bridge] = {}


def supervise_bridges() -> None:
    """Keeps one bridge running per WhatsApp destination, records each one's state, and removes the bridges of
    destinations that are gone. The state goes in the database, where the site shows it and tick.php notices drops."""
    wanted = {r["id"]: r for r in q("SELECT id, wa_state FROM target WHERE kind = 'whatsapp'")}
    for tid in [t for t in BRIDGES if t not in wanted]:
        BRIDGES.pop(tid).stop(unlink=True)
    # A session folder with no destination behind it, say from a removal while the service was down.
    if os.path.isdir(WA_DIR):
        for name in os.listdir(WA_DIR):
            if name.isdigit() and int(name) not in wanted:
                Bridge(int(name)).stop(unlink=True)
    for tid, row in wanted.items():
        b = BRIDGES.setdefault(tid, Bridge(tid))
        if not b.alive():
            if time.time() >= b.next_start:
                b.start()
                b.next_start = time.time() + b.backoff
                b.backoff = min(b.backoff * 2, 300)
            continue
        st = wa_call(tid, "GET", "/status")
        if not st:
            continue
        b.backoff = 5
        state = st.get("state", "")
        since = datetime.fromtimestamp(st.get("since", time.time() * 1000) / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        ex("UPDATE target SET wa_state = ?, wa_since = ?, wa_me = ?, wa_linked = max(wa_linked, ?) WHERE id = ?",
           (state, since, st.get("me", "") if state == "open" else "", 1 if state == "open" else 0, tid))
WAKE = threading.Event()


def next_slot(slug: str, after: datetime) -> datetime:
    """Every six hours from midnight UTC, each organization at its own fixed offset within the hour."""
    offset = int(hashlib.sha1(slug.encode()).hexdigest(), 16) % 3600
    day = after.replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(0, 9):
        t = day + timedelta(hours=6 * i, seconds=offset)
        if t > after:
            return t
    return after + timedelta(hours=6)


def supervise() -> None:
    """Every 10 seconds, or when woken: make each agent match what the database asks for, and record what's true."""
    last_health = 0.0
    while not STOPPING.is_set():
        try:
            check_health = time.time() - last_health >= 15
            if check_health:
                last_health = time.time()
            rows = q("""SELECT a.*, m.slug, m.state AS monitor_state, m.site_id, s.setup_state, s.setup_monitor,
                           s.health, s.repair_monitor, s.repair_started
                        FROM agent a JOIN monitor m ON m.id = a.monitor_id JOIN site s ON s.id = m.site_id""")
            seen = set()
            for a in rows:
                seen.add(a["monitor_id"])
                supervise_one(a, check_health)
            with GW_LOCK:
                for mid in [m for m in GATEWAYS if m not in seen]:
                    gw = GATEWAYS.pop(mid)
                    gw.stop()
                    remove_home(gw.home)
                    log(f"removed agent {gw.slug}")
            if WHATSAPP:
                supervise_bridges()
        except Exception as e:  # keep supervising whatever one pass hits
            log("supervise error:", repr(e))
        WAKE.wait(10)
        WAKE.clear()


def supervise_one(a: dict, check_health: bool) -> None:
    mid, slug, want = a["monitor_id"], a["slug"], a["desired_state"]
    with GW_LOCK:
        gw = GATEWAYS.get(mid)
        if gw is None and want == "enabled":
            gw = GATEWAYS[mid] = Gateway(mid, slug, a["home"])
    if want == "removed":
        if gw:
            gw.stop()
            with GW_LOCK:
                GATEWAYS.pop(mid, None)
        remove_home(a["home"])
        ex("UPDATE agent SET actual_state = 'removed', pid = NULL, rss_kb = NULL, run_requested = 0, checked_at = ? WHERE monitor_id = ?",
           (now(), mid))
        return
    if want == "paused":
        if gw:
            gw.stop()
        ex("UPDATE agent SET actual_state = 'paused', pid = NULL, rss_kb = NULL, checked_at = ? WHERE monitor_id = ?", (now(), mid))
        return

    # Enabled: keep the gateway up, restarting with a growing pause when it keeps failing.
    if not gw.alive():
        if gw.proc is not None:  # it was running and died
            gw.restarts += 1
            gw.next_start = time.time() + gw.backoff
            gw.backoff = min(gw.backoff * 3, 600)
            log(f"gateway {slug} exited ({gw.proc.returncode}); restarting in {int(gw.next_start - time.time())}s")
            gw.proc = None
        if time.time() >= gw.next_start:
            try:
                gw.start()
            except OSError as e:
                gw.next_start = time.time() + gw.backoff
                ex("UPDATE agent SET actual_state = 'error', last_error = ?, checked_at = ? WHERE monitor_id = ?",
                   (f"gateway won't start: {e}", now(), mid))
                return
    elif check_health and not gw.busy.locked():
        if gw.check():
            gw.backoff = 5
        elif gw.failed_checks >= 3:
            log(f"gateway {slug} failed 3 health checks; restarting")
            gw.stop()
            gw.restarts += 1
        if gw.write_home() and gw.alive():  # config or instructions changed under it
            gw.stop()

    # Schedule. A monitor runs setup for its site, waits while its owner chooses, then checks on schedule.
    next_run = a["next_run"]
    if a["monitor_state"] == "setup":
        next_run = None
        claim_setup(a, gw)
    elif a["monitor_state"] == "ready":
        repairing_elsewhere = a["health"] == "repairing" and a["repair_monitor"] not in (None, mid)
        due = a["run_requested"] or (next_run is not None and next_run <= now())
        if next_run is None or (next_run <= now() and not a["run_requested"]):
            next_run = next_slot(slug, datetime.now(timezone.utc)).strftime("%Y-%m-%d %H:%M:%S")
        # While another agent repairs the site, this one waits; the fix wakes it.
        if due and gw.healthy and not repairing_elsewhere:
            enqueue_run(mid, {1: "requested", 2: "repaired"}.get(a["run_requested"], "schedule"))
    else:
        next_run = None  # waiting for its owner to choose meetings

    running = bool(q("SELECT 1 FROM agent_run WHERE monitor_id = ? AND state = 'running'", (mid,)))
    if not gw.alive() or not gw.healthy:
        state = "pending" if gw.restarts == 0 else "error"
    else:
        state = "error" if (a["last_exit"] or 0) != 0 and not running else "enabled"
    ex("""UPDATE agent SET actual_state = ?, port = ?, pid = ?, started_at = ?, restarts = ?, rss_kb = ?,
          next_run = ?, checked_at = ? WHERE monitor_id = ?""",
       (state, gw.port, gw.proc.pid if gw.alive() else None, gw.started_at, gw.restarts, gw.rss_kb() if gw.alive() else None,
        next_run, now(), mid))


def claim_setup(a: dict, gw: "Gateway") -> None:
    """The first monitor waiting on a site that nobody is setting up sets it up, for every account."""
    sid, mid = a["site_id"], a["monitor_id"]
    owner = a["setup_monitor"]
    if owner is not None and owner != mid and not q("SELECT 1 FROM monitor WHERE id = ?", (owner,)):
        owner = None  # the monitor that was setting it up has been removed
    if a["setup_state"] in ("pending",) or (a["setup_state"] == "running" and owner is None):
        with contextlib.closing(db()) as c:
            took = c.execute("""UPDATE site SET setup_state = 'running', setup_monitor = ? WHERE id = ?
                                AND (setup_state = 'pending' OR setup_monitor IS NULL OR setup_monitor = ?)""", (mid, sid, owner)).rowcount
        if took:
            log(f"{a['slug']} is setting up site {sid}")
            owner = mid
    if owner == mid and a["setup_state"] != "failed" and gw.healthy:
        enqueue_run(mid, "setup")


def remove_home(home: str) -> None:
    real = os.path.realpath(home)
    if os.path.isdir(real) and real.startswith(os.path.realpath(DATA + "/agents") + "/"):
        shutil.rmtree(real)


# ---- runs ----------------------------------------------------------------------

RUNS: "queue.Queue[tuple[int, int]]" = queue.Queue()


def enqueue_run(mid: int, trigger: str) -> int | None:
    if q("SELECT 1 FROM agent_run WHERE monitor_id = ? AND state IN ('queued', 'running')", (mid,)):
        ex("UPDATE agent SET run_requested = 0 WHERE monitor_id = ?", (mid,))
        return None
    run_id = ex("INSERT INTO agent_run (monitor_id, trigger) VALUES (?, ?)", (mid, trigger))
    ex("UPDATE agent SET run_requested = 0 WHERE monitor_id = ?", (mid,))
    RUNS.put((run_id, mid))
    log(f"queued run {run_id} for monitor {mid} ({trigger})")
    return run_id


def a2a_send(port: int, context: str, text: str, timeout: int) -> tuple[str, str]:
    """Sends one message to a gateway and waits for the finished task. Returns (state, reply text)."""
    body = {"jsonrpc": "2.0", "id": 1, "method": "message/send", "params": {"message": {
        "messageId": f"{context}-{time.time_ns()}", "role": "user", "contextId": context,
        "parts": [{"kind": "text", "text": text}]}}}
    req = urllib.request.Request(f"http://127.0.0.1:{port}/a2a", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {GATEWAY_TOKEN}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        res = json.loads(r.read())
    if "error" in res:
        return "failed", json.dumps(res["error"])[:2000]
    task = res.get("result", {})
    reply = "\n".join(p.get("text", "") for art in task.get("artifacts", []) for p in art.get("parts", []))
    return task.get("status", {}).get("state", "unknown"), reply


def after_run(mid: int, trigger: str) -> None:
    """A setup that didn't finish marks the site failed, so its owner can try again; a repair this agent
    didn't finish is given up, so the next agent to notice can take it on."""
    site = q("SELECT s.* FROM site s JOIN monitor m ON m.site_id = s.id WHERE m.id = ?", (mid,))
    if not site:
        return
    site = site[0]
    if trigger == "setup" and site["setup_state"] != "ready":
        ex("UPDATE site SET setup_state = 'failed', setup_monitor = NULL WHERE id = ?", (site["id"],))
        log(f"setup of site {site['id']} didn't finish")
    if site["health"] == "repairing" and site["repair_monitor"] == mid:
        ex("UPDATE site SET repair_monitor = NULL, repair_started = NULL WHERE id = ?", (site["id"],))
        log(f"repair of site {site['id']} wasn't finished; it's open to the next agent")


def run_worker() -> None:
    while not STOPPING.is_set():
        try:
            run_id, mid = RUNS.get(timeout=5)
        except queue.Empty:
            continue
        try:
            do_run(run_id, mid)
        except Exception as e:
            log(f"run {run_id} crashed: {e!r}")
            ex("UPDATE agent_run SET state = 'failed', ended_at = ?, error = ? WHERE id = ?", (now(), repr(e)[:500], run_id))


def site_mark(gw: "Gateway") -> str | None:
    """The hash of the site's links and videos from adtool fingerprint, or None when it can't tell."""
    try:
        out = subprocess.run([PHP, os.path.join(ROOT, "bin/adtool.php"), "fingerprint"], capture_output=True, text=True,
                             timeout=300, env={"HOME": gw.home, "PATH": PATH, "LANG": "C.UTF-8"}, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return None
    mark = out.stdout.strip()
    if out.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", mark):
        log(f"no fingerprint for {gw.slug}: {(out.stderr or out.stdout).strip()[-200:]}")
        return None
    return mark


def do_run(run_id: int, mid: int) -> None:
    gw = GATEWAYS.get(mid)
    if gw is None or not gw.alive():
        ex("UPDATE agent_run SET state = 'failed', ended_at = ?, error = 'gateway not running' WHERE id = ?", (now(), run_id))
        return
    with gw.busy:
        trigger = q("SELECT trigger FROM agent_run WHERE id = ?", (run_id,))[0]["trigger"]
        # A scheduled check of a site whose links and videos match the last full run is skipped, so the model
        # isn't asked to read pages that haven't changed. A full run still happens at least every FULL_RUN_EVERY
        # hours, for anything posted without a new link.
        mark = site_mark(gw) if trigger != "setup" else None
        last = q("SELECT fingerprint, full_run_at FROM agent WHERE monitor_id = ?", (mid,))[0]
        recent = (datetime.now(timezone.utc) - timedelta(hours=FULL_RUN_EVERY)).strftime("%Y-%m-%d %H:%M:%S")
        if trigger == "schedule" and mark and mark == last["fingerprint"] and (last["full_run_at"] or "") > recent:
            ex("UPDATE agent_run SET state = 'skipped', started_at = ?, ended_at = ?, reply = ? WHERE id = ?",
               (now(), now(), "Nothing new on the site since the last check.", run_id))
            ex("UPDATE agent SET last_run_end = ?, last_exit = 0, last_error = '' WHERE monitor_id = ?", (now(), mid))
            log(f"run {run_id} for {gw.slug}: skipped, the site hasn't changed")
            return
        ex("UPDATE agent_run SET state = 'running', started_at = ? WHERE id = ?", (now(), run_id))
        ex("UPDATE agent SET last_run_start = ? WHERE monitor_id = ?", (now(), mid))
        log(f"run {run_id} started for {gw.slug}")
        text = ("This site isn't set up yet. Set it up now, following the Setup section of AGENTS.md." if trigger == "setup"
                else "Run your scheduled check now, following AGENTS.md.")
        state, reply, error = "failed", "", ""
        # A fresh conversation per run keeps the tokens resent with each model call down; what the agent
        # learns between runs lives in its notes and NullClaw's own memory.
        for attempt in (1, 2):
            try:
                state, reply = a2a_send(gw.port, f"run-{run_id}", text, RUN_TIMEOUT)
            except (OSError, ValueError) as e:
                state, error = "failed", f"no answer from the gateway: {e}"
                gw.stop()  # a hung turn ends with its gateway; supervise starts it again
                break
            # The model now and then writes a tool call as plain text, which ends the turn early.
            if not re.search(r'DSML|"tool_calls"\s*:', reply):
                break
            text = "Your last reply was a tool call written as text, so it never ran. Continue the scheduled check from where you stopped, following AGENTS.md."
        ok = state == "completed"
        if not ok and not error:
            error = f"run ended as {state}"
        ex("UPDATE agent_run SET state = ?, ended_at = ?, reply = ?, error = ? WHERE id = ?",
           ("completed" if ok else "failed", now(), reply[-4000:], error[:1000], run_id))
        ex("UPDATE agent SET last_run_end = ?, last_exit = ?, last_error = ?, actual_state = ? WHERE monitor_id = ?",
           (now(), 0 if ok else 1, "" if ok else error[:400], "enabled" if ok else "error", mid))
        log(f"run {run_id} for {gw.slug}: {'completed' if ok else error}")
        after_run(mid, trigger)
        if ok and trigger != "setup":
            ex("UPDATE agent SET fingerprint = ?, full_run_at = ? WHERE monitor_id = ?", (mark, now(), mid))
            ex("UPDATE monitor SET notify_from = ? WHERE id = ? AND notify_from IS NULL AND state = 'ready' AND site_id IN "
               "(SELECT id FROM site WHERE health = 'ok')", (now(), mid))
    tick()


# ---- executables ---------------------------------------------------------------

SLOTS: "queue.Queue[int]" = queue.Queue()
for _slot in range(BROWSER_SLOTS):
    SLOTS.put(_slot)
LIMITS = {"pdftotext": threading.BoundedSemaphore(2), "yt-dlp": threading.BoundedSemaphore(1)}
# YouTube answers too many requests from one address with HTTP 429, so yt-dlp runs one at a time with a gap between
# runs, and after a 429 every yt-dlp job waits out a cool-down instead of asking again. The agent retries on its next run.
YT_GAP = 8            # seconds between one yt-dlp run starting and the next
YT_COOLDOWN = 900     # seconds to leave YouTube alone after it says 429
YT = {"last": 0.0, "until": 0.0}
FULL_RUN_EVERY = 24   # hours; an unchanged site still gets a full check this often
XVFB = shutil.which("xvfb-run", path=PATH)
YTDLP = shutil.which("yt-dlp", path=PATH) or "yt-dlp"


def run_tool(tool: str, args: list, mid: int | None, target: str) -> dict:
    """Runs one executable for an agent, waiting for its turn. Every run is a row in the job table."""
    if tool not in ("render", "pdftotext", "yt-dlp") or not all(isinstance(a, str) for a in args):
        return {"exit": 2, "stdout": "", "stderr": f"unknown tool {tool}"}
    job = ex("INSERT INTO job (monitor_id, tool, target) VALUES (?, ?, ?)", (mid, tool, target[:500]))
    slot, held = None, False
    try:
        if tool == "render":
            try:
                slot = SLOTS.get(timeout=JOB_WAIT)
            except queue.Empty:
                raise TimeoutError("every browser is busy, try again later")
        else:
            held = LIMITS[tool].acquire(timeout=JOB_WAIT)
            if not held:
                raise TimeoutError(f"{tool} is busy, try again later")
            if tool == "yt-dlp":
                if time.time() < YT["until"]:
                    raise RuntimeError(f"YouTube asked for fewer requests, so videos wait until {time.strftime('%H:%M', time.localtime(YT['until']))}. Try again after that")
                time.sleep(max(0.0, YT["last"] + YT_GAP - time.time()))
                YT["last"] = time.time()
        ex("UPDATE job SET state = 'running', slot = ?, started_at = ? WHERE id = ?", (slot, now(), job))
        argv, timeout = tool_argv(tool, args, slot)
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                                env={"HOME": DATA + "/browser", "PATH": PATH, "LANG": "C.UTF-8"}, start_new_session=True)
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            stop_group(proc, grace=2)
            out, err = b"", f"{tool} took longer than {timeout}s".encode()
            proc.returncode = 124
        # yt-dlp's notice about this Python version comes with every run and isn't about the job.
        err_text = "\n".join(l for l in err.decode("utf-8", "replace").splitlines() if not l.startswith("Deprecated Feature:"))
        result = {"exit": proc.returncode, "stdout": out.decode("utf-8", "replace"), "stderr": err_text}
        if tool == "yt-dlp" and "HTTP Error 429" in err_text:
            YT["until"] = time.time() + YT_COOLDOWN
            log(f"YouTube said 429, pausing yt-dlp for {YT_COOLDOWN // 60} minutes")
    except Exception as e:
        result = {"exit": 1, "stdout": "", "stderr": str(e)}
    finally:
        if slot is not None:
            # Anything Chrome left in this slot's profile goes before the slot is handed on.
            # (No leading dashes in the pattern, or pkill reads it as one of its own options.)
            subprocess.run(["pkill", "-9", "-f", f"user-data-dir={DATA}/browser/profile{slot}"], env={"PATH": PATH})
            SLOTS.put(slot)
        if held:
            LIMITS[tool].release()
    ok = result["exit"] == 0
    ex("UPDATE job SET state = ?, ended_at = ?, error = ? WHERE id = ?",
       ("done" if ok else "failed", now(), "" if ok else (result["stderr"] or result["stdout"])[-300:], job))
    return result


def tool_argv(tool: str, args: list, slot: int | None) -> tuple[list, int]:
    if tool == "render":
        url = args[0]
        if not re.match(r"https?://", url):
            raise ValueError("render needs an http(s) URL")
        argv = [PYTHON, os.path.join(ROOT, "bin/render.py"), url, f"{DATA}/browser/profile{slot}"]
        if len(args) > 1:
            argv += ["--save", args[1]]
        # A virtual display lets Chrome run as a normal window, which bot checks accept where they refuse headless.
        if XVFB:
            argv = [XVFB, "-a", "-s", "-screen 0 1366x900x24"] + argv
        return argv, 150
    if tool == "pdftotext":
        if not os.path.isfile(args[0]):
            raise ValueError("pdftotext needs a file")
        return ["pdftotext", "-layout", "-l", "80", args[0], "-"], 60
    return [YTDLP, "--no-warnings", "--sleep-requests", "1", "--sleep-subtitles", "2"] + args, 180


# ---- housekeeping --------------------------------------------------------------

TICK_LOCK = threading.Lock()


def tick() -> None:
    """Imports token use and sends waiting notifications (bin/tick.php)."""
    if not TICK_LOCK.acquire(blocking=False):
        return
    try:
        out = subprocess.run([PHP, os.path.join(ROOT, "bin/tick.php")], capture_output=True, text=True, timeout=300)
        if out.returncode != 0:
            log("tick failed:", (out.stderr or out.stdout)[-300:])
        elif out.stdout.strip():
            log("tick:", out.stdout.strip())
    except subprocess.TimeoutExpired:
        log("tick took longer than 300s")
    finally:
        TICK_LOCK.release()


def tick_loop() -> None:
    while not STOPPING.wait(60):
        tick()


# ---- API -----------------------------------------------------------------------

def agent_view(gw: Gateway) -> dict:
    run = q("SELECT id, trigger, state, started_at FROM agent_run WHERE monitor_id = ? AND state IN ('queued', 'running') ORDER BY id DESC LIMIT 1",
            (gw.mid,))
    return {"monitor_id": gw.mid, "slug": gw.slug, "port": gw.port, "pid": gw.proc.pid if gw.alive() else None,
            "alive": gw.alive(), "healthy": gw.healthy, "rss_kb": gw.rss_kb() if gw.alive() else None,
            "restarts": gw.restarts, "started_at": gw.started_at, "run": run[0] if run else None}


def gateway_by_slug(slug: str) -> Gateway | None:
    with GW_LOCK:
        return next((g for g in GATEWAYS.values() if g.slug == slug), None)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # the journal gets our own lines, not one per request
        pass

    def address_string(self):
        return "socket"

    def reply(self, code: int, body) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/health":
            with GW_LOCK:
                gws = list(GATEWAYS.values())
            return self.reply(200, {
                "ok": True, "uptime": int(time.time() - STARTED),
                "gateways": sum(g.alive() for g in gws), "healthy": sum(g.healthy for g in gws),
                "runs_running": q("SELECT count(*) AS n FROM agent_run WHERE state = 'running'")[0]["n"],
                "runs_queued": RUNS.qsize(),
                "jobs_running": q("SELECT count(*) AS n FROM job WHERE state = 'running'")[0]["n"],
                "browser_slots_free": SLOTS.qsize(),
            })
        if path == "/agents":
            with GW_LOCK:
                gws = list(GATEWAYS.values())
            return self.reply(200, [agent_view(g) for g in gws])
        m = re.fullmatch(r"/agents/([a-z0-9-]+)/log", path)
        if m:
            gw = gateway_by_slug(m.group(1))
            if not gw:
                return self.reply(404, {"error": "no such agent"})
            lines = int(re.search(r"lines=(\d+)", query).group(1)) if "lines=" in query else 100
            try:
                with open(os.path.join(gw.home, "gateway.log"), "rb") as f:
                    f.seek(max(0, os.path.getsize(f.name) - 200_000))
                    tail = f.read().decode("utf-8", "replace").splitlines()[-min(lines, 2000):]
            except OSError:
                tail = []
            return self.reply(200, {"slug": gw.slug, "lines": tail})
        if path == "/jobs":
            return self.reply(200, q("SELECT * FROM job WHERE state IN ('queued', 'running') OR queued_at > datetime('now', '-1 hour') ORDER BY id DESC LIMIT 100"))
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.partition("?")[0]
        try:
            body = self.body()
        except ValueError:
            return self.reply(400, {"error": "bad JSON"})
        if path == "/exec":
            return self.reply(200, run_tool(str(body.get("tool")), list(body.get("args") or []),
                                            body.get("monitor_id"), str(body.get("target") or "")))
        m = re.fullmatch(r"/agents/([a-z0-9-]+)/(run|sync|pause|resume)", path)
        if not m:
            return self.reply(404, {"error": "not found"})
        slug, action = m.groups()
        rows = q("SELECT monitor_id FROM agent a JOIN monitor m ON m.id = a.monitor_id WHERE m.slug = ?", (slug,))
        if not rows:
            return self.reply(404, {"error": "no such agent"})
        mid = rows[0]["monitor_id"]
        if action == "run":
            ex("UPDATE agent SET run_requested = 1 WHERE monitor_id = ?", (mid,))
        elif action in ("pause", "resume"):
            ex("UPDATE agent SET desired_state = ? WHERE monitor_id = ? AND desired_state != 'removed'",
               ("paused" if action == "pause" else "enabled", mid))
        WAKE.set()
        self.reply(200, {"ok": True})

    def do_DELETE(self):
        m = re.fullmatch(r"/agents/([a-z0-9-]+)", self.path.partition("?")[0])
        if not m:
            return self.reply(404, {"error": "not found"})
        ex("UPDATE agent SET desired_state = 'removed' WHERE monitor_id = (SELECT id FROM monitor WHERE slug = ?)", (m.group(1),))
        WAKE.set()
        self.reply(200, {"ok": True})


class SocketServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


# ---- main ----------------------------------------------------------------------

STOPPING = threading.Event()


def shutdown(*_):
    STOPPING.set()
    WAKE.set()


def main() -> None:
    os.makedirs(DATA + "/browser", exist_ok=True)
    # Runs the last service was in the middle of didn't finish.
    ex("UPDATE agent_run SET state = 'failed', ended_at = ?, error = 'the service restarted' WHERE state IN ('queued', 'running')", (now(),))
    ex("UPDATE job SET state = 'failed', ended_at = ?, error = 'the service restarted' WHERE state IN ('queued', 'running')", (now(),))

    os.makedirs(os.path.dirname(SOCKET), exist_ok=True)
    if os.path.exists(SOCKET):
        os.unlink(SOCKET)
    server = SocketServer(SOCKET, Handler)
    os.chmod(SOCKET, 0o660)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    threads = [threading.Thread(target=supervise, name="supervise", daemon=True),
               threading.Thread(target=tick_loop, name="tick", daemon=True),
               threading.Thread(target=server.serve_forever, name="api", daemon=True)]
    threads += [threading.Thread(target=run_worker, name=f"run{i}", daemon=True) for i in range(RUN_LIMIT)]
    for t in threads:
        t.start()
    log(f"agenda delivery service up: socket {SOCKET}, {RUN_LIMIT} runs and {BROWSER_SLOTS} browsers at once")
    STOPPING.wait()

    log("stopping")
    server.shutdown()
    with GW_LOCK:
        for gw in GATEWAYS.values():
            gw.stop()
    if os.path.exists(SOCKET):
        os.unlink(SOCKET)


if __name__ == "__main__":
    main()
