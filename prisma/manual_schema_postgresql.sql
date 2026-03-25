-- 由 prisma/schema.prisma 手動轉換的 PostgreSQL 建表語句
-- 執行前請確認資料庫、權限；若表已存在請先備份或刪除後再執行
--
-- 若表已存在且時間欄位仍為 INTEGER（需改為 DOUBLE PRECISION 以避免毫秒時間戳溢出）：
-- ALTER TABLE "Order" ALTER COLUMN "createdAt" TYPE DOUBLE PRECISION;
-- ALTER TABLE "Order" ALTER COLUMN "deletedAt" TYPE DOUBLE PRECISION;
-- ALTER TABLE "MesActivityLog" ALTER COLUMN "ts" TYPE DOUBLE PRECISION;
--
-- 可選：清空並重建（會刪資料，請謹慎）
-- DROP TABLE IF EXISTS "MesAppSettings" CASCADE;
-- DROP TABLE IF EXISTS "MesActivityLog" CASCADE;
-- DROP TABLE IF EXISTS "MesWorker" CASCADE;
-- DROP TABLE IF EXISTS "Order" CASCADE;

-- 「Order」為保留字，需雙引號
CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "client" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "qty" INTEGER NOT NULL DEFAULT 1,
  "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sales" TEXT NOT NULL DEFAULT '',
  "deliveryDate" TEXT NOT NULL DEFAULT '',
  "drawing" TEXT NOT NULL DEFAULT '未发图',
  "materials" TEXT NOT NULL DEFAULT '未配料',
  "assignedDay" TEXT NOT NULL DEFAULT 'Unscheduled',
  "taskStatus" TEXT NOT NULL DEFAULT 'normal',
  "cutStatus" TEXT NOT NULL DEFAULT 'pending',
  "boxNumber" INTEGER,
  "worker" TEXT,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "isImportError" BOOLEAN NOT NULL DEFAULT false,
  "errorReason" TEXT,
  "drawingUrl" TEXT,
  "activeAlarm" TEXT,
  "totalQty" INTEGER NOT NULL DEFAULT 1,
  "reportedQty" INTEGER NOT NULL DEFAULT 0,
  "isUrgent" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" DOUBLE PRECISION,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MesWorker" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MesWorker_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MesWorker_name_key" UNIQUE ("name")
);

CREATE TABLE "MesActivityLog" (
  "id" TEXT NOT NULL,
  "ts" DOUBLE PRECISION NOT NULL,
  "text" TEXT NOT NULL,
  "operator" TEXT,
  "role" TEXT,
  "actionType" TEXT,
  CONSTRAINT "MesActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MesAppSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "dailyCapacity" INTEGER NOT NULL DEFAULT 980,
  "theme" TEXT NOT NULL DEFAULT 'dark',
  "layoutMode" TEXT NOT NULL DEFAULT 'card',
  CONSTRAINT "MesAppSettings_pkey" PRIMARY KEY ("id")
);
