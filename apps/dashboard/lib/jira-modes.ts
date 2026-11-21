import { JIRA_MODES, JIRA_MODE_INFO, type JiraMode } from '@sdlc/shared';

/** The Jira mode dropdown: REST first and marked as recommended, the connector marked as the one that spends Claude tokens. */
export const JIRA_MODE_OPTIONS: readonly { value: JiraMode; label: string }[] = JIRA_MODES.map((mode) => {
  const info = JIRA_MODE_INFO[mode];
  const tag = info.recommended ? ' (recommended)' : info.usesClaudeTokens ? ' (uses Claude tokens)' : '';
  return { value: mode, label: `${info.label}${tag}` };
});

export const jiraModeLabel = (mode: string): string => JIRA_MODE_INFO[mode as JiraMode]?.label ?? mode;
