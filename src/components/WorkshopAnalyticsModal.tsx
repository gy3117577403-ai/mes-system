'use client';

import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { X } from 'lucide-react';
import { Order, ActivityLogEntry } from '@/types';

interface WorkshopAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  workers: string[];
  activityLogs: ActivityLogEntry[];
}

export default function WorkshopAnalyticsModal({
  isOpen,
  onClose,
  orders,
  workers,
  activityLogs,
}: WorkshopAnalyticsModalProps) {
  const chartData = useMemo(() => {
    const map = new Map<string, { name: string; 订单数: number; 工时分钟: number }>();
    workers.forEach((w) => map.set(w, { name: w, 订单数: 0, 工时分钟: 0 }));
    orders.forEach((o) => {
      if (!o.worker) return;
      if (!map.has(o.worker)) {
        map.set(o.worker, { name: o.worker, 订单数: 0, 工时分钟: 0 });
      }
      const row = map.get(o.worker)!;
      row.订单数 += 1;
      row.工时分钟 += Number(o.totalHours) || 0;
    });
    return Array.from(map.values());
  }, [orders, workers]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analytics-title"
    >
      <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-[0_0_60px_rgba(34,211,238,0.15)] w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80 shrink-0">
          <h2 id="analytics-title" className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-emerald-400">
            📊 效能统计
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            aria-label="关闭"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
          <section>
            <h3 className="text-sm font-bold text-slate-400 mb-3 tracking-widest uppercase">
              员工产能 · 订单数 / 工时（分钟）
            </h3>
            <div className="h-80 w-full min-h-[280px]">
              {chartData.length === 0 ? (
                <p className="text-slate-500 text-center py-16">暂无派工数据</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Legend />
                    <Bar dataKey="订单数" fill="#22d3ee" name="订单数" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="工时分钟" fill="#34d399" name="工时(分钟)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-400 mb-3 tracking-widest uppercase">
              全量操作日志（时间倒序）
            </h3>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 max-h-[40vh] overflow-y-auto custom-scrollbar">
              {activityLogs.length === 0 ? (
                <p className="text-slate-500 text-center py-12 text-sm">暂无日志</p>
              ) : (
                <ul className="divide-y divide-slate-800/80">
                  {activityLogs.map((log) => (
                    <li
                      key={log.id}
                      className="px-4 py-2.5 text-xs font-mono text-slate-300 hover:bg-slate-900/80"
                    >
                      {log.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
