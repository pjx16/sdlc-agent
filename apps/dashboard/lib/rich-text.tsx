import type { ReactNode } from 'react';

const TOKEN = /(\*\*[^*\n]+\*\*|https?:\/\/[^\s<>]+)/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/**
 * Plain text with two conveniences, for messages written by the pipeline: `**bold**` and http(s) links. Only the http and https schemes
 * become links; anything else, including markup, stays text (React escapes it), so no library is needed and nothing can inject HTML.
 */
export function renderRichText(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(part)) {
      const trail = TRAILING.exec(part)?.[0] ?? '';
      const url = trail ? part.slice(0, -trail.length) : part;
      try {
        new URL(url);
      } catch {
        return part;
      }
      return (
        <span key={i}>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{url}</a>
          {trail}
        </span>
      );
    }
    return part;
  });
}
