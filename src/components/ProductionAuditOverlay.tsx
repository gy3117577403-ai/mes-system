'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  fetchProductionAuditSummaryAction,
  type ProductionAuditCompletedModelRow,
  type ProductionAuditMonthly30d,
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
}

const STANDARD_CAPACITY_MINUTES = 11880;
const ADJUSTMENT_LS_KEY = 'mes-audit-capacity-adjustment';

/** 庫存工時欄位（小時語義）→ 分鐘（展示與比率用） */
function workloadToMinutes(v: number): number {
  const n = Number(v) || 0;
  return Math.round(n * 60 * 1000) / 1000;
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

function EfficiencyConsolePanel({
  data,
  adjustmentMinutes,
  setAdjustmentMinutes,
  availableCapacityMinutes,
  weekActualMin,
  weekPlannedMin,
  planRate,
  utilizationRate,
  rolling,
  rollingPlanRate,
  rollingUtilRate,
  monthly,
  monthlyRate,
}: {
  data: ProductionAuditSummaryResult;
  adjustmentMinutes: number;
  setAdjustmentMinutes: (n: number) => void;
  availableCapacityMinutes: number;
  weekActualMin: number;
  weekPlannedMin: number;
  planRate: number;
  utilizationRate: number;
  rolling: ProductionAuditRolling4w;
  rollingPlanRate: number;
  rollingUtilRate: number;
  monthly: ProductionAuditMonthly30d;
  monthlyRate: number;
}) {
  const rollFrom = formatMsToShanghaiLocale(rolling.windowStartMs).slice(0, 10);
  const rollTo = formatMsToShanghaiLocale(rolling.windowEndMs).slice(0, 10);
  const plannedMin30 = workloadToMinutes(monthly.plannedHours);
  const burnedMin30 = workloadToMinutes(monthly.burnedHours);
  const rollActualMin = workloadToMinutes(rolling.totalActualOutput);
  const rollPlannedMin = workloadToMinutes(rolling.totalPlannedLoad);
  const pendingPlanMin = workloadToMinutes(data.plannedHours);

  return (
    <div className="w-[min(100vw-2rem,22rem)] space-y-4 rounded-xl border border-white/15 bg-slate-900/98 p-4 text-sm text-slate-200 shadow-2xl backdrop-blur-xl">
      <div>
        <p className="text-[11px] font-semibold text-slate-400">产能微调（分钟）</p>
        <p className="mt-0.5 text-[10px] text-slate-500">基准 {STANDARD_CAPACITY_MINUTES} min / 周</p>
        <input
          type="number"
          inputMode="numeric"
          value={Number.isFinite(adjustmentMinutes) ? adjustmentMinutes : 0}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || v === '-') {
              setAdjustmentMinutes(0);
              return;
            }
            const n = Number(v);
            setAdjustmentMinutes(Number.isFinite(n) ? Math.trunc(n) : 0);
          }}
          className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-cyan-500/40"
        />
      </div>

      <div className="border-t border-white/10 pt-3">
        <p className="text-[11px] font-semibold text-slate-400">产能利用率（本周）</p>
        <p className="mt-1 text-xs tabular-nums text-slate-300">
          实做 {Math.round(weekActualMin)} min / 可用 {Math.round(availableCapacityMinutes)} min →{' '}
          <span className="font-medium text-sky-300">{formatPctOne(utilizationRate)}%</span>
        </p>
      </div>

      <div className="border-t border-white/10 pt-3">
        <p className="text-[11px] font-semibold text-slate-400">周计划达成率（验算）</p>
        <p className="mt-1 text-xs tabular-nums text-slate-300">
          实做 {Math.round(weekActualMin)} min / 计划 {Math.round(weekPlannedMin)} min →{' '}
          <span className="font-medium text-emerald-300">{formatPctOne(planRate)}%</span>
        </p>
      </div>

      <div className="border-t border-white/10 pt-3">
        <p className="text-[11px] font-semibold text-amber-200/90">四周滚动汇总</p>
        <p className="mt-1 text-[10px] text-slate-500">
          {rollFrom} ～ {rollTo}（上海）
        </p>
        <p className="mt-2 text-xs tabular-nums">
          达成率 {formatPctOne(rollingPlanRate)}%（{Math.round(rollActualMin)} / {Math.round(rollPlannedMin)} min）
        </p>
        <p className="mt-1 text-xs tabular-nums">
          产能利用率 {formatPctOne(rollingUtilRate)}%（四周可用 {Math.round(availableCapacityMinutes * 4)} min）
        </p>
      </div>

      <div className="border-t border-white/10 pt-3">
        <p className="text-[11px] font-semibold text-slate-400">近 30 天月度达成率</p>
        <p className="mt-1 text-xs tabular-nums text-slate-300">
          {formatPctOne(monthlyRate)}%（计划 {Math.round(plannedMin30)} min / 完工 {Math.round(burnedMin30)} min）
        </p>
        <p className="mt-1 text-[10px] text-slate-500">待办口径（全库）约 {Math.round(pendingPlanMin)} min</p>
      </div>
    </div>
  );
}

