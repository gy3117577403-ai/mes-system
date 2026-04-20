/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, isValid, parseISO } from 'date-fns';
import {
  AlertOctagon,
  CalendarClock,
  FileText,
  Package,
  UserCircle,
  CheckCircle2,
  Flag,
  Upload,
} from 'lucide-react';
import { Order } from '@/types';
import { UserRole } from '@/types/auth';
import {
  isEngineeringRole,
  isWarehouseRole,
  isPlannerFieldReadOnly,
  employeeReadOnlyFields,
  isBoss,
} from '@/lib/rbac';
import { isOrderCompletedStatus } from '@/lib/orderStatus';
import type { AppTheme, LayoutMode } from '@/lib/uiTheme';
import { cn } from '@/lib/uiTheme';

function missingEtaToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function dateInputToUtcNoonIso(ymd: string): string | null {
  const t = ymd.trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)).toISOString();
}

function normMaterialText(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

/** Badge 上顯示到料日：`MM-dd`（如 04-18），不含時分秒 */
function formatEtaMmDd(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = parseISO(iso);
    if (!isValid(d)) return '';
    return format(d, 'MM-dd');
  } catch {
    return '';
  }
}

/** 標籤形態：未登記 vs 已登記缺料 */
function MissingMaterialMorphBadge({
  triggerRef,
  hasReasonDetail,
  reasonText,
  etaIso,
  onToggle,
  isOpen,
}: {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  hasReasonDetail: boolean;
  reasonText: string;
  etaIso: string | null | undefined;
  onToggle: () => void;
  isOpen: boolean;
}) {
  const etaShort = formatEtaMmDd(etaIso);
  if (!hasReasonDetail) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-md border border-red-700 bg-red-900/80 px-2 py-0.5 text-[10px] font-bold text-red-200 transition hover:bg-red-900/95"
      >
        <span aria-hidden>📦</span>
        <span className="truncate">未配料</span>
      </button>
    );
  }
  const displayReason = reasonText.length > 18 ? `${reasonText.slice(0, 18)}…` : reasonText;
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      className="inline-flex max-w-full min-w-0 flex-1 items-center gap-1 rounded-md border border-red-500 bg-red-600 px-2 py-0.5 text-left text-[10px] font-bold text-white shadow-lg shadow-red-900/50 transition hover:bg-red-500"
    >
      <span className="shrink-0" aria-hidden>
        📦
      </span>
      <span className="min-w-0 truncate">
        缺: {displayReason}
        {etaShort ? ` (${etaShort})` : ''}
      </span>
    </button>
  );
}

export interface OrderCardRbacProps {
  role: UserRole;
}

interface EnhancedOrderCardProps {
  task: Order;
  status: string;
  updateTask: (orderId: string, field: string, value: any) => void;
  saveOrderPatch: (orderId: string, patch: Record<string, unknown>) => void;
  rbac?: OrderCardRbacProps;
  layoutMode?: LayoutMode;
  theme?: AppTheme;
}

function statusStripClass(status: string): string {
  const m: Record<string, string> = {
    green: 'bg-emerald-500',
    yellow: 'bg-yellow-400',
    red: 'bg-rose-500',
    completed: 'bg-slate-500',
    anomaly: 'bg-red-600',
    pendingQC: 'bg-amber-500',
    rework: 'bg-orange-500',
  };
  return m[status] || 'bg-slate-500';
}

