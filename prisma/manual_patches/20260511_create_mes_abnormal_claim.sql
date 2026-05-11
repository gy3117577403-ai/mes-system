-- Manual patch generated from prisma/schema.prisma on 2026-05-11.
-- Purpose: create public."MesAbnormalClaim" without using prisma db push --accept-data-loss.
-- Safety: all DDL is guarded with IF NOT EXISTS where PostgreSQL supports it.
-- Review this file before executing it against any production database.

CREATE TABLE IF NOT EXISTS public."MesAbnormalClaim" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "workerName" TEXT NOT NULL,
  "claimedHours" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MesAbnormalClaim_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MesAbnormalClaim_orderId_fkey'
      AND conrelid = 'public."MesAbnormalClaim"'::regclass
  ) THEN
    ALTER TABLE public."MesAbnormalClaim"
      ADD CONSTRAINT "MesAbnormalClaim_orderId_fkey"
      FOREIGN KEY ("orderId")
      REFERENCES public."Order"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "MesAbnormalClaim_orderId_idx"
  ON public."MesAbnormalClaim"("orderId");

CREATE INDEX IF NOT EXISTS "MesAbnormalClaim_createdAt_idx"
  ON public."MesAbnormalClaim"("createdAt");
