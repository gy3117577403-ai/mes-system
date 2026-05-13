const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

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

async function main() {
  const sinceHoursRaw = Number(process.env.READY_FLAG_CHECK_SINCE_HOURS ?? 24);
  const sinceHours = Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0 ? sinceHoursRaw : 24;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  try {
    const rows = await prisma.order.findMany({
      where: {
        deletedAt: null,
        isArchived: false,
        updatedAt: { gte: since },
      },
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

    const drawingProblems = rows.filter((row) => drawingTextReady(row.drawing) && row.isDrawingReady !== true);
    const materialProblems = rows.filter((row) => materialTextReady(row.materials) && row.isMaterialReady !== true);
    const problemIds = new Set([...drawingProblems, ...materialProblems].map((row) => row.id));
    const examples = rows
      .filter((row) => problemIds.has(row.id))
      .slice(0, 20)
      .map((row) => ({
        id: row.id,
        client: row.client,
        model: row.model,
        drawing: row.drawing,
        materials: row.materials,
        isDrawingReady: row.isDrawingReady,
        isMaterialReady: row.isMaterialReady,
        updatedAt: safeDate(row.updatedAt),
      }));

    const problemCount = problemIds.size;
    const payload = {
      ok: problemCount === 0,
      sinceHours,
      problemCount,
      drawingProblems: drawingProblems.length,
      materialProblems: materialProblems.length,
      examples,
      message:
        problemCount === 0
          ? `最近 ${sinceHours} 小时未发现新增 ready-flags 状态不一致。`
          : `最近 ${sinceHours} 小时发现 ${problemCount} 条 ready-flags 状态不一致，请确认是否发生在写入归一化修复前。`,
    };

    console.log(JSON.stringify(payload, null, 2));
    if (problemCount > 0) process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          sinceHours,
          problemCount: 0,
          drawingProblems: 0,
          materialProblems: 0,
          examples: [],
          message: `ready-flags new data check failed: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
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

