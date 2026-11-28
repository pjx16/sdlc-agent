/**
 * Adds one line to the rules of a guideline: `- <tweak>` at the end of the `## Rules` section, or at the end of the text when there is no
 * such section. A line that is already there is not added twice.
 */
export function appendTweak(text: string, tweak: string): string {
  const line = `- ${tweak.trim()}`;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.some((l) => l.trim() === line)) return text;
  const start = lines.findIndex((l) => /^#{2,6}\s+rules\s*$/i.test(l.trim()));
  if (start < 0) {
    const body = text.replace(/\s+$/, '');
    return `${body}${body === '' ? '' : '\n\n'}${line}\n`;
  }
  // The section ends at the next heading; the new line goes after its last non-blank line.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test((lines[i] as string).trim())) {
      end = i;
      break;
    }
  }
  let last = end - 1;
  while (last > start && (lines[last] as string).trim() === '') last--;
  const out = [...lines.slice(0, last + 1), line, ...lines.slice(last + 1)];
  return out.join('\n');
}
