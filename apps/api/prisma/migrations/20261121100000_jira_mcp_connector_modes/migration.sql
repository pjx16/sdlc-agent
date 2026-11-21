-- Jira is reached over REST, the Rovo MCP server (called by code) or the Claude Jira connector (driven by an agent).
ALTER TYPE "JiraMode" ADD VALUE IF NOT EXISTS 'mcp';
ALTER TYPE "JiraMode" ADD VALUE IF NOT EXISTS 'connector';
