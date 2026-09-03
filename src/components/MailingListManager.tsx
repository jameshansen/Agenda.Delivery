"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMailingList,
  deleteMailingList,
  addSubscribers,
  updateSubscriber,
  setSubscriberStatus,
  deleteSubscribers,
  saveTemplate,
  deleteTemplate,
  generateTemplate,
  saveSenderSettings,
  sendTestEmail,
  saveMergeFields,
} from "@/app/actions";
import {
  BUILTIN_FIELDS,
  BUILTIN_KEYS,
  missingRequiredFields,
  previewValues,
  renderTemplate,
  toFieldKey,
} from "@/lib/mail-fields";
import {
  WEEKDAYS,
  MONTH_DAYS,
  describeSchedule,
  DEFAULT_SENDER_SUBSCRIBER_CAP,
} from "@/lib/mailing";
import HtmlEditor from "@/components/HtmlEditor";
import {
  Card,
  Dialog,
  SectionHeading,
  inputCls,
  labelCls,
  btnCls,
  primaryBtnCls,
} from "@/components/account-ui";

export type MList = {
  id: string;
  name: string;
  header: string;
  footer: string;
  sendPolicy: string;
  threshold: number;
  weekday: number;
  monthDay: string;
  audience: string;
  templateId: string | null;
  subscriberIds: string[];
  queued: number;
  lastSentAt: string;
};
export type Subscriber = {
  id: string;
  email: string;
  name: string;
  status: string;
  fields: Record<string, string>;
  createdAt: string;
};
export type Template = { id: string; name: string; html: string; isDefault: boolean };
export type MergeFieldRow = { key: string; label: string; value: string };
export type Sender = {
  provider: string;
  fromEmail: string;
  fromName: string;
  hasSendgridKey: boolean;
  hasSmtpPass: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpSecure: boolean;
};

type Section = "lists" | "subscribers" | "templates" | "sending";

const SECTIONS: { key: Section; label: string; icon: string }[] = [
  { key: "lists", label: "Mailing Lists", icon: "fa-envelopes-bulk" },
  { key: "subscribers", label: "Subscribers", icon: "fa-users" },
  { key: "templates", label: "Templates", icon: "fa-file-code" },
  { key: "sending", label: "Sending Settings", icon: "fa-paper-plane" },
];

