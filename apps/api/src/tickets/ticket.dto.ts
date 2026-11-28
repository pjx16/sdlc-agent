import type { Ticket } from '../generated/prisma/client';

export interface TicketDto {
  id: string;
  projectId: string;
  key: string;
  source: 'jira' | 'paste' | 'github';
  externalKey: string | null;
  type: 'story' | 'bug' | 'tech';
  title: string;
  body: string;
  featureKey: string | null;
  /** KB docs attached to the ticket (paths inside the project's KB folder). */
  kbAttachments: string[];
  labels: unknown;
  status: string;
  holdReason: string | null;
  holdFromStatus: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  /** Whether the ticket also gets a GitHub issue: none, pending (the worker will make or link it), created, or failed. */
  githubIssueState: 'none' | 'pending' | 'created' | 'failed';
  githubIssueError: string | null;
  /** The ticket's GitHub issue, once it has one. */
  githubIssueUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `owner/name#42` is the issue at github.com/owner/name/issues/42. Only a ticket that is a GitHub issue (or was given one) has it. */
export function githubIssueUrl(t: Pick<Ticket, 'source' | 'externalKey' | 'githubIssueState'>): string | null {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(t.externalKey ?? '');
  return m && (t.source === 'github' || t.githubIssueState === 'created') ? `https://github.com/${m[1]}/issues/${m[2]}` : null;
}

export function toTicketDto(t: Ticket): TicketDto {
  return {
    id: t.id,
    projectId: t.projectId,
    key: t.key,
    source: t.source,
    externalKey: t.externalKey,
    type: t.type,
    title: t.title,
    body: t.body,
    featureKey: t.featureKey,
    kbAttachments: Array.isArray(t.kbAttachments) ? (t.kbAttachments as string[]) : [],
    labels: t.labels,
    status: t.status,
    holdReason: t.holdReason,
    holdFromStatus: t.holdFromStatus,
    branch: t.branch,
    prNumber: t.prNumber,
    prUrl: t.prUrl,
    githubIssueState: t.githubIssueState,
    githubIssueError: t.githubIssueError,
    githubIssueUrl: githubIssueUrl(t),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
