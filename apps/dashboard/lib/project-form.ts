import {
  DEFAULT_PROJECT_SETTINGS, STACK_PREFILLS, STAGE_NAMES,
  type ProjectStack,
} from '@sdlc/shared';
import { splitLines, stringifyNumbers, toNumber, type FormValues } from './form';
import type { ProjectView } from './types';

const NUMERIC_PATHS = [
  ...STAGE_NAMES.map((s) => `settings.stages.${s}.maxTurns`),
  'settings.pr.ciTimeoutMin',
  'settings.limits.maxSubtasks',
  'settings.limits.prSoftLines',
  'settings.limits.prHardLines',
  'settings.limits.maxTestFixRounds',
  'settings.limits.maxReviewRounds',
  'settings.limits.kbDocMaxLines',
  'settings.limits.reviewMaxDiffLines',
  'settings.loopLimits.ciFix',
  'settings.recovery.maxAttempts',
  'settings.loopLimits.userRerun',
  'settings.loopLimits.orchestratorReplan',
];

export function initialValues(project?: ProjectView): FormValues {
  if (project) {
    return {
      name: project.name,
      repoUrl: project.repoUrl,
      githubAuth: project.githubAuth ?? 'token',
      baseBranch: project.baseBranch,
      stack: project.stack,
      installCmd: project.installCmd,
      typecheckCmd: project.typecheckCmd,
      testCmdTemplate: project.testCmdTemplate,
      kbDir: project.kbDir,
      claudeMdMode: project.claudeMdMode,
      localKeyPrefix: project.localKeyPrefix,
      enabled: project.enabled,
      settings: formSettings(project.settings),
    };
  }
  return {
    name: '',
    repoUrl: '',
    githubAuth: 'token',
    baseBranch: 'dev',
    stack: 'ts_node',
    ...STACK_PREFILLS.ts_node,
    kbDir: 'docs/kb',
    claudeMdMode: 'both',
    localKeyPrefix: '',
    enabled: true,
    settings: formSettings(DEFAULT_PROJECT_SETTINGS),
  };
}

function formSettings(settings: ProjectView['settings']): FormValues {
  const s = stringifyNumbers(structuredClone(settings)) as unknown as FormValues & {
    verify: { redInvalidPatterns: string[] | string };
  };
  s.verify.redInvalidPatterns = settings.verify.redInvalidPatterns.join('\n');
  (s as unknown as { securityRiskPatterns: string }).securityRiskPatterns = (settings.securityRiskPatterns ?? []).join('\n');
  // The GitHub board is one object in the API and two fields in the form.
  const github = s as unknown as { github: { project: unknown; projectOwner?: string; projectNumber?: string } };
  github.github.projectOwner = settings.github.project?.owner ?? '';
  github.github.projectNumber = settings.github.project ? String(settings.github.project.number) : '';
  delete (github.github as { project?: unknown }).project;
  const approval = (s as unknown as { github: { approval: { plan: string | null; breakdown: string | null } } }).github.approval;
  approval.plan = settings.github.approval.plan ?? '';
  approval.breakdown = settings.github.approval.breakdown ?? '';
  return s;
}

/** Converts form text back into the API shape (numbers, string lists, empty-to-null). */
export function toPayload(values: FormValues): Record<string, unknown> {
  const out = structuredClone(values) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const path of NUMERIC_PATHS) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    const parent = keys.reduce((o, k) => o?.[k], out);
    if (parent && last in parent) parent[last] = toNumber(parent[last]);
  }
  const s = out.settings;
  s.verify.redInvalidPatterns = splitLines(String(s.verify.redInvalidPatterns ?? ''));
  s.securityRiskPatterns = splitLines(String(s.securityRiskPatterns ?? ''));
  for (const key of ['plan', 'breakdown'] as const) {
    const v = String((s.github.approval as Record<string, unknown>)[key] ?? '').trim();
    (s.github.approval as Record<string, unknown>)[key] = v === '' ? null : v;
  }
  const gh = s.github as { project?: unknown; projectOwner?: string; projectNumber?: string };
  const owner = String(gh.projectOwner ?? '').trim();
  const number = String(gh.projectNumber ?? '').trim();
  gh.project = owner && number ? { owner, number: toNumber(number) } : null;
  delete gh.projectOwner;
  delete gh.projectNumber;
  if (String(out.localKeyPrefix ?? '').trim() === '') delete out.localKeyPrefix;
  return out;
}

/** Re-prefills the three commands when the stack changes, unless the user has customised them. */
export function applyStackChange(values: FormValues, previous: ProjectStack, next: ProjectStack): FormValues {
  const prev = STACK_PREFILLS[previous];
  const fill = STACK_PREFILLS[next];
  const out: FormValues = { ...values, stack: next };
  for (const key of ['installCmd', 'typecheckCmd', 'testCmdTemplate'] as const) {
    const current = String(values[key] ?? '');
    if (current === '' || current === prev[key]) out[key] = fill[key];
  }
  return out;
}