export default function ProductionAuditOverlay({ isOpen, onClose }: ProductionAuditOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductionAuditSummaryResult | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [adjustmentMinutes, setAdjustmentMinutes] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const consoleWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(ADJUSTMENT_LS_KEY);
      if (raw === null || raw === '') return;
      const n = Number(raw);
      if (Number.isFinite(n)) setAdjustmentMinutes(Math.trunc(n));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ADJUSTMENT_LS_KEY, String(adjustmentMinutes));
    } catch {
      /* ignore */
    }
  }, [adjustmentMinutes]);

  useEffect(() => {
    if (!consoleOpen) return;
    const fn = (e: MouseEvent) => {
      if (consoleWrapRef.current && !consoleWrapRef.current.contains(e.target as Node)) {
        setConsoleOpen(false);
      }
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [consoleOpen]);

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
      setConsoleOpen(false);
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

  const availableCapacityMinutes = STANDARD_CAPACITY_MINUTES + adjustmentMinutes;

  const metrics = useMemo(() => {
    if (!data?.ok) {
      return {
        weekActualMin: 0,
        weekPlannedMin: 0,
        planRate: 0,
        utilizationRate: 0,
        rollingPlanRate: 0,
        rollingUtilRate: 0,
        monthlyRate: 0,
      };
    }
    const weekActualMin = workloadToMinutes(data.burnedHours);
    const weekPlannedMin = workloadToMinutes(data.weekScheduledLoadHours);
    const planRate = safeRatePercent(weekActualMin, weekPlannedMin);
    const utilizationRate = safeRatePercent(weekActualMin, availableCapacityMinutes);

    const r = data.rolling4Weeks;
    const rollActualMin = workloadToMinutes(r.totalActualOutput);
    const rollPlannedMin = workloadToMinutes(r.totalPlannedLoad);
    const rollingPlanRate = safeRatePercent(rollActualMin, rollPlannedMin);
    const rollingUtilRate = safeRatePercent(rollActualMin, availableCapacityMinutes * 4);

    const m = data.monthly30d;
    const plannedMin30 = workloadToMinutes(m.plannedHours);
    const burnedMin30 = workloadToMinutes(m.burnedHours);
    const monthlyRate = safeRatePercent(burnedMin30, plannedMin30);

    return {
      weekActualMin,
      weekPlannedMin,
      planRate,
      utilizationRate,
      rollingPlanRate,
      rollingUtilRate,
      monthlyRate,
    };
  }, [data, availableCapacityMinutes]);

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
                当周完工 <span className="font-medium text-emerald-300">{Math.round(metrics.weekActualMin)}</span> min
              </span>
              <span className="shrink-0 tabular-nums text-slate-300">
                待办计划 <span className="font-medium text-teal-300">{Math.round(workloadToMinutes(data.plannedHours))}</span>{' '}
                min
              </span>

              <div className="relative ml-auto shrink-0" ref={consoleWrapRef}>
                <button
                  type="button"
                  onClick={() => setConsoleOpen((o) => !o)}
                  className={cn(
                    'flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors sm:text-xs',
                    consoleOpen
                      ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                      : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                  )}
                  aria-expanded={consoleOpen}
                >
                  ⚙️ 效能控制台
                </button>
                {consoleOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 max-h-[min(70vh,32rem)] overflow-y-auto">
                    <EfficiencyConsolePanel
                      data={data}
                      adjustmentMinutes={adjustmentMinutes}
                      setAdjustmentMinutes={setAdjustmentMinutes}
                      availableCapacityMinutes={availableCapacityMinutes}
                      weekActualMin={metrics.weekActualMin}
                      weekPlannedMin={metrics.weekPlannedMin}
                      planRate={metrics.planRate}
                      utilizationRate={metrics.utilizationRate}
                      rolling={data.rolling4Weeks}
                      rollingPlanRate={metrics.rollingPlanRate}
                      rollingUtilRate={metrics.rollingUtilRate}
                      monthly={data.monthly30d}
                      monthlyRate={metrics.monthlyRate}
                    />
                  </div>
                )}
              </div>
            </div>

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
  const estMin = Math.round(workloadToMinutes(model.estimatedHours));

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
          分钟 <span className="tabular-nums text-slate-200">{estMin}</span>
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
  const burnedMin = Math.round(workloadToMinutes(model.burnedHours));

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
          分钟 <span className="tabular-nums text-slate-200">{burnedMin}</span>
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
