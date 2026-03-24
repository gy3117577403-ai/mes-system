import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
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
        message: '数据库行数（空库时订单为 0 仍应能进入界面）',
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
  console.error('查询失败（可能是 Prisma 未 generate 或 dev.db 路径错误）:', e.message);
  process.exit(1);
} finally {
  await p.$disconnect();
}
