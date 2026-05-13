const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function drawingTextReady(value) {
  const text = String(value ?? '').trim();
  return ['已发', '已下发', '图纸已发', '已发图'].some((keyword) => text.includes(keyword));
}

function materialTextReady(value) {
  const text = String(value ?? '').trim();
  return ['料齐', '已配料', '齐套', '料已齐'].some((keyword) => text.includes(keyword));
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function createdAtToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildPossibleReasons(rows) {
  const reasons = [];
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

async function main() {
  try {
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
    const examples = problemRows.slice(0, 100).map((order) => ({
      id: order.id,
      client: order.client,
      model: order.model,
      deliveryDate: order.deliveryDate,
      drawing: order.drawing,
      materials: order.materials,
      isDrawingReady: order.isDrawingReady,
      isMaterialReady: order.isMaterialReady,
      assignedDay: order.assignedDay,
      createdAt: createdAtToIso(order.createdAt),
      updatedAt: toIso(order.updatedAt),
    }));
    const payload = {
      ok: true,
      summary: {
        legacyTextReadyButFlagBlocked: legacyTextReadyButFlagBlocked.length,
        drawingTextReadyButFlagFalse: drawingMismatch.length,
        materialTextReadyButFlagFalse: materialMismatch.length,
      },
      examples,
      possibleReasons: buildPossibleReasons(problemRows),
    };

    fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
    fs.writeFileSync(
      path.join(process.cwd(), 'tmp', 'ready-flag-mismatch-report.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8'
    );
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
