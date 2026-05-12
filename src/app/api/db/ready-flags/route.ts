import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReadyFlagExample = {
  id: string;
  client: string;
  model: string;
  drawing: string;
  materials: string;
  isDrawingReady: boolean;
  isMaterialReady: boolean;
};

type ReadyFlagsStatus = {
  ok: boolean;
  totalProblemOrders: number;
  legacyTextReadyButFlagBlocked: number;
  drawingTextReadyButFlagFalse: number;
  materialTextReadyButFlagFalse: number;
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

export async function GET() {
  if (!process.env.DATABASE_URL?.trim()) {
    return json({
      ok: false,
      totalProblemOrders: 0,
      legacyTextReadyButFlagBlocked: 0,
      drawingTextReadyButFlagFalse: 0,
      materialTextReadyButFlagFalse: 0,
      examples: [],
      message: 'DATABASE_URL is not configured. AI cannot compare saved order readiness flags.',
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, isArchived: false },
      orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        client: true,
        model: true,
        drawing: true,
        materials: true,
        isDrawingReady: true,
        isMaterialReady: true,
      },
    });

    const drawingMismatch = orders.filter(
      (order) => drawingTextReady(order.drawing) && order.isDrawingReady !== true
    );
    const materialMismatch = orders.filter(
      (order) => materialTextReady(order.materials) && order.isMaterialReady !== true
    );
    const legacyTextReadyButFlagBlocked = orders.filter(
      (order) =>
        drawingTextReady(order.drawing) &&
        materialTextReady(order.materials) &&
        (order.isDrawingReady !== true || order.isMaterialReady !== true)
    );
    const problemIds = new Set([...drawingMismatch, ...materialMismatch].map((order) => order.id));
    const examples = orders
      .filter((order) => problemIds.has(order.id))
      .slice(0, 10)
      .map((order) => ({
        id: order.id,
        client: order.client,
        model: order.model,
        drawing: order.drawing ?? '',
        materials: order.materials ?? '',
        isDrawingReady: order.isDrawingReady === true,
        isMaterialReady: order.isMaterialReady === true,
      }));

    return json({
      ok: true,
      totalProblemOrders: problemIds.size,
      legacyTextReadyButFlagBlocked: legacyTextReadyButFlagBlocked.length,
      drawingTextReadyButFlagFalse: drawingMismatch.length,
      materialTextReadyButFlagFalse: materialMismatch.length,
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
      totalProblemOrders: 0,
      legacyTextReadyButFlagBlocked: 0,
      drawingTextReadyButFlagFalse: 0,
      materialTextReadyButFlagFalse: 0,
      examples: [],
      message: `Ready flag diagnostics failed: ${safeMessage(error)}`,
    });
  }
}
