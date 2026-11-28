import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCodes, GITHUB_AUTHS, missingAcceptance, GlobalSettingsSchema, ONBOARDING_SECTIONS, ProjectSettingsSchema, RepoProfileData, TICKET_STATUSES, defaultLocalKeyPrefix, events,
  type OnboardingProgress, type OnboardingProposal, type OnboardingSection, type OnboardingStatus, type TicketStatus,
} from '@sdlc/shared';
import { z } from 'zod';
import { ApiException } from '../common/api-exception';
import { logEvent } from '../common/event-log';
import { parseBody } from '../common/parse-body';
import { Prisma, type Project } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupportRaiser } from '../support/support-raiser';
import { type ProjectDto, toDto } from './project.dto';

const GITHUB_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

const StartBody = z.object({
  repoUrl: z.string({ error: 'required' }).trim().min(1, 'required').refine((v) => GITHUB_URL.test(v), 'must be an HTTPS github.com repository URL'),
  /** token: the personal token from Settings (the default). bot: sdlc-agent-bot, through the token broker. */
  githubAuth: z.enum(GITHUB_AUTHS, { error: 'must be token or bot' }).default('token'),
});

const SectionBody = z.object({ action: z.enum(['accept', 'edit']), value: z.record(z.string(), z.unknown()).optional() });

export interface OnboardingDto {
  status: OnboardingStatus;
  error: string | null;
  proposal: OnboardingProposal | null;
  /** While profiling: which phases are planned, running and done. */
  progress: OnboardingProgress | null;
}

