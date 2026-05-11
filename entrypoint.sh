#!/bin/sh
echo "🚀 [Sealos CI/CD] Starting Prisma DB Push via Internal Network..."
./node_modules/.bin/prisma db push --accept-data-loss
echo "✅ [Sealos CI/CD] DB Sync Complete. Starting Next.js server..."
exec node server.js
