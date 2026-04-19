'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Loader2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';

import type { Order } from '@/types';
import { carryOverOrdersAction } from '@/actions/mesActions';
import { isOrderCompletedStatus } from '@/lib/orderStatus';
import {
  getShanghaiBatchImportMondayYmd,
  parseShanghaiWallClockToEpochMs,
} from '@/lib/datetimeShanghai';
import { cn } from '@/lib/uiTheme';

export interface CarryOverModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  /** 结转或清空后同步服务器数据 */
  onSynced: () => void | Promise<void>;
  /** 仍要执行原「清屏归档」（软删全部） */
  onRequestHardClearBoard: () => void;
}

export default function CarryOverModal({
  isOpen,
  onClose,
  orders,
  onSynced,
  onRequestHardClearBoard,
}: CarryOverModalProps) {
  const incomplete = useMemo(
    () => orders.filter((o) => !isOrderCompletedStatus(o.taskStatus)),
    [orders]
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set());
      setBusy(false);
      return;
    }
    setSelected(new Set(incomplete.map((o) => o.id)));
  }, [isOpen, incomplete]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === incomplete.length) return new Set();
      return new Set(incomplete.map((o) => o.id));
    });
  }, [incomplete]);

  const exportIncomplete = useCallback(() => {
    const rows = incomplete.map((o) => ({
      型号: (o.model ?? '').trim() || '—',
      客户: (o.client ?? '').trim() || '—',
      剩余工时: Number(o.totalHours) || 0,
    }));
    if (rows.length === 0) {
      toast.error('没有未完工订单可导出');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '未完成');
    const ymd = getShanghaiBatchImportMondayYmd(0);
    XLSX.writeFile(wb, `未完成清单_${ymd}.xlsx`);
    toast.success('已导出 Excel');
  }, [incomplete]);

  const carryOverSelected = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      toast.error('请至少勾选一笔订单');
      return;
    }
    const mondayYmd = getShanghaiBatchImportMondayYmd(1);
    let ms: number;
    try {
      ms = parseShanghaiWallClockToEpochMs(mondayYmd, '00:00:00');
    } catch {
      toast.error('无法计算下周一锚点时间');
      return;
    }
    setBusy(true);
    try {
      const res = await carryOverOrdersAction(ids, ms);
      if (!res.ok) {
        toast.error(res.error ?? '结转失败');
        return;
      }
      toast.success(`已结转 ${res.updated ?? ids.length} 笔至下周一（上海 00:00）`);
      await onSynced();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [selected, onSynced, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="carry-over-title"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md"
    >
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 6 }}
          transition={{ duration: 0.2 }}
          className="flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4 md:px-6">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">周计划</p>
              <h2 id="carry-over-title" className="text-lg font-bold tracking-tight text-white md:text-xl">
                周末结转
              </h2>
              <p className="text-sm text-slate-400">
                未完成 {incomplete.length} 单 · 可导出清单或将选中单计划锚点改为下周一
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5">
            {incomplete.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">当前没有未完工订单。</p>
            ) : (
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                    <th className="w-10 py-2 pl-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                        checked={incomplete.length > 0 && selected.size === incomplete.length}
                        onChange={toggleAll}
                        aria-label="全选"
                      />
                    </th>
                    <th className="py-2 pr-2 font-medium">型號</th>
                    <th className="py-2 pr-2 font-medium">客户</th>
                    <th className="w-24 py-2 pr-2 text-right font-medium tabular-nums">剩余工时</th>
                  </tr>
                </thead>
                <tbody>
                  {incomplete.map((o) => (
                    <tr key={o.id} className="border-b border-white/[0.06] hover:bg-white/[0.04]">
                      <td className="py-2.5 pl-2 align-middle">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                          checked={selected.has(o.id)}
                          onChange={() => toggleOne(o.id)}
                          aria-label={`选取 ${o.model}`}
                        />
                      </td>
                      <td className="max-w-[10rem] truncate py-2.5 pr-2 font-mono text-slate-100">{o.model || '—'}</td>
                      <td className="max-w-[10rem] truncate py-2.5 pr-2 text-slate-300">{o.client || '—'}</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-slate-300">
                        {Number(o.totalHours) || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/10 bg-slate-950/40 px-4 py-4 md:px-6">
            <button
              type="button"
              onClick={() => onClose()}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              onClick={exportIncomplete}
              disabled={incomplete.length === 0}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25',
                incomplete.length === 0 && 'pointer-events-none opacity-40'
              )}
            >
              <Download className="h-4 w-4" />
              导出未完成清单
            </button>
            <button
              type="button"
              onClick={onRequestHardClearBoard}
              className="rounded-xl border border-red-500/35 bg-red-950/40 px-4 py-2.5 text-sm font-medium text-red-200 hover:bg-red-950/70"
            >
              仍要清屏归档
            </button>
            <button
              type="button"
              onClick={() => void carryOverSelected()}
              disabled={busy || selected.size === 0}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:from-emerald-500 hover:to-teal-500',
                (busy || selected.size === 0) && 'pointer-events-none opacity-50'
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              批量更新交期并结转
            </button>
          </footer>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
