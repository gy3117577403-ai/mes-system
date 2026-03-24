import { v4 as uuidv4 } from 'uuid';
import { ActivityLogEntry, AuditActionType } from '@/types';

export function normalizeActivityLogEntry(raw: unknown): ActivityLogEntry {
  if (typeof raw !== 'object' || raw === null) {
    return {
      id: uuidv4(),
      ts: Date.now(),
      text: '',
      operator: '系统',
      role: 'legacy',
      actionType: 'legacy',
    };
  }
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id ?? uuidv4()),
    ts: typeof r.ts === 'number' ? r.ts : Date.now(),
    text: String(r.text ?? ''),
    operator: r.operator != null ? String(r.operator) : undefined,
    role: r.role != null ? String(r.role) : undefined,
    actionType: (r.actionType as AuditActionType) ?? 'legacy',
  };
}

export function normalizeActivityLogs(list: unknown[]): ActivityLogEntry[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeActivityLogEntry);
}
