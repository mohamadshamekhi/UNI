"use client";

import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

const TOOLS = [
  { cmd: "formatBlock", arg: "h2", icon: Heading2, label: "تیتر" },
  { cmd: "formatBlock", arg: "h3", icon: Heading3, label: "زیرتیتر" },
  { cmd: "bold", icon: Bold, label: "پررنگ" },
  { cmd: "italic", icon: Italic, label: "مورب" },
  { cmd: "insertUnorderedList", icon: List, label: "فهرست نقطه‌ای" },
  { cmd: "insertOrderedList", icon: ListOrdered, label: "فهرست شماره‌دار" },
  { cmd: "formatBlock", arg: "blockquote", icon: Quote, label: "نقل‌قول" },
  { cmd: "link", icon: Link2, label: "پیوند" },
  { cmd: "removeFormat", icon: Undo2, label: "حذف قالب" },
] as const;

/**
 * Small rich-text editor (NWS-01). Only simple formatting; the server sanitises the HTML with an
 * allow-list either way (NWS-08), so pasted styles and scripts never survive.
 */
export function RichText({ id, value, onChange, labelledBy }: { id: string; value: string; onChange: (html: string) => void; labelledBy: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // load external value only when it differs (keeps the caret while typing)
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value]);

  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    if (cmd === "link") {
      const url = window.prompt("نشانی پیوند (https://…)");
      if (!url || !/^(https?:|mailto:|tel:)/i.test(url)) return;
      document.execCommand("createLink", false, url);
    } else document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/30">
      <div role="toolbar" aria-label="قالب‌بندی متن" aria-controls={id} className="flex flex-wrap gap-0.5 border-b border-border bg-muted/50 p-1">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.label}
            aria-label={t.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(t.cmd, "arg" in t ? t.arg : undefined)}
            className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <t.icon aria-hidden className="size-4" />
          </button>
        ))}
      </div>
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onPaste={(e) => {
          // paste as plain text: no foreign markup
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        className="rich min-h-64 px-4 py-3 outline-none"
      />
    </div>
  );
}
