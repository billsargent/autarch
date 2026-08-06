"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// Fenced code block with a header bar (language label + copy button). Kept as a
// styled <pre> — no syntax-highlighter dependency so the bundle stays light.
function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/70 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">{lang || "code"}</span>
        <button
          onClick={copy}
          className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
          title="Copy code"
        >
          {copied ? "✓ copied" : "⧉ copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-neutral-200">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// Dark-theme styling for the rendered Markdown. Colors mostly inherit so the
// same renderer works for both normal replies and the dimmed "thinking" block.
const components: Components = {
  // react-markdown wraps fenced code in <pre>; we render the block code panel
  // ourselves via `code`, so strip the outer <pre> to avoid a double wrapper.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, node: _node, children }) => {
    if (/language-/.test(className ?? "")) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return (
      <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[0.85em] text-cyan-300">{children}</code>
    );
  },
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-bold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-bold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-bold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-2.5 text-sm font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1 mt-2 text-[13px] font-semibold first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mb-1 mt-2 text-[13px] font-semibold first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline decoration-blue-700 underline-offset-2 hover:text-blue-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-neutral-700 pl-3 text-neutral-400 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-neutral-800" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-neutral-800/60">{children}</thead>,
  th: ({ children }) => <th className="border border-neutral-700 px-2 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-neutral-700 px-2 py-1.5">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del className="text-neutral-500">{children}</del>,
};

export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`min-w-0 text-sm leading-relaxed ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
