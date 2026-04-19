-- 一次性大清洗：軟刪除所有未完工髒單（保留已完工）；deletedAt 為毫秒戳與 Prisma Float 對齊
UPDATE "Order"
SET "deletedAt" = (EXTRACT(EPOCH FROM NOW()) * 1000)
WHERE "deletedAt" IS NULL
  AND "taskStatus" NOT IN ('COMPLETED', 'completed');
