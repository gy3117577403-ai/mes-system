import { PrismaClient } from '@prisma/client';
import { nowEpochMsForMesStorage } from '@/lib/datetimeShanghai';

/**
 * 為帶 Float 毫秒欄位的模型在 **create** 路徑補預設時間戳，避免呼叫端漏傳導致臟資料。
 * 讀路徑不改寫：Float 本身已是 UTC 絕對時標，展示統一走 `datetimeShanghai`。
 */
function createMesPrismaClient() {
  const log: Array<'error' | 'warn' | 'info' | 'query'> =
    process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'];

  return new PrismaClient({ log }).$extends({
    query: {
      order: {
        async create({ args, query }) {
          const data = args.data as Record<string, unknown>;
          const hasCreated =
            Object.prototype.hasOwnProperty.call(data, 'createdAt') &&
            data.createdAt !== undefined &&
            data.createdAt !== null;
          const nextData = hasCreated ? data : { ...data, createdAt: nowEpochMsForMesStorage() };
          return query({ ...args, data: nextData as typeof args.data });
        },
      },
      mesActivityLog: {
        async create({ args, query }) {
          const data = args.data as Record<string, unknown>;
          const hasTs =
            Object.prototype.hasOwnProperty.call(data, 'ts') &&
            data.ts !== undefined &&
            data.ts !== null;
          const nextData = hasTs ? data : { ...data, ts: nowEpochMsForMesStorage() };
          return query({ ...args, data: nextData as typeof args.data });
        },
      },
      mesAbnormalClaim: {
        async create({ args, query }) {
          const data = args.data as Record<string, unknown>;
          const hasCreated =
            Object.prototype.hasOwnProperty.call(data, 'createdAt') &&
            data.createdAt !== undefined &&
            data.createdAt !== null;
          const nextData = hasCreated ? data : { ...data, createdAt: nowEpochMsForMesStorage() };
          return query({ ...args, data: nextData as typeof args.data });
        },
      },
    },
  });
}

export type MesPrismaClient = ReturnType<typeof createMesPrismaClient>;

const globalForPrisma = globalThis as unknown as { mesPrisma?: MesPrismaClient };

export const prisma: MesPrismaClient = globalForPrisma.mesPrisma ?? createMesPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.mesPrisma = prisma;
