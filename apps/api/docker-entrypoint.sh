#!/bin/sh
# Applies database migrations when any exist, then starts the API.
set -e
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  # The image has no npm/npx: run the Prisma CLI from the installed dependencies.
  node /app/node_modules/prisma/build/index.js migrate deploy
fi
exec node dist/main.js
