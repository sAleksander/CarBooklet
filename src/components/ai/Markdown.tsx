import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Assistant output, rendered as markdown.
 *
 * No `rehype-raw`. The model's output is untrusted text and react-markdown
 * escapes embedded HTML by default; turning that off to render a stray `<div>`
 * nicely would hand a prompt injection a script tag. Tables, strikethrough and
 * task lists come from `remark-gfm`, which is markdown syntax only.
 *
 * Block styling lives in the `components` map rather than in a typography
 * plugin: the whole surface is a dozen elements, and a plugin would style every
 * `.prose` in the app to match one bubble.
 *
 * `pre` resets the inline-code styling on its own child, because react-markdown
 * v9 dropped the `inline` prop and a fenced block otherwise inherits the pill
 * background meant for `` `like this` `` inside a sentence.
 */
const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="marker:text-muted-foreground">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 text-lg font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-base font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 text-sm font-bold">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">{children}</blockquote>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs last:mb-0 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-border" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline hover:no-underline">
      {children}
    </a>
  ),
};

export function Markdown({ content }: { content: string }) {
  return (
    <div className="text-sm break-words text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
