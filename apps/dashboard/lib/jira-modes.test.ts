import { describe, expect, it } from 'vitest';
import { JIRA_MODE_OPTIONS, jiraModeLabel } from './jira-modes';

describe('Jira mode options', () => {
  it('lists REST first as recommended, and marks the connector as using Claude tokens', () => {
    expect(JIRA_MODE_OPTIONS.map((o) => o.value)).toEqual(['rest', 'mcp', 'connector', 'off']);
    expect(JIRA_MODE_OPTIONS[0]?.label).toBe('REST API (recommended)');
    expect(JIRA_MODE_OPTIONS.find((o) => o.value === 'connector')?.label).toBe('Claude Jira connector (uses Claude tokens)');
    expect(JIRA_MODE_OPTIONS.find((o) => o.value === 'mcp')?.label).toBe('Atlassian Rovo MCP');
  });

  it('labels a mode for display', () => {
    expect(jiraModeLabel('mcp')).toBe('Atlassian Rovo MCP');
    expect(jiraModeLabel('unknown')).toBe('unknown');
  });
});
