'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  CLAUDE_MD_MODES, MODEL_ALIASES, PROJECT_STACKS, STAGE_NAMES,
  ProjectSettingsSchema, commandWarnings, stageWarnings, type ProjectStack,
} from '@sdlc/shared';
import { Check, FormProvider, Num, Section, Select, Text, TextArea, Warnings } from './form';
import { MirrorStatus } from './mirror-status';
import { collapseListErrors, getIn, setIn, type FormValues } from '@/lib/form';
import { applyStackChange, initialValues, toPayload } from '@/lib/project-form';
import type { ProjectView } from '@/lib/types';
import { STAGE_LABELS } from '@/lib/stage-labels';

const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

/** Best-effort live view of the warnings, using the same shared functions the API relies on. */
function currentWarnings(values: FormValues) {
  const settings = ProjectSettingsSchema.safeParse({ stages: stagesFrom(values) });
  return {
    commands: commandWarnings({ installCmd: String(values.installCmd ?? ''), typecheckCmd: String(values.typecheckCmd ?? '') }),
    stages: settings.success ? stageWarnings(settings.data) : [],
  };
}

function stagesFrom(values: FormValues) {
  return Object.fromEntries(STAGE_NAMES.map((s) => [s, { enabled: Boolean(getIn(values, `settings.stages.${s}.enabled`)) }]));
}

