-- The pipeline runs on an Anthropic API key. The old Claude subscription token cannot be reused as one (and is encrypted under its own key name), so it is removed.
DELETE FROM "Credential" WHERE "key" = 'claude_token';
