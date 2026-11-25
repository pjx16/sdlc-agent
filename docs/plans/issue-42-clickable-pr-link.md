# Plan: #42 — Make the PR link in Human Review items clickable

## Root cause
`inbox.tsx` renders support-ticket bodies as plain `whitespace-pre-wrap` text; URLs are never turned into anchors.

## Approach
1. New `apps/dashboard/lib/linkify.tsx`: `renderRichText(text)` → React nodes. Splits on `https?://[^\s<>)]+`, trims trailing punctuation, wraps in `<a href target="_blank" rel="noopener noreferrer" className="text-accent underline">`; converts `**x**` to `<strong>`. Only `http`/`https` schemes are linked; everything else stays text (React escapes it).
2. Use it in `inbox.tsx` (line ~125) and anywhere else `t.body` is shown (e.g. dashboard home inbox preview, if applicable).
3. Keep `stripAnsi` first.

## Tests
- `linkify.test.tsx`: plain URL, URL with trailing `.`/`)`, two URLs, `javascript:` stays text, `**bold**`, text with `<script>` stays escaped.
- `inbox` test: a `pr_ready` item renders an anchor with the PR URL and `rel` attributes.

## Acceptance criteria
- The PR URL in a Human Review item opens the PR in a new tab.
- No unsafe schemes are linkified.

## Out of scope
Action buttons (#43), dismiss semantics (#44).

## Decisions
Tiny in-house linkifier, no markdown lib; fix in the renderer so all support items benefit.
