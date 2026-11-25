# Plan: #38 — Show progress during `npx sdlc-agent init`

## Goal
`init` must never look stuck: show an animated in-progress indicator plus a one-line peek at what is happening.

## Approach
1. **`ui.ts`**: add `withProgress(label, fn, { verbose })`.
   - TTY: spinner frame + label + dim latest output line (truncated to terminal width), redrawn every 80 ms; final line `✔ label (12s)` or `✖ label`.
   - Non-TTY: `▸ label…` then `✔ label`.
2. **`proc.ts`**: add `onLine?: (line: string) => void` to `RunOptions`; when set, capture stdout+stderr line-by-line (split on `\n` and `\r`) instead of `inherit`. Result still carries the full buffer.
3. **`commands.ts` `up()`**: wrap the steps — "Checking your system", "Pulling images", "Building the agent image (first build takes a few minutes)", "Starting services (waiting for healthy)". On non-zero exit print the captured output, then the existing `CliError`.
4. **`init.ts`**: wrap doctor, file copy and secret generation in short steps so the whole run is covered.
5. `--verbose` / `SDLC_AGENT_VERBOSE=1` keeps current inherit behaviour.

## Files
`packages/cli/src/{ui,proc,commands,init,cli}.ts`, tests `ui.test.ts`, `commands.test.ts`.

## Tests
- `withProgress` in non-TTY emits plain lines; in TTY updates the latest line; failure prints captured output.
- Line splitter handles `\r` progress updates and partial chunks.
- Existing `init.test.ts` / `commands.test.ts` pass with mocked `run`.

## Acceptance criteria
- Every step >1 s shows a spinner and a latest-output line on a TTY.
- Non-TTY output has no control characters.
- Failures show the full captured log of the failed step.
- `--verbose` behaves as before.

## Out of scope
Dashboard UI; reducing build time (see #39).

## Decisions
No spinner library; capture-and-peek instead of raw docker output; plain-line fallback; verbose escape hatch.

## Risks
Docker may buffer output when not on a TTY, so the peek line can lag — mitigated by always showing the spinner and elapsed time.
