# Plan: #46 — Merge open questions into the plan-approval step

## Goal
To approve a plan the user must first answer its open questions (if any); questions and approval are one card.

## Approach
1. **API** (`support.service.ts`)
   - `ActionBody` gets `answers?: { id: string; answer: string }[]`.
   - On `approve` for stage `plan`: load open `open_question` rows of the ticket; every one must be answered (in `answers` or already answered); otherwise 409 `{ unanswered: [ids] }`.
   - Persist answers (`status 'resolved'`, response), then append a `## Decisions from open questions` section to `planMarkdown` (idempotent marker) and write the artifact before the existing `approvePlan` transition.
2. **View**: support-ticket DTO for an `approval` item includes `openQuestions: [{id, title, defaultAnswer, response}]`; list endpoints omit the standalone `open_question` rows that belong to an open approval from the main inbox group (still reachable in history).
3. **Dashboard**
   - `inbox.tsx` approval card: question list with textarea each, "Use default" button, progress "2 of 3 answered"; `Approve` disabled until complete; Reject unchanged (re-plan note can prefill from answers).
   - `plan-panel.tsx` shows the same block on the ticket page.
4. **Shared**: remove `answer` from user-facing `open_question` actions only where grouped; keep `rerun_with_answers` as "Re-plan with these answers".
5. **Listener**: when the approval is raised, link question rows via `dedupeKey` prefix so grouping is deterministic.

## Tests
Service int: approve blocked with unanswered; allowed with answers; plan gets decisions section once; no questions → unchanged. Dashboard: disabled/enabled button, default-answer button. Shared: actions table.

## Acceptance criteria
- A plan with N open questions cannot be approved until all N are answered.
- Answers are visible in the approved plan and used by later stages.
- Plans without questions approve as before.

## Out of scope
Changing how the planner generates questions; answering via Jira.

## Decisions
Approve-with-answers (no forced replan); server-side gate; defaults can be accepted explicitly; grouping instead of deleting question rows.
