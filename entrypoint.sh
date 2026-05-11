#!/bin/sh
echo "[Sealos] Running read-only database schema check..."
node scripts/check-db-schema.cjs || true

if [ "$AUTO_DB_PUSH_ON_START" = "yes" ]; then
  echo "[Sealos] AUTO_DB_PUSH_ON_START=yes, running prisma db push without accept-data-loss..."
  node ./node_modules/prisma/build/index.js db push || true
else
  echo "[Sealos] Database auto mutation is disabled. Use controlled migration or manual patch."
fi

echo "[Sealos] Starting Next.js server..."
exec node server.js
