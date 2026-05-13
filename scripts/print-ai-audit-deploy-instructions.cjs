console.log(`
AI Planner Audit schema deployment instructions
==============================================

This script only prints instructions. It does not execute SQL and does not modify any database.

1. Back up the target PostgreSQL database first.
2. Confirm DATABASE_URL points to the intended target environment.
3. Deploy the latest application image/code so Prisma Client and server actions match the schema.
4. Manually execute the SQL patch:

   psql "$DATABASE_URL" -f prisma/manual_ai_planner_audit.sql

5. Verify after execution:

   pnpm check:ai-audit-schema

6. For Sealos / Docker deployments, confirm the running image contains:
   - latest Prisma Client generated from prisma/schema.prisma
   - src/lib/aiPlannerAudit.ts
   - src/actions/aiPlannerAuditActions.ts
   - src/app/api/db/status/route.ts with aiAuditStatus

7. The SQL only creates AI audit tables:
   - public."AiPlannerRun"
   - public."AiContextSnapshot"
   - public."AiSuggestion"
   It does not modify Order, MesWorker, MesActivityLog, MesAppSettings, or MesAbnormalClaim.

8. Do not rely on prisma db push --accept-data-loss as a long-term production migration strategy.
`);
