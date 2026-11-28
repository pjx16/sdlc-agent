import { z } from 'zod';
import { PROJECT_STACKS, TICKET_STATUSES, type TicketStatus } from './enums';

/** Project onboarding: code collects facts, two agents propose, the person confirms. */

export const ONBOARDING_STATUSES = ['draft', 'profiling', 'proposed', 'confirmed'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** The steps of profiling a repository, in the order a person sees them. Several run at the same time (see `OnboardingProgress`). */
export const ONBOARDING_PHASES = [
  { id: 'access', label: 'Checking access to the repository' },
  { id: 'facts', label: 'Reading the repository and your GitHub board' },
  { id: 'mirror', label: 'Cloning the repository' },
  { id: 'checkout', label: 'Preparing a working copy' },
  { id: 'profile', label: 'Profiling the code (stack, commands, tests)' },
  { id: 'install', label: 'Checking the install command' },
  { id: 'typecheck', label: 'Checking the type-check command' },
  { id: 'advise', label: 'Proposing the GitHub board setup' },
] as const;
export type OnboardingPhaseId = (typeof ONBOARDING_PHASES)[number]['id'];

/** Where profiling is, written by the worker as it goes. `planned` lists the phases this run will do. */
export interface OnboardingProgress {
  startedAt: string;
  planned: OnboardingPhaseId[];
  running: OnboardingPhaseId[];
  done: { id: OnboardingPhaseId; ms: number }[];
}

/** What a pipeline ticket is. */
export const TICKET_KINDS = ['feature', 'bug', 'chore'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

// ------------------------------------------------------------------------------------------------ agent output

const text = z.string().min(1, 'must not be empty');

/** `repo-profiler`: stack, commands, KB folder and the test-file pattern. */
export const RepoProfileData = z.object({
  stack: z.enum(PROJECT_STACKS),
  installCmd: z.string(),
  typecheckCmd: z.string(),
  testCmdTemplate: text.refine((v) => v.includes('{files}'), 'must contain {files}'),
  kbDir: text.refine((v) => !v.startsWith('/') && !v.split('/').includes('..'), 'must be a relative path inside the repository'),
  testFilePattern: z.string(),
  exampleTestFile: z.string().nullable(),
});
export type RepoProfile = z.infer<typeof RepoProfileData>;

const statusMapShape = Object.fromEntries(TICKET_STATUSES.map((s) => [s, z.string().min(1).nullable()])) as Record<TicketStatus, z.ZodNullable<z.ZodString>>;

/** `onboarding-advisor` for a GitHub Projects board: which column each pipeline state moves the card to, and which columns approve. */
export const BoardAdviseData = z.object({
  board: z.object({
    /** Each internal state to one column of the board, or none. Several states may share a column. */
    statusMap: z.object(statusMapShape).partial().transform((m) => m as Partial<Record<TicketStatus, string | null>>),
    approval: z.object({ plan: z.string().min(1).nullable(), breakdown: z.string().min(1).nullable() }),
    /** The column that holds the cards the pipeline should pick up. */
    intakeStatus: z.string().min(1).nullable(),
    /** True when the board has nothing that fits: sdlc-agent's own columns are used (and created) instead. */
    useDefaultColumns: z.boolean(),
  }),
});
export type BoardAdvice = z.infer<typeof BoardAdviseData>['board'];

// ------------------------------------------------------------------------------------------------ facts

export interface GithubFacts {
  defaultBranch: string;
  languages: string[];
  /** The Status columns of the project's GitHub Projects board, when it uses one. */
  board?: { columns: string[] };
}
export interface OnboardingFacts {
  github: GithubFacts;
}

export interface CommandCheck {
  command: string;
  ok: boolean;
  /** The last lines of the output, for the review card. */
  tail: string;
}

// ------------------------------------------------------------------------------------------------ the proposal

export const ONBOARDING_SECTIONS = ['commands', 'board'] as const;
export type OnboardingSection = (typeof ONBOARDING_SECTIONS)[number];

export interface OnboardingProposal {
  facts: OnboardingFacts;
  profile: RepoProfile & { baseBranch: string; installCheck: CommandCheck | null; typecheckCheck: CommandCheck | null };
  /** The board mapping, for a project that works from a GitHub Projects board. It changes what the pipeline does to the board, so it must be accepted. */
  board?: BoardAdvice;
  /** Which sections the person accepted (or edited, which counts as accepting). */
  accepted: Partial<Record<OnboardingSection, boolean>>;
  createdAt: string;
  /** How long each profiling phase took, in milliseconds. Absent in proposals made before phases were timed. */
  timings?: Record<string, number>;
}

/** Whether a section needs a person's decision before the project can be confirmed. */
export function missingAcceptance(proposal: Pick<OnboardingProposal, 'accepted' | 'board'>): OnboardingSection[] {
  return proposal.board && !proposal.accepted.board ? ['board'] : [];
}