export default function EnhancedOrderCard({
  task,
  status,
  updateTask,
  saveOrderPatch,
  rbac,
  layoutMode = 'card',
  theme = 'dark',
}: EnhancedOrderCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const role = rbac?.role ?? 'Employee';

  const isCompleted = status === 'completed';
  const isAnomaly = status === 'anomaly';

  const plannerRo = isPlannerFieldReadOnly(role);
  const empRo = employeeReadOnlyFields(role);
  const eng = isEngineeringRole(role);
  const wh = isWarehouseRole(role);
  const boss = isBoss(role);

  const drawingDisabled = isCompleted || plannerRo || empRo || wh;
  const materialsDisabled = isCompleted || plannerRo || empRo || eng;

  const dimBody = (eng || wh) && !boss;
  const highlightDrawing = eng || boss || (!eng && !wh);
  const highlightMaterials = wh || boss || (!eng && !wh);

  const styleMapDark: Record<string, string> = {
    green:
      'bg-slate-900/80 backdrop-blur-md border-l-[4px] border-l-emerald-400 border border-slate-700/80 rounded-xl p-3 shadow-[0_0_20px_rgba(16,185,129,0.08)] hover:shadow-[0_0_28px_rgba(52,211,153,0.15)] transition-shadow duration-300',
    yellow:
      'bg-slate-900/80 backdrop-blur-md border-l-[4px] border-l-yellow-400 border border-slate-700/80 rounded-xl p-3 shadow-[0_0_20px_rgba(250,204,21,0.08)]',
    red: 'bg-slate-900/80 backdrop-blur-md border-l-[4px] border-l-rose-500 border border-slate-700/80 rounded-xl p-3 shadow-[0_0_20px_rgba(244,63,94,0.1)]',
    completed:
      'bg-slate-900/50 backdrop-blur-md border-l-[4px] border-l-slate-500 border border-slate-700/80 rounded-xl p-3 opacity-50 grayscale',
    anomaly:
      'bg-slate-900/80 backdrop-blur-md border-l-[4px] border-l-red-600 border border-red-900/50 rounded-xl p-3 shadow-[0_0_22px_rgba(220,38,38,0.35)] animate-pulse',
    pendingQC:
      'bg-slate-900/80 backdrop-blur-md border-l-[4px] border-l-amber-500 border border-amber-900/40 rounded-xl p-3 shadow-[0_0_18px_rgba(245,158,11,0.2)]',
    rework:
      'bg-slate-900/80 backdrop-blur-md border-l-[4px] border-l-orange-500 border border-orange-900/40 rounded-xl p-3 shadow-[0_0_18px_rgba(249,115,22,0.15)]',
  };

  const styleMapLight: Record<string, string> = {
    green:
      'bg-white border border-gray-300 border-l-[4px] border-l-emerald-500 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow',
    yellow: 'bg-white border border-gray-300 border-l-[4px] border-l-yellow-500 rounded-xl p-3 shadow-sm',
    red: 'bg-white border border-gray-300 border-l-[4px] border-l-rose-500 rounded-xl p-3 shadow-sm',
    completed: 'bg-gray-100 border border-gray-300 border-l-[4px] border-l-gray-400 rounded-xl p-3 opacity-60 grayscale',
    anomaly: 'bg-red-50 border border-red-300 border-l-[4px] border-l-red-600 rounded-xl p-3 shadow-sm animate-pulse',
    pendingQC: 'bg-amber-50/80 border border-amber-300 border-l-[4px] border-l-amber-500 rounded-xl p-3 shadow-sm',
    rework: 'bg-orange-50/80 border border-orange-300 border-l-[4px] border-l-orange-500 rounded-xl p-3 shadow-sm',
  };

  const styleMap = theme === 'dark' ? styleMapDark : styleMapLight;

  const isCustomMaterialShortage =
    !['料齐', '已配料', '未配料'].includes(task.materials) && task.materials !== '';

  const [materialPopoverOpen, setMaterialPopoverOpen] = useState(false);
  const [materialPopoverDraftReason, setMaterialPopoverDraftReason] = useState('');
  const [materialPopoverDraftEta, setMaterialPopoverDraftEta] = useState('');
  const [materialPopoverCoords, setMaterialPopoverCoords] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const materialPopoverTriggerRef = useRef<HTMLButtonElement>(null);
  const materialPopoverPanelRef = useRef<HTMLDivElement>(null);

  /** 僅未配料且可編輯：才允許缺料 Popover（已配料嚴禁） */
  const showMissingMaterialPopover =
    !materialsDisabled && task.isMaterialReady === false && !['料齐', '已配料'].includes(task.materials);

  const materialsLooksKit = ['料齐', '已配料'].includes(task.materials) || task.isMaterialReady === true;

  useEffect(() => {
    if (task.isMaterialReady !== false || ['料齐', '已配料'].includes(task.materials)) {
      queueMicrotask(() => {
        setMaterialPopoverOpen(false);
        setMaterialPopoverCoords(null);
      });
    }
  }, [task.isMaterialReady, task.materials]);

  const repositionMaterialPopover = useCallback(() => {
    const trig = materialPopoverTriggerRef.current;
    if (!trig || !materialPopoverOpen) return;
    const rect = trig.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(256, vw - 2 * margin);
    const left = Math.max(margin, Math.min(rect.left, vw - width - margin));
    const panel = materialPopoverPanelRef.current;
    const h = Math.max(panel?.offsetHeight ?? 320, 160);
    let top = rect.bottom + gap;
    if (top + h > vh - margin) {
      top = rect.top - h - gap;
    }
    top = Math.max(margin, Math.min(top, vh - h - margin));
    setMaterialPopoverCoords({ top, left, width });
  }, [materialPopoverOpen]);

  useLayoutEffect(() => {
    if (!materialPopoverOpen) {
      queueMicrotask(() => setMaterialPopoverCoords(null));
      return;
    }
    repositionMaterialPopover();
    const id = requestAnimationFrame(() => repositionMaterialPopover());
    window.addEventListener('scroll', repositionMaterialPopover, true);
    window.addEventListener('resize', repositionMaterialPopover);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('scroll', repositionMaterialPopover, true);
      window.removeEventListener('resize', repositionMaterialPopover);
    };
  }, [materialPopoverOpen, repositionMaterialPopover]);

  useEffect(() => {
    if (!materialPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (materialPopoverTriggerRef.current?.contains(t)) return;
      if (materialPopoverPanelRef.current?.contains(t)) return;
      setMaterialPopoverOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [materialPopoverOpen]);

  const handleSopFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    updateTask(task.id, 'drawing', '已发');
    updateTask(task.id, 'drawingUrl', `/mock/sop/${f.name}`);
    e.target.value = '';
  };

  const urgent = task.isUrgent === true;
  const clientShort =
    (task.client || '—').length > 4 ? `${(task.client || '').slice(0, 4)}…` : task.client || '—';

  const drawingOk = task.drawing === '已发';
  const materialOk = ['料齐', '已配料'].includes(task.materials);

  /** 精簡列表：單行條狀，供 DnD 整塊拖拽 */
  if (layoutMode === 'compact') {
    const rowBg =
      theme === 'dark'
        ? 'bg-slate-900/95 border-slate-600/90'
        : 'bg-white border-gray-300';
    const textMain = theme === 'dark' ? 'text-white' : 'text-gray-900';
    const textSub = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
    const textMono = theme === 'dark' ? 'text-slate-300' : 'text-gray-700';

    return (
      <div
        className={`flex items-stretch min-h-[44px] h-11 max-h-[52px] rounded-lg overflow-hidden border shadow-sm ${rowBg} ${
          urgent ? 'ring-2 ring-red-500' : ''
        }`}
      >
        <div className={`w-1.5 shrink-0 ${statusStripClass(status)}`} aria-hidden />
        <div className="flex-1 flex items-center gap-2 px-2 min-w-0">
          <span
            className={`font-mono text-sm font-extrabold truncate flex-1 min-w-0 ${textMain}`}
            title={task.model}
          >
            {task.model}
          </span>
          <span className={`text-[10px] font-bold truncate max-w-[4.5rem] shrink-0 ${textSub}`} title={task.client}>
            {clientShort}
          </span>
          <span className={`text-[10px] font-mono tabular-nums shrink-0 ${textMono}`}>
            {task.qty}套·{task.totalHours}分
          </span>
          <FileText
            className={`w-3.5 h-3.5 shrink-0 ${drawingOk ? 'text-emerald-500' : 'text-red-500'}`}
            aria-label={drawingOk ? '图纸已发' : '图纸未齐'}
          />
          <Package
            className={`w-3.5 h-3.5 shrink-0 ${materialOk ? 'text-emerald-500' : 'text-amber-500'}`}
            aria-label={materialOk ? '料齐' : '料未齐'}
          />
          {urgent && (
            <span className="text-[9px] font-black text-red-600 bg-red-100 dark:bg-red-950/80 px-1 rounded shrink-0">
              急
            </span>
          )}
        </div>
      </div>
    );
  }

  const missingMaterialReasonFilled = normMaterialText(task.missingMaterialReason) != null;

  const toggleMaterialMissingPopover = () => {
    if (materialPopoverOpen) {
      setMaterialPopoverOpen(false);
      return;
    }
    setMaterialPopoverDraftReason(task.missingMaterialReason ?? '');
    setMaterialPopoverDraftEta(missingEtaToDateInput(task.missingMaterialEta ?? null));
    setMaterialPopoverOpen(true);
  };

  const cancelMaterialMissingPopover = () => {
    setMaterialPopoverDraftReason(task.missingMaterialReason ?? '');
    setMaterialPopoverDraftEta(missingEtaToDateInput(task.missingMaterialEta ?? null));
    setMaterialPopoverOpen(false);
  };

  const saveMaterialMissingPopover = () => {
    saveOrderPatch(task.id, {
      missingMaterialReason: normMaterialText(materialPopoverDraftReason),
      missingMaterialEta: dateInputToUtcNoonIso(materialPopoverDraftEta),
    });
    setMaterialPopoverOpen(false);
  };

  const materialMissingPopoverPortal =
    typeof document !== 'undefined' &&
    materialPopoverOpen &&
    task.isMaterialReady === false &&
    materialPopoverCoords != null &&
    createPortal(
      <div
        ref={materialPopoverPanelRef}
        role="dialog"
        aria-label="缺料登记"
        className="z-[9999] flex w-64 max-w-[min(100vw-1rem,16rem)] flex-col gap-3 rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md"
        style={{
          position: 'fixed',
          top: materialPopoverCoords.top,
          left: materialPopoverCoords.left,
          width: materialPopoverCoords.width,
        }}
      >
        <div>
          <label className="sr-only" htmlFor={`mat-status-${task.id}`}>
            配料状态
          </label>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">配料状态</p>
          <select
            id={`mat-status-${task.id}`}
            value={task.materials}
            onChange={(e) => {
              updateTask(task.id, 'materials', e.target.value);
              if (['料齐', '已配料'].includes(e.target.value)) setMaterialPopoverOpen(false);
            }}
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-xs font-bold text-slate-100 outline-none focus:ring-1 focus:ring-red-500"
          >
            <option value="料齐">料已齐</option>
            <option value="未配料">未配料</option>
            {isCustomMaterialShortage && <option value={task.materials}>⚠️ {task.materials}</option>}
          </select>
        </div>
        <div>
          <label htmlFor={`missing-reason-${task.id}`} className="mb-1 block text-[10px] font-semibold text-slate-400">
            缺料原因
          </label>
          <input
            id={`missing-reason-${task.id}`}
            type="text"
            value={materialPopoverDraftReason}
            onChange={(e) => setMaterialPopoverDraftReason(e.target.value)}
            placeholder="填写缺料原因…"
            className="w-full rounded-md border border-slate-600 bg-slate-800 p-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-red-500"
          />
        </div>
        <div>
          <label htmlFor={`missing-eta-${task.id}`} className="mb-1 block text-[10px] font-semibold text-slate-400">
            预计到料
          </label>
          <input
            id={`missing-eta-${task.id}`}
            type="date"
            value={materialPopoverDraftEta}
            onChange={(e) => setMaterialPopoverDraftEta(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="w-full rounded-md border border-slate-600 bg-slate-800 p-2 text-xs text-slate-100 outline-none focus:ring-1 focus:ring-red-500 [color-scheme:dark]"
          />
        </div>
        <div className="mt-1 flex items-center justify-end gap-2 border-t border-slate-700/80 pt-3">
          <button
            type="button"
            onClick={cancelMaterialMissingPopover}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={saveMaterialMissingPopover}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-md transition hover:bg-red-500"
          >
            保存
          </button>
        </div>
      </div>,
      document.body
    );

  return (
    <>
      <div
        className={`relative transition-all duration-300 ${styleMap[status] || styleMap.yellow} group ${
          urgent ? 'ring-2 ring-red-500 shadow-[0_0_22px_rgba(239,68,68,0.28)]' : ''
        }`}
      >
      {isCompleted && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 -rotate-12 text-gray-400 font-black text-4xl opacity-40 pointer-events-none tracking-widest z-0">
          已完成
        </div>
      )}

      {task.taskStatus === 'Rework' && (
        <div className="absolute top-0 left-0 z-20 bg-orange-600 text-white text-[10px] px-2 py-0.5 rounded-br-lg font-black shadow-[0_0_12px_rgba(249,115,22,0.5)] animate-pulse">
          ⚠️ 返工
        </div>
      )}

      {urgent && (
        <div className="absolute top-0 right-0 z-30 bg-red-600 text-white text-[11px] px-2 py-0.5 rounded-bl-lg font-black border border-red-400/80 shadow-[0_0_14px_rgba(239,68,68,0.7)]">
          急
        </div>
      )}

      {task.taskStatus === 'PendingQC' && (
        <div
          className={`absolute right-0 bg-amber-500 text-slate-950 text-[9px] px-2 py-0.5 rounded-bl-lg font-black shadow-sm z-20 ${
            urgent ? 'top-6' : 'top-0'
          }`}
        >
          待质检
        </div>
      )}

      {task.isImportError && (
        <div className="absolute top-0 right-0 bg-red-600 text-white text-[9px] px-1.5 py-0.5 rounded-bl font-bold shadow-sm z-20">
          导入异常
        </div>
      )}

      {status === 'red' && !task.isImportError && (
        <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-bl-lg font-bold shadow-sm">
          缺料拦截
        </div>
      )}

      <div className={`relative z-10 ${dimBody && !highlightDrawing && !highlightMaterials ? 'opacity-40' : ''}`}>
        <div className={`${dimBody ? 'opacity-40' : ''}`}>
          <div className="flex justify-between items-center mb-2 gap-2">
            <span
              className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                theme === 'dark'
                  ? `bg-slate-800/80 border-slate-600/80 ${isCompleted ? 'text-slate-500' : 'text-slate-300'}`
                  : `bg-gray-100 border-gray-300 ${isCompleted ? 'text-gray-500' : 'text-gray-800'}`
              }`}
            >
              {task.client}
            </span>
            <span
              className={`text-[10px] flex items-center gap-1 font-medium shrink-0 ${
                isCompleted
                  ? theme === 'dark'
                    ? 'text-slate-500'
                    : 'text-gray-500'
                  : theme === 'dark'
                    ? 'text-blue-400 bg-blue-950/40 px-1 rounded border border-blue-500/30'
                    : 'text-blue-700 bg-blue-50 px-1 rounded border border-blue-300'
              }`}
            >
              <CalendarClock className="w-3 h-3" />
              交期: {task.deliveryDate || '待定'}
            </span>
          </div>

          <div className="flex justify-between items-start mb-2 min-h-[3.25rem]">
            <span
              className={`font-mono text-3xl font-extrabold leading-tight break-words line-clamp-3 w-full pr-1 ${
                isCompleted
                  ? theme === 'dark'
                    ? 'text-slate-500 line-through'
                    : 'text-gray-500 line-through'
                  : theme === 'dark'
                    ? 'text-white'
                    : 'text-gray-900'
              }`}
              title={task.model}
            >
              {task.model}
            </span>
          </div>
        </div>

        {(task.totalQty ?? 0) > 0 && !isOrderCompletedStatus(task.taskStatus) && (
          <div
            className={`text-[10px] font-mono mb-1.5 ${dimBody ? 'opacity-40' : ''} ${
              theme === 'dark' ? 'text-slate-500' : 'text-gray-600'
            }`}
          >
            報工 {task.reportedQty ?? 0}/{task.totalQty}
          </div>
        )}

        <div className={`flex items-center gap-1.5 mb-2 text-[11px] ${dimBody ? 'opacity-40' : ''}`}>
          <div
            className={`px-1.5 py-0.5 rounded border font-mono ${
              isCompleted
                ? theme === 'dark'
                  ? 'bg-slate-800 text-slate-500 border-slate-600'
                  : 'bg-gray-200 text-gray-600 border-gray-400'
                : theme === 'dark'
                  ? 'bg-blue-950/40 text-blue-400 border-blue-500/30'
                  : 'bg-blue-50 text-blue-800 border-blue-300'
            }`}
          >
            {task.qty}套
          </div>
          <div
            className={`px-1.5 py-0.5 rounded border font-mono ${
              isCompleted
                ? theme === 'dark'
                  ? 'bg-slate-800 text-slate-500 border-slate-600'
                  : 'bg-gray-200 text-gray-600 border-gray-400'
                : theme === 'dark'
                  ? 'bg-slate-800 text-slate-300 border-slate-600'
                  : 'bg-gray-100 text-gray-800 border-gray-300'
            }`}
          >
            {task.totalHours} 分钟
          </div>
          <div
            className={`ml-auto px-1.5 py-0.5 flex items-center gap-1 ${
              theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
            }`}
          >
            <UserCircle className="w-3 h-3" /> {task.sales}
          </div>
        </div>

        {task.isImportError && (
          <div className="mb-2 bg-red-950/50 border border-red-800/50 text-red-300 text-[10px] p-1.5 rounded flex items-center gap-1 leading-tight">
            <AlertOctagon className="w-3 h-3 shrink-0" />
            <span className="truncate" title={task.errorReason}>
              {task.errorReason}
            </span>
          </div>
        )}

        <div
          className={`flex flex-col gap-2 pt-2 border-t ${
            theme === 'dark' ? 'border-slate-700/60' : 'border-gray-200'
          }`}
        >
          <div
            className={`flex flex-wrap gap-2 items-stretch justify-between transition-all duration-300 ${
              eng && !boss ? 'ring-2 ring-cyan-400/50 rounded-xl p-2 bg-cyan-950/20 shadow-[0_0_24px_rgba(34,211,238,0.15)]' : ''
            } ${theme === 'light' && eng && !boss ? 'bg-cyan-50/80' : ''} ${highlightDrawing || boss ? '' : eng ? '' : 'opacity-100'}`}
          >
            <div
              className={`flex items-center flex-1 min-w-[120px] px-1.5 py-1 rounded-lg border ${
                task.drawing === '已发'
                  ? theme === 'dark'
                    ? 'border-emerald-500/40 bg-emerald-950/30'
                    : 'border-emerald-400 bg-emerald-50'
                  : theme === 'dark'
                    ? 'border-red-500/40 bg-red-950/30'
                    : 'border-red-300 bg-red-50'
              } ${dimBody && !eng && !boss ? 'opacity-35 pointer-events-none' : ''}`}
            >
              <FileText
                className={`w-3.5 h-3.5 mr-1 shrink-0 ${task.drawing === '已发' ? 'text-emerald-400' : 'text-red-400'}`}
              />
              <select
                disabled={drawingDisabled}
                value={task.drawing}
                onChange={(e) => updateTask(task.id, 'drawing', e.target.value)}
                className={`min-w-0 flex-1 text-[10px] font-bold bg-transparent outline-none cursor-pointer appearance-none truncate ${
                  task.drawing === '已发' ? 'text-emerald-400' : 'text-red-400'
                } ${drawingDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <option value="已发">已发图</option>
                <option value="未发图">未发图</option>
                <option value="修改中">图修改</option>
              </select>
            </div>
            {(eng || boss) && (
              <div className="flex items-center">
                <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleSopFile} />
                <button
                  type="button"
                  disabled={drawingDisabled}
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 text-[10px] font-black px-2 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600/80 to-blue-600/80 text-white border border-cyan-400/40 shadow-[0_0_14px_rgba(34,211,238,0.25)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Upload className="w-3.5 h-3.5" />
                  上传 SOP
                </button>
              </div>
            )}
          </div>

          <div
            className={`flex flex-col gap-2 transition-all duration-300 ${
              wh && !boss ? 'ring-2 ring-amber-400/50 rounded-xl p-2 bg-amber-950/20 shadow-[0_0_24px_rgba(251,191,36,0.12)]' : ''
            } ${theme === 'light' && wh && !boss ? 'bg-amber-50/90' : ''}`}
          >
            <div className="flex gap-2 items-center justify-between">
              <div
                className={`flex items-center flex-1 min-w-[120px] gap-1 px-1.5 py-1 rounded-lg border ${
                  materialsLooksKit
                    ? theme === 'dark'
                      ? 'border-emerald-500/40 bg-emerald-950/30'
                      : 'border-emerald-400 bg-emerald-50'
                    : theme === 'dark'
                      ? 'border-red-500/40 bg-red-950/30'
                      : 'border-red-300 bg-red-50'
                } ${dimBody && !wh && !boss ? 'opacity-35 pointer-events-none' : ''}`}
              >
                <Package
                  className={`w-3.5 h-3.5 mr-1 shrink-0 ${materialsLooksKit ? 'text-emerald-400' : 'text-red-400'}`}
                />
                {showMissingMaterialPopover ? (
                  <div className="relative flex min-w-0 flex-1 items-center gap-1">
                    {task.materials !== '未配料' && isCustomMaterialShortage ? (
                      <span
                        className={cn(
                          'mr-1 max-w-[4.5rem] truncate text-[9px] font-bold text-amber-200',
                          theme === 'dark' ? '' : 'text-amber-800'
                        )}
                        title={task.materials}
                      >
                        ⚠ {task.materials}
                      </span>
                    ) : null}
                    <MissingMaterialMorphBadge
                      triggerRef={materialPopoverTriggerRef}
                      hasReasonDetail={missingMaterialReasonFilled}
                      reasonText={String(task.missingMaterialReason ?? '').trim()}
                      etaIso={task.missingMaterialEta}
                      onToggle={toggleMaterialMissingPopover}
                      isOpen={materialPopoverOpen}
                    />
                  </div>
                ) : (
                  <select
                    disabled={materialsDisabled}
                    value={task.materials}
                    onChange={(e) => updateTask(task.id, 'materials', e.target.value)}
                    className={`min-w-0 flex-1 text-[10px] font-bold bg-transparent outline-none cursor-pointer appearance-none truncate ${
                      materialsLooksKit ? 'text-emerald-400' : 'text-red-400'
                    } ${materialsDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
                    title={task.materials}
                  >
                    <option value="料齐">料已齐</option>
                    <option value="未配料">未配料</option>
                    {isCustomMaterialShortage && <option value={task.materials}>⚠️ {task.materials}</option>}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {task.taskStatus === 'PendingQC' ? (
                  <span className="text-[10px] text-amber-400 font-bold px-1">待质检（顶部「质检审核」）</span>
                ) : isCompleted ? (
                  <button
                    onClick={() => updateTask(task.id, 'taskStatus', 'normal')}
                    className={`text-[10px] underline ${
                      theme === 'dark' ? 'text-slate-400 hover:text-blue-400' : 'text-gray-600 hover:text-blue-700'
                    }`}
                  >
                    撤销完成
                  </button>
                ) : isAnomaly ? (
                  <button
                    onClick={() => updateTask(task.id, 'taskStatus', 'normal')}
                    className="text-[10px] bg-red-950/80 text-red-300 px-1.5 py-0.5 rounded font-bold hover:bg-red-900"
                  >
                    解除异常
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => updateTask(task.id, 'taskStatus', 'anomaly')}
                      title="提报异常"
                      className={`p-1 rounded transition-colors ${
                        theme === 'dark'
                          ? 'text-slate-500 hover:text-red-400 hover:bg-red-950/50'
                          : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                      }`}
                    >
                      <Flag className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => updateTask(task.id, 'taskStatus', 'completed')}
                      title="标记为已完成"
                      className={`p-1 rounded transition-colors ${
                        theme === 'dark'
                          ? 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-950/50'
                          : 'text-gray-500 hover:text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
      {materialMissingPopoverPortal}
    </>
  );
}
