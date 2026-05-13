# AI Planner Audit

This project now defines optional AI planner audit tables:

- `AiPlannerRun`: one record for each AI planner analysis.
- `AiContextSnapshot`: compact scheduler context captured for a run.
- `AiSuggestion`: proposed mutations that require human approval.

The tables are intentionally optional at runtime. If they are not deployed, the AI planner still analyzes orders and returns suggestions; the UI shows that AI memory/history is unavailable.

## Why no automatic db push

Production schema changes must be controlled. The app must not run `prisma db push --accept-data-loss` as a long-term production strategy, and this change does not automatically execute DDL.

## Manual deployment

To print the deployment checklist without changing any database:

```bash
pnpm db:ai-audit:instructions
```

After backing up the target PostgreSQL database, review and execute:

```bash
psql "$DATABASE_URL" -f prisma/manual_ai_planner_audit.sql
```

The SQL only creates `AiPlannerRun`, `AiContextSnapshot`, and `AiSuggestion` with indexes and cascading foreign keys. It does not delete or modify existing tables.

## Verification

Check whether the audit schema is deployed:

```bash
pnpm check:ai-audit-schema
```

The check is read-only. It validates tables, columns, foreign keys, and indexes, and returns structured JSON. If `DATABASE_URL` is missing or the database is unreachable, it reports `ok:false` without printing secrets.

The AI workspace shows three memory states:

- Enabled: audit tables are deployed and history/suggestions can persist.
- Not deployed: AI analysis still works, but memory/history is unavailable.
- Database unreachable: AI cannot reliably inspect persistence state.

## Writable self-check

The workspace can run a "Test AI memory write" self-check. It:

- does not call the model;
- does not modify orders;
- creates one minimal `AiPlannerRun` with `source = SYSTEM_CHECK`;
- immediately deletes that test run;
- returns a structured warning if creation or cleanup fails.

## Degraded behavior

If the audit tables are missing:

- AI analysis still works.
- Order context still follows `src/lib/scheduleEligibility.ts`.
- Suggested mutations still require manual confirmation.
- History and memory panels show a persistence warning instead of crashing.

The audit trail never bypasses scheduling hard rules: orders with drawing not ready or material not ready cannot be forced into the schedule by AI.
