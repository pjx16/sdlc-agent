-- How a new project reaches GitHub unless told otherwise: with a personal token, or as sdlc-agent-bot.
ALTER TABLE "GlobalSettings" ADD COLUMN "githubDefaultAuth" TEXT NOT NULL DEFAULT 'token';
