'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  fetchProductionAuditSummaryAction,
  type ProductionAuditSummaryResult,
} from '@/actions/mesActions';
import { formatMsToShanghaiLocale } from '@/lib/datetimeShanghai';

interface ProductionAuditOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 1000) / 10);
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
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 animate-pulse flex-col space-y-6 px-4 pb-8 pt-2 md:px-8">
      <div className="flex justify-between gap-4">
        <div className="h-10 w-64 rounded-lg bg-slate-800/80" />
        <div className="h-14 w-14 shrink-0 rounded-2xl bg-slate-800/80" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-800/80 bg-slate-900/50" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 rounded-xl border border-slate-800/80 bg-slate-900/40" />
        <div className="h-72 rounded-xl border border-slate-800/80 bg-slate-900/40" />
      </div>
    </div>
  );
}

/**
 * 全屏生產效能審計疊層：型號級 `pendingModels` / `completedModels`，純 Tailwind 進度條。
 */
export default function ProductionAuditOverlay({ isOpen, onClose }: ProductionAuditOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductionAuditSummaryResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchProductionAuditSummaryAction();
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  const weekLabel = useMemo(() => {
    if (!data?.ok) return '';
    return `${formatMsToShanghaiLocale(data.weekStartMs)} ～ ${formatMsToShanghaiLocale(data.weekEndMs)}`;
  }, [data]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="production-audit-title"
      className="fixed inset-0 z-[100] flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950/85 backdrop-blur-xl"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-4 pb-4 pt-5 md:px-8 md:pt-6">
        <header className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-4 md:mb-6">
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-400/80 md:text-xs">
              MES · Phase 2
            </p>
            <h1 id="production-audit-title" className="text-2xl font-black tracking-tight text-white md:text-4xl">
              本周生产效能审计
            </h1>
            {weekLabel ? (
              <p className="mt-2 text-xs text-slate-400 md:text-sm">统计区间（上海）：{weekLabel}</p>
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

        {loading && <AuditSkeleton />}

        {!loading && data && !data.ok && (
          <div className="shrink-0 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200">
            加载失败：{data.error ?? '未知错误'}
          </div>
        )}

        {!loading && data?.ok && (
          <>
            <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 md:mb-6 md:grid-cols-4 md:gap-4">
              <KpiCard label="本周总单量" value={String(data.totalOrderCount)} tone="sky" />
              <KpiCard label="型号总数" value={String(data.modelCount)} tone="cyan" />
              <KpiCard label="已燃烧工时" value={String(data.burnedHours)} tone="emerald" />
              <KpiCard label="总计划工时" value={String(data.plannedHours)} tone="teal" />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-6">
              <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-amber-500/25 bg-slate-900/40 shadow-[inset_0_1px_0_rgba(251,191,36,0.08)] lg:min-w-0 lg:flex-1">
                <div className="shrink-0 border-b border-slate-800/80 px-4 py-3 md:px-5">
                  <h2 className="text-sm font-black uppercase tracking-widest text-amber-200/90 md:text-base">
                    未完工点名墙
                  </h2>
                  <p className="mt-1 text-[11px] text-slate-500 md:text-xs">按型号聚合 · 欠产与待燃烧工时</p>
                </div>
                <ul className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-3 py-3 pr-2 md:px-4 md:py-4 md:pr-3">
                  {data.pendingModels.length === 0 ? (
                    <li className="py-12 text-center text-sm text-slate-500">本周暂无未完工型号</li>
                  ) : (
                    data.pendingModels.map((m) => {
                      const hourPct = pct(m.modelWeekBurnedHours, m.modelWeekPlannedHours);
                      return (
                        <li
                          key={m.partNumber}
                          className="rounded-xl border border-slate-800/90 bg-slate-950/50 px-3 py-3 md:px-4 md:py-4"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-mono text-sm font-bold text-cyan-300 md:text-base">
                              {m.partNumber}
                            </span>
                            <span className="text-[10px] text-slate-500">未结 {m.pendingOrderCount} 单</span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:text-sm">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">欠产数量</p>
                              <p className="mt-0.5 text-lg font-black text-amber-300 md:text-xl">{m.shortfallQty}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">预估工时</p>
                              <p className="mt-0.5 text-lg font-black text-sky-300 md:text-xl">{m.estimatedHours}</p>
                            </div>
                          </div>
                          <p className="mt-2 text-[10px] text-slate-500 md:text-xs">
                            型号周计划工时燃烧 {hourPct}%（已燃 {m.modelWeekBurnedHours} / 计 {m.modelWeekPlannedHours}）
                          </p>
                          <ProgressBar valuePct={hourPct} />
                        </li>
                      );
                    })
                  )}
                </ul>
              </section>

              <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-emerald-500/25 bg-slate-900/40 shadow-[inset_0_1px_0_rgba(52,211,153,0.08)] lg:min-w-0 lg:flex-1">
                <div className="shrink-0 border-b border-slate-800/80 px-4 py-3 md:px-5">
                  <h2 className="text-sm font-black uppercase tracking-widest text-emerald-200/90 md:text-base">
                    已完工战报榜
                  </h2>
                  <p className="mt-1 text-[11px] text-slate-500 md:text-xs">按型号聚合 · 实做件数与产出工时</p>
                </div>
                <ul className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-3 py-3 pr-2 md:px-4 md:py-4 md:pr-3">
                  {data.completedModels.length === 0 ? (
                    <li className="py-12 text-center text-sm text-slate-500">本周暂无完工产出</li>
                  ) : (
                    data.completedModels.map((m) => {
                      const qtyPct = pct(m.actualQty, m.modelWeekPlannedQty);
                      return (
                        <li
                          key={m.partNumber}
                          className="rounded-xl border border-slate-800/90 bg-slate-950/50 px-3 py-3 md:px-4 md:py-4"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-mono text-sm font-bold text-emerald-300 md:text-base">
                              {m.partNumber}
                            </span>
                            <span className="text-[10px] text-slate-500">完工 {m.completedOrderCount} 单</span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:text-sm">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">实做数量</p>
                              <p className="mt-0.5 text-lg font-black text-emerald-300 md:text-xl">{m.actualQty}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">产出工时</p>
                              <p className="mt-0.5 text-lg font-black text-sky-300 md:text-xl">{m.burnedHours}</p>
                            </div>
                          </div>
                          <p className="mt-2 text-[10px] text-slate-500 md:text-xs">
                            件数达成 {qtyPct}%（实做 {m.actualQty} / 周计划 {m.modelWeekPlannedQty}）
                          </p>
                          <ProgressBar valuePct={qtyPct} />
                        </li>
                      );
                    })
                  )}
                </ul>
              </section>
            </div>
          </>
        )}
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
    <div className={`rounded-xl border bg-slate-900/70 px-3 py-3 md:px-5 md:py-4 ${border}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 md:text-xs">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-black tabular-nums md:text-3xl ${accent}`}>{value}</p>
    </div>
  );
}
