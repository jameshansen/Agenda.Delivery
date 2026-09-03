"use client";

import { useEffect, useRef, useState } from "react";
import { inputCls, labelCls, primaryBtnCls } from "@/components/account-ui";

/**
 * Template editor: a contenteditable canvas with a formatting toolbar, an
 * HTML source view, and a live preview.
 *
 * The toolbar uses document.execCommand. It is deprecated but it is also the
 * only rich-text primitive every browser ships, and pulling in an editor
 * library to bold some text in an email template is not a trade worth making.
 * The source tab is the escape hatch for anything the toolbar can't express.
 */

type Mode = "design" | "source" | "preview";

const TOOLS: { cmd: string; arg?: string; icon: string; title: string }[] = [
  { cmd: "bold", icon: "fa-bold", title: "Bold" },
  { cmd: "italic", icon: "fa-italic", title: "Italic" },
  { cmd: "underline", icon: "fa-underline", title: "Underline" },
  { cmd: "formatBlock", arg: "h1", icon: "fa-heading", title: "Heading" },
  { cmd: "formatBlock", arg: "p", icon: "fa-paragraph", title: "Paragraph" },
  { cmd: "insertUnorderedList", icon: "fa-list-ul", title: "Bulleted list" },
  { cmd: "insertOrderedList", icon: "fa-list-ol", title: "Numbered list" },
  { cmd: "justifyLeft", icon: "fa-align-left", title: "Align left" },
  { cmd: "justifyCenter", icon: "fa-align-center", title: "Centre" },
  { cmd: "removeFormat", icon: "fa-eraser", title: "Clear formatting" },
];

export default function HtmlEditor({
  value,
  onChange,
  fields,
  previewHtml,
}: {
  value: string;
  onChange: (html: string) => void;
  /** Placeholder keys offered as one-click inserts. */
  fields: { key: string; label: string }[];
  /** The same template with sample values filled in, for the preview tab. */
  previewHtml: string;
}) {
  const [mode, setMode] = useState<Mode>("design");
  const canvas = useRef<HTMLDivElement | null>(null);

  // Only push the value into the canvas when it changed underneath us (an AI
  // generation, a template switch). Writing on every keystroke would reset
  // the caret to the start of the document on each character typed.
  useEffect(() => {
    if (mode !== "design") return;
    const el = canvas.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value, mode]);

  function exec(cmd: string, arg?: string) {
    canvas.current?.focus();
    document.execCommand(cmd, false, arg);
    if (canvas.current) onChange(canvas.current.innerHTML);
  }

  function insertField(key: string) {
    if (mode === "source") {
      onChange(value + `{{${key}}}`);
      return;
    }
    exec("insertText", `{{${key}}}`);
  }

  function insertLink() {
    const url = window.prompt("Link URL");
    if (url) exec("createLink", url);
  }

  function insertImage() {
    const url = window.prompt("Image URL");
    if (url) exec("insertImage", url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-black/10 bg-field/60 p-1.5">
        {mode === "design" && (
          <>
            {TOOLS.map((t) => (
              <button
                key={t.icon + (t.arg ?? "")}
                type="button"
                title={t.title}
                aria-label={t.title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => exec(t.cmd, t.arg)}
                className="h-7 w-7 rounded text-xs text-ink-soft hover:bg-white hover:text-ink"
              >
                <i className={`fa-solid ${t.icon}`} />
              </button>
            ))}
            <button
              type="button"
              title="Link"
              aria-label="Link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertLink}
              className="h-7 w-7 rounded text-xs text-ink-soft hover:bg-white hover:text-ink"
            >
              <i className="fa-solid fa-link" />
            </button>
            <button
              type="button"
              title="Image"
              aria-label="Image"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertImage}
              className="h-7 w-7 rounded text-xs text-ink-soft hover:bg-white hover:text-ink"
            >
              <i className="fa-solid fa-image" />
            </button>
            <span className="mx-1 h-5 w-px bg-black/10" />
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          {(["design", "source", "preview"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-2 py-1 text-xs capitalize ${
                mode === m ? "bg-green text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === "design" && (
        <div
          ref={canvas}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          className="min-h-[380px] max-h-[52vh] overflow-y-auto rounded-b-lg border border-t-0 border-black/10 bg-white p-4 text-sm text-black outline-none"
        />
      )}

      {mode === "source" && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="min-h-[380px] max-h-[52vh] w-full overflow-y-auto rounded-b-lg border border-t-0 border-black/10 bg-white p-4 font-mono text-xs text-black outline-none"
        />
      )}

      {mode === "preview" && (
        <iframe
          title="Template preview"
          // Sandboxed with no allow-scripts: a template is other people's
          // HTML and it has no business running anything in this page.
          sandbox=""
          srcDoc={previewHtml}
          className="min-h-[380px] h-[52vh] w-full rounded-b-lg border border-t-0 border-black/10 bg-white"
        />
      )}

      <div className="mt-3">
        <label className={labelCls}>Insert a field</label>
        <div className="flex flex-wrap gap-1.5">
          {fields.map((f) => (
            <button
              key={f.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertField(f.key)}
              title={`{{${f.key}}}`}
              className="rounded-full border border-black/15 px-2.5 py-1 text-xs text-ink-soft hover:border-green hover:text-green"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Name + editor + save, used by the template overlay. */
export function TemplateNameField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-3">
      <label className={labelCls}>Template name</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder="Monthly newsletter" />
    </div>
  );
}

export { primaryBtnCls };