export default function MailingListManager({
  lists,
  subscribers,
  templates,
  mergeFields,
  sender,
  accountEmail,
}: {
  lists: MList[];
  subscribers: Subscriber[];
  templates: Template[];
  mergeFields: MergeFieldRow[];
  sender: Sender;
  accountEmail: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [section, setSection] = useState<Section>("lists");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run<T extends { ok: boolean; error?: string }>(
    fn: () => Promise<T | void>,
    onDone?: (res: T) => void,
  ) {
    setErr(null);
    setNote(null);
    start(async () => {
      const res = (await fn()) as T | undefined;
      if (res && !res.ok) {
        setErr(res.error ?? "Something went wrong.");
        return;
      }
      if (res) onDone?.(res);
      router.refresh();
    });
  }

  const activeCount = subscribers.filter((s) => s.status === "active").length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-black/10 pb-2">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => { setSection(s.key); setErr(null); setNote(null); }}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              section === s.key ? "bg-green/10 text-green-dark" : "text-ink-soft hover:text-ink"
            }`}
          >
            <i className={`fa-solid ${s.icon} mr-1.5 text-xs`} />
            {s.label}
          </button>
        ))}
      </div>

      {err && <div className="mt-4 rounded-lg bg-rose-500/10 px-4 py-2 text-sm text-rose-700">{err}</div>}
      {note && <div className="mt-4 rounded-lg bg-green/10 px-4 py-2 text-sm text-green-dark">{note}</div>}

      <div className="mt-5">
        {section === "lists" && (
          <ListsSection
            lists={lists}
            subscribers={subscribers}
            templates={templates}
            activeCount={activeCount}
            pending={pending}
            run={run}
            onNote={setNote}
          />
        )}
        {section === "subscribers" && (
          <SubscribersSection
            subscribers={subscribers}
            mergeFields={mergeFields}
            capped={sender.provider === "default"}
            pending={pending}
            run={run}
            onNote={setNote}
          />
        )}
        {section === "templates" && (
          <TemplatesSection
            templates={templates}
            mergeFields={mergeFields}
            pending={pending}
            run={run}
            onNote={setNote}
            onError={setErr}
          />
        )}
        {section === "sending" && (
          <SendingSection
            sender={sender}
            templates={templates}
            mergeFields={mergeFields}
            accountEmail={accountEmail}
            pending={pending}
            run={run}
            onNote={setNote}
            onError={setErr}
          />
        )}
      </div>
    </div>
  );
}

/* ══════════════ Mailing lists ══════════════ */

type RunFn = <T extends { ok: boolean; error?: string }>(
  fn: () => Promise<T | void>,
  onDone?: (res: T) => void,
) => void;

function ListsSection({
  lists, subscribers, templates, activeCount, pending, run, onNote,
}: {
  lists: MList[];
  subscribers: Subscriber[];
  templates: Template[];
  activeCount: number;
  pending: boolean;
  run: RunFn;
  onNote: (s: string | null) => void;
}) {
  const [edit, setEdit] = useState<MList | "new" | null>(null);

  return (
    <section>
      <SectionHeading
        title="Mailing lists"
        hint="Actions queue updates into a list. A list sends when its queue fills up, or on the day you choose."
        action={
          <button onClick={() => setEdit("new")} className={primaryBtnCls}>
            <i className="fa-solid fa-plus mr-1" /> New list
          </button>
        }
      />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {lists.map((l) => {
          const recipients = l.audience === "all" ? activeCount : l.subscriberIds.length;
          const tpl = templates.find((t) => t.id === l.templateId);
          return (
            <div key={l.id} className="rounded-2xl border border-black/10 bg-white/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{l.name}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {recipients} recipient{recipients !== 1 ? "s" : ""}
                    {l.audience === "all" ? " (all subscribers)" : ""} · sends {describeSchedule(l)}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    Template: {tpl?.name ?? "Agenda.delivery default"}
                    {l.lastSentAt && l.lastSentAt !== "—" ? ` · last sent ${l.lastSentAt}` : ""}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-rust/10 px-2 py-0.5 text-xs text-rust">
                  {l.queued} queued
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setEdit(l)} className={btnCls}>Edit</button>
                <button
                  onClick={() => run(() => deleteMailingList({ id: l.id }))}
                  className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-rose-500 hover:text-rose-600"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {lists.length === 0 && <p className="text-sm text-ink-soft">No mailing lists yet.</p>}
      </div>

      {edit && (
        <ListDialog
          list={edit === "new" ? null : edit}
          subscribers={subscribers}
          templates={templates}
          pending={pending}
          onClose={() => setEdit(null)}
          onSave={(input) =>
            run(
              async () => {
                const res = await saveMailingList(input);
                if (res.ok) {
                  setEdit(null);
                  onNote("Mailing list saved.");
                }
                return res;
              },
            )
          }
        />
      )}
    </section>
  );
}

function ListDialog({
  list, subscribers, templates, pending, onClose, onSave,
}: {
  list: MList | null;
  subscribers: Subscriber[];
  templates: Template[];
  pending: boolean;
  onClose: () => void;
  onSave: (input: {
    id?: string;
    name: string;
    header: string;
    footer: string;
    sendPolicy: "threshold" | "weekly" | "monthly";
    threshold: number;
    weekday: number;
    monthDay: string;
    audience: "all" | "selected";
    templateId: string | null;
    subscriberIds: string[];
  }) => void;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const [header, setHeader] = useState(list?.header ?? "");
  const [footer, setFooter] = useState(list?.footer ?? "");
  const [sendPolicy, setSendPolicy] = useState<"threshold" | "weekly" | "monthly">(
    (list?.sendPolicy as "threshold" | "weekly" | "monthly") ?? "threshold",
  );
  const [threshold, setThreshold] = useState(list?.threshold ?? 5);
  const [weekday, setWeekday] = useState(list?.weekday ?? 0);
  const [monthDay, setMonthDay] = useState(list?.monthDay ?? "first");
  const [audience, setAudience] = useState<"all" | "selected">(
    (list?.audience as "all" | "selected") ?? "all",
  );
  const [templateId, setTemplateId] = useState(list?.templateId ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(list?.subscriberIds ?? []));

  const active = subscribers.filter((s) => s.status === "active");

  return (
    <Dialog title={list ? "Edit mailing list" : "New mailing list"} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Neighbourhood watch digest" />
          </div>
          <div>
            <label className={labelCls}>Header</label>
            <textarea value={header} onChange={(e) => setHeader(e.target.value)} rows={2} className={inputCls} placeholder="Intro shown at the top of every send" />
          </div>
          <div>
            <label className={labelCls}>Footer</label>
            <textarea value={footer} onChange={(e) => setFooter(e.target.value)} rows={2} className={inputCls} placeholder="Signature, contact details, etc." />
          </div>
          <div>
            <label className={labelCls}>Template</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
              <option value="">Agenda.delivery default</option>
              {templates.filter((t) => !t.isDefault).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl bg-row/60 p-3">
            <label className={labelCls}>Send</label>
            <select
              value={sendPolicy}
              onChange={(e) => setSendPolicy(e.target.value as typeof sendPolicy)}
              className={inputCls}
            >
              <option value="threshold">When the queue reaches a threshold</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>

            {sendPolicy === "threshold" && (
              <div className="mt-2">
                <label className={labelCls}>Threshold (queued items)</label>
                <input
                  type="number"
                  min={1}
                  value={threshold}
                  onChange={(e) => setThreshold(parseInt(e.target.value) || 1)}
                  className={inputCls}
                />
              </div>
            )}
            {sendPolicy === "weekly" && (
              <div className="mt-2">
                <label className={labelCls}>On</label>
                <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={inputCls}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            {sendPolicy === "monthly" && (
              <div className="mt-2">
                <label className={labelCls}>On</label>
                <select value={monthDay} onChange={(e) => setMonthDay(e.target.value)} className={inputCls}>
                  {MONTH_DAYS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            )}
            <p className="mt-2 text-xs text-ink-soft">
              Scheduled sends only go out when there is something queued.
            </p>
          </div>
        </div>

        <div>
          <label className={labelCls}>Who receives it</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className={inputCls}>
            <option value="all">All subscribers ({active.length})</option>
            <option value="selected">Selected subscribers</option>
          </select>

          {audience === "selected" && (
            <div className="mt-3">
              <SubscriberPicker
                subscribers={active}
                picked={picked}
                onChange={setPicked}
              />
            </div>
          )}
          {audience === "all" && (
            <p className="mt-2 text-xs text-ink-soft">
              Everyone on your account&apos;s subscriber list, including people you add later.
            </p>
          )}
        </div>
      </div>

      <button
        disabled={pending}
        onClick={() =>
          onSave({
            id: list?.id,
            name, header, footer,
            sendPolicy, threshold, weekday, monthDay,
            audience,
            templateId: templateId || null,
            subscriberIds: [...picked],
          })
        }
        className={`mt-5 w-full ${primaryBtnCls} py-2`}
      >
        {list ? "Save changes" : "Create list"}
      </button>
    </Dialog>
  );
}

/** Search + bulk-select list picker used inside the mailing-list dialog. */
function SubscriberPicker({
  subscribers, picked, onChange,
}: {
  subscribers: Subscriber[];
  picked: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return subscribers;
    return subscribers.filter(
      (s) => s.email.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle),
    );
  }, [subscribers, q]);

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white/60 p-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={inputCls}
        placeholder="Search subscribers…"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => onChange(new Set([...picked, ...shown.map((s) => s.id)]))}
          className="text-green hover:text-green-dark"
        >
          select {q ? "all matching" : "all"} ({shown.length})
        </button>
        <button
          onClick={() => {
            const next = new Set(picked);
            for (const s of shown) next.delete(s.id);
            onChange(next);
          }}
          className="text-ink-soft hover:text-ink"
        >
          deselect shown
        </button>
        <span className="ml-auto text-ink-soft">{picked.size} selected</span>
      </div>
      <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
        {shown.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-row/60">
            <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="h-3.5 w-3.5" />
            <span className="min-w-0 truncate">
              {s.name ? <span className="mr-1">{s.name}</span> : null}
              <span className="text-ink-soft">{s.email}</span>
            </span>
          </label>
        ))}
        {shown.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-soft">No subscribers match.</p>}
      </div>
    </div>
  );
}

/* ══════════════ Subscribers ══════════════ */

function SubscribersSection({
  subscribers, mergeFields, capped, pending, run, onNote,
}: {
  subscribers: Subscriber[];
  mergeFields: MergeFieldRow[];
  /** True while sending through the shared relay, which is capped. */
  capped: boolean;
  pending: boolean;
  run: RunFn;
  onNote: (s: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "unsubscribed">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Subscriber | null>(null);
  const full = capped && subscribers.length >= DEFAULT_SENDER_SUBSCRIBER_CAP;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return subscribers.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!needle) return true;
      return s.email.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle);
    });
  }, [subscribers, q, statusFilter]);

  const allShownSelected = shown.length > 0 && shown.every((s) => selected.has(s.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function bulk(fn: (ids: string[]) => Promise<{ ok: boolean; error?: string }>, label: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    run(async () => {
      const res = await fn(ids);
      if (res.ok) {
        setSelected(new Set());
        onNote(`${ids.length} subscriber${ids.length !== 1 ? "s" : ""} ${label}.`);
      }
      return res;
    });
  }

  return (
    <section>
      <SectionHeading
        title="Subscribers"
        hint="One address book for your whole account. Any mailing list can send to all of them, or to a selection."
        action={
          <button onClick={() => setAddOpen(true)} disabled={full} className={primaryBtnCls}>
            <i className="fa-solid fa-user-plus mr-1" /> Add subscribers
          </button>
        }
      />

      {capped && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${full ? "bg-amber-500/10 text-amber-800" : "bg-row/60 text-ink-soft"}`}>
          <i className={`fa-solid ${full ? "fa-triangle-exclamation" : "fa-circle-info"} mr-1.5`} />
          {subscribers.length} of {DEFAULT_SENDER_SUBSCRIBER_CAP} subscribers used on the
          built-in sender. Connect SendGrid or your own SMTP server in Sending Settings
          to remove the limit.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${inputCls} max-w-xs`}
          placeholder="Search name or email…"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className={`${inputCls} max-w-[12rem]`}
        >
          <option value="all">All ({subscribers.length})</option>
          <option value="active">Active ({subscribers.filter((s) => s.status === "active").length})</option>
          <option value="unsubscribed">Unsubscribed ({subscribers.filter((s) => s.status !== "active").length})</option>
        </select>
        <span className="ml-auto text-xs text-ink-soft">{shown.length} shown</span>
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-row/60 px-3 py-2 text-sm">
          <span className="text-ink-soft">{selected.size} selected</span>
          <button disabled={pending} onClick={() => bulk((ids) => setSubscriberStatus({ ids, status: "active" }), "marked active")} className={btnCls}>
            Mark active
          </button>
          <button disabled={pending} onClick={() => bulk((ids) => setSubscriberStatus({ ids, status: "unsubscribed" }), "unsubscribed")} className={btnCls}>
            Unsubscribe
          </button>
          <button
            disabled={pending}
            onClick={() => bulk((ids) => deleteSubscribers({ ids }), "deleted")}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-rose-500 hover:text-rose-600 disabled:opacity-40"
          >
            Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-ink-soft hover:text-ink">
            clear selection
          </button>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-black/10 bg-white/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-ink-soft">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allShownSelected}
                  onChange={() => {
                    const next = new Set(selected);
                    if (allShownSelected) for (const s of shown) next.delete(s.id);
                    else for (const s of shown) next.add(s.id);
                    setSelected(next);
                  }}
                  className="h-3.5 w-3.5"
                />
              </th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Added</th>
              <th className="w-16 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className="border-b border-black/5 last:border-0 hover:bg-row/40">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="h-3.5 w-3.5" aria-label={`Select ${s.email}`} />
                </td>
                <td className="break-all px-3 py-2">{s.email}</td>
                <td className="px-3 py-2 text-ink-soft">{s.name || "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    s.status === "active" ? "bg-green/10 text-green-dark" : "bg-ink/5 text-ink-soft"
                  }`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-ink-soft">{s.createdAt}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setEditing(s)} className="text-xs text-green hover:text-green-dark">edit</button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-soft">No subscribers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <Dialog title="Add subscribers" onClose={() => setAddOpen(false)}>
          <AddSubscribersForm
            pending={pending}
            onSubmit={(raw) =>
              run(async () => {
                const res = await addSubscribers({ raw });
                if (res.ok) {
                  setAddOpen(false);
                  const r = res as { added?: number; skipped?: number; invalid?: number };
                  onNote(
                    `Added ${r.added ?? 0}` +
                      (r.skipped ? `, skipped ${r.skipped} already on the list` : "") +
                      (r.invalid ? `, ${r.invalid} line(s) were not valid addresses` : "") +
                      ".",
                  );
                }
                return res;
              })
            }
          />
        </Dialog>
      )}

      {editing && (
        <EditSubscriberDialog
          subscriber={editing}
          mergeFields={mergeFields}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            run(async () => {
              const res = await updateSubscriber(input);
              if (res.ok) setEditing(null);
              return res;
            })
          }
        />
      )}
    </section>
  );
}

