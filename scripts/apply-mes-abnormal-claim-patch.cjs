const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const sqlFile = path.resolve(__dirname, '..', 'prisma', 'manual_patches', '20260511_create_mes_abnormal_claim.sql');

async function tableExists(tableName) {
  const rows = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `;
  return rows.length > 0;
}

async function verifyMesAbnormalClaim() {
  const rows = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MesAbnormalClaim'
  `;
  const columns = new Set(rows.map((row) => row.column_name));
  return ['id', 'orderId', 'workerName', 'claimedHours', 'reason', 'status', 'createdAt'].every((column) =>
    columns.has(column)
  );
}

function splitSqlStatements(sql) {
  const statements = [];
  let buffer = '';
  let inDoBlock = false;

  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') continue;
    if (/^DO\s+\$\$/i.test(trimmed)) inDoBlock = true;
    buffer += `${line}\n`;
    if (inDoBlock) {
      if (trimmed === '$$;') {
        statements.push(buffer.trim());
        buffer = '';
        inDoBlock = false;
      }
      continue;
    }
    if (trimmed.endsWith(';')) {
      statements.push(buffer.trim());
      buffer = '';
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function main() {
  if (process.env.APPLY_DB_PATCH !== 'yes') {
    console.error('Refusing to modify the database. Set APPLY_DB_PATCH=yes only in the intended environment.');
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL is not configured. Refusing to run patch.');
    process.exitCode = 1;
    return;
  }

  await prisma.$queryRaw`SELECT 1`;

  if (!(await tableExists('Order'))) {
    console.error('Required table public."Order" does not exist. Refusing to create MesAbnormalClaim.');
    process.exitCode = 1;
    return;
  }

  if (await tableExists('MesAbnormalClaim')) {
    console.log('public."MesAbnormalClaim" already exists. No patch applied.');
    return;
  }

  if (!fs.existsSync(sqlFile)) {
    console.error(`SQL file not found: ${sqlFile}`);
    process.exitCode = 1;
    return;
  }

  const statements = splitSqlStatements(fs.readFileSync(sqlFile, 'utf8'));
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const verified = await verifyMesAbnormalClaim();
  console.log(
    JSON.stringify(
      {
        ok: verified,
        patchApplied: true,
        table: 'MesAbnormalClaim',
        verified,
      },
      null,
      2
    )
  );
  process.exitCode = verified ? 0 : 1;
}

main()
  .catch((error) => {
    console.error('Patch failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
