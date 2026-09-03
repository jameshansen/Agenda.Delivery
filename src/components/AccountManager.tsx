"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTarget,
  deleteTarget,
  createArtifact,
  deleteArtifact,
  createRule,
  deleteRule,
} from "@/app/actions";
import { Card, Dialog, inputCls, labelCls } from "@/components/account-ui";

type Sub = { moduleId: string; slug: string; name: string; region: string; channel: string };
type Target = { id: string; kind: string; name: string; url: string };
type Artifact = { id: string; kind: string; name: string; promptText: string | null; keywords: string | null };
type Rule = {
  id: string;
  moduleId: string;
  trigger: string;
  artifactId: string | null;
  contentMode: string;
  actionKind: string;
  targetId: string | null;
  listId: string | null;
};
/** Only what the actions flowchart needs — the full shape lives in
 * MailingListManager, which owns the Mailing Lists tab. */
type MList = { id: string; name: string };

const CONTENT_LABEL: Record<string, string> = {
  summary: "AI summary",
  link: "Agenda link",
  full_text: "Full agenda text",
};

export default function AccountManager({
  subscriptions,
  targets,
  artifacts,
  rules,
  mailingLists,
}: {
  subscriptions: Sub[];
  targets: Target[];
  artifacts: Artifact[];
  rules: Rule[];
  mailingLists: MList[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);

  const moduleName = (id: string) => subscriptions.find((s) => s.moduleId === id)?.name ?? "Unknown";

  function run(fn: () => Promise<{ ok: boolean; error?: string } | void>) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res && !res.ok) setErr(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-10">
      {err && (
        <div className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm text-rose-700">{err}</div>
      )}

      {/* Three-column flowchart */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
        {/* Column 1: Subscriptions */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green/15 text-xs text-green-dark">1</span>
            <h2 className="text-lg">Subscriptions</h2>
          </div>
          <p className="mb-3 text-xs text-ink-soft">The agendas you follow. Each can trigger an action.</p>
          {subscriptions.length === 0 ? (
            <Card className="text-sm text-ink-soft">No subscriptions yet.</Card>
          ) : (
            <div className="space-y-2">
              {subscriptions.map((s) => (
                <Card key={s.moduleId}>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-ink-soft">{s.region}</div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Column 2: Artifacts */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rust/15 text-xs text-rust">2</span>
            <h2 className="text-lg">Artifacts</h2>
          </div>
          <p className="mb-3 text-xs text-ink-soft">
            Transforms applied to an agenda. Summaries are kept indefinitely.
          </p>
          <div className="space-y-2">
            <Card className="flex items-center gap-2 bg-row/60">
              <i className="fa-solid fa-comment-dots text-violet-500" />
              <div>
                <div className="text-sm font-medium">AI summary</div>
                <div className="text-xs text-ink-soft">Built in · always available</div>
              </div>
            </Card>
            {artifacts.map((a) => {
              const detail = (a.kind === "keywords" ? a.keywords : a.promptText) ?? "";
              const typeLabel = a.kind === "keywords" ? "Keywords" : "Custom prompt";
              const long = detail.length > 90;
              const expanded = expandedArtifact === a.id;
              return (
                <Card key={a.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <i className={`fa-solid ${a.kind === "keywords" ? "fa-tags text-teal-600" : "fa-wand-magic-sparkles text-amber-600"}`} />
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">
                        {typeLabel}
                      </span>
                    </div>
                    <button
                      onClick={() => run(() => deleteArtifact({ id: a.id }))}
                      className="shrink-0 text-xs text-ink-soft hover:text-rose-600"
                      aria-label="Delete artifact"
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  </div>
                  <p className={`mt-1.5 whitespace-pre-wrap break-words text-xs text-ink-soft ${expanded || !long ? "" : "line-clamp-2"}`}>
                    {detail}
                  </p>
                  {long && (
                    <button
                      onClick={() => setExpandedArtifact(expanded ? null : a.id)}
                      className="mt-1 text-[11px] font-medium text-green hover:text-green-dark"
                    >
                      {expanded ? "show less" : "show more"}
                    </button>
                  )}
                </Card>
              );
            })}
            <button
              onClick={() => setArtifactOpen(true)}
              className="w-full rounded-xl border border-dashed border-black/20 py-2 text-sm text-ink-soft hover:border-green hover:text-green"
            >
              <i className="fa-solid fa-plus mr-1" /> New artifact
            </button>
          </div>
        </section>

        {/* Column 3: Actions */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 text-xs text-sky-700">3</span>
            <h2 className="text-lg">Actions</h2>
          </div>
          <p className="mb-3 text-xs text-ink-soft">When a subscription updates, deliver the content somewhere.</p>
          <div className="space-y-2">
            {rules.map((r) => {
              const contentLabel = r.artifactId
                ? artifacts.find((a) => a.id === r.artifactId)?.name ?? "Artifact"
                : CONTENT_LABEL[r.contentMode] ?? r.contentMode;
              const dest =
                r.actionKind === "email"
                  ? "My email"
                  : r.actionKind === "mailing_list"
                  ? mailingLists.find((l) => l.id === r.listId)?.name ?? "Mailing list"
                  : targets.find((t) => t.id === r.targetId)?.name ?? r.actionKind;
              const destIcon =
                r.actionKind === "discord" ? "fa-brands fa-discord text-indigo-500"
                : r.actionKind === "email" ? "fa-solid fa-envelope text-green-dark"
                : r.actionKind === "mailing_list" ? "fa-solid fa-envelopes-bulk text-rose-500"
                : "fa-solid fa-code text-slate-500";
              return (
                <Card key={r.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{moduleName(r.moduleId)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      <span className="rounded bg-ink/5 px-1.5 py-0.5">
                        {r.trigger === "new_summary" ? "new summary" : "new agenda"}
                      </span>
                      <i className="fa-solid fa-arrow-right text-[9px]" />
                      <span className="rounded bg-rust/10 px-1.5 py-0.5 text-rust">{contentLabel}</span>
                      <i className="fa-solid fa-arrow-right text-[9px]" />
                      <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5">
                        <i className={destIcon} /> {dest}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => run(() => deleteRule({ id: r.id }))}
                    className="text-xs text-ink-soft hover:text-rose-600"
                    aria-label="Delete action"
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </Card>
              );
            })}
            <button
              onClick={() => { setErr(null); setRuleOpen(true); }}
              disabled={subscriptions.length === 0}
              className="w-full rounded-xl border border-dashed border-black/20 py-2 text-sm text-ink-soft hover:border-green hover:text-green disabled:opacity-40"
            >
              <i className="fa-solid fa-plus mr-1" /> New action
            </button>
            {subscriptions.length === 0 && (
              <p className="text-xs text-ink-soft">Subscribe to an agenda first.</p>
            )}
          </div>
        </section>
      </div>

      {artifactOpen && (
        <ArtifactDialog
          pending={pending}
          onClose={() => setArtifactOpen(false)}
          onSave={(input) => run(async () => {
            const res = await createArtifact(input);
            if (res.ok) setArtifactOpen(false);
            return res;
          })}
        />
      )}

      {ruleOpen && (
        <RuleDialog
          pending={pending}
          subscriptions={subscriptions}
          artifacts={artifacts}
          targets={targets}
          mailingLists={mailingLists}
          onClose={() => setRuleOpen(false)}
          onCreateTarget={(input) => run(() => createTarget(input))}
          onDeleteTarget={(id) => run(() => deleteTarget({ id }))}
          onSave={(input) => run(async () => {
            const res = await createRule(input);
            if (res.ok) setRuleOpen(false);
            return res;
          })}
        />
      )}

    </div>
  );
}

/* ---- Dialogs ---- */

function ArtifactDialog({ pending, onClose, onSave }: {
  pending: boolean;
  onClose: () => void;
  onSave: (i: { kind: "custom_prompt" | "keywords"; name: string; promptText?: string; keywords?: string }) => void;
}) {
  const [kind, setKind] = useState<"custom_prompt" | "keywords">("custom_prompt");
  const [name, setName] = useState("");
  const [promptText, setPromptText] = useState("");
  const [keywords, setKeywords] = useState("");
  return (
    <Dialog title="New artifact" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputCls}>
            <option value="custom_prompt">Custom prompt</option>
            <option value="keywords">Keywords</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Budget watch" />
        </div>
        {kind === "custom_prompt" ? (
          <div>
            <label className={labelCls}>Prompt</label>
            <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={4} className={inputCls} placeholder="Summarize anything about zoning changes…" />
          </div>
        ) : (
          <div>
            <label className={labelCls}>Keywords (comma separated)</label>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={inputCls} placeholder="housing, budget, transit" />
          </div>
        )}
        <button
          disabled={pending}
          onClick={() => onSave({ kind, name, promptText, keywords })}
          className="w-full rounded-lg bg-green py-2 text-sm text-paper hover:opacity-90 disabled:opacity-50"
        >
          Create artifact
        </button>
      </div>
    </Dialog>
  );
}

function RuleDialog({
  pending, subscriptions, artifacts, targets, mailingLists, onClose, onSave, onCreateTarget, onDeleteTarget,
}: {
  pending: boolean;
  subscriptions: Sub[];
  artifacts: Artifact[];
  targets: Target[];
  mailingLists: MList[];
  onClose: () => void;
  onSave: (i: {
    moduleId: string; trigger: "new_agenda" | "new_summary";
    artifactId?: string | null; contentMode: "summary" | "link" | "full_text";
    actionKind: "email" | "script" | "discord" | "mailing_list"; targetId?: string | null; listId?: string | null;
  }) => void;
  onCreateTarget: (i: { kind: "script" | "discord"; name: string; url: string }) => void;
  onDeleteTarget: (id: string) => void;
}) {
  const [moduleId, setModuleId] = useState(subscriptions[0]?.moduleId ?? "");
  // Only trigger for now: a subscription publishes a new agenda.
  const trigger = "new_agenda" as const;
  // content value: "summary" | "link" | "full_text" | "artifact:<id>"
  const [content, setContent] = useState("summary");
  const [actionKind, setActionKind] = useState<"email" | "script" | "discord" | "mailing_list">("email");
  const [targetId, setTargetId] = useState("");
  const [listId, setListId] = useState(mailingLists[0]?.id ?? "");
  const [showNewTarget, setShowNewTarget] = useState(false);
  const [ntName, setNtName] = useState("");
  const [ntUrl, setNtUrl] = useState("");

  const kindTargets = targets.filter((t) => t.kind === actionKind);

  function submit() {
    const isArtifact = content.startsWith("artifact:");
    onSave({
      moduleId,
      trigger,
      artifactId: isArtifact ? content.slice("artifact:".length) : null,
      contentMode: isArtifact ? "summary" : (content as "summary" | "link" | "full_text"),
      actionKind,
      targetId: actionKind === "mailing_list" ? null : targetId,
      listId: actionKind === "mailing_list" ? listId : null,
    });
  }

  return (
    <Dialog title="New action" onClose={onClose}>
      <div className="space-y-4">
        {/* IF */}
        <div className="rounded-xl bg-row/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-dark">If</div>
          <label className={labelCls}>Subscription</label>
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className={inputCls}>
            {subscriptions.map((s) => <option key={s.moduleId} value={s.moduleId}>{s.name}</option>)}
          </select>
          <label className={`${labelCls} mt-2`}>Trigger</label>
          <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-sm text-ink">
            <i className="fa-solid fa-file-circle-plus text-green-dark" />
            publishes a new agenda
          </div>
        </div>

        {/* USE */}
        <div className="rounded-xl bg-row/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-rust">Use</div>
          <select value={content} onChange={(e) => setContent(e.target.value)} className={inputCls}>
            <option value="summary">AI summary</option>
            <option value="link">Agenda link</option>
            <option value="full_text">Full agenda text</option>
            {artifacts.map((a) => <option key={a.id} value={`artifact:${a.id}`}>Artifact: {a.name}</option>)}
          </select>
          {(() => {
            if (content === "summary") return <p className="mt-2 text-xs text-ink-soft">The plain-language AI summary of the agenda.</p>;
            if (content === "link") return <p className="mt-2 text-xs text-ink-soft">A link to the agenda on this source.</p>;
            if (content === "full_text") return <p className="mt-2 text-xs text-ink-soft">The full extracted agenda text.</p>;
            const a = artifacts.find((x) => x.id === content.slice("artifact:".length));
            if (!a) return null;
            return (
              <div className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <i className={`fa-solid ${a.kind === "keywords" ? "fa-tags text-teal-600" : "fa-wand-magic-sparkles text-amber-600"}`} />
                  {a.name}
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">
                    {a.kind === "keywords" ? "Keywords" : "Custom prompt"}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-ink-soft">
                  {(a.kind === "keywords" ? a.keywords : a.promptText) ?? ""}
                </p>
              </div>
            );
          })()}
        </div>

        {/* THEN */}
        <div className="rounded-xl bg-row/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-700">Then</div>
          <select value={actionKind} onChange={(e) => setActionKind(e.target.value as typeof actionKind)} className={inputCls}>
            <option value="email">Send to my email</option>
            <option value="discord">Post to Discord</option>
            <option value="script">Push to a script</option>
            <option value="mailing_list">Queue to a mailing list</option>
          </select>

          {actionKind === "email" ? (
            <p className="mt-2 text-xs text-ink-soft">Delivered to your account email address.</p>
          ) : actionKind === "mailing_list" ? (
            <div className="mt-2">
              <label className={labelCls}>Mailing list</label>
              {mailingLists.length === 0 ? (
                <p className="text-xs text-ink-soft">Create a mailing list below first.</p>
              ) : (
                <select value={listId} onChange={(e) => setListId(e.target.value)} className={inputCls}>
                  {mailingLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <div className="flex items-center justify-between">
                <label className={labelCls}>{actionKind === "discord" ? "Discord webhook" : "Script endpoint"}</label>
                <button onClick={() => setShowNewTarget((v) => !v)} className="text-xs text-green hover:text-green-dark">
                  {showNewTarget ? "cancel" : "+ new"}
                </button>
              </div>
              {kindTargets.length > 0 && !showNewTarget && (
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputCls}>
                  <option value="">Select…</option>
                  {kindTargets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              {kindTargets.length > 0 && !showNewTarget && targetId && (
                <button onClick={() => { onDeleteTarget(targetId); setTargetId(""); }} className="mt-1 text-xs text-ink-soft hover:text-rose-600">
                  delete this target
                </button>
              )}
              {(showNewTarget || kindTargets.length === 0) && (
                <div className="mt-2 space-y-2">
                  <input value={ntName} onChange={(e) => setNtName(e.target.value)} className={inputCls} placeholder="Target name" />
                  <input value={ntUrl} onChange={(e) => setNtUrl(e.target.value)} className={inputCls} placeholder="https://…" />
                  <button
                    disabled={pending}
                    onClick={() => { onCreateTarget({ kind: actionKind, name: ntName, url: ntUrl }); setNtName(""); setNtUrl(""); setShowNewTarget(false); }}
                    className="rounded-lg border border-green px-2.5 py-1 text-xs text-green hover:bg-green/10 disabled:opacity-50"
                  >
                    Save target
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          disabled={pending || !moduleId}
          onClick={submit}
          className="w-full rounded-lg bg-green py-2 text-sm text-paper hover:opacity-90 disabled:opacity-50"
        >
          Create action
        </button>
      </div>
    </Dialog>
  );
}
