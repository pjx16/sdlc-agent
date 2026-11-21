import { JIRA_MODE_INFO, type JiraMode } from '@sdlc/shared';

/** What the chosen Jira mode means. REST is recommended; the connector mode warns that every Jira call spends Claude usage. */
export function JiraModeNote({ mode }: { mode: string }) {
  const info = JIRA_MODE_INFO[mode as JiraMode];
  if (!info || mode === 'off') return null;
  if (info.usesClaudeTokens) {
    return (
      <p role="note" className="rounded border border-amber/40 bg-amber/10 p-2 text-xs sm:col-span-2">
        <strong>Uses Claude tokens.</strong> {info.description} Every poll, comment, status move and sub-task runs a Claude agent, so connector
        projects are polled less often. Sign the connector in once with <code>bash scripts/jira-connector-login.sh</code>. Prefer REST, or Rovo
        MCP, when your organisation allows them.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted sm:col-span-2">
      {info.recommended && <strong>Recommended. </strong>}
      {info.description}
      {mode === 'mcp' && ' Connect it in Settings → Connections.'}
    </p>
  );
}
