const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, isArchived: false },
      select: {
        id: true,
        drawing: true,
        materials: true,
        isDrawingReady: true,
        isMaterialReady: true,
        assignedDay: true,
        plannedDate: true,
        taskStatus: true,
      },
    });

    const ready = orders.filter((order) => order.isDrawingReady === true && order.isMaterialReady === true);
    const drawingTextReady = (value) => ['已发', '已发图'].includes(String(value ?? '').trim());
    const materialTextReady = (value) => ['料齐', '已配料', '料已齐'].includes(String(value ?? '').trim());
    const legacyTextReadyButFlagBlocked = orders.filter(
      (order) =>
        (order.isDrawingReady !== true || order.isMaterialReady !== true) &&
        drawingTextReady(order.drawing) &&
        materialTextReady(order.materials)
    );
    const readyUnscheduled = ready.filter((order) => {
      const assignedDay = String(order.assignedDay ?? '').trim();
      const plannedDate = String(order.plannedDate ?? '').trim();
      return (assignedDay === '' || assignedDay === 'Unscheduled') && plannedDate === '';
    });
    const drawingBlocked = orders.filter((order) => order.isDrawingReady !== true).length;
    const materialBlocked = orders.filter((order) => order.isDrawingReady === true && order.isMaterialReady !== true).length;

    console.log(
      JSON.stringify(
        {
          readyOrders: ready.length,
          readyUnscheduled: readyUnscheduled.length,
          drawingBlocked,
          materialBlocked,
          legacyTextReadyButFlagBlocked: legacyTextReadyButFlagBlocked.length,
          warning: 'readyUnscheduled orders should appear in ready pool, not tech pool',
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
