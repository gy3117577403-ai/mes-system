'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Search, Trash2, X } from 'lucide-react';
import {
  fetchProductionAuditSummaryAction,
  type ProductionAuditCompletedModelRow,
  type ProductionAuditOrderLine,
  type ProductionAuditPendingModelRow,
  type ProductionAuditRolling4w,
  type ProductionAuditSummaryResult,
} from '@/actions/mesActions';
import { cn } from '@/lib/uiTheme';
import { formatMsToShanghaiLocale, MES_TIMEZONE } from '@/lib/datetimeShanghai';

interface ProductionAuditOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  /** 主頁每日排產上限（分鐘）；未設週基準且無本地 daily 鍵時，用於估算週基準 = 該值 × 6 */
  dailyCapacityMinutes?: number;
}

const LS_WEEKLY_BASE_CAPACITY = 'mes_weekly_base_capacity';
const DEFAULT_WEEKLY_BASE_CAPACITY = 10800;
const LS_EXCEPTION_LEDGER = 'mes-audit-ledger-exception';
const LS_ATTENDANCE_LEDGER = 'mes-audit-ledger-attendance';

function readPositiveIntFromLocalStorage(key: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null || raw.trim() === '') return null;
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.trunc(n);
  } catch {
    return null;
  }
}

type LedgerEntry = {
  id: string;
  date: string;
  minutes: number;
  reason: string;
  createdAt: number;
};

