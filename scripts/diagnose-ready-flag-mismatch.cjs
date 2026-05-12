const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function drawingTextReady(value) {
  return ['已发', '已发图'].includes(String(value ?? '').trim());
}

function materialTextReady(value) {
  return ['料齐', '已配料', '料已齐'].includes(String(value ?? '').trim());
}

async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, isArchived: false },
      orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        model: true,
        client: true,
        drawing: true,
        materials: true,
        isDrawingReady: true,
        isMaterialReady: true,
        taskStatus: true,
        assignedDay: true,
        plannedDate: true,
      },
    });

    const drawingNotReady = orders.filter((order) => order.isDrawingReady !== true);
    const materialNotReady = orders.filter((order) => order.isDrawingReady === true && order.isMaterialReady !== true);
    const ready = orders.filter((order) => order.isDrawingReady === true && order.isMaterialReady === true);
    const legacyTextReadyButFlagBlocked = orders.filter(
      (order) =>
        (order.isDrawingReady !== true || order.isMaterialReady !== true) &&
        drawingTextReady(order.drawing) &&
        materialTextReady(order.materials)
    );

    console.log(
      JSON.stringify(
        {
          drawingNotReadyCount: drawingNotReady.length,
          materialNotReadyCount: materialNotReady.length,
          readyCount: ready.length,
          legacyTextReadyButFlagBlocked: legacyTextReadyButFlagBlocked.length,
          drawingNotReadySample: drawingNotReady.slice(0, 30).map((order) => ({
            id: order.id,
            model: order.model,
            client: order.client,
            isDrawingReady: order.isDrawingReady,
            isMaterialReady: order.isMaterialReady,
            drawing: order.drawing,
            materials: order.materials,
            taskStatus: order.taskStatus,
            assignedDay: order.assignedDay,
            plannedDate: order.plannedDate,
          })),
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
          error: error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220),
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
