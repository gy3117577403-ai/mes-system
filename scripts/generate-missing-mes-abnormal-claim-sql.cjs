const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'prisma', 'schema.prisma');
const outDir = path.join(repoRoot, 'prisma', 'manual_patches');
const outFile = path.join(outDir, '20260511_create_mes_abnormal_claim.sql');

function assertSchemaLooksCompatible(schema) {
  const modelMatch = /model\s+MesAbnormalClaim\s+\{([\s\S]*?)\n\}/m.exec(schema);
  if (!modelMatch) {
    throw new Error('schema.prisma does not contain model MesAbnormalClaim.');
  }

  const body = modelMatch[1];
  const required = [
    /id\s+String\s+@id/,
    /orderId\s+String/,
    /order\s+Order\s+@relation\(fields:\s*\[orderId\],\s*references:\s*\[id\]/,
    /workerName\s+String/,
    /claimedHours\s+Float/,
    /reason\s+String/,
    /status\s+String\s+@default\("PENDING"\)/,
    /createdAt\s+DateTime\s+@default\(now\(\)\)/,
    /@@index\(\[createdAt\]\)/,
    /@@index\(\[orderId\]\)/,
  ];

  const missing = required.filter((pattern) => !pattern.test(body)).map((pattern) => pattern.toString());
  if (missing.length > 0) {
    throw new Error(`MesAbnormalClaim schema does not match expected SQL shape: ${missing.join(', ')}`);
  }
}

const schema = fs.readFileSync(schemaPath, 'utf8');
assertSchemaLooksCompatible(schema);

const sql = `-- Manual patch generated from prisma/schema.prisma on 2026-05-11.
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
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, sql, 'utf8');

console.log(JSON.stringify({ ok: true, path: outFile, bytes: Buffer.byteLength(sql, 'utf8') }, null, 2));