export interface ConfirmDto {
  project: ProjectDto;
  /** Things that did not work but do not stop the project. */
  warnings: string[];
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly raiser: SupportRaiser,
  ) {}

  /** POST /projects/onboard: a repo URL. The worker does the rest. */
  async start(body: unknown): Promise<ProjectDto> {
    const { repoUrl, githubAuth } = parseBody(StartBody, body);
    const [, owner = '', repo = ''] = GITHUB_URL.exec(repoUrl) ?? [];
    const names = [repo, `${owner}-${repo}`, `${owner}-${repo}-2`];
    for (const name of names) {
      try {
        const project = await this.prisma.project.create({
          data: {
            name,
            repoUrl,
            githubAuth,
            // Placeholders until the proposal is confirmed: the worker ignores the project until then.
            stack: 'ts_node',
            testCmdTemplate: 'echo {files}',
            localKeyPrefix: defaultLocalKeyPrefix(repo),
            onboardingStatus: 'profiling',
            mirrorStatus: 'pending',
          },
        });
        await logEvent(this.prisma, events.note({ source: 'user', type: 'system', message: `Onboarding of ${name} started` }));
        return toDto(project);
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'Validation failed', { repoUrl: 'a project for this repository already exists' });
  }

  private async project(id: string): Promise<Project> {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new ApiException(HttpStatus.NOT_FOUND, ErrorCodes.notFound, 'Project not found');
    return p;
  }

  private proposalOf(p: Project): OnboardingProposal | null {
    return (p.onboardingProposal as unknown as OnboardingProposal | null) ?? null;
  }

  async get(id: string): Promise<OnboardingDto> {
    const p = await this.project(id);
    return { status: p.onboardingStatus, error: p.onboardingError, proposal: this.proposalOf(p), progress: p.onboardingStatus === 'profiling' ? ((p.onboardingProgress as unknown as OnboardingProgress | null) ?? null) : null };
  }

  /** POST /projects/:id/onboarding/rerun: a new proposal. Settings do not change until it is confirmed again, and the worker ignores the project meanwhile. */
  async rerun(id: string): Promise<OnboardingDto> {
    const p = await this.project(id);
    if (p.onboardingStatus === 'profiling') throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.conflict, 'The project is already being profiled');
    await this.raiser.close({ projectId: id, kind: 'onboarding' }, 'dismissed', 'user', 'Replaced by a new proposal');
    await this.prisma.project.update({ where: { id }, data: { onboardingStatus: 'profiling', onboardingError: null } });
    return this.get(id);
  }

  /** PATCH /projects/:id/onboarding/sections/:section: accept the proposal as it is, or edit it (which counts as accepting). */
  async section(id: string, section: string, body: unknown): Promise<OnboardingDto> {
    const p = await this.project(id);
    if (!(ONBOARDING_SECTIONS as readonly string[]).includes(section)) throw new ApiException(HttpStatus.NOT_FOUND, ErrorCodes.notFound, 'Unknown section');
    const { action, value } = parseBody(SectionBody, body);
    const proposal = this.proposalOf(p);
    if (p.onboardingStatus !== 'proposed' || !proposal) throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.conflict, 'There is no proposal to review yet');
    if (section === 'board' && !proposal.board) throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'Validation failed', { board: 'this project has no GitHub Projects board to map' });
    if (action === 'edit') this.apply(proposal, section as OnboardingSection, parseBody(z.record(z.string(), z.unknown()), value ?? {}));
    proposal.accepted = { ...proposal.accepted, [section]: true };
    await this.prisma.project.update({ where: { id }, data: { onboardingProposal: proposal as unknown as Prisma.InputJsonValue } });
    return this.get(id);
  }

  /** Edits one section, checking it against the facts: a column must exist on the board. */
  private apply(proposal: OnboardingProposal, section: OnboardingSection, value: Record<string, unknown>): void {
    switch (section) {
      case 'commands': {
        const merged = parseBody(RepoProfileData, { ...proposal.profile, ...value });
        const branch = value.baseBranch === undefined ? proposal.profile.baseBranch : parseBody(z.object({ baseBranch: z.string().trim().min(1, 'required').refine((v) => !/\s/.test(v), 'must not contain spaces') }), { baseBranch: value.baseBranch }).baseBranch;
        proposal.profile = { ...proposal.profile, ...merged, baseBranch: branch };
        return;
      }
      case 'board': {
        const board = proposal.board;
        if (!board || !proposal.facts.github.board) throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'Validation failed', { board: 'this project has no GitHub Projects board to map' });
        const names = new Map(proposal.facts.github.board.columns.map((c) => [c.toLowerCase(), c]));
        const column = z.string().nullable().transform((v, ctx) => {
          if (v === null) return null;
          const hit = names.get(v.toLowerCase());
          if (!hit) ctx.addIssue({ code: 'custom', message: 'is not a column of this board' });
          return hit ?? null;
        });
        const parsed = parseBody(z.object({ statusMap: z.partialRecord(z.enum(TICKET_STATUSES), column).optional(), approval: z.object({ plan: column, breakdown: column }).partial().optional(), intakeStatus: column.optional(), useDefaultColumns: z.boolean().optional() }), value);
        proposal.board = {
          statusMap: { ...board.statusMap, ...(parsed.statusMap as Partial<Record<TicketStatus, string | null>> | undefined) },
          approval: { ...board.approval, ...parsed.approval },
          intakeStatus: parsed.intakeStatus === undefined ? board.intakeStatus : parsed.intakeStatus,
          useDefaultColumns: parsed.useDefaultColumns ?? board.useDefaultColumns,
        };
        return;
      }
    }
  }

  /** POST /projects/:id/onboarding/confirm: applies the proposal. The board mapping, when there is one, must have been accepted. */
  async confirm(id: string): Promise<ConfirmDto> {
    const p = await this.project(id);
    const proposal = this.proposalOf(p);
    if (p.onboardingStatus !== 'proposed' || !proposal) throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.conflict, 'There is no proposal to confirm');
    const missing = missingAcceptance(proposal);
    if (missing.length > 0) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.conflict, `Accept these first: ${missing.join(', ')}`, Object.fromEntries(missing.map((s) => [s, 'must be accepted'])));
    }
    const warnings: string[] = [];
    const { profile } = proposal;
    const settings = ProjectSettingsSchema.parse(p.settings);

    // New projects start with the models and turn limits chosen in Settings.
    const row = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    const defaults = GlobalSettingsSchema.parse({ stageDefaults: row?.stageDefaults ?? {} }).stageDefaults;
    const stages = Object.fromEntries(Object.entries(settings.stages).map(([stage, current]) => [stage, { ...current, ...(defaults[stage as keyof typeof defaults] ?? {}) }]));
    const nextSettings = {
      ...settings,
      stages,
      // The board mapping, once accepted: what the pipeline writes to the board and which columns approve.
      ...(proposal.board
        ? {
            github: {
              ...settings.github,
              statusMap: Object.fromEntries(Object.entries(proposal.board.statusMap).filter(([, v]) => v !== undefined)),
              approval: { ...settings.github.approval, plan: proposal.board.approval.plan, breakdown: proposal.board.approval.breakdown },
              useDefaultColumns: proposal.board.useDefaultColumns,
              ...(proposal.board.intakeStatus ? { intakeStatus: proposal.board.intakeStatus } : {}),
            },
          }
        : {}),
    };
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        stack: profile.stack,
        installCmd: profile.installCmd,
        typecheckCmd: profile.typecheckCmd,
        testCmdTemplate: profile.testCmdTemplate,
        kbDir: profile.kbDir,
        baseBranch: profile.baseBranch,
        settings: nextSettings as unknown as Prisma.InputJsonValue,
        // A changed base branch needs a fresh mirror; otherwise the one the worker made stays.
        ...(profile.baseBranch !== p.baseBranch ? { mirrorStatus: 'pending', mirrorError: null } : {}),
        onboardingStatus: 'confirmed',
        onboardingError: null,
      },
    });
    await this.raiser.close({ projectId: id, kind: 'onboarding' }, 'resolved', 'user', 'The proposal was confirmed');
    await logEvent(this.prisma, events.note({ source: 'user', type: 'system', message: `Onboarding of ${p.name} confirmed` }));
    return { project: toDto(updated), warnings };
  }
}
