"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  content: string;
  streaming?: boolean;
}

const MONO_FONT = "var(--font-mono), DM Mono, monospace";
const ACCENT = "#4df5c8";

export function MarkdownMessage({ content, streaming }: MarkdownMessageProps) {
  return (
    <div style={{ fontSize: 15, lineHeight: 1.7 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: "14px 0 8px" }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, color: "var(--text-primary)", margin: "12px 0 7px" }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: ACCENT, margin: "10px 0 6px" }}>
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: ACCENT, margin: "8px 0 5px" }}>
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: "8px 0 4px" }}>
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text-muted)", margin: "8px 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {children}
            </h6>
          ),
          p: ({ children }) => (
            <p style={{ margin: "0 0 8px 0", lineHeight: 1.7, color: "var(--text-primary)" }}>
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: "6px 0 10px 0", paddingLeft: 22, color: "var(--text-primary)" }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: "6px 0 10px 0", paddingLeft: 22, color: "var(--text-primary)" }}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: "3px 0", lineHeight: 1.7 }}>
              {children}
            </li>
          ),
          hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "10px 0" }} />,
          blockquote: ({ children }) => (
            <blockquote style={{ borderLeft: "3px solid " + ACCENT, paddingLeft: 12, margin: "8px 0", color: "var(--text-secondary)", fontStyle: "italic" }}>
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: "underline", textDecorationColor: "rgba(77,245,200,0.5)" }}>
              {children}
            </a>
          ),
          code: ({ node, className, children, ...props }: { node?: unknown; className?: string; children?: React.ReactNode; inline?: boolean }) => {
            const value = String(children ?? "").replace(/\n$/, "");
            const inline = !className;
            if (inline) {
              return (
                <code style={{ fontFamily: MONO_FONT, fontSize: "0.875em", background: "rgba(77,245,200,0.08)", border: "1px solid rgba(77,245,200,0.15)", borderRadius: 4, padding: "1px 5px", color: ACCENT }} {...props}>
                  {value}
                </code>
              );
            }
            const language = className.replace(/^language-/, "");
            return (
              <div style={{ margin: "8px 0" }}>
                {language ? (
                  <div style={{ fontFamily: MONO_FONT, fontSize: 14, color: ACCENT, padding: "4px 12px", background: "rgba(77,245,200,0.08)", borderRadius: "8px 8px 0 0", borderBottom: "1px solid rgba(77,245,200,0.15)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {language}
                  </div>
                ) : null}
                <pre style={{ background: "rgba(6,8,16,0.80)", border: "1px solid rgba(77,245,200,0.15)", borderRadius: language ? "0 0 8px 8px" : "8px", padding: "12px 16px", overflowX: "auto", margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                  <code style={{ fontFamily: MONO_FONT, color: "#e2e8f0" }}>{value}</code>
                </pre>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming ? (
        <span style={{ display: "inline-block", width: 2, height: "1em", background: ACCENT, marginLeft: 2, animation: "breathe 0.8s ease-in-out infinite", verticalAlign: "text-bottom" }} />
      ) : null}
    </div>
  );
}
