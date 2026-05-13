import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const provider = 'postgresql';
const requiredTables = ['Order', 'MesWorker', 'MesActivityLog', 'MesAppSettings'] as const;
const optionalTables = ['MesAbnormalClaim', 'AiPlannerRun', 'AiContextSnapshot', 'AiSuggestion'] as const;
const checkedTables = [...requiredTables, ...optionalTables] as const;

type DbStatus = {
  ok: boolean;
  connected: boolean;
  provider: typeof provider;
  checkedTables: string[];
  requiredTables: string[];
  optionalTables: string[];
  missingTables: string[];
  optionalMissingTables: string[];
  schemaStatus: 'ok' | 'missing_tables' | 'database_url_missing' | 'connection_failed';
  optionalStatus?: 'ok' | 'degraded';
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
  const base: Pick<DbStatus, 'provider' | 'checkedTables' | 'requiredTables' | 'optionalTables'> = {
    provider,
    checkedTables: [...checkedTables],
    requiredTables: [...requiredTables],
    optionalTables: [...optionalTables],
  };

  if (!process.env.DATABASE_URL?.trim()) {
    return json(
      {
        ...base,
        ok: false,
        connected: false,
        missingTables: [...requiredTables],
        optionalMissingTables: [...optionalTables],
        schemaStatus: 'database_url_missing',
        optionalStatus: 'degraded',
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
    const missingTables = requiredTables.filter((table) => !existing.has(table));
    const optionalMissingTables = optionalTables.filter((table) => !existing.has(table));

    return json({
      ...base,
      ok: missingTables.length === 0,
      connected: true,
      missingTables,
      optionalMissingTables,
      schemaStatus: missingTables.length === 0 ? 'ok' : 'missing_tables',
      optionalStatus: optionalMissingTables.length === 0 ? 'ok' : 'degraded',
      message:
        optionalMissingTables.length > 0
          ? 'Optional tables are missing. Core order context may still work; abnormal hours or AI audit history may degrade.'
          : undefined,
    });
  } catch (error) {
    console.error('[api/db/status]', error);
    return json(
      {
        ...base,
        ok: false,
        connected: false,
        missingTables: [],
        optionalMissingTables: [],
        schemaStatus: 'connection_failed',
        optionalStatus: 'degraded',
        message: safeMessage(error),
      },
      { status: 200 }
    );
  }
}
