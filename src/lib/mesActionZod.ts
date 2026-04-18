import { z } from 'zod';

/** 訂單主鍵：非空字串，防空白與併發錯寫 */
export const orderIdZ = z.string().trim().min(1, 'orderId 必填');

/** 建立訂單：至少含 id，其餘欄位交由 normalize 補齊 */
export const createOrderActionInputZ = z.object({ id: orderIdZ }).passthrough();

/** 單筆更新 payload：限制鍵數量，防惡意超大物件 */
export const updateOrderDataZ = z
  .record(z.string(), z.unknown())
  .superRefine((rec, ctx) => {
    if (Object.keys(rec).length > 80) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '更新欄位過多（>80）' });
    }
  });

export const toggleOrderReadyInputZ = z.object({
  orderId: orderIdZ,
  type: z.enum(['DRAWING', 'MATERIAL']),
  isReady: z.boolean(),
  exception: z.string().optional(),
  boxNo: z.string().optional(),
});

export const createAbnormalClaimInputZ = z.object({
  orderId: orderIdZ,
  workerName: z.string().trim().min(1, 'workerName 必填'),
  claimedHours: z.number().finite().positive('claimedHours 须为正数'),
  reason: z.string().trim().min(1, 'reason 必填'),
});

export const approveAbnormalClaimInputZ = z.object({
  claimId: z.string().trim().min(1, 'claimId 必填'),
});

export const addWorkerNameZ = z.string().trim().min(1, 'empty name');

export const batchUpdateOrderItemZ = z.object({
  id: orderIdZ,
  data: updateOrderDataZ,
});

export const batchUpdateOrdersZ = z.array(batchUpdateOrderItemZ).max(500, '單次批量上限 500 筆');

export const batchAssignedDayItemZ = z.object({
  id: orderIdZ,
  assignedDay: z.string().trim().min(1),
});

export const batchAssignedDaysZ = z.array(batchAssignedDayItemZ).max(2000);

export const activityLogEntryZ = z.object({
  id: z.string().trim().min(1),
  ts: z.number().finite(),
  text: z.string().trim().min(1),
  operator: z.string().optional(),
  role: z.string().optional(),
  actionType: z.string().optional(),
});

export const patchMesSettingsZ = z.object({
  dailyCapacity: z.number().int().positive().optional(),
  theme: z.enum(['dark', 'light']).optional(),
  layoutMode: z.enum(['card', 'compact']).optional(),
});

export const softDeleteModeZ = z.enum(['completed', 'all']);
