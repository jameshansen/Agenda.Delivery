// The WhatsApp link behind one agenda.delivery destination. agenda-delivery.service starts one of these per WhatsApp
// destination, keeps it running and stops it when the destination is removed. It holds the Baileys session (in --auth,
// a private folder) and answers on a Unix socket (--socket) that only the agenda user can reach:
//   GET  /status  {state, since, me, qr}   state: starting | qr | connecting | open | closed | logged_out
//   GET  /groups  [{id, name, size}]       the groups the linked account is in
//   POST /send    {to, text}               to: a group's id (…@g.us); nothing else is accepted
//   POST /logout                           unlinks, deletes the session and exits
import http from 'node:http';
import fs from 'node:fs';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, jidNormalizedUser } from '@whiskeysockets/baileys';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
const authDir = arg('--auth');
const socketPath = arg('--socket');
if (!authDir || !socketPath) { console.error('usage: bridge.mjs --auth DIR --socket PATH'); process.exit(2); }
fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });

const status = { state: 'starting', since: Date.now(), me: '', qr: '' };
const set = (state, extra = {}) => {
  if (state !== status.state) Object.assign(status, { state, since: Date.now() });
  Object.assign(status, extra);
};
let sock = null;
let retry = 0;

async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
  sock = makeWASocket({
    auth, logger: pino({ level: 'silent' }), browser: ['agenda.delivery', 'Chrome', '1.0'],
    markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async u => {
    if (u.qr) set('qr', { qr: await QRCode.toString(u.qr, { type: 'svg', margin: 1, width: 240 }) });
    if (u.connection === 'connecting' && status.state !== 'qr') set('connecting');
    if (u.connection === 'open') {
      retry = 0;
      set('open', { qr: '', me: jidNormalizedUser(sock.user?.id || '').split('@')[0] });
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone: forget the session and offer a new code.
        set('logged_out', { me: '', qr: '' });
        fs.rmSync(authDir, { recursive: true, force: true });
        fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
        setTimeout(connect, 5000);
      } else {
        // Anything else (the restart WhatsApp asks for right after linking, a dropped network) reconnects, backing off.
        if (status.state === 'open') set('closed');
        retry = Math.min(retry + 1, 8);
        setTimeout(connect, code === DisconnectReason.restartRequired ? 500 : 2000 * retry);
      }
    }
  });
}

const reply = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readJson = req => new Promise(resolve => {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/status') return reply(res, 200, status);
    if (req.method === 'GET' && req.url === '/groups') {
      if (status.state !== 'open' || !sock) return reply(res, 409, { error: 'WhatsApp is not linked' });
      const all = await sock.groupFetchAllParticipating();
      const groups = Object.values(all).map(g => ({ id: g.id, name: g.subject || 'Unnamed group', size: (g.participants || []).length }))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300);
      return reply(res, 200, groups);
    }
    if (req.method === 'POST' && req.url === '/send') {
      if (status.state !== 'open' || !sock) return reply(res, 409, { error: 'WhatsApp is not linked' });
      const { to = '', text = '' } = await readJson(req);
      // Groups only: a person's chat is never messaged, whatever the request says.
      if (!/^[0-9]+(-[0-9]+)?@g\.us$/.test(String(to))) return reply(res, 400, { error: 'only a group can be sent to' });
      if (!text || String(text).length > 4096) return reply(res, 400, { error: 'nothing to send' });
      await sock.sendMessage(String(to), { text: String(text) });
      return reply(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/logout') {
      try { await sock?.logout(); } catch {}
      fs.rmSync(authDir, { recursive: true, force: true });
      reply(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 200);
      return;
    }
    reply(res, 404, { error: 'not found' });
  } catch (e) {
    reply(res, 500, { error: String(e?.message || e).slice(0, 200) });
  }
});

try { fs.unlinkSync(socketPath); } catch {}
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o660));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); try { sock?.end(); } catch {} process.exit(0); });
connect();
