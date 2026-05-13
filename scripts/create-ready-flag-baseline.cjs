const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const baselinePath = path.join('tmp', 'ready-flag-baseline.json');

function drawingTextReady(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (['未发图', '未下发', '待发图', '缺图纸', '无图纸'].some((keyword) => text.includes(keyword))) return false;
  return ['已发', '已发图', '图纸已发', '已下发', '图纸已下发', '已提供图纸', '图纸齐全'].some((keyword) =>
    text.includes(keyword)
  );
}

function materialTextReady(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (['未配料', '缺料', '待配料', '物料不足', '欠料'].some((keyword) => text.includes(keyword))) return false;
  return ['料齐', '已配料', '已齐套', '齐套', '物料齐', '物料已齐', '配料完成'].some((keyword) =>
    text.includes(keyword)
  );
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function signatureOf(item) {
  const input = [
    item.id,
    item.updatedAt ?? '',
    item.drawing ?? '',
    item.materials ?? '',
    String(item.isDrawingReady),
    String(item.isMaterialReady),
  ].join('|');
  return createHash('sha1').update(input).digest('hex');
}

async function loadMismatchItems() {
  const rows = await prisma.order.findMany({
    where: { deletedAt: null, isArchived: false },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      drawing: true,
      materials: true,
      isDrawingReady: true,
      isMaterialReady: true,
      updatedAt: true,
    },
  });

  return rows
    .filter((row) => (drawingTextReady(row.drawing) && row.isDrawingReady !== true) || (materialTextReady(row.materials) && row.isMaterialReady !== true))
    .map((row) => {
      const item = {
        id: row.id,
        updatedAt: safeDate(row.updatedAt),
        drawing: row.drawing ?? '',
        materials: row.materials ?? '',
        isDrawingReady: row.isDrawingReady === true,
        isMaterialReady: row.isMaterialReady === true,
      };
      return { ...item, signature: signatureOf(item) };
    });
}

async function main() {
  try {
    const items = await loadMismatchItems();
    const drawingProblems = items.filter((item) => drawingTextReady(item.drawing) && item.isDrawingReady !== true).length;
    const materialProblems = items.filter((item) => materialTextReady(item.materials) && item.isMaterialReady !== true).length;
    const payload = {
      generatedAt: new Date().toISOString(),
      problemCount: items.length,
      drawingProblems,
      materialProblems,
      items,
    };

    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(
      JSON.stringify(
        {
          ok: true,
          baselinePath,
          problemCount: items.length,
          message: 'Ready flag baseline created',
        },
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          baselinePath,
          problemCount: 0,
          message: `Ready flag baseline failed: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
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
