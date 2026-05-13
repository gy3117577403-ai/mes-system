const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const baselinePath = process.env.READY_FLAG_BASELINE_PATH || path.join('tmp', 'ready-flag-baseline.json');

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
      client: true,
      model: true,
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
        client: row.client,
        model: row.model,
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
    if (!fs.existsSync(baselinePath)) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            baselinePath,
            baselineProblemCount: 0,
            currentProblemCount: 0,
            newProblemCount: 0,
            changedProblemCount: 0,
            resolvedProblemCount: 0,
            newProblems: [],
            changedProblems: [],
            message: 'Baseline file not found. Run pnpm ready-flags:baseline before importing, then run pnpm check:ready-flags:delta after importing.',
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const baselineItems = Array.isArray(baseline.items) ? baseline.items : [];
    const baselineById = new Map(baselineItems.map((item) => [String(item.id), item]));
    const currentItems = await loadMismatchItems();
    const currentIds = new Set(currentItems.map((item) => item.id));
    const newProblems = currentItems.filter((item) => !baselineById.has(item.id));
    const changedProblems = currentItems.filter((item) => {
      const before = baselineById.get(item.id);
      return before && before.signature !== item.signature;
    });
    const resolvedProblemCount = baselineItems.filter((item) => !currentIds.has(String(item.id))).length;
    const failed = newProblems.length > 0 || changedProblems.length > 0;

    console.log(
      JSON.stringify(
        {
          ok: !failed,
          baselineProblemCount: baselineItems.length,
          currentProblemCount: currentItems.length,
          newProblemCount: newProblems.length,
          changedProblemCount: changedProblems.length,
          resolvedProblemCount,
          newProblems: newProblems.slice(0, 20),
          changedProblems: changedProblems.slice(0, 20),
          message: failed
            ? 'Ready flag mismatch changed after baseline. Check import/edit normalization before accepting this import.'
            : 'No new ready flag mismatch since baseline',
        },
        null,
        2
      )
    );
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          baselinePath,
          baselineProblemCount: 0,
          currentProblemCount: 0,
          newProblemCount: 0,
          changedProblemCount: 0,
          resolvedProblemCount: 0,
          newProblems: [],
          changedProblems: [],
          message: `Ready flag delta check failed: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
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
