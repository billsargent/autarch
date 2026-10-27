"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// The library's reader for markdown documents (#170): headings, lists,
// tables, quotes and links set out like a printed page, on parchment.
// No raw HTML: a document's markup is sanitised, and links open in a new tab.

const components: Components = {
  h1: ({ children }) => <h1 className="village-pixel mb-3 mt-1 text-xl leading-snug text-[#3b2716]">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 border-b border-[#d8c49a] pb-1 text-lg font-bold text-[#3b2716]">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-base font-bold text-[#3b2716]">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 font-bold">{children}</h4>,
  p: ({ children }) => <p className="mb-3">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-6">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="mb-3 border-l-4 border-[#c9a96a] pl-3 italic text-[#5a4128]">{children}</blockquote>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-[#7a3b12] underline">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-[#f1e7d0] px-1 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="mb-3 overflow-x-auto rounded bg-[#f1e7d0] p-3 text-[13px] [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  hr: () => <hr className="my-4 border-[#d8c49a]" />,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-[#c9a96a] bg-[#f1e7d0] px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-[#c9a96a] px-2 py-1 align-top">{children}</td>,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="my-2 h-auto max-h-[50vh] w-auto max-w-full object-contain" loading="lazy" />
  ),
};

export default function MarkdownReader({ text }: { text: string | null }) {
  return (
    <article className="max-h-[65vh] overflow-auto rounded border-2 border-[#3b2716] bg-[#fffaf0] px-5 py-4 font-serif text-[15px] leading-relaxed text-[#2b1d10]">
      {text == null ? (
        <p>Opening…</p>
      ) : (
        <div className="mx-auto max-w-[46rem]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
            {text}
          </ReactMarkdown>
        </div>
      )}
    </article>
  );
}