function AddSubscribersForm({ pending, onSubmit }: { pending: boolean; onSubmit: (raw: string) => void }) {
  const [raw, setRaw] = useState("");
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Paste addresses</label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          className={`${inputCls} font-mono text-xs`}
          placeholder={"sam@example.com\nSam Rivers <sam@example.com>\nSam Rivers, sam@example.com"}
        />
        <p className="mt-1 text-xs text-ink-soft">
          One per line. Names are optional, in angle brackets or after a comma.
          Addresses already on your list are skipped.
        </p>
      </div>
      <button disabled={pending || !raw.trim()} onClick={() => onSubmit(raw)} className={`w-full ${primaryBtnCls} py-2`}>
        Add subscribers
      </button>
    </div>
  );
}

function EditSubscriberDialog({
  subscriber, mergeFields, pending, onClose, onSave,
}: {
  subscriber: Subscriber;
  mergeFields: MergeFieldRow[];
  pending: boolean;
  onClose: () => void;
  onSave: (i: { id: string; name: string; email: string; fields: Record<string, string> }) => void;
}) {
  const [name, setName] = useState(subscriber.name);
  const [email, setEmail] = useState(subscriber.email);
  const [fields, setFields] = useState<Record<string, string>>(subscriber.fields ?? {});

  // Only "owned" fields make sense per subscriber; the automatic ones are
  // filled at send time and can't be overridden.
  const editable = [
    ...BUILTIN_FIELDS.filter((f) => f.kind === "owned"),
    ...mergeFields.filter((f) => !BUILTIN_KEYS.has(f.key)),
  ];

  return (
    <Dialog title="Edit subscriber" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        {editable.length > 0 && (
          <div>
            <label className={labelCls}>Field overrides (optional)</label>
            <div className="space-y-2">
              {editable.map((f) => (
                <div key={f.key}>
                  <div className="text-xs text-ink-soft">{f.label}</div>
                  <input
                    value={fields[f.key] ?? ""}
                    onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                    className={inputCls}
                    placeholder="leave blank to use the account value"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <button
          disabled={pending}
          onClick={() => {
            const trimmed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()));
            onSave({ id: subscriber.id, name, email, fields: trimmed });
          }}
          className={`w-full ${primaryBtnCls} py-2`}
        >
          Save subscriber
        </button>
      </div>
    </Dialog>
  );
}

/* ══════════════ Templates ══════════════ */

function TemplatesSection({
  templates, mergeFields, pending, run, onNote, onError,
}: {
  templates: Template[];
  mergeFields: MergeFieldRow[];
  pending: boolean;
  run: RunFn;
  onNote: (s: string | null) => void;
  onError: (s: string | null) => void;
}) {
  const [editing, setEditing] = useState<{ id?: string; name: string; html: string } | null>(null);
  const [previewing, setPreviewing] = useState<Template | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const fieldChips = [
    ...BUILTIN_FIELDS.map((f) => ({ key: f.key, label: f.label })),
    ...mergeFields.filter((f) => !BUILTIN_KEYS.has(f.key)).map((f) => ({ key: f.key, label: f.label })),
  ];
  const fieldValues = Object.fromEntries(mergeFields.map((f) => [f.key, f.value]));

  return (
    <section>
      <SectionHeading
        title="Templates"
        hint="The HTML wrapper around every send. Start from the built-in default, write your own, or have the model draft one."
        action={
          <div className="flex gap-2">
            <button onClick={() => setAiOpen(true)} className={btnCls}>
              <i className="fa-solid fa-wand-magic-sparkles mr-1" /> Generate from AI
            </button>
            <button
              onClick={() =>
                setEditing({
                  name: "",
                  html: templates.find((t) => t.isDefault)?.html ?? "<div>{{content}}</div>",
                })
              }
              className={primaryBtnCls}
            >
              <i className="fa-solid fa-plus mr-1" /> New template
            </button>
          </div>
        }
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <Card key={t.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.name}</div>
                {t.isDefault && (
                  <span className="mt-0.5 inline-block rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">
                    built in
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreviewing(t)}
              title="Open full preview"
              className="group relative mt-2 block w-full overflow-hidden rounded-lg border border-black/10 bg-white"
            >
              <iframe
                title={`${t.name} preview`}
                sandbox=""
                srcDoc={renderTemplate(t.html, previewValues(fieldValues))}
                scrolling="no"
                // A 160px-tall thumbnail can't be scrolled usefully, so it
                // stays inert and the click opens the scrollable modal.
                className="pointer-events-none h-40 w-full"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-ink/0 text-sm text-transparent transition-colors group-hover:bg-ink/40 group-hover:text-paper">
                <i className="fa-solid fa-expand mr-1.5" /> View
              </span>
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setPreviewing(t)} className={btnCls}>
                View
              </button>
              {t.isDefault ? (
                <button
                  onClick={() => setEditing({ name: `${t.name} (copy)`, html: t.html })}
                  className={btnCls}
                >
                  Duplicate to edit
                </button>
              ) : (
                <>
                  <button onClick={() => setEditing({ id: t.id, name: t.name, html: t.html })} className={btnCls}>
                    Edit
                  </button>
                  <button
                    onClick={() => run(() => deleteTemplate({ id: t.id }))}
                    className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-rose-500 hover:text-rose-600"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <TemplateDialog
          template={editing}
          fields={fieldChips}
          fieldValues={fieldValues}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            run(async () => {
              const res = await saveTemplate(input);
              if (res.ok) {
                setEditing(null);
                onNote("Template saved.");
              }
              return res;
            })
          }
        />
      )}

      {previewing && (
        <TemplatePreviewDialog
          template={previewing}
          fieldValues={fieldValues}
          onClose={() => setPreviewing(null)}
          onDuplicate={() => {
            setEditing({ name: `${previewing.name} (copy)`, html: previewing.html });
            setPreviewing(null);
          }}
          onEdit={
            previewing.isDefault
              ? undefined
              : () => {
                  setEditing({ id: previewing.id, name: previewing.name, html: previewing.html });
                  setPreviewing(null);
                }
          }
        />
      )}

      {aiOpen && (
        <AiTemplateDialog
          onClose={() => setAiOpen(false)}
          onGenerated={(html) => {
            setAiOpen(false);
            setEditing({ name: "AI template", html });
          }}
          onError={onError}
        />
      )}
    </section>
  );
}

/** Full-size, scrollable preview. The built-in default can only be looked at
 * and copied -- it is shared by every account, so nobody edits it in place. */
function TemplatePreviewDialog({
  template, fieldValues, onClose, onDuplicate, onEdit,
}: {
  template: Template;
  fieldValues: Record<string, string>;
  onClose: () => void;
  onDuplicate: () => void;
  onEdit?: () => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const rendered = renderTemplate(template.html, previewValues(fieldValues));

  return (
    <Dialog title={template.name} onClose={onClose} wide>
      {template.isDefault && (
        <p className="mb-3 rounded-lg bg-row/60 px-3 py-2 text-xs text-ink-soft">
          This is the built-in template every account starts with. It is read-only —
          duplicate it to make a version you can change.
        </p>
      )}

      <div className="mb-2 flex items-center gap-1">
        <button
          onClick={() => setShowSource(false)}
          className={`rounded px-2 py-1 text-xs ${!showSource ? "bg-green text-paper" : "text-ink-soft hover:text-ink"}`}
        >
          Preview
        </button>
        <button
          onClick={() => setShowSource(true)}
          className={`rounded px-2 py-1 text-xs ${showSource ? "bg-green text-paper" : "text-ink-soft hover:text-ink"}`}
        >
          HTML
        </button>
      </div>

      {showSource ? (
        <pre className="h-[60vh] overflow-auto rounded-lg border border-black/10 bg-white p-4 font-mono text-xs text-black">
          {template.html}
        </pre>
      ) : (
        <iframe
          title={`${template.name} full preview`}
          sandbox=""
          srcDoc={rendered}
          className="h-[60vh] w-full rounded-lg border border-black/10 bg-white"
        />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {onEdit && (
          <button onClick={onEdit} className={primaryBtnCls}>
            Edit this template
          </button>
        )}
        <button onClick={onDuplicate} className={btnCls}>
          Duplicate to edit
        </button>
        <button onClick={onClose} className={`${btnCls} ml-auto`}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function TemplateDialog({
  template, fields, fieldValues, pending, onClose, onSave,
}: {
  template: { id?: string; name: string; html: string };
  fields: { key: string; label: string }[];
  fieldValues: Record<string, string>;
  pending: boolean;
  onClose: () => void;
  onSave: (i: { id?: string; name: string; html: string }) => void;
}) {
  const [name, setName] = useState(template.name);
  const [html, setHtml] = useState(template.html);
  const missing = missingRequiredFields(html);

  return (
    <Dialog title={template.id ? "Edit template" : "New template"} onClose={onClose} wide>
      <div className="mb-3">
        <label className={labelCls}>Template name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Monthly newsletter" />
      </div>
      <HtmlEditor
        value={html}
        onChange={setHtml}
        fields={fields}
        previewHtml={renderTemplate(html, previewValues(fieldValues))}
      />
      {missing.length > 0 && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          <i className="fa-solid fa-triangle-exclamation mr-1.5" />
          Add {missing.map((f) => `{{${f.key}}}`).join(" and ")} before saving —{" "}
          {missing.map((f) => f.why).join(", and ")}.
        </p>
      )}
      <button
        disabled={pending || missing.length > 0}
        onClick={() => onSave({ id: template.id, name, html })}
        className={`mt-4 w-full ${primaryBtnCls} py-2`}
      >
        Save template
      </button>
    </Dialog>
  );
}

function AiTemplateDialog({
  onClose, onGenerated, onError,
}: {
  onClose: () => void;
  onGenerated: (html: string) => void;
  onError: (s: string | null) => void;
}) {
  const [logoUrl, setLogoUrl] = useState("");
  const [info, setInfo] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    onError(null);
    try {
      const res = await generateTemplate({ logoUrl, info, prompt });
      if (res.ok && res.html) onGenerated(res.html);
      else onError(res.error ?? "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Generate a template" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Logo image URL</label>
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className={inputCls}
            placeholder="https://example.org/logo.png"
          />
          <p className="mt-1 text-xs text-ink-soft">
            A hosted URL, not an upload — most email clients refuse to render an
            embedded image, and the ones that do will flag the message as spam.
          </p>
        </div>
        <div>
          <label className={labelCls}>About your organization</label>
          <textarea
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            rows={3}
            className={inputCls}
            placeholder="Langley Urbanist Society — a volunteer group following council decisions on housing and transit."
          />
        </div>
        <div>
          <label className={labelCls}>What should it look like?</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className={inputCls}
            placeholder="Clean and serious. Deep green header band, cream body, generous line spacing."
          />
        </div>
        {busy && (
          <p className="text-xs text-ink-soft">
            <i className="fa-solid fa-circle-notch fa-spin mr-1.5" />
            Drafting the template — this takes up to a minute.
          </p>
        )}
        <button disabled={busy} onClick={generate} className={`w-full ${primaryBtnCls} py-2`}>
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
    </Dialog>
  );
}

/* ══════════════ Sending settings ══════════════ */

function SendingSection({
  sender, templates, mergeFields, accountEmail, pending, run, onNote, onError,
}: {
  sender: Sender;
  templates: Template[];
  mergeFields: MergeFieldRow[];
  accountEmail: string;
  pending: boolean;
  run: RunFn;
  onNote: (s: string | null) => void;
  onError: (s: string | null) => void;
}) {
  const ownedBuiltins = BUILTIN_FIELDS.filter((f) => f.kind === "owned");
  const autoBuiltins = BUILTIN_FIELDS.filter((f) => f.kind === "auto");
  const stored = Object.fromEntries(mergeFields.map((f) => [f.key, f]));

  const [rows, setRows] = useState<MergeFieldRow[]>([
    ...ownedBuiltins.map((f) => ({ key: f.key, label: f.label, value: stored[f.key]?.value ?? "" })),
    ...mergeFields.filter((f) => !BUILTIN_KEYS.has(f.key)),
  ]);

  const [provider, setProvider] = useState<"default" | "sendgrid" | "smtp">(
    (sender.provider as "default" | "sendgrid" | "smtp") ?? "default",
  );
  const [fromEmail, setFromEmail] = useState(sender.fromEmail);
  const [fromName, setFromName] = useState(sender.fromName);
  const [sendgridKey, setSendgridKey] = useState("");
  const [smtpHost, setSmtpHost] = useState(sender.smtpHost);
  const [smtpPort, setSmtpPort] = useState(sender.smtpPort);
  const [smtpUser, setSmtpUser] = useState(sender.smtpUser);
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(sender.smtpSecure);

  const [testTo, setTestTo] = useState(accountEmail);
  const [testTemplate, setTestTemplate] = useState("");
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    setTesting(true);
    onError(null);
    onNote(null);
    try {
      const res = await sendTestEmail({ to: testTo, templateId: testTemplate || null });
      if (res.ok) onNote(`Test email sent to ${testTo}.`);
      else onError(res.error ?? "Sending failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Template fields"
          hint="Values dropped into your templates wherever the matching placeholder appears. Add your own for anything else you want to reuse."
        />
        <div className="mt-4 max-w-2xl space-y-2">
          {rows.map((f, i) => {
            const builtin = BUILTIN_KEYS.has(f.key);
            const hint = BUILTIN_FIELDS.find((b) => b.key === f.key)?.hint;
            return (
              <div key={f.key || `new-${i}`} className="flex flex-wrap items-start gap-2">
                <div className="w-56 shrink-0">
                  {builtin ? (
                    <>
                      <div className="text-sm">{f.label}</div>
                      <code className="text-[10px] text-ink-soft">{`{{${f.key}}}`}</code>
                    </>
                  ) : (
                    <>
                      <input
                        value={f.label}
                        onChange={(e) => {
                          const next = [...rows];
                          next[i] = { ...f, label: e.target.value, key: toFieldKey(e.target.value) };
                          setRows(next);
                        }}
                        className={inputCls}
                        placeholder="Field name"
                      />
                      <code className="text-[10px] text-ink-soft">
                        {f.key ? `{{${f.key}}}` : " "}
                      </code>
                    </>
                  )}
                </div>
                <div className="min-w-[12rem] flex-1">
                  <input
                    value={f.value}
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = { ...f, value: e.target.value };
                      setRows(next);
                    }}
                    className={inputCls}
                    placeholder={hint ?? "Value"}
                  />
                </div>
                {!builtin && (
                  <button
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="mt-2 text-xs text-ink-soft hover:text-rose-600"
                    aria-label="Remove field"
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                )}
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setRows([...rows, { key: "", label: "", value: "" }])}
              className={btnCls}
            >
              <i className="fa-solid fa-plus mr-1" /> Add field
            </button>
            <button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await saveMergeFields({ fields: rows });
                  if (res.ok) onNote("Fields saved.");
                  return res;
                })
              }
              className={primaryBtnCls}
            >
              Save fields
            </button>
          </div>
        </div>

        <details className="mt-4 max-w-2xl text-sm">
          <summary className="cursor-pointer text-ink-soft hover:text-ink">
            Fields filled in automatically
          </summary>
          <ul className="mt-2 space-y-1">
            {autoBuiltins.map((f) => (
              <li key={f.key} className="text-xs text-ink-soft">
                <code className="text-ink">{`{{${f.key}}}`}</code> — {f.hint}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section>
        <SectionHeading
          title="Where mail is sent from"
          hint="By default everything relays through agenda.delivery. Connect your own provider to send under your domain."
        />
        <div className="mt-4 max-w-2xl space-y-3">
          <div>
            <label className={labelCls}>Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className={inputCls}
            >
              <option value="default">agenda.delivery (update@agenda.delivery)</option>
              <option value="sendgrid">SendGrid API</option>
              <option value="smtp">Your own SMTP server</option>
            </select>
          </div>

          {provider === "default" ? (
            <p className="text-xs text-ink-soft">
              Sends as <code>update@agenda.delivery</code>, signed by our domain. Nothing to configure.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>From address</label>
                  <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className={inputCls} placeholder="news@yourdomain.org" />
                </div>
                <div>
                  <label className={labelCls}>From name</label>
                  <input value={fromName} onChange={(e) => setFromName(e.target.value)} className={inputCls} placeholder="Langley Urbanist Society" />
                </div>
              </div>

              {provider === "sendgrid" && (
                <div>
                  <label className={labelCls}>SendGrid API key</label>
                  <input
                    type="password"
                    value={sendgridKey}
                    onChange={(e) => setSendgridKey(e.target.value)}
                    className={inputCls}
                    placeholder={sender.hasSendgridKey ? "•••••••• (saved — type to replace)" : "SG.xxxxxxxx"}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-ink-soft">
                    Verify the from address as a SendGrid sender identity first, or SendGrid will reject the send.
                  </p>
                </div>
              )}

              {provider === "smtp" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <div>
                      <label className={labelCls}>SMTP host</label>
                      <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={inputCls} placeholder="smtp.yourdomain.org" />
                    </div>
                    <div>
                      <label className={labelCls}>Port</label>
                      <input
                        type="number"
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Username</label>
                      <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} className={inputCls} autoComplete="off" />
                    </div>
                    <div>
                      <label className={labelCls}>Password</label>
                      <input
                        type="password"
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                        className={inputCls}
                        placeholder={sender.hasSmtpPass ? "•••••••• (saved — type to replace)" : ""}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} className="h-3.5 w-3.5" />
                    Require TLS (port 465 always uses implicit TLS)
                  </label>
                </>
              )}
            </>
          )}

          <button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await saveSenderSettings({
                  provider, fromEmail, fromName, sendgridKey,
                  smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure,
                });
                if (res.ok) {
                  setSendgridKey("");
                  setSmtpPass("");
                  onNote("Sending settings saved.");
                }
                return res;
              })
            }
            className={primaryBtnCls}
          >
            Save sending settings
          </button>
        </div>
      </section>

      <section>
        <SectionHeading title="Send a test" hint="Delivers one template, filled with sample content, through the settings above." />
        <div className="mt-4 flex max-w-2xl flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label className={labelCls}>To</label>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} className={inputCls} placeholder="you@example.com" />
          </div>
          <div className="min-w-[12rem] flex-1">
            <label className={labelCls}>Template</label>
            <select value={testTemplate} onChange={(e) => setTestTemplate(e.target.value)} className={inputCls}>
              <option value="">Agenda.delivery default</option>
              {templates.filter((t) => !t.isDefault).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <button disabled={testing} onClick={sendTest} className={primaryBtnCls}>
            {testing ? "Sending…" : "Send test email"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Save your settings first — the test uses what is stored, not what is on screen.
        </p>
      </section>
    </div>
  );
}
