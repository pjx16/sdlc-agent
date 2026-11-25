# Plan: #41 — Remove the Confluence integration

## Goal
No Confluence code, settings, credentials or docs remain. Plan/feature docs live in the repository's knowledge-base directory and are always committed.

## Steps
1. **Docs-in-repo first**
   - Plan handler writes the approved plan to `<kbDir>/plans/<ticketKey>.md` (renderer reuses `HubDocument` → markdown logic from `document-hub.ts`).
   - Ensure the commit step stages that path on the ticket branch; adjust `kb-guard` allow-list if needed.
2. **Remove runtime code**
   - Delete `apps/api/src/confluence/`, `worker/plan-pages/`; unwire from modules, worker loop and `plan.handler.ts` (always use Jira comment path).
   - Remove credential type, endpoints, health checks, error-policy/event-message entries.
3. **Shared + onboarding**
   - Drop `confluence` from `project-settings`, `onboarding` (facts, advice, sanitizer), agent prompts and formats.
4. **Database** (one migration)
   - Drop `Artifact.externalUrl/externalId/externalVersion/externalSig`.
   - SQL to remove `confluence` keys from `Project.settings` and `onboardingProposal`; delete confluence credential rows.
5. **Dashboard**: remove Confluence cards/links from plan panel, artifact versions, onboarding panel, credentials form, project summary, error note; show "Plan file" link to the repo path instead.
6. **CLI/docs**: remove references in `packages/cli`, `docs/CONFLUENCE.md`, README, CONFIGURATION, `.env` docs; CHANGELOG "Removed" + upgrade note.

## Tests
Update/delete confluence tests; add: plan file written + committed; migration test (data stripped); settings parse of legacy payload with `confluence` key succeeds; `rg -i confluence` guard test limited to CHANGELOG/migrations.

## Acceptance criteria
- `rg -i confluence` finds only CHANGELOG and historical migrations.
- A planned ticket's PR contains `<kbDir>/plans/<key>.md`.
- Upgrade from the previous version succeeds with existing Confluence-configured projects.

## Out of scope
Importing existing Confluence pages; other doc hubs.

## Decisions
Hard removal; docs always committed to KB dir; Jira comment as sole write-back; destructive migration documented.

## Risks
Breaking for current Confluence users (mitigate: major-version note, backup before migrate — CLI `upgrade` already backs up); large diff (mitigate: step-wise commits).
