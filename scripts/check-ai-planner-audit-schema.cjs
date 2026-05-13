const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

const tableColumns = {
  AiPlannerRun: [
    'id',
    'createdAt',
    'updatedAt',
    'status',
    'userPrompt',
    'contextSummaryJson',
    'contextHash',
    'responseJson',
    'replyText',
  ],
  AiContextSnapshot: ['id', 'aiRunId', 'snapshotType', 'orderCount', 'contentHash', 'contentJson'],
  AiSuggestion: ['id', 'aiRunId', 'type', 'status', 'targetOrderId', 'payloadJson', 'resultJson', 'blockedReason'],
};

const requiredForeignKeys = [
  'AiContextSnapshot_aiRunId_fkey',
  'AiSuggestion_aiRunId_fkey',
];

const requiredIndexes = [
  'AiPlannerRun_createdAt_idx',
  'AiPlannerRun_status_idx',
  'AiContextSnapshot_aiRunId_idx',
  'AiContextSnapshot_createdAt_idx',
  'AiSuggestion_aiRunId_idx',
  'AiSuggestion_status_idx',
  'AiSuggestion_targetOrderId_idx',
  'AiSuggestion_createdAt_idx',
];

function print(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function safeMessage(error) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    print({
      ok: false,
      databaseReachable: false,
      aiAuditTablesReady: false,
      missingTables: Object.keys(tableColumns),
      missingColumns: {},
      missingForeignKeys: requiredForeignKeys,
      missingIndexes: requiredIndexes,
      message: 'DATABASE_URL is not configured',
    });
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    const tableNames = Object.keys(tableColumns);
    const tableRows = await prisma.$queryRaw(Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${Prisma.join(tableNames)})
    `);
    const existingTables = new Set(tableRows.map((row) => row.table_name));
    const missingTables = tableNames.filter((table) => !existingTables.has(table));

    const columnRows = await prisma.$queryRaw(Prisma.sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${Prisma.join(tableNames)})
    `);
    const columnMap = new Map();
    for (const row of columnRows) {
      const columns = columnMap.get(row.table_name) ?? new Set();
      columns.add(row.column_name);
      columnMap.set(row.table_name, columns);
    }
    const missingColumns = {};
    for (const [table, columns] of Object.entries(tableColumns)) {
      if (!existingTables.has(table)) continue;
      const existingColumns = columnMap.get(table) ?? new Set();
      const missed = columns.filter((column) => !existingColumns.has(column));
      if (missed.length > 0) missingColumns[table] = missed;
    }

    const fkRows = await prisma.$queryRaw(Prisma.sql`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'f'
        AND conname IN (${Prisma.join(requiredForeignKeys)})
    `);
    const existingFks = new Set(fkRows.map((row) => row.conname));
    const missingForeignKeys = requiredForeignKeys.filter((name) => !existingFks.has(name));

    const indexRows = await prisma.$queryRaw(Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (${Prisma.join(requiredIndexes)})
    `);
    const existingIndexes = new Set(indexRows.map((row) => row.indexname));
    const missingIndexes = requiredIndexes.filter((name) => !existingIndexes.has(name));

    const aiAuditTablesReady =
      missingTables.length === 0 &&
      Object.keys(missingColumns).length === 0 &&
      missingForeignKeys.length === 0 &&
      missingIndexes.length === 0;

    print({
      ok: aiAuditTablesReady,
      databaseReachable: true,
      aiAuditTablesReady,
      missingTables,
      missingColumns,
      missingForeignKeys,
      missingIndexes,
      message: aiAuditTablesReady
        ? 'AI planner audit schema is ready'
        : 'AI planner audit schema is not fully deployed',
    });
  } catch (error) {
    print({
      ok: false,
      databaseReachable: false,
      aiAuditTablesReady: false,
      missingTables: [],
      missingColumns: {},
      missingForeignKeys: [],
      missingIndexes: [],
      message: safeMessage(error),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
