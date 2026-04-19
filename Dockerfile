# Next.js standalone — 多階段建置（pnpm）
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

FROM base AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 建置時需 DATABASE_URL（可用占位，僅為 prisma generate；實際連線在運行時）
ARG DATABASE_URL=postgresql://postgres:placeholder@localhost:5432/postgres
ENV DATABASE_URL=${DATABASE_URL}
# 映像建置不執行 db push（CI 無內網 DB）；建表請在部署環境執行 pnpm run build 或 prisma db push
RUN pnpm exec prisma generate && pnpm exec next build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

COPY entrypoint.sh ./
RUN chmod +x ./entrypoint.sh \
  && chown nextjs:nodejs ./entrypoint.sh \
  && npm install -g prisma@6.19.0

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./entrypoint.sh"]
