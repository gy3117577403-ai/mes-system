import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReadyFlagExample = {
  id: string;
  client: string;
  model: string;
  deliveryDate: string;
  drawing: string;
  materials: string;
  isDrawingReady: boolean;
  isMaterialReady: boolean;
  assignedDay: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type ReadyFlagsStatus = {
  ok: boolean;
  generatedAt: string;
  totalProblemOrders: number;
  legacyTextReadyButFlagBlocked: number;
  drawingTextReadyButFlagFalse: number;
  materialTextReadyButFlagFalse: number;
  latestProblemUpdatedAt: string | null;
  oldestProblemCreatedAt: string | null;
  possibleReasons: string[];
  examples: ReadyFlagExample[];
  message: string;
};

function json(payload: ReadyFlagsStatus, init?: ResponseInit) {
  return NextResponse.json(payload, init);
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 180);
  return String(error).slice(0, 180);
}

function drawingTextReady(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return ['已发', '已下发', '图纸已发', '已发图'].some((keyword) => text.includes(keyword));
}

function materialTextReady(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return ['料齐', '已配料', '齐套', '料已齐'].some((keyword) => text.includes(keyword));
}

function createdAtToIso(value: number | null | undefined): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateToIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildPossibleReasons(rows: Array<{ drawing: string; materials: string; isDrawingReady: boolean; isMaterialReady: boolean; updatedAt: Date }>) {
  const reasons: string[] = [];
  if (rows.some((row) => drawingTextReady(row.drawing) && row.isDrawingReady !== true)) {
    reasons.push('图纸文本字段与排产布尔字段不一致：drawing 显示已发，但 isDrawingReady=false。');
  }
  if (rows.some((row) => materialTextReady(row.materials) && row.isMaterialReady !== true)) {
    reasons.push('物料文本字段与排产布尔字段不一致：materials 显示料齐，但 isMaterialReady=false。');
  }
  const newest = rows[0]?.updatedAt ? new Date(rows[0].updatedAt).getTime() : 0;
  if (newest && Date.now() - newest < 7 * 24 * 60 * 60 * 1000) {
    reasons.push('部分问题订单 updatedAt 很新，可能是近期导入/编辑产生。');
  } else if (rows.length > 0) {
    reasons.push('问题订单看起来更像历史字段迁移未同步。');
  }
  return reasons;
}

export async function GET() {
  const generatedAt = new Date().toISOString();
  if (!process.env.DATABASE_URL?.trim()) {
    return json({
      ok: false,
      generatedAt,
      totalProblemOrders: 0,
      legacyTextReadyButFlagBlocked: 0,
      drawingTextReadyButFlagFalse: 0,
      materialTextReadyButFlagFalse: 0,
      latestProblemUpdatedAt: null,
      oldestProblemCreatedAt: null,
      possibleReasons: ['DATABASE_URL is not configured.'],
      examples: [],
      message: 'DATABASE_URL is not configured. AI cannot compare saved order readiness flags.',
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, isArchived: false },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        client: true,
        model: true,
        deliveryDate: true,
        drawing: true,
        materials: true,
        isDrawingReady: true,
        isMaterialReady: true,
        assignedDay: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const drawingMismatch = orders.filter((order) => drawingTextReady(order.drawing) && order.isDrawingReady !== true);
    const materialMismatch = orders.filter((order) => materialTextReady(order.materials) && order.isMaterialReady !== true);
    const legacyTextReadyButFlagBlocked = orders.filter(
      (order) =>
        drawingTextReady(order.drawing) &&
        materialTextReady(order.materials) &&
        (order.isDrawingReady !== true || order.isMaterialReady !== true)
    );
    const problemIds = new Set([...drawingMismatch, ...materialMismatch].map((order) => order.id));
    const problemRows = orders.filter((order) => problemIds.has(order.id));
    const latestProblemUpdatedAt = dateToIso(problemRows[0]?.updatedAt);
    const oldestProblemCreatedAt = problemRows
      .map((order) => createdAtToIso(order.createdAt))
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
    const examples = problemRows.slice(0, 10).map((order) => ({
      id: order.id,
      client: order.client,
      model: order.model,
      deliveryDate: order.deliveryDate ?? '',
      drawing: order.drawing ?? '',
      materials: order.materials ?? '',
      isDrawingReady: order.isDrawingReady === true,
      isMaterialReady: order.isMaterialReady === true,
      assignedDay: order.assignedDay ?? '',
      createdAt: createdAtToIso(order.createdAt),
      updatedAt: dateToIso(order.updatedAt),
    }));

    return json({
      ok: true,
      generatedAt,
      totalProblemOrders: problemIds.size,
      legacyTextReadyButFlagBlocked: legacyTextReadyButFlagBlocked.length,
      drawingTextReadyButFlagFalse: drawingMismatch.length,
      materialTextReadyButFlagFalse: materialMismatch.length,
      latestProblemUpdatedAt,
      oldestProblemCreatedAt,
      possibleReasons: buildPossibleReasons(problemRows),
      examples,
      message:
        problemIds.size > 0
          ? '历史文本状态与排产布尔字段存在不一致，AI 和排产系统会以布尔字段为准。'
          : '未发现历史文本状态与排产布尔字段不一致。',
    });
  } catch (error) {
    console.error('[api/db/ready-flags]', error);
    return json({
      ok: false,
      generatedAt,
      totalProblemOrders: 0,
      legacyTextReadyButFlagBlocked: 0,
      drawingTextReadyButFlagFalse: 0,
      materialTextReadyButFlagFalse: 0,
      latestProblemUpdatedAt: null,
      oldestProblemCreatedAt: null,
      possibleReasons: ['Ready flag diagnostics failed.'],
      examples: [],
      message: `Ready flag diagnostics failed: ${safeMessage(error)}`,
    });
  }
}