function loadLedger(key: string): LedgerEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p
      .filter(
        (x): x is LedgerEntry =>
          x != null &&
          typeof x === 'object' &&
          typeof (x as LedgerEntry).id === 'string' &&
          typeof (x as LedgerEntry).minutes === 'number' &&
          typeof (x as LedgerEntry).reason === 'string'
      )
      .map((x) => ({
        ...x,
        date:
          typeof x.date === 'string' && x.date.trim()
            ? x.date
            : formatMsToShanghaiLocale(Date.now()).slice(0, 10),
        createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveLedger(key: string, rows: LedgerEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

/** 庫存工時欄位原樣數值（`totalHours` 等欄位在庫中存的是分鐘，禁止再做 ×60） */
function workloadValue(v: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

/** 與產能基準同口徑：直接採用庫存分鐘值（不換算） */
function workloadMinutesValue(v: number): number {
  return Math.round(workloadValue(v) * 1000) / 1000;
}

function safeRatePercent(actual: number, denominator: number): number {
  if (denominator <= 0 || !Number.isFinite(denominator)) return 0;
  if (!Number.isFinite(actual)) return 0;
  return (actual / denominator) * 100;
}

function formatPctOne(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  const clamped = Math.max(-9999, Math.min(9999, n));
  return clamped.toFixed(1);
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 1000) / 10);
}

function dedupeAuditOrderLinesForDisplay(orders: ProductionAuditOrderLine[]): ProductionAuditOrderLine[] {
  const seen = new Set<string>();
  const out: ProductionAuditOrderLine[] = [];
  for (const o of orders) {
    const fp = `${(o.customerName ?? '').trim()}\t${Math.round((Number(o.totalHours) || 0) * 1000) / 1000}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(o);
  }
  return out;
}

function DrawingMaterialDots({ order }: { order: ProductionAuditOrderLine }) {
  const drOk = order.isDrawingReady === true;
  const mrOk = order.isMaterialReady === true;
  return (
    <span className="inline-flex items-center gap-4 text-xs text-slate-400">
      <span className="inline-flex items-center gap-2">
        <span className="text-slate-500">图纸</span>
        {drOk ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500/90" title="图纸已就绪" />
        ) : (
          <span
            className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.45)]"
            title="图纸未下发"
          />
        )}
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="text-slate-500">物料</span>
        {mrOk ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500/90" title="物料已齐" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-amber-500/85" title="缺料" />
        )}
      </span>
    </span>
  );
}

function OrderDetailOneLine({ order }: { order: ProductionAuditOrderLine }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm leading-relaxed">
      <span className="min-w-0 truncate font-medium text-slate-100">{order.customerName || '—'}</span>
      <span className="text-slate-600" aria-hidden>
        |
      </span>
      <span className="tabular-nums text-slate-300">
        数量: {order.actualQuantity} / {order.totalQuantity}
      </span>
      <span className="text-slate-600" aria-hidden>
        |
      </span>
      <span className="text-slate-500">状态</span>
      <DrawingMaterialDots order={order} />
    </div>
  );
}

function OrderDetailCompletedLine({ order }: { order: ProductionAuditOrderLine }) {
  const doneAt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: MES_TIMEZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(order.updatedAtMs));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm leading-relaxed">
      <span className="min-w-0 truncate font-medium text-slate-100">{order.customerName || '—'}</span>
      <span className="text-slate-600" aria-hidden>
        |
      </span>
      <span className="tabular-nums text-slate-300">
        数量: {order.actualQuantity} / {order.totalQuantity}
      </span>
      <span className="text-slate-600" aria-hidden>
        |
      </span>
      <span className="tabular-nums text-slate-400" title="完工时间（上海）">
        完工 {doneAt}
      </span>
    </div>
  );
}

function ProgressBar({ valuePct }: { valuePct: number }) {
  const w = Math.max(0, Math.min(100, valuePct));
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800/80">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-500/90 to-emerald-400/80 transition-[width] duration-500"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function AuditSkeleton() {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 animate-pulse flex-col space-y-4 px-4 pb-8 pt-3 md:px-10">
      <div className="flex justify-between gap-4">
        <div className="h-12 w-56 rounded-xl bg-slate-800/60" />
        <div className="h-14 w-14 shrink-0 rounded-2xl bg-slate-800/60" />
      </div>
      <div className="h-20 w-full rounded-xl bg-slate-800/40" />
      <div className="h-12 w-full rounded-xl bg-slate-800/40" />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <div className="h-80 rounded-xl bg-slate-800/30" />
        <div className="h-80 rounded-xl bg-slate-800/30" />
      </div>
    </div>
  );
}

function matchesSearch(q: string, partNumber: string, orders: ProductionAuditOrderLine[]): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  if (partNumber.toLowerCase().includes(n)) return true;
  return orders.some(
    (o) => o.customerName.toLowerCase().includes(n) || o.taskStatus.toLowerCase().includes(n)
  );
}

const WEEK_SELECT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
  value: i,
  label: i === 0 ? '本周' : i === 1 ? '上周' : `${i}周前`,
}));

/** SVG 环形进度：<100% 蓝色，≥100% 翠绿色 */
function SvgAuditRing({
  percent,
  title,
  subtitle,
}: {
  percent: number;
  title: string;
  subtitle?: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const p = Number.isFinite(percent) ? percent : 0;
  const arcPct = Math.min(Math.max(p, 0), 100);
  const offset = c - (arcPct / 100) * c;
  const strokeProgress = p >= 100 ? 'stroke-emerald-400' : 'stroke-sky-500';

  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="relative aspect-square w-full max-w-[10rem]">
        <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-slate-800" />
          <g transform="rotate(-90 60 60)">
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              className={strokeProgress}
              strokeDasharray={c}
              strokeDashoffset={offset}
            />
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-50 md:text-3xl">
            {formatPctOne(p)}%
          </span>
        </div>
      </div>
      {subtitle ? <p className="max-w-[14rem] text-[11px] leading-snug text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function WeeklyBaseCapacityControl({
  baseCapacity,
  onBaseCapacityChange,
}: {
  baseCapacity: number;
  onBaseCapacityChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2.5">
      <span className="shrink-0 text-xs font-medium text-slate-300 md:text-sm">周基准产能</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={9999999}
          step={1}
          value={baseCapacity}
          onChange={(e) => {
            const v = Math.trunc(Number(e.target.value));
            if (!Number.isFinite(v)) return;
            const clamped = Math.max(1, Math.min(9_999_999, v));
            onBaseCapacityChange(clamped);
          }}
          className="w-[5.5rem] shrink-0 rounded-lg border border-white/15 bg-white/5 py-1.5 pl-2 pr-1 text-right text-xs font-semibold tabular-nums text-slate-100 outline-none focus:border-cyan-500/45 md:w-24 md:text-sm"
          aria-label="周基准产能（分钟）"
        />
        <span className="shrink-0 text-[11px] font-medium text-slate-500 md:text-xs">min</span>
      </div>
    </div>
  );
}

function LedgerSummaryCard({
  totalExceptionMinutes,
  totalAttendanceMinutes,
  onOpenTimesheet,
}: {
  totalExceptionMinutes: number;
  totalAttendanceMinutes: number;
  onOpenTimesheet: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/60 p-5">
      <div className="space-y-2 text-sm leading-relaxed text-slate-300">
        <p className="font-semibold text-slate-100">工时双账本</p>
        <p className="tabular-nums text-emerald-200/95">
          异常补偿: +{Math.round(totalExceptionMinutes)} 工时（算入产出）
        </p>
        <p className="tabular-nums text-sky-200/95">
          出勤变动: {totalAttendanceMinutes > 0 ? '+' : ''}
          {Math.round(totalAttendanceMinutes)} 工时（修饰基数）
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenTimesheet}
        className="w-full rounded-xl border border-cyan-500/40 bg-cyan-500/15 py-3 text-sm font-bold text-cyan-100 transition hover:bg-cyan-500/25"
      >
        📝 登记工时明细
      </button>
    </div>
  );
}

function TimesheetModal({
  onClose,
  exceptionLogs,
  setExceptionLogs,
  attendanceLogs,
  setAttendanceLogs,
}: {
  onClose: () => void;
  exceptionLogs: LedgerEntry[];
  setExceptionLogs: React.Dispatch<React.SetStateAction<LedgerEntry[]>>;
  attendanceLogs: LedgerEntry[];
  setAttendanceLogs: React.Dispatch<React.SetStateAction<LedgerEntry[]>>;
}) {
  const [tab, setTab] = useState<'exception' | 'attendance'>('exception');
  const [minutesInput, setMinutesInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');

  const list = tab === 'exception' ? exceptionLogs : attendanceLogs;
  const setList = tab === 'exception' ? setExceptionLogs : setAttendanceLogs;

  const sorted = useMemo(
    () => [...list].sort((a, b) => b.createdAt - a.createdAt),
    [list]
  );

  const submit = () => {
    const m = Number(minutesInput);
    if (!Number.isFinite(m) || minutesInput.trim() === '') return;
    const reason = reasonInput.trim() || '—';
    const dateStr = formatMsToShanghaiLocale(Date.now()).slice(0, 10);
    const row: LedgerEntry = {
      id: crypto.randomUUID(),
      date: dateStr,
      minutes: Math.trunc(m),
      reason,
      createdAt: Date.now(),
    };
    setList((prev) => [row, ...prev]);
    setMinutesInput('');
    setReasonInput('');
  };

  const remove = (id: string) => {
    setList((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="timesheet-title"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 id="timesheet-title" className="text-lg font-bold text-white">
            工时申报
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 gap-2 border-b border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={() => setTab('exception')}
            className={cn(
              'flex-1 rounded-lg py-2 text-sm font-semibold transition',
              tab === 'exception' ? 'bg-amber-500/20 text-amber-100' : 'text-slate-400 hover:bg-white/5'
            )}
          >
            🚨 异常工时申报
          </button>
          <button
            type="button"
            onClick={() => setTab('attendance')}
            className={cn(
              'flex-1 rounded-lg py-2 text-sm font-semibold transition',
              tab === 'attendance' ? 'bg-sky-500/20 text-sky-100' : 'text-slate-400 hover:bg-white/5'
            )}
          >
            📅 出勤变动申报
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-white/10 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-500">
              工时（可负，与库存口径一致）
              <input
                type="number"
                value={minutesInput}
                onChange={(e) => setMinutesInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm tabular-nums text-slate-100 outline-none focus:border-cyan-500/40"
                placeholder="例如 120 或 -30"
              />
            </label>
            <label className="block text-xs text-slate-500 sm:col-span-2">
              原因备注
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/40"
                placeholder="简要说明"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={submit}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 py-2.5 text-sm font-bold text-white hover:from-cyan-500 hover:to-teal-500"
          >
            提交入账
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">流水账</p>
          {sorted.length === 0 ? (
            <p className="text-center text-sm text-slate-500">暂无记录</p>
          ) : (
            <ul className="space-y-2">
              {sorted.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tabular-nums text-slate-200">
                      {r.date} · {r.minutes > 0 ? '+' : ''}
                      {r.minutes} 工时
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{r.reason}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-red-500/20 hover:text-red-300"
                    aria-label="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function MegaEfficiencyPanel({
  baseCapacity,
  onBaseCapacityChange,
  totalExceptionMinutes,
  totalAttendanceMinutes,
  capacityNumeratorMin,
  capacityDenominatorMin,
  onOpenTimesheet,
  weekActualMinutes,
  weekPlannedMinutes,
  planRate,
  utilizationRate,
  rolling,
  rollingPlanRate,
  monthlyRate,
}: {
  baseCapacity: number;
  onBaseCapacityChange: (next: number) => void;
  totalExceptionMinutes: number;
  totalAttendanceMinutes: number;
  capacityNumeratorMin: number;
  capacityDenominatorMin: number;
  onOpenTimesheet: () => void;
  weekActualMinutes: number;
  weekPlannedMinutes: number;
  planRate: number;
  utilizationRate: number;
  rolling: ProductionAuditRolling4w;
  rollingPlanRate: number;
  monthlyRate: number;
}) {
  const rollFrom = formatMsToShanghaiLocale(rolling.windowStartMs).slice(0, 10);
  const rollTo = formatMsToShanghaiLocale(rolling.windowEndMs).slice(0, 10);
  const raMin = workloadMinutesValue(rolling.totalActualOutput);
  const rpMin = workloadMinutesValue(rolling.totalPlannedLoad);

  return (
    <div className="grid grid-cols-1 gap-6 border-b border-slate-800 bg-slate-900/50 p-6 md:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-3">
        <WeeklyBaseCapacityControl baseCapacity={baseCapacity} onBaseCapacityChange={onBaseCapacityChange} />
        <LedgerSummaryCard
          totalExceptionMinutes={totalExceptionMinutes}
          totalAttendanceMinutes={totalAttendanceMinutes}
          onOpenTimesheet={onOpenTimesheet}
        />
      </div>

      <SvgAuditRing
        percent={planRate}
        title="周计划达成率"
        subtitle={`实做 ${Math.round(weekActualMinutes)} 工时 / 计划 ${Math.round(weekPlannedMinutes)} 工时`}
      />

      <SvgAuditRing
        percent={utilizationRate}
        title="周产能利用率"
        subtitle={`产出 ${Math.round(capacityNumeratorMin)} 工时 / 基数 ${Math.round(capacityDenominatorMin)} 工时（基准 ${baseCapacity}）`}
      />

      <SvgAuditRing
        percent={rollingPlanRate}
        title="滚动四周达成率"
        subtitle={`${rollFrom}～${rollTo} 上海 · 实做 ${Math.round(raMin)} 工时 / 排产 ${Math.round(rpMin)} 工时 · 30d 月度 ${formatPctOne(monthlyRate)}%`}
      />
    </div>
  );
}

export default function ProductionAuditOverlay({
  isOpen,
  onClose,
  dailyCapacityMinutes,
}: ProductionAuditOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductionAuditSummaryResult | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [exceptionLogs, setExceptionLogs] = useState<LedgerEntry[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<LedgerEntry[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [baseCapacity, setBaseCapacity] = useState(DEFAULT_WEEKLY_BASE_CAPACITY);

  const persistBaseCapacity = useCallback((next: number) => {
    setBaseCapacity(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_WEEKLY_BASE_CAPACITY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setExceptionLogs(loadLedger(LS_EXCEPTION_LEDGER));
    setAttendanceLogs(loadLedger(LS_ATTENDANCE_LEDGER));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromWeekly = readPositiveIntFromLocalStorage(LS_WEEKLY_BASE_CAPACITY);
    if (fromWeekly != null) {
      setBaseCapacity(fromWeekly);
      return;
    }
    for (const key of ['daily_limit', 'mes_daily_capacity', 'dailyCapacity'] as const) {
      const d = readPositiveIntFromLocalStorage(key);
      if (d != null) {
        setBaseCapacity(Math.trunc(d * 6));
        return;
      }
    }
    const daily = dailyCapacityMinutes;
    if (daily != null && daily > 0) {
      setBaseCapacity(Math.trunc(daily * 6));
      return;
    }
    setBaseCapacity(DEFAULT_WEEKLY_BASE_CAPACITY);
  }, [dailyCapacityMinutes]);

  useEffect(() => {
    saveLedger(LS_EXCEPTION_LEDGER, exceptionLogs);
  }, [exceptionLogs]);

  useEffect(() => {
    saveLedger(LS_ATTENDANCE_LEDGER, attendanceLogs);
  }, [attendanceLogs]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchProductionAuditSummaryAction(weekOffset);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [weekOffset]);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setWeekOffset(0);
      setExpandedKey(null);
      setIsConsoleOpen(false);
    }
  }, [isOpen]);

  const weekLabel = useMemo(() => {
    if (!data?.ok) return '';
    return `${formatMsToShanghaiLocale(data.weekStartMs)} ～ ${formatMsToShanghaiLocale(data.weekEndMs)}`;
  }, [data]);

  const filteredPending = useMemo(() => {
    if (!data?.ok) return [];
    const q = searchTerm.trim();
    return data.pendingModels.filter((m) => matchesSearch(q, m.partNumber, m.orders));
  }, [data, searchTerm]);

  const filteredCompleted = useMemo(() => {
    if (!data?.ok) return [];
    const q = searchTerm.trim();
    return data.completedModels.filter((m) => matchesSearch(q, m.partNumber, m.orders));
  }, [data, searchTerm]);

  const totalExceptionMinutes = useMemo(
    () => exceptionLogs.reduce((s, e) => s + e.minutes, 0),
    [exceptionLogs]
  );
  const totalAttendanceMinutes = useMemo(
    () => attendanceLogs.reduce((s, e) => s + e.minutes, 0),
    [attendanceLogs]
  );

  const metrics = useMemo(() => {
    if (!data?.ok) {
      return {
        weekActualHours: 0,
        actualBaseMinutes: 0,
        weekPlanned: 0,
        weekPlannedMinutes: 0,
        planRate: 0,
        utilizationRate: 0,
        rollingPlanRate: 0,
        monthlyRate: 0,
        capacityNumeratorMin: 0,
        capacityDenominatorMin: baseCapacity,
      };
    }
    const weekActualHours = workloadValue(data.burnedHours);
    const actualBaseMinutes = workloadMinutesValue(data.burnedHours);
    const weekPlanned = workloadValue(data.weekScheduledLoadHours);
    const weekPlannedMinutes = workloadMinutesValue(data.weekScheduledLoadHours);
    const planRate = safeRatePercent(weekActualHours, weekPlanned);

    const capacityNumeratorMin = actualBaseMinutes + totalExceptionMinutes;
    const capacityDenominatorMin = baseCapacity + totalAttendanceMinutes;
    const utilizationRate = safeRatePercent(capacityNumeratorMin, capacityDenominatorMin);

    const r = data.rolling4Weeks;
    const rollActual = workloadValue(r.totalActualOutput);
    const rollPlanned = workloadValue(r.totalPlannedLoad);
    const rollingPlanRate = safeRatePercent(rollActual, rollPlanned);

    const m = data.monthly30d;
    const monthlyRate = safeRatePercent(workloadValue(m.burnedHours), workloadValue(m.plannedHours));

    return {
      weekActualHours,
      actualBaseMinutes,
      weekPlanned,
      weekPlannedMinutes,
      planRate,
      utilizationRate,
      rollingPlanRate,
      monthlyRate,
      capacityNumeratorMin,
      capacityDenominatorMin,
    };
  }, [data, totalExceptionMinutes, totalAttendanceMinutes, baseCapacity]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="production-audit-title"
      className="fixed inset-0 z-[100] flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950/70 backdrop-blur-2xl"
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-1 flex-col px-5 pb-8 pt-8 md:px-12 md:pt-10">
        <header className="mb-6 flex shrink-0 flex-wrap items-start justify-between gap-4 md:mb-8">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-400/70">生产审计</p>
            <h1 id="production-audit-title" className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              效能审计
            </h1>
            {weekLabel ? (
              <p className="text-sm leading-relaxed text-slate-400">统计区间（上海）：{weekLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="group flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-100 shadow-lg backdrop-blur-md transition hover:border-cyan-500/40 hover:bg-white/10 md:h-16 md:w-16"
            title="关闭"
            aria-label="关闭审计覆盖层"
          >
            <X
              className="h-8 w-8 transition-transform duration-300 ease-out group-hover:rotate-90 md:h-9 md:w-9"
              strokeWidth={2}
              aria-hidden
            />
          </button>
        </header>

        {loading && (
          <div className="flex min-h-0 flex-1 flex-col">
            <AuditSkeleton />
          </div>
        )}

        {!loading && data && !data.ok && (
          <div className="shrink-0 rounded-2xl border border-red-500/30 bg-red-950/20 px-5 py-4 text-sm leading-relaxed text-red-100/95">
            加载失败：{data.error ?? '未知错误'}
          </div>
        )}

        {!loading && data?.ok && (
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
            <div
              className={cn(
                'flex max-h-20 min-h-[5rem] shrink-0 items-center gap-x-2 gap-y-1 overflow-x-auto border-b border-white/10 pb-2',
                'text-[11px] sm:text-xs md:gap-3'
              )}
            >
              <span
                className={cn(
                  'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-bold tabular-nums',
                  metrics.planRate >= 80
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                    : metrics.planRate >= 50
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                      : 'border-red-500/40 bg-red-500/15 text-red-100'
                )}
              >
                达成 {formatPctOne(metrics.planRate)}%
              </span>
              <span className="shrink-0 tabular-nums text-slate-300">
                当周完工单 <span className="font-medium text-sky-300">{data.completedInWeekCount}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-300">
                型号 <span className="font-medium text-cyan-300">{data.modelCount}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-300">
                当周完工 <span className="font-medium text-emerald-300">{Math.round(metrics.actualBaseMinutes)}</span> 工时
              </span>
              <span className="shrink-0 tabular-nums text-slate-300">
                待办计划{' '}
                <span className="font-medium text-teal-300">{Math.round(workloadMinutesValue(data.plannedHours))}</span> 工时
              </span>

              <button
                type="button"
                onClick={() => setIsConsoleOpen((o) => !o)}
                className={cn(
                  'ml-auto flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors sm:text-xs',
                  isConsoleOpen
                    ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                    : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                )}
                aria-expanded={isConsoleOpen}
              >
                ⚙️ 效能控制台
              </button>
            </div>

            <AnimatePresence initial={false}>
              {isConsoleOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <MegaEfficiencyPanel
                    baseCapacity={baseCapacity}
                    onBaseCapacityChange={persistBaseCapacity}
                    totalExceptionMinutes={totalExceptionMinutes}
                    totalAttendanceMinutes={totalAttendanceMinutes}
                    capacityNumeratorMin={metrics.capacityNumeratorMin}
                    capacityDenominatorMin={metrics.capacityDenominatorMin}
                    onOpenTimesheet={() => setTimesheetOpen(true)}
                    weekActualMinutes={metrics.actualBaseMinutes}
                    weekPlannedMinutes={metrics.weekPlannedMinutes}
                    planRate={metrics.planRate}
                    utilizationRate={metrics.utilizationRate}
                    rolling={data.rolling4Weeks}
                    rollingPlanRate={metrics.rollingPlanRate}
                    monthlyRate={metrics.monthlyRate}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">搜索产品型号、客户名称</span>
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 md:h-5 md:w-5"
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索型号、客户…"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-sm leading-relaxed text-slate-100 shadow-inner backdrop-blur-md placeholder:text-slate-500 focus:border-cyan-500/35 focus:outline-none focus:ring-2 focus:ring-cyan-500/15 md:py-4 md:pl-14 md:text-base"
                  autoComplete="off"
                />
              </label>
              <select
                value={weekOffset}
                onChange={(e) => setWeekOffset(Number(e.target.value))}
                aria-label="选择统计周"
                className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm font-medium leading-relaxed text-slate-200 shadow-inner backdrop-blur-md focus:border-cyan-500/35 focus:outline-none focus:ring-2 focus:ring-cyan-500/15 md:min-w-[9rem] md:py-4"
              >
                {WEEK_SELECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-slate-900">
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-hidden lg:flex-row lg:gap-10">
              <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden lg:max-w-[50%]">
                <h2 className="mb-3 shrink-0 text-sm font-semibold tracking-wide text-amber-200/90">未完工</h2>
                <ul
                  className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain pr-1"
                  style={{ minHeight: 'min(55vh, 560px)' }}
                >
                  {filteredPending.length === 0 ? (
                    <li className="py-16 text-center text-sm leading-relaxed text-slate-500">
                      {data.pendingModels.length === 0 ? '本周暂无未完工型号' : '无匹配结果'}
                    </li>
                  ) : (
                    filteredPending.map((m, i) => {
                      const rowKey = `p:${m.partNumber}:${i}`;
                      return (
                        <CollapsiblePendingRow
                          key={rowKey}
                          model={m}
                          isExpanded={expandedKey === rowKey}
                          onToggle={() => setExpandedKey((k) => (k === rowKey ? null : rowKey))}
                        />
                      );
                    })
                  )}
                </ul>
              </section>

              <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden lg:max-w-[50%]">
                <h2 className="mb-3 shrink-0 text-sm font-semibold tracking-wide text-emerald-200/90">已完工</h2>
                <ul
                  className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain pr-1"
                  style={{ minHeight: 'min(55vh, 560px)' }}
                >
                  {filteredCompleted.length === 0 ? (
                    <li className="py-16 text-center text-sm leading-relaxed text-slate-500">
                      {data.completedModels.length === 0 ? '本周暂无完工产出' : '无匹配结果'}
                    </li>
                  ) : (
                    filteredCompleted.map((m, i) => {
                      const rowKey = `c:${m.partNumber}:${i}`;
                      return (
                        <CollapsibleCompletedRow
                          key={rowKey}
                          model={m}
                          isExpanded={expandedKey === rowKey}
                          onToggle={() => setExpandedKey((k) => (k === rowKey ? null : rowKey))}
                        />
                      );
                    })
                  )}
                </ul>
              </section>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {timesheetOpen && (
          <TimesheetModal
            onClose={() => setTimesheetOpen(false)}
            exceptionLogs={exceptionLogs}
            setExceptionLogs={setExceptionLogs}
            attendanceLogs={attendanceLogs}
            setAttendanceLogs={setAttendanceLogs}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CollapsiblePendingRow({
  model,
  isExpanded,
  onToggle,
}: {
  model: ProductionAuditPendingModelRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const orderLines = useMemo(() => dedupeAuditOrderLinesForDisplay(model.orders), [model.orders]);
  const linePct = pct(model.modelWeekBurnedHours, model.modelWeekPlannedHours);
  const estWorkload = workloadMinutesValue(model.estimatedHours);

  return (
    <li className="shrink-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-cyan-500/10 active:bg-cyan-500/15 md:gap-5 md:px-5 md:py-4"
        aria-expanded={isExpanded}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold tracking-tight text-cyan-200/95 md:text-base">
          {model.partNumber}
        </span>
        <span className="hidden min-w-0 flex-[1.2] text-center text-xs leading-relaxed text-slate-400 sm:block md:text-sm">
          欠产 <span className="tabular-nums text-slate-200">{model.shortfallQty}</span>
          <span className="mx-2 text-slate-600">·</span>
          工时 <span className="tabular-nums text-slate-200">{Math.round(estWorkload)}</span>
          <span className="mx-2 text-slate-600">·</span>
          <span className="tabular-nums text-slate-400">{linePct}%</span>
        </span>
        <span className="shrink-0 text-xs text-slate-500 sm:hidden">{model.pendingOrderCount} 单</span>
        <ChevronDown
          className={cn('h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200', isExpanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      <div className="px-4 pb-3 md:px-5">
        <ProgressBar valuePct={linePct} />
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-white/[0.06]"
          >
            <motion.div
              initial={{ y: -6 }}
              animate={{ y: 0 }}
              exit={{ y: -4 }}
              transition={{ duration: 0.18 }}
              className="space-y-0 px-3 py-3 md:px-4 md:py-4"
            >
              {orderLines.map((o, idx) => (
                <div
                  key={`${model.partNumber}-${idx}-${o.customerName}`}
                  className="border-b border-white/[0.05] py-3 last:border-0"
                >
                  <OrderDetailOneLine order={o} />
                </div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function CollapsibleCompletedRow({
  model,
  isExpanded,
  onToggle,
}: {
  model: ProductionAuditCompletedModelRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const orderLines = useMemo(() => dedupeAuditOrderLinesForDisplay(model.orders), [model.orders]);
  const qtyPct = pct(model.actualQty, model.modelWeekPlannedQty);
  const burnedWorkload = workloadMinutesValue(model.burnedHours);

  return (
    <li className="shrink-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-emerald-500/10 active:bg-emerald-500/15 md:gap-5 md:px-5 md:py-4"
        aria-expanded={isExpanded}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold tracking-tight text-emerald-200/95 md:text-base">
          {model.partNumber}
        </span>
        <span className="hidden min-w-0 flex-[1.2] text-center text-xs leading-relaxed text-slate-400 sm:block md:text-sm">
          实做 <span className="tabular-nums text-slate-200">{model.actualQty}</span>
          <span className="mx-2 text-slate-600">·</span>
          工时 <span className="tabular-nums text-slate-200">{Math.round(burnedWorkload)}</span>
          <span className="mx-2 text-slate-600">·</span>
          <span className="tabular-nums text-slate-400">{qtyPct}%</span>
        </span>
        <span className="shrink-0 text-xs text-slate-500 sm:hidden">{model.completedOrderCount} 单</span>
        <ChevronDown
          className={cn('h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200', isExpanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      <div className="px-4 pb-3 md:px-5">
        <ProgressBar valuePct={qtyPct} />
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-white/[0.06]"
          >
            <motion.div
              initial={{ y: -6 }}
              animate={{ y: 0 }}
              exit={{ y: -4 }}
              transition={{ duration: 0.18 }}
              className="space-y-0 px-3 py-3 md:px-4 md:py-4"
            >
              {orderLines.map((o, idx) => (
                <div
                  key={`${model.partNumber}-${idx}-${o.customerName}`}
                  className="border-b border-white/[0.05] py-3 last:border-0"
                >
                  <OrderDetailCompletedLine order={o} />
                </div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
