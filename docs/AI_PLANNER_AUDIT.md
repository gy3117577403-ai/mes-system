# AI Planner Audit

This project now defines optional AI planner audit tables:

- `AiPlannerRun`: one record for each AI planner analysis.
- `AiContextSnapshot`: compact scheduler context captured for a run.
- `AiSuggestion`: proposed mutations that require human approval.

The tables are intentionally optional at runtime. If they are not deployed, the AI planner still analyzes orders and returns suggestions; the UI shows that AI memory/history is unavailable.

## Why no automatic db push

Production schema changes must be controlled. The app must not run `prisma db push --accept-data-loss` as a long-term production strategy, and this change does not automatically execute DDL.

## Manual deployment

After backing up the target PostgreSQL database, review and execute:

```bash
psql "$DATABASE_URL" -f prisma/manual_ai_planner_audit.sql
```

The SQL only creates `AiPlannerRun`, `AiContextSnapshot`, and `AiSuggestion` with indexes and cascading foreign keys. It does not delete or modify existing tables.

## Degraded behavior

If the audit tables are missing:

- AI analysis still works.
- Order context still follows `src/lib/scheduleEligibility.ts`.
- Suggested mutations still require manual confirmation.
- History and memory panels show a persistence warning instead of crashing.

The audit trail never bypasses scheduling hard rules: orders with drawing not ready or material not ready cannot be forced into the schedule by AI.