export function ProjectForm({ project }: { project?: ProjectView }) {
  const router = useRouter();
  const editing = Boolean(project);
  const [values, setValues] = useState<FormValues>(() => initialValues(project));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (path: string, value: unknown) => {
    if (path === 'stack') {
      setValues((v) => applyStackChange(v, v.stack as ProjectStack, value as ProjectStack));
    } else {
      setValues((v) => setIn(v, path, value));
    }
    setErrors((e) => {
      if (!(path in e)) return e;
      const { [path]: _removed, ...rest } = e; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(editing ? `/api/projects/${project?.id}` : '/api/projects', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toPayload(values)),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setErrors({});
        if (editing) {
          setMessage({ kind: 'ok', text: 'Saved. Changes apply from the next stage run.' });
          router.refresh();
        } else {
          router.push(`/projects/${body.id}`);
        }
        return;
      }
      if (res.status === 400 && body.fields) {
        setErrors(collapseListErrors(body.fields, ['settings.verify.redInvalidPatterns']));
        setMessage({ kind: 'error', text: 'Some fields need attention.' });
      } else {
        setMessage({ kind: 'error', text: body.message ?? 'Could not save the project.' });
      }
    } catch {
      setMessage({ kind: 'error', text: 'Cannot reach the server.' });
    } finally {
      setBusy(false);
    }
  }

  const warnings = currentWarnings(values);
  const githubMode = (values.settings as { github?: { mode?: string } } | undefined)?.github?.mode;

  return (
    <FormProvider value={{ values, errors, set }}>
      <form onSubmit={submit} className="max-w-4xl space-y-6" noValidate>
        {project && <MirrorStatus project={project} />}

        <Section title="Repository">
          <Text path="name" label="Name" />
          <Text path="repoUrl" label="Repository URL" placeholder="https://github.com/owner/repo" hint="HTTPS github.com repositories only." />
          <Select path="githubAuth" label="GitHub access" options={[{ value: 'token', label: 'My personal token (Settings)' }, { value: 'bot', label: 'sdlc-agent-bot (GitHub App, no token)' }]} hint="Who pushes, opens pull requests and comments. sdlc-agent-bot needs the GitHub App installed on this repository (Settings → Connections)." />
          <Text path="baseBranch" label="Base branch" />
          <Select path="stack" label="Stack" options={options(PROJECT_STACKS)} hint="Pre-fills the three commands below." />
          <Text path="localKeyPrefix" label="Local ticket prefix" hint="Used for pasted tickets, e.g. BILL-1. Default: first 4 letters of the name." />
          <Check path="enabled" label="Project enabled" hint="A disabled project accepts no new tickets." />
        </Section>

        <Section title="Commands" description="Run in the workspace before and after the agent works.">
          <Text path="installCmd" label="Install command" />
          <Text path="typecheckCmd" label="Typecheck command" />
          <Text path="testCmdTemplate" label="Test command template" hint="Must contain {files}." />
          <Warnings items={warnings.commands} />
        </Section>

        <Section title="Knowledge base">
          <Text path="kbDir" label="KB directory" hint="Relative to the repository root." />
        </Section>

        <Section title="Instructions">
          <Select path="claudeMdMode" label="CLAUDE.md mode" options={options(CLAUDE_MD_MODES)} hint="ours: only our guidelines; theirs: the repository's; both: both." />
        </Section>

        <Section title="GitHub issues and projects" description="Take tickets from GitHub. A Projects board is recommended: its cards show where each ticket is.">
          <Select path="settings.github.mode" label="Source" options={[{ value: 'off', label: 'Off' }, { value: 'projects', label: 'GitHub Projects board (recommended)' }, { value: 'issues', label: 'Issues with a label' }]} />
          {githubMode === 'issues' && <Text path="settings.github.label" label="Issue label" hint="Open issues with this label are picked up. The label sdlc:<state> shows progress." />}
          {githubMode === 'projects' && (
            <>
              <Text path="settings.github.projectOwner" label="Project owner" placeholder="acme" hint="The user or organization that owns the board." />
              <Text path="settings.github.projectNumber" label="Project number" placeholder="3" hint="The number in the board's URL. The GitHub token needs the “project” scope." />
              <Text path="settings.github.statusField" label="Status field" />
              <Text path="settings.github.intakeStatus" label="Pick up cards in column" hint="Cards of this repository in this column become tickets." />
              <Check path="settings.github.useDefaultColumns" label="Use sdlc-agent's own columns" hint="Plan review, Plan approved, Breakdown review and Breakdown approved are added to the board when they are first needed. Nothing already on the board changes." />
              <Text path="settings.github.approval.plan" label="Plan approved column" hint="Moving a card to this column approves its plan. Ignored when sdlc-agent's own columns are on." />
              <Text path="settings.github.approval.breakdown" label="Breakdown approved column" hint="Moving a card to this column approves its breakdown." />
            </>
          )}
          {githubMode === 'issues' && <Text path="settings.github.approval.label" label="Approval label" hint="Adding this label to the issue approves the plan or the breakdown. It is removed once used." />}
        </Section>

        <Section title="Tickets">
          <Check path="settings.intake.paste" label="Allow pasted tickets" hint="Tickets typed into the dashboard, with or without a GitHub issue." />
        </Section>

        <Section title="Stages" description="Every stage has enabled, model and max turns. Changes apply from the next stage run.">
          <div className="sm:col-span-2 space-y-3">
            {STAGE_NAMES.map((stage) => (
              <div key={stage} className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_8rem]">
                <Check
                  path={`settings.stages.${stage}.enabled`}
                  label={`${STAGE_LABELS[stage]} enabled`}
                  disabled={stage === 'implement'}
                  hint={stage === 'implement' ? 'Always on.' : undefined}
                />
                <Select path={`settings.stages.${stage}.model`} label={`${STAGE_LABELS[stage]} model`} options={options(MODEL_ALIASES)} />
                <Num path={`settings.stages.${stage}.maxTurns`} label={`${STAGE_LABELS[stage]} max turns`} />
              </div>
            ))}
          </div>
          <Warnings items={warnings.stages} />
        </Section>

        <Section title="Security review" description="The security reviewer runs when a change touches risky paths or code. Add your own triggers here.">
          <TextArea path="settings.securityRiskPatterns" label="Extra security triggers" hint="One regular expression per line. A changed file path or added line that matches calls the security reviewer, besides the built-in rules." rows={4} />
        </Section>

        <Section title="Gates" description="Pause for your approval before the pipeline continues.">
          <Check path="settings.gates.plan" label="Require plan approval" />
          <Check path="settings.recovery.enabled" label="Recover stuck steps by itself" hint="The orchestrator reads the failure and tries again with a note before asking you." />
          <Num path="settings.recovery.maxAttempts" label="Recovery attempts before asking me" />
        </Section>

        <Section title="PR">
          <Check path="settings.pr.earlyDraft" label="Open a draft PR after the first subtask" hint="Off: the PR opens after the last subtask." />
          <Check path="settings.pr.ciFixRound" label="Run a fix round when CI fails" />
          <Num path="settings.pr.ciTimeoutMin" label="CI timeout (minutes)" />
        </Section>

        <Section title="Limits">
          <Num path="settings.limits.maxSubtasks" label="Max subtasks" />
          <Num path="settings.limits.maxTestFixRounds" label="Max test-fix rounds" />
          <Num path="settings.limits.maxReviewRounds" label="Max review rounds" />
          <Num path="settings.limits.kbDocMaxLines" label="KB doc max lines" />
          <Num path="settings.limits.reviewMaxDiffLines" label="Review max diff lines" />
          <Num path="settings.loopLimits.ciFix" label="CI fix rounds before asking me" hint="How many times the pipeline tries to fix failing CI checks by itself. 0 turns it off." />
          <Num path="settings.loopLimits.userRerun" label="Reruns you can request per stage" />
          <Num path="settings.loopLimits.orchestratorReplan" label="Re-plans the orchestrator may do" />
          <Num path="settings.limits.prSoftLines" label="PR size: soft limit (changed lines)" hint="Past this the pipeline records it and writes a note on the ticket's issue. Lockfiles and generated files are not counted." />
          <Num path="settings.limits.prHardLines" label="PR size: hard limit (changed lines)" hint="Past this it also comments on the PR with the size of each commit and tells you in the inbox. Nothing is blocked." />
          <TextArea path="settings.verify.redInvalidPatterns" label="Invalid red-test patterns" hint="One regular expression per line. A failing test whose output matches is not a valid red." rows={4} />
        </Section>

        <div className="flex items-center gap-4">
          <button type="submit" disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-60">
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create project'}
          </button>
          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-red' : 'text-green'}`}>
              {message.text}
            </p>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
