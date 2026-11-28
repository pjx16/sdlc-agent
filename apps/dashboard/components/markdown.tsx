'use client';

import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { memo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

/** Beyond this many characters the preview is not rendered: a huge document would freeze the page. */
export const MAX_PREVIEW_CHARS = 200_000;

/** Only the languages people write in tickets and plans; each one costs bundle size. Aliases (ts, tsx, js, sh, html) come with the grammars. */
const LANGUAGES = { bash, css, diff, javascript, json, markdown, sql, typescript, xml, yaml };
const HIGHLIGHT = [[rehypeHighlight, { languages: LANGUAGES, detect: false }]] as ComponentProps<typeof ReactMarkdown>['rehypePlugins'];

/**
 * Which links are kept: http, https and mailto, an in-page `#anchor`, and relative paths. Anything else (`javascript:`, `data:`, `vbscript:`…)
 * is dropped, so the link has no target.
 */
export function safeUrl(url: string): string {
  const u = url.trim();
  if (u === '' || u.startsWith('#') || u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) return u;
  // A scheme is letters, digits, + - . before the first colon; browsers also ignore control characters and spaces inside it.
  const squeezed = [...u].filter((ch) => ch.charCodeAt(0) > 32).join('');
  const scheme = /^([^/?#]*?):/.exec(squeezed)?.[1]?.toLowerCase();
  if (scheme === undefined) return u; // a relative path with no scheme
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? u : '';
}

interface HastNode {
  type?: string;
  value?: string;
  children?: HastNode[];
}
/** The plain text of a rendered code block (the highlighter splits it into spans), for its Copy button. */
const textOf = (node: HastNode | undefined): string => (node?.type === 'text' ? (node.value ?? '') : (node?.children ?? []).map(textOf).join(''));

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return [copied, copy];
}

function CodeBlock({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const [copied, copy] = useCopy();
  return (
    <div className="markdown-code">
      <pre>{children}</pre>
      <button type="button" onClick={() => copy(textOf(node))} aria-label="Copy code" className="markdown-copy">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const COMPONENTS: Components = {
  a: ({ href, children }) => {
    const external = /^(https?:)?\/\//i.test(href ?? '');
    return (
      <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="text-accent underline">
        {children}
      </a>
    );
  },
  pre: ({ node, children }) => <CodeBlock node={node as HastNode}>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
  input: ({ type, checked }) => (type === 'checkbox' ? <input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? 'done' : 'not done'} /> : null),
};

type View = 'preview' | 'raw';

export interface MarkdownProps {
  source: string;
  /** Shows the Preview / Raw switch and a Copy button. Default true. */
  toggle?: boolean;
  /** Tighter spacing, for chat bubbles and list rows. */
  compact?: boolean;
  /** A Tailwind max-height class (for example `max-h-96`): the content scrolls inside it. */
  maxHeight?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * Markdown the way people read it: headings, lists, tables, task lists, code with highlighting. It opens on Preview, every time. Raw HTML in
 * the source is shown as text, never rendered, and links keep only safe schemes, so text written by an agent cannot inject markup.
 */
function MarkdownView({ source, toggle = true, compact = false, maxHeight, className = '', 'aria-label': label }: MarkdownProps) {
  const tooBig = source.length > MAX_PREVIEW_CHARS;
  const [view, setView] = useState<View>('preview');
  const [copied, copy] = useCopy();
  const tabs = useRef<Record<View, HTMLButtonElement | null>>({ preview: null, raw: null });
  const shown: View = tooBig ? 'raw' : view;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: View = shown === 'preview' ? 'raw' : 'preview';
    setView(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className={className} aria-label={label}>
      {toggle && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <div role="tablist" aria-label="View" onKeyDown={onKeyDown} className="inline-flex rounded-md border border-border text-xs">
            {(['preview', 'raw'] as const).map((v) => (
              <button
                key={v}
                ref={(el) => void (tabs.current[v] = el)}
                type="button"
                role="tab"
                aria-selected={shown === v}
                tabIndex={shown === v ? 0 : -1}
                disabled={tooBig && v === 'preview'}
                onClick={() => setView(v)}
                className={`px-3 py-1 capitalize first:rounded-l-md last:rounded-r-md ${shown === v ? 'bg-accent text-accent-text' : 'text-muted hover:text-text'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => copy(source)} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {tooBig && <p className="mb-2 text-xs text-amber">This document is too long to preview, so it is shown as raw text.</p>}
      <div className={maxHeight ? `${maxHeight} overflow-auto` : undefined}>
        {shown === 'raw' ? (
          <pre className="whitespace-pre-wrap font-mono text-xs">{source}</pre>
        ) : (
          <div className={`markdown${compact ? ' compact' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={HIGHLIGHT} urlTransform={safeUrl} components={COMPONENTS}>
              {source}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export const Markdown = memo(MarkdownView);
