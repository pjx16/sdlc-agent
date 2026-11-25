# Plan: #45 — Attach knowledge-base files to a ticket and keep them in context

## Goal
When creating a ticket from the dashboard, the user can attach one or more KB docs; every pipeline stage keeps them in the agent's context.

## Approach
1. **DB**: `Ticket.kbAttachments Json @default("[]")` (array of `{ path }`), migration.
2. **API**
   - `GET /projects/:id/kb` → entries from `features.json` (+ markdown files in `kbDir`), read from the mirror via `safe-fs`.
   - `POST /tickets` accepts `kbAttachments: string[]` (max 5); validate each path is inside `kbDir`, exists, `.md`.
   - `PATCH /tickets/:id/kb-attachments` allowed until the ticket starts coding.
3. **Context builder** (`context-builder.ts`): new input `attachments: {name, content}[]`; written to `/context/attachments/`; a "Attached knowledge" section listed for all stages; enforce combined line cap, note truncation.
4. **Pipeline handlers**: load attachments once per stage (`kb-attachments.service.ts`), reading from the mirror at the base branch; missing file → warn event, continue.
5. **Dashboard**: multi-select with search in the new-ticket form; chips on the ticket page with remove; read-only after coding starts.
6. **Docs**: README/KB docs mention.

## Tests
- DTO/service: path traversal rejected, nonexistent rejected, limit enforced.
- Context builder: attachments appear for each stage, truncation note.
- Int test: attached doc content reaches the plan stage context.
- Dashboard: select, submit, display.

## Acceptance criteria
- Attached docs are visible in the context of plan, breakdown, coding, review stages.
- Cannot attach files outside `kbDir`.
- Ticket without attachments behaves exactly as today.

## Out of scope
Arbitrary (non-KB) file uploads; attachments on pasted Jira bodies; semantic retrieval.

## Decisions
Store paths not content; additive to featureKey doc; size cap; editable until coding starts.

## Risks
Context bloat/cost (cap + warning); stale paths if KB docs are renamed (warning event, no failure).
