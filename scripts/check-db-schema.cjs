const { PrismaClient, Prisma } = require('@prisma/client');

const checkedTables = ['Order', 'MesWorker', 'MesActivityLog', 'MesAppSettings', 'MesAbnormalClaim'];
const prisma = new PrismaClient();

function maskDatabaseUrl(value) {
  if (!value) return 'not_configured';
  try {
    const url = new URL(value);
    return `${url.protocol}//***:***@${url.hostname ? '***' : 'unknown'}:${url.port || 'default'}/${url.pathname.replace(/^\//, '') || 'database'}`;
  } catch {
    return 'configured_but_unparseable';
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  console.log('DATABASE_URL:', maskDatabaseUrl(databaseUrl));

  if (!databaseUrl || !databaseUrl.trim()) {
    console.log(
      JSON.stringify(
        {
          connected: false,
          provider: 'postgresql',
          checkedTables,
          missingTables: checkedTables,
          schemaStatus: 'database_url_missing',
          suggestion: 'Configure DATABASE_URL in the runtime environment before deploying.',
        },
        null,
        2
      )
    );
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (${Prisma.join(checkedTables)})
      `
    );

    const existing = new Set(rows.map((row) => row.table_name));
    const missingTables = checkedTables.filter((table) => !existing.has(table));
    const schemaStatus = missingTables.length === 0 ? 'ok' : 'missing_tables';
    const suggestion =
      missingTables.length === 0
        ? 'No schema action required.'
        : 'Back up production data, then run a controlled Prisma migration or prisma db push from a trusted deployment job. This script does not modify the database.';

    console.log(
      JSON.stringify(
        {
          connected: true,
          provider: 'postgresql',
          checkedTables,
          missingTables,
          schemaStatus,
          suggestion,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          connected: false,
          provider: 'postgresql',
          checkedTables,
          missingTables: [],
          schemaStatus: 'connection_failed',
          error: error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220),
          suggestion: 'Check DATABASE_URL, database reachability, credentials, and PostgreSQL server health. This script does not modify the database.',
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error('Unexpected schema check failure:', error instanceof Error ? error.message : String(error));
  await prisma.$disconnect();
  process.exitCode = 1;
});
