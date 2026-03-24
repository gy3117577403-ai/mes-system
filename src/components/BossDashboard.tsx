'use client';

import React, { useMemo } from 'react';
import dayjs from 'dayjs';
import {
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts';
import { Order, AlarmKind } from '@/types';

const COLORS = ['#f87171', '#60a5fa', '#a78bfa', '#fbbf24'];

interface BossDashboardProps {
  orders: Order[];
}

export default function BossDashboard({ orders }: BossDashboardProps) {
  const pieData = useMemo(() => {
    const counts: Record<AlarmKind, number> = {
      Material: 0,
      Maintenance: 0,
      QC: 0,
    };
    orders.forEach((o) => {
      if (o.activeAlarm && counts[o.activeAlarm] !== undefined) {
        counts[o.activeAlarm] += 1;
      }
    });
    if (Object.values(counts).every((n) => n === 0)) {
      return [
        { name: '缺料', value: 4, fill: COLORS[0] },
        { name: '维修', value: 3, fill: COLORS[1] },
        { name: '质检', value: 2, fill: COLORS[2] },
      ];
    }
    return [
      { name: '缺料', value: counts.Material || 0, fill: COLORS[0] },
      { name: '维修', value: counts.Maintenance || 0, fill: COLORS[1] },
      { name: '质检', value: counts.QC || 0, fill: COLORS[2] },
    ];
  }, [orders]);

  const radarData = useMemo(() => {
    const today = dayjs().startOf('day');
    const in3 = today.add(3, 'day');
    const urgent = orders.filter((o) => {
      if (!o.deliveryDate || o.taskStatus === 'completed') return false;
      const d = dayjs(o.deliveryDate);
      if (!d.isValid()) return false;
      if (d.isBefore(today, 'day') || d.isAfter(in3, 'day')) return false;
      return o.assignedDay === 'Unscheduled';
    });
    if (urgent.length === 0) {
      return [
        { model: 'EHPS-A', risk: 85 },
        { model: 'LIN-02', risk: 72 },
        { model: 'HV-88', risk: 60 },
      ];
    }
    return urgent.slice(0, 8).map((o) => ({
      model: o.model.length > 10 ? o.model.slice(0, 10) + '…' : o.model,
      risk: Math.min(100, 40 + (o.totalHours || 0) / 2),
    }));
  }, [orders]);

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NeonPanel title="安灯异常统计 (今日 Mock)" subtitle="缺料 / 维修 / 质检">
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} stroke="rgba(15,23,42,0.8)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    border: '1px solid rgba(34,211,238,0.3)',
                    borderRadius: 12,
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </NeonPanel>

        <NeonPanel title="延期预警雷达" subtitle="未来 3 日内交期 · 尚未排产">
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                <PolarGrid stroke="rgba(148,163,184,0.3)" />
                <PolarAngleAxis dataKey="model" tick={{ fill: '#94a3b8', fontSize: 8 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#64748b' }} />
                <Radar
                  name="风险指数"
                  dataKey="risk"
                  stroke="#22d3ee"
                  fill="rgba(34,211,238,0.25)"
                  strokeWidth={2}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    border: '1px solid rgba(34,211,238,0.3)',
                    borderRadius: 12,
                  }}
                />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </NeonPanel>
      </div>
    </div>
  );
}

function NeonPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 backdrop-blur-xl p-5 shadow-[0_0_40px_rgba(34,211,238,0.08),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300 hover:shadow-[0_0_50px_rgba(34,211,238,0.12)]">
      <div className="mb-4">
        <h2 className="text-lg font-black text-white tracking-wide">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
