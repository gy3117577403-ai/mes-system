-- AI Planner audit tables manual patch.
-- IMPORTANT: Back up the target database before executing this file.
-- This SQL only creates AI audit tables and indexes. It does not delete or modify existing tables.

CREATE TABLE IF NOT EXISTS public."AiPlannerRun" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "source" TEXT NOT NULL DEFAULT 'AI_PLANNER_WORKSPACE',
  "userPrompt" TEXT NOT NULL,
  "operator" TEXT,
  "role" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "durationMs" INTEGER,
  "contextSummaryJson" JSONB,
  "contextHash" TEXT,
  "responseJson" JSONB,
  "replyText" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "executedAt" TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS public."AiContextSnapshot" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aiRunId" TEXT NOT NULL,
  "snapshotType" TEXT NOT NULL DEFAULT 'SCHEDULER_CONTEXT',
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "contentHash" TEXT,
  "contentJson" JSONB,
  CONSTRAINT "AiContextSnapshot_aiRunId_fkey"
    FOREIGN KEY ("aiRunId") REFERENCES public."AiPlannerRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS public."AiSuggestion" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aiRunId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "reason" TEXT,
  "targetOrderId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payloadJson" JSONB,
  "resultJson" JSONB,
  "blockedReason" TEXT,
  "executedAt" TIMESTAMP(3),
  CONSTRAINT "AiSuggestion_aiRunId_fkey"
    FOREIGN KEY ("aiRunId") REFERENCES public."AiPlannerRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AiPlannerRun_createdAt_idx" ON public."AiPlannerRun"("createdAt");
CREATE INDEX IF NOT EXISTS "AiPlannerRun_status_idx" ON public."AiPlannerRun"("status");
CREATE INDEX IF NOT EXISTS "AiContextSnapshot_aiRunId_idx" ON public."AiContextSnapshot"("aiRunId");
CREATE INDEX IF NOT EXISTS "AiContextSnapshot_createdAt_idx" ON public."AiContextSnapshot"("createdAt");
CREATE INDEX IF NOT EXISTS "AiSuggestion_aiRunId_idx" ON public."AiSuggestion"("aiRunId");
CREATE INDEX IF NOT EXISTS "AiSuggestion_status_idx" ON public."AiSuggestion"("status");
CREATE INDEX IF NOT EXISTS "AiSuggestion_targetOrderId_idx" ON public."AiSuggestion"("targetOrderId");
CREATE INDEX IF NOT EXISTS "AiSuggestion_createdAt_idx" ON public."AiSuggestion"("createdAt");
