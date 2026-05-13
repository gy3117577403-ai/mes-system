const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { inspectDatabaseTarget } = require('./inspect-database-target.cjs');

const sqlPath = path.join(process.cwd(), 'prisma', 'manual_ai_planner_audit.sql');

function print(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function fail(reason, nextStep) {
  print({ ok: false, executed: false, reason, nextStep });
}

function psqlAvailable() {
  const result = spawnSync('psql', ['--version'], { encoding: 'utf8', shell: true });
  return result.status === 0;
}

function runCheck() {
  const result = spawnSync('pnpm', ['check:ai-audit-schema'], {
    encoding: 'utf8',
    shell: true,
    cwd: process.cwd(),
  });
  const match = result.stdout.match(/\{[\s\S]*\}\s*$/);
  if (!match) return { ok: false, raw: result.stdout || result.stderr };
  try {
    return JSON.parse(match[0]);
  } catch {
    return { ok: false, raw: result.stdout || result.stderr };
  }
}

async function main() {
  const target = inspectDatabaseTarget();
  if (!target.hasDatabaseUrl) {
    fail('DATABASE_URL is not configured', 'Configure a local development DATABASE_URL first.');
    return;
  }
  if (!target.safeForLocalSchemaDeploy) {
    fail(
      'DATABASE_URL is not considered safe for automatic local schema deployment',
      'Use pnpm db:ai-audit:instructions and deploy manually after backup.'
    );
    return;
  }
  if (process.env.GG_AI_ALLOW_LOCAL_AI_AUDIT_SCHEMA_DEPLOY !== 'YES') {
    fail(
      'GG_AI_ALLOW_LOCAL_AI_AUDIT_SCHEMA_DEPLOY must equal YES',
      'PowerShell: $env:GG_AI_ALLOW_LOCAL_AI_AUDIT_SCHEMA_DEPLOY="YES"; pnpm db:ai-audit:apply-local'
    );
    return;
  }
  if (!fs.existsSync(sqlPath)) {
    fail('prisma/manual_ai_planner_audit.sql does not exist', 'Regenerate or restore the manual SQL file.');
    return;
  }
  if (!psqlAvailable()) {
    fail('psql is not available on PATH', 'Manually execute: psql "$DATABASE_URL" -f prisma/manual_ai_planner_audit.sql');
    return;
  }

  const result = spawnSync('psql', [process.env.DATABASE_URL, '-f', sqlPath], {
    encoding: 'utf8',
    shell: true,
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    fail('psql failed while executing manual_ai_planner_audit.sql', (result.stderr || result.stdout || '').slice(0, 500));
    return;
  }

  const check = runCheck();
  print({
    ok: check.aiAuditTablesReady === true,
    executed: true,
    aiAuditTablesReady: check.aiAuditTablesReady === true,
    message:
      check.aiAuditTablesReady === true
        ? 'AI planner audit schema deployed to local database'
        : 'SQL executed, but schema verification did not pass',
    verification: check,
  });
}

main();
