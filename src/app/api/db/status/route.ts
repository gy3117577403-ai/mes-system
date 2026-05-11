import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const provider = 'postgresql';
const checkedTables = ['Order', 'MesWorker', 'MesActivityLog', 'MesAppSettings', 'MesAbnormalClaim'] as const;

type DbStatus = {
  ok: boolean;
  connected: boolean;
  provider: typeof provider;
  checkedTables: string[];
  missingTables: string[];
  schemaStatus: 'ok' | 'missing_tables' | 'database_url_missing' | 'connection_failed';
  message?: string;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: DbStatus, init?: ResponseInit) {
  return NextResponse.json(status, init);
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 180);
  return String(error).slice(0, 180);
}

export async function GET() {
  const base: Pick<DbStatus, 'provider' | 'checkedTables'> = {
    provider,
    checkedTables: [...checkedTables],
  };

  if (!process.env.DATABASE_URL?.trim()) {
    return json(
      {
        ...base,
        ok: false,
        connected: false,
        missingTables: [...checkedTables],
        schemaStatus: 'database_url_missing',
        message: 'DATABASE_URL is not configured.',
      },
      { status: 200 }
    );
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    const rows = await prisma.$queryRaw<{ table_name: string }[]>(Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${Prisma.join([...checkedTables])})
    `);

    const existing = new Set(rows.map((row) => row.table_name));
    const missingTables = checkedTables.filter((table) => !existing.has(table));

    return json({
      ...base,
      ok: missingTables.length === 0,
      connected: true,
      missingTables,
      schemaStatus: missingTables.length === 0 ? 'ok' : 'missing_tables',
    });
  } catch (error) {
    console.error('[api/db/status]', error);
    return json(
      {
        ...base,
        ok: false,
        connected: false,
        missingTables: [],
        schemaStatus: 'connection_failed',
        message: safeMessage(error),
      },
      { status: 200 }
    );
  }
}
