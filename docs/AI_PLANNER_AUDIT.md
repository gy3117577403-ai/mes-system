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

To inspect whether the configured database target is safe for a local-only schema deployment:

```bash
pnpm db:inspect-target
```

After backing up the target PostgreSQL database, review and execute:

```bash
psql "$DATABASE_URL" -f prisma/manual_ai_planner_audit.sql
```

The SQL only creates `AiPlannerRun`, `AiContextSnapshot`, and `AiSuggestion` with indexes and cascading foreign keys. It does not delete or modify existing tables.

For local development only, this repository also includes a guarded helper:

```bash
GG_AI_ALLOW_LOCAL_AI_AUDIT_SCHEMA_DEPLOY=YES pnpm db:ai-audit:apply-local
```

The helper refuses to run unless `DATABASE_URL` points to localhost, does not look production-like, and the explicit environment switch is set. It never runs `prisma db push`.

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

## Ready Flag Mismatch Diagnostics

Historical imported orders can have text fields such as `drawing` or `materials` that read like "issued drawing" or "materials ready" while the scheduling booleans remain false. The scheduler and AI always trust the booleans.

Use the read-only explain script to inspect the source of those mismatches:

```bash
pnpm diagnose:ready-flags:explain
```

The script writes a local JSON report to `tmp/ready-flag-mismatch-report.json`. That report is ignored by git and must not be treated as a data repair. The controlled repair remains the existing manual UI action, and it must not be executed automatically.
