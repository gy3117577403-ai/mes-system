'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { Search, X } from 'lucide-react';
import {
  fetchProductionAuditSummaryAction,
  type ProductionAuditCompletedModelRow,
  type ProductionAuditMonthly30d,
  type ProductionAuditOrderLine,
  type ProductionAuditPendingModelRow,
  type ProductionAuditSummaryResult,
} from '@/actions/mesActions';
import { formatMsToShanghaiLocale, plannedDateAnchorEpochMs } from '@/lib/datetimeShanghai';

interface ProductionAuditOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 1000) / 10);
}

function formatAuditDueDate(plannedDate: string | null, deliveryDate: string): string {
  const anchor = plannedDateAnchorEpochMs(plannedDate);
  if (anchor != null) {
    return formatMsToShanghaiLocale(anchor).slice(0, 10);
  }
  for (const raw of [plannedDate, deliveryDate]) {
    if (!raw?.trim()) continue;
    const s = raw.trim();
    const isoPrefix = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoPrefix) {
      const d = parseISO(isoPrefix[1]);
      if (isValid(d)) return format(d, 'yyyy-MM-dd');
    }
  }
  if (plannedDate?.trim()) return plannedDate.trim();
  if (deliveryDate?.trim()) return deliveryDate.trim();
  return '—';
}

function hasAssignedDay(assignedDay: string): boolean {
  const t = (assignedDay ?? '').trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (t === 'Unscheduled' || t === '未排程' || lower === 'unscheduled') return false;
  return true;
}

function schedulingStatusText(order: ProductionAuditOrderLine): string {
  if (order.isDrawingReady === false) return '图纸未下发';
  if (order.isMaterialReady === false) return '缺料';
  if (hasAssignedDay(order.assignedDay)) return `排产至 ${order.assignedDay}`;
  return '待排产';
}

function OrderStatusBadge({ order }: { order: ProductionAuditOrderLine }) {
  if (order.isDrawingReady === false) {
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-red-500/45 bg-red-950/75 px-2 py-0.5 text-xs font-bold text-red-200">
        <span aria-hidden>🔴</span>
        <span className="max-w-[7.5rem] truncate sm:max-w-[10rem]">图纸未下发</span>
      </span>
    );
  }
  if (order.isMaterialReady === false) {
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-amber-500/45 bg-amber-950/70 px-2 py-0.5 text-xs font-bold text-amber-200">
        <span aria-hidden>🟡</span>
        缺料
      </span>
    );
  }
  if (hasAssignedDay(order.assignedDay)) {
    return (
      <span className="inline-flex max-w-[9rem] shrink-0 items-center gap-0.5 rounded-md border border-emerald-500/40 bg-emerald-950/65 px-2 py-0.5 text-xs font-bold text-emerald-200">
        <span aria-hidden>🟢</span>
        <span className="truncate">排产至：{order.assignedDay}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-slate-600/70 bg-slate-800/90 px-2 py-0.5 text-xs font-bold text-slate-200">
      <span aria-hidden>⚪</span>
      待排产
    </span>
  );
}

function ProgressBar({ valuePct }: { valuePct: number }) {
  const w = Math.max(0, Math.min(100, valuePct));
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800/90">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-[width] duration-500"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function AuditSkeleton() {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 animate-pulse flex-col space-y-3 px-4 pb-6 pt-2 md:px-8">
      <div className="flex justify-between gap-4">
        <div className="h-10 w-64 rounded-lg bg-slate-800/80" />
        <div className="h-14 w-14 shrink-0 rounded-2xl bg-slate-800/80" />
      </div>
      <div className="grid h-20 shrink-0 grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-slate-800/80 bg-slate-900/50" />
        ))}
      </div>
      <div className="h-11 w-full rounded-xl border border-slate-800/80 bg-slate-900/50" />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <div className="h-72 rounded-xl border border-slate-800/80 bg-slate-900/40" />
        <div className="h-72 rounded-xl border border-slate-800/80 bg-slate-900/40" />
      </div>
    </div>
  );
}

function matchesSearch(
  q: string,
  partNumber: string,
  orders: ProductionAuditOrderLine[]
): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  if (partNumber.toLowerCase().includes(n)) return true;
  return orders.some(
    (o) =>
      o.id.toLowerCase().includes(n) ||
      o.customerName.toLowerCase().includes(n) ||
      o.taskStatus.toLowerCase().includes(n)
  );
}

/**
 * 全屏生產效能審計疊層：型號聚合 + 訂單明細、搜尋過濾、狀態徽章。
 */
const WEEK_SELECT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
  value: i,
  label: i === 0 ? '本周' : i === 1 ? '上周' : `${i}周前`,
}));

