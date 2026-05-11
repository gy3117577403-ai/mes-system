const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();
const requiredColumns = ['id', 'orderId', 'workerName', 'claimedHours', 'reason', 'status', 'createdAt'];
const expectedIndexes = ['MesAbnormalClaim_orderId_idx', 'MesAbnormalClaim_createdAt_idx'];

async function tableExists() {
  const rows = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'MesAbnormalClaim'
  `;
  return rows.length > 0;
}

async function getColumns() {
  return prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MesAbnormalClaim'
    ORDER BY ordinal_position
  `;
}

async function getForeignKeys() {
  return prisma.$queryRaw(Prisma.sql`
    SELECT conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid = 'public."MesAbnormalClaim"'::regclass
      AND confrelid = 'public."Order"'::regclass
  `);
}

async function getIndexes() {
  return prisma.$queryRaw`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'MesAbnormalClaim'
  `;
}

async function verify() {
  if (!process.env.DATABASE_URL?.trim()) {
    return {
      ok: false,
      connected: false,
      tableExists: false,
      missingColumns: requiredColumns,
      missingIndexes: expectedIndexes,
      foreignKeyExists: false,
      schemaStatus: 'database_url_missing',
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const exists = await tableExists();
    if (!exists) {
      return {
        ok: false,
        connected: true,
        tableExists: false,
        missingColumns: requiredColumns,
        missingIndexes: expectedIndexes,
        foreignKeyExists: false,
        schemaStatus: 'missing_table',
      };
    }

    const [columns, foreignKeys, indexes] = await Promise.all([getColumns(), getForeignKeys(), getIndexes()]);
    const columnNames = new Set(columns.map((row) => row.column_name));
    const indexNames = new Set(indexes.map((row) => row.indexname));
    const missingColumns = requiredColumns.filter((column) => !columnNames.has(column));
    const missingIndexes = expectedIndexes.filter((index) => !indexNames.has(index));
    const foreignKeyExists = foreignKeys.length > 0;
    const createdAtColumn = columns.find((row) => row.column_name === 'createdAt');
    const createdAtTypeOk = createdAtColumn?.data_type === 'timestamp without time zone';

    const ok = missingColumns.length === 0 && missingIndexes.length === 0 && foreignKeyExists && createdAtTypeOk;

    return {
      ok,
      connected: true,
      tableExists: true,
      columns: columns.map((row) => ({
        name: row.column_name,
        dataType: row.data_type,
        nullable: row.is_nullable === 'YES',
        hasDefault: row.column_default != null,
      })),
      missingColumns,
      indexes: indexes.map((row) => row.indexname),
      missingIndexes,
      foreignKeyExists,
      createdAtTypeOk,
      schemaStatus: ok ? 'ok' : 'shape_mismatch',
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      tableExists: false,
      missingColumns: [],
      missingIndexes: [],
      foreignKeyExists: false,
      schemaStatus: 'connection_failed',
      error: error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220),
    };
  }
}

verify()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.connected ? 0 : 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
