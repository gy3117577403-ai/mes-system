process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./dev.db';
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient({
  log: ['error'],
});

(async () => {
  try {
    const [orders, workers, logs, settings] = await Promise.all([
      p.order.count(),
      p.mesWorker.count(),
      p.mesActivityLog.count(),
      p.mesAppSettings.count(),
    ]);
    console.log(
      JSON.stringify(
        {
          orderCount: orders,
          workerCount: workers,
          activityLogCount: logs,
          settingsCount: settings,
        },
        null,
        2
      )
    );
  } catch (e) {
    console.error('查询失败:', e.message);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
})();