export default function ProductionAuditOverlay({ isOpen, onClose }: ProductionAuditOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductionAuditSummaryResult | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);

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

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="production-audit-title"
      className="fixed inset-0 z-[100] flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950/85 backdrop-blur-xl"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-4 pb-4 pt-5 md:px-8 md:pt-6">
        <header className="mb-2 flex shrink-0 flex-wrap items-start justify-between gap-3 md:mb-3">
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-400/80 md:text-xs">
              MES · Phase 2
            </p>
            <h1 id="production-audit-title" className="text-xl font-black tracking-tight text-white md:text-3xl">
              生产效能审计
            </h1>
            {weekLabel ? (
              <p className="mt-1 text-[11px] text-slate-400 md:text-xs">统计区间（上海）：{weekLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="group flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-slate-600/80 bg-slate-900/90 text-slate-100 shadow-[0_0_32px_rgba(34,211,238,0.12)] transition hover:border-cyan-500/50 hover:bg-slate-800 md:h-20 md:w-20"
            title="关闭"
            aria-label="关闭审计覆盖层"
          >
            <X
              className="h-10 w-10 transition-transform duration-300 ease-out group-hover:rotate-90 md:h-12 md:w-12"
              strokeWidth={2.25}
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
          <div className="shrink-0 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200">
            加载失败：{data.error ?? '未知错误'}
          </div>
        )}

        {!loading && data?.ok && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 grid h-20 shrink-0 grid-cols-5 gap-3">
              <MonthlyAttainmentCard m={data.monthly30d} />
              <KpiCard label="当周完工单" value={String(data.completedInWeekCount)} tone="sky" />
              <KpiCard label="型号总数" value={String(data.modelCount)} tone="cyan" />
              <KpiCard label="当周完工工时" value={String(data.burnedHours)} tone="emerald" />
              <KpiCard label="待办计划工时" value={String(data.plannedHours)} tone="teal" />
            </div>

            <div className="mb-2 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-stretch">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">搜索产品型号、客户名称</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 md:h-5 md:w-5"
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索产品型号、客户名称..."
                  className="w-full rounded-xl border border-slate-700/90 bg-slate-900/50 py-2.5 pl-10 pr-3 text-sm text-slate-100 shadow-inner backdrop-blur-md placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 md:py-3 md:pl-11 md:text-base"
                  autoComplete="off"
                />
              </label>
              <select
                value={weekOffset}
                onChange={(e) => setWeekOffset(Number(e.target.value))}
                aria-label="选择统计周"
                className="shrink-0 rounded-xl border border-slate-700/90 bg-slate-900/50 px-3 py-2.5 text-sm font-bold text-slate-200 shadow-inner backdrop-blur-md focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 sm:min-w-[8.5rem] md:py-3"
              >
                {WEEK_SELECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-slate-900">
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-6">
              <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-amber-500/25 bg-slate-900/40 shadow-[inset_0_1px_0_rgba(251,191,36,0.08)] lg:min-w-0 lg:flex-1">
                <div className="shrink-0 border-b border-slate-800/80 px-4 py-3 md:px-5">
                  <h2 className="text-sm font-black uppercase tracking-widest text-amber-200/90 md:text-base">
                    未完工点名墙
                  </h2>
                  <p className="mt-1 text-[11px] text-slate-500 md:text-xs">型号聚合 · 订单交期与排产状态</p>
                </div>
                <ul className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-3 py-3 pr-2 md:px-4 md:py-4 md:pr-3">
                  {filteredPending.length === 0 ? (
                    <li className="py-12 text-center text-sm text-slate-500">
                      {data.pendingModels.length === 0 ? '本周暂无未完工型号' : '无匹配结果'}
                    </li>
                  ) : (
                    filteredPending.map((m) => (
                      <PendingModelCard key={m.partNumber} model={m} />
                    ))
                  )}
                </ul>
              </section>

              <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-emerald-500/25 bg-slate-900/40 shadow-[inset_0_1px_0_rgba(52,211,153,0.08)] lg:min-w-0 lg:flex-1">
                <div className="shrink-0 border-b border-slate-800/80 px-4 py-3 md:px-5">
                  <h2 className="text-sm font-black uppercase tracking-widest text-emerald-200/90 md:text-base">
                    已完工战报榜
                  </h2>
                  <p className="mt-1 text-[11px] text-slate-500 md:text-xs">型号聚合 · 实做与产出明细</p>
                </div>
                <ul className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-3 py-3 pr-2 md:px-4 md:py-4 md:pr-3">
                  {filteredCompleted.length === 0 ? (
                    <li className="py-12 text-center text-sm text-slate-500">
                      {data.completedModels.length === 0 ? '本周暂无完工产出' : '无匹配结果'}
                    </li>
                  ) : (
                    filteredCompleted.map((m) => (
                      <CompletedModelCard key={m.partNumber} model={m} />
                    ))
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

function PendingModelCard({ model }: { model: ProductionAuditPendingModelRow }) {
  const hourPct = pct(model.modelWeekBurnedHours, model.modelWeekPlannedHours);
  return (
    <li className="rounded-xl border border-slate-800/90 bg-slate-950/50 px-3 py-3 pb-4 md:px-4 md:py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-mono text-sm font-bold text-cyan-300 md:text-base">{model.partNumber}</span>
        <span className="text-[10px] text-slate-500">未结 {model.pendingOrderCount} 单</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:text-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">欠产数量</p>
          <p className="mt-0.5 text-lg font-black text-amber-300 md:text-xl">{model.shortfallQty}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">预估工时</p>
          <p className="mt-0.5 text-lg font-black text-sky-300 md:text-xl">{model.estimatedHours}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-500 md:text-xs">
        型号周计划工时燃烧 {hourPct}%（已燃 {model.modelWeekBurnedHours} / 计 {model.modelWeekPlannedHours}）
      </p>
      <ProgressBar valuePct={hourPct} />

      <div className="mt-3 space-y-2 rounded-lg border border-slate-800/50 bg-slate-900/40 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">订单明细</p>
        <div className="space-y-2">
          {model.orders.map((o) => (
            <div
              key={o.id}
              className="flex items-start justify-between gap-3 rounded-md bg-slate-950/35 px-2.5 py-2 md:gap-4 md:px-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5 text-sm leading-snug text-slate-400">
                <p className="truncate">客户：{o.customerName || '—'}</p>
                <p className="truncate">交期：{formatAuditDueDate(o.plannedDate, o.deliveryDate)}</p>
                <p className="truncate text-slate-500">排产：{schedulingStatusText(o)}</p>
              </div>
              <OrderStatusBadge order={o} />
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}

function CompletedModelCard({ model }: { model: ProductionAuditCompletedModelRow }) {
  const qtyPct = pct(model.actualQty, model.modelWeekPlannedQty);
  return (
    <li className="rounded-xl border border-slate-800/90 bg-slate-950/50 px-3 py-3 pb-4 md:px-4 md:py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-mono text-sm font-bold text-emerald-300 md:text-base">{model.partNumber}</span>
        <span className="text-[10px] text-slate-500">完工 {model.completedOrderCount} 单</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:text-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">实做数量</p>
          <p className="mt-0.5 text-lg font-black text-emerald-300 md:text-xl">{model.actualQty}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">产出工时</p>
          <p className="mt-0.5 text-lg font-black text-sky-300 md:text-xl">{model.burnedHours}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-500 md:text-xs">
        件数达成 {qtyPct}%（实做 {model.actualQty} / 周计划 {model.modelWeekPlannedQty}）
      </p>
      <ProgressBar valuePct={qtyPct} />

      <div className="mt-3 space-y-2 rounded-lg border border-slate-800/50 bg-slate-900/40 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">订单明细</p>
        <div className="space-y-2">
          {model.orders.map((o) => (
            <div
              key={o.id}
              className="flex items-start justify-between gap-3 rounded-md bg-slate-950/35 px-2.5 py-2 md:gap-4 md:px-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5 text-sm leading-snug text-slate-400">
                <p className="truncate">客户：{o.customerName || '—'}</p>
                <p className="truncate">交期：{formatAuditDueDate(o.plannedDate, o.deliveryDate)}</p>
                <p className="truncate text-slate-500">排产：{schedulingStatusText(o)}</p>
              </div>
              <OrderStatusBadge order={o} />
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}

function MonthlyAttainmentCard({ m }: { m: ProductionAuditMonthly30d }) {
  const safe = Math.min(100, Math.max(0, m.attainmentPct));
  return (
    <div className="flex h-full min-h-0 items-center gap-2 rounded-lg border border-emerald-500/30 bg-slate-900/80 p-2 shadow-[0_0_12px_rgba(52,211,153,0.1)]">
      <div className="relative h-12 w-12 shrink-0">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(rgb(52 211 153) ${safe * 3.6}deg, rgb(30 41 59) 0deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full bg-slate-950/95" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-black leading-none text-emerald-300">{safe}%</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[8px] font-black uppercase tracking-wider text-emerald-400/90">月度达成</p>
        <p className="truncate text-[9px] text-slate-500">30d {m.plannedHours}h/{m.burnedHours}h</p>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'sky' | 'cyan' | 'emerald' | 'teal';
}) {
  const accent =
    tone === 'sky'
      ? 'text-sky-300'
      : tone === 'cyan'
        ? 'text-cyan-300'
        : tone === 'emerald'
          ? 'text-emerald-300'
          : 'text-teal-300';
  const border =
    tone === 'sky'
      ? 'border-sky-500/30 shadow-[0_0_24px_rgba(56,189,248,0.12)]'
      : tone === 'cyan'
        ? 'border-cyan-500/35 shadow-[0_0_24px_rgba(34,211,238,0.14)]'
        : tone === 'emerald'
          ? 'border-emerald-500/35 shadow-[0_0_24px_rgba(52,211,153,0.14)]'
          : 'border-teal-500/30 shadow-[0_0_24px_rgba(45,212,191,0.12)]';
  return (
    <div className={`flex h-full min-h-0 flex-col justify-center rounded-lg border bg-slate-900/80 p-3 ${border}`}>
      <p className="text-[8px] font-bold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-lg font-black tabular-nums leading-none md:text-xl ${accent}`}>
        {value}
      </p>
    </div>
  );
}
