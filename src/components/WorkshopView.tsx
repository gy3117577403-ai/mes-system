/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertOctagon, ArrowLeft, ScrollText, ListChecks, BellRing, FileImage, Sun, Moon } from 'lucide-react';
import { toast } from 'react-hot-toast';
import confetti from 'canvas-confetti';
import { BoxSelectionModal, WorkerSelectionModal } from './Modals';
import WorkshopAnalyticsModal from './WorkshopAnalyticsModal';
import { ActivityLogEntry, AlarmKind, Order } from '@/types';
import {
  SOPViewerModal,
  AlarmPickerModal,
  ProgressKeypadModal,
} from '@/components/mes/WorkshopMESModals';
import type { AppTheme } from '@/lib/uiTheme';
import { cn, workshopRoot, workshopTitle, workshopDayTab } from '@/lib/uiTheme';
import { isOrderCompletedStatus } from '@/lib/orderStatus';

interface WorkshopViewProps {
  orders: Order[];
  updateOrderData: (id: string, field: string, value: any) => void;
  /** 已被占用的周轉箱編號字串列表（如 "05"），與選盤整數比對時會正規化 */
  occupiedBoxes: (string | null | undefined)[];
  workers: string[];
  setWorkers: React.Dispatch<React.SetStateAction<string[]>>;
  setViewMode: (m: 'manager' | 'workshop') => void;
  dailyCapacity: number;
  activityLogs: ActivityLogEntry[];
  appendActivityLog: (actionLabel: string, description: string) => void;
  submitProgressReport: (orderId: string, amount: number) => void;
  setOrderAlarm: (orderId: string, alarm: AlarmKind | null) => void;
  alarmCount: number;
  theme: AppTheme;
  setTheme: React.Dispatch<React.SetStateAction<AppTheme>>;
  /** 若提供，新增員工時同步後端並樂觀更新列表 */
  onAddWorker?: (name: string) => void;
}

export default function WorkshopView({
  orders,
  updateOrderData,
  occupiedBoxes,
  workers,
  setWorkers,
  setViewMode,
  dailyCapacity,
  activityLogs,
  appendActivityLog,
  submitProgressReport,
  setOrderAlarm,
  alarmCount,
  theme,
  setTheme,
  onAddWorker,
}: WorkshopViewProps) {
  const [boxModal, setBoxModal] = useState<{ isOpen: boolean; taskId: string | null }>({
    isOpen: false,
    taskId: null,
  });
  const [activeDay, setActiveDay] = useState('Monday');
  const [workerModal, setWorkerModal] = useState<{ isOpen: boolean; orderId: string | null }>({
    isOpen: false,
    orderId: null,
  });
  const [newWorkerName, setNewWorkerName] = useState('');
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);

  const [sopOrderId, setSopOrderId] = useState<string | null>(null);
  const [alarmOrderId, setAlarmOrderId] = useState<string | null>(null);
  const [progressOrderId, setProgressOrderId] = useState<string | null>(null);

  const withUndo = (orderLabel: string, stepDescription: string, actionFn: () => void) => {
    let undone = false;
    const tid = window.setTimeout(() => {
      if (!undone) {
        actionFn();
      }
    }, 5000);

    toast((t) => (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          订单 <strong className="text-cyan-300">{orderLabel}</strong> 准备流转：{stepDescription}
          <span className="text-slate-400 ml-1">(5 秒)</span>
        </span>
        <button
          type="button"
          onClick={() => {
            undone = true;
            window.clearTimeout(tid);
            toast.dismiss(t.id);
            toast.error(`已撤销：${stepDescription}`);
          }}
          className="bg-slate-700 text-white px-3 py-1.5 rounded-md text-xs font-bold hover:bg-slate-600 transition-colors shadow shrink-0"
        >
          撤销
        </button>
      </div>
    ), { duration: 5000, position: 'bottom-center' });
  };

  const handleBoxSelect = (boxNum: number) => {
    if (!boxModal.taskId) return;
    const tId = boxModal.taskId;
    const taskModel = orders.find((o) => o.id === tId)?.model ?? tId.slice(-6);
    setBoxModal({ isOpen: false, taskId: null });

    const boxStr = String(Math.trunc(boxNum)).padStart(2, '0');
    withUndo(String(taskModel), `锁定 ${boxStr} 号周转箱`, () => {
      updateOrderData(tId, 'boxNumber', boxStr);
      updateOrderData(tId, 'cutStatus', 'completed');
      appendActivityLog('锁定箱号', `订单 ${taskModel} 已锁定 ${boxStr} 号周转箱`);
      toast.success(`成功锁定 ${boxStr} 号箱！`);
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#22d3ee', '#34d399', '#818cf8', '#f87171'],
      });
    });
  };

  const handleWorkerSelect = (workerName: string) => {
    if (!workerModal.orderId) return;
    const oId = workerModal.orderId;
    const taskModel = orders.find((o) => o.id === oId)?.model ?? String(oId).slice(-6);
    setWorkerModal({ isOpen: false, orderId: null });

    withUndo(String(taskModel), `派工给 ${workerName}`, () => {
      updateOrderData(oId, 'worker', workerName);
      appendActivityLog('派工', `订单 ${taskModel} 已派发给 ${workerName}`);
      toast.success(`成功派工给 ${workerName}！`);
    });
  };

  const handleAddWorker = () => {
    const n = newWorkerName.trim();
    if (!n) return;
    if (onAddWorker) {
      onAddWorker(n);
    } else {
      setWorkers([...workers, n]);
    }
    setNewWorkerName('');
    toast.success('新员工添加成功');
  };

  const workshopDays = [
    { key: 'Monday', label: '周一' },
    { key: 'Tuesday', label: '周二' },
    { key: 'Wednesday', label: '周三' },
    { key: 'Thursday', label: '周四' },
    { key: 'Friday', label: '周五' },
    { key: 'Saturday', label: '周六' },
  ];

  const workshopVisible = (o: Order) =>
    !isOrderCompletedStatus(o.taskStatus) && o.taskStatus !== 'PendingQC';

  const activeTasks = orders.filter(
    (o) => o.assignedDay === activeDay && workshopVisible(o)
  );

  const sopOrder = sopOrderId ? orders.find((o) => o.id === sopOrderId) : null;
  const alarmOrder = alarmOrderId ? orders.find((o) => o.id === alarmOrderId) : null;
  const progressOrder = progressOrderId ? orders.find((o) => o.id === progressOrderId) : null;

  useEffect(() => {
    if (!logPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLogPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [logPanelOpen]);

  return (
    <div className={cn('flex-1 flex flex-row min-h-0 overflow-hidden relative', workshopRoot(theme))}>
      {/* Industrial control room: dot grid + subtle scanlines */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.35]"
        style={{
          backgroundImage:
            theme === 'dark'
              ? `
            radial-gradient(circle at 1px 1px, rgba(148,163,184,0.14) 1px, transparent 0),
            linear-gradient(rgba(15,23,42,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(15,23,42,0.5) 1px, transparent 1px)
          `
              : `
            radial-gradient(circle at 1px 1px, rgba(100,116,139,0.2) 1px, transparent 0),
            linear-gradient(rgba(229,231,235,0.9) 1px, transparent 1px),
            linear-gradient(90deg, rgba(229,231,235,0.9) 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px, 48px 48px, 48px 48px',
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-0 bg-gradient-to-b via-transparent',
          theme === 'dark' ? 'from-cyan-950/20 to-slate-950/80' : 'from-cyan-100/40 to-gray-100'
        )}
      />

      <div className="relative z-10 flex-1 min-w-0 flex flex-col p-4 overflow-hidden">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4 shrink-0">
          <div className="min-w-0">
            <h2
              className={cn(
                'text-2xl sm:text-3xl font-black tracking-widest flex items-center gap-3 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)]',
                workshopTitle(theme)
              )}
            >
              <span className="w-3 h-10 bg-cyan-400 rounded-md shadow-[0_0_10px_#22d3ee] animate-pulse shrink-0" />
              <span className="truncate">车间作业终端</span>
            </h2>
            {alarmCount > 0 && (
              <p className="mt-1 text-xs font-bold text-red-400/95 animate-pulse pl-1">
                当前有 🚨 {alarmCount} 个呼叫待处理
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className={cn(
                'h-10 w-10 flex items-center justify-center rounded-xl border transition-all shrink-0',
                theme === 'dark'
                  ? 'bg-slate-900/90 border-slate-600 text-amber-400 hover:bg-slate-800'
                  : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-100'
              )}
              title={theme === 'dark' ? '切換為白晝模式' : '切換為深色模式'}
              aria-label={theme === 'dark' ? '白晝模式' : '深色模式'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setAnalyticsOpen(true)}
              className="rounded-xl bg-gradient-to-r from-violet-600/90 to-cyan-600/90 hover:from-violet-500 hover:to-cyan-500 text-white px-4 py-2 flex items-center gap-2 font-bold text-sm shadow-lg border border-cyan-500/40"
            >
              📊 效能统计
            </button>
            <button
              type="button"
              onClick={() => setViewMode('manager')}
              className={cn(
                'rounded-xl px-4 py-2 flex items-center gap-2 font-bold text-sm border',
                theme === 'dark'
                  ? 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-gray-50 text-gray-900 border-gray-300'
              )}
            >
              <ArrowLeft size={18} strokeWidth={2.5} />
              返回控制台
            </button>
          </div>
        </div>

        <div
          className={cn(
            'flex mb-4 shrink-0 overflow-x-auto rounded-xl border backdrop-blur-sm',
            theme === 'dark' ? 'border-slate-800/80 bg-slate-950/40' : 'border-gray-300 bg-white/90'
          )}
        >
          {workshopDays.map((day) => {
            const isActive = activeDay === day.key;
            const dayTasks = orders.filter(
              (o) => o.assignedDay === day.key && workshopVisible(o)
            );
            const dayCount = dayTasks.length;
            const totalMins = dayTasks.reduce(
              (sum, t) => sum + (Number(t.totalHours) || 0),
              0
            );
            const loadPercent = Math.min(100, Math.round((totalMins / dailyCapacity) * 100));
            const isOverloaded = totalMins > dailyCapacity;
            const englishAbbr = day.key.substring(0, 3);

            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setActiveDay(day.key)}
                className={cn(
                  'flex-1 min-w-[72px] p-3 transition-all duration-300 relative flex items-center justify-center rounded-t-xl',
                  workshopDayTab(theme, isActive),
                  isActive && theme === 'dark' && 'shadow-[0_5px_15px_rgba(34,211,238,0.25)]',
                  isActive && theme === 'light' && 'shadow-[0_5px_15px_rgba(6,182,212,0.2)]'
                )}
              >
                <div className="flex items-center">
                  <div className="flex flex-col items-center justify-center text-center">
                    <span
                      className={cn(
                        'text-[10px] tracking-[0.2em] uppercase font-semibold',
                        isActive
                          ? theme === 'dark'
                            ? 'text-cyan-400'
                            : 'text-cyan-700'
                          : theme === 'dark'
                            ? 'text-slate-600'
                            : 'text-gray-500'
                      )}
                    >
                      {englishAbbr}
                    </span>
                    <span
                      className={cn(
                        'text-lg font-black tracking-widest mt-1',
                        isActive
                          ? theme === 'dark'
                            ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                            : 'text-gray-900'
                          : theme === 'dark'
                            ? 'text-slate-500'
                            : 'text-gray-600'
                      )}
                    >
                      {day.label}
                    </span>
                  </div>
                  {dayCount > 0 && (
                    <div
                      className={cn(
                        'absolute top-2 right-2 -skew-x-12 border font-mono px-2 py-0.5 text-xs rounded-sm',
                        theme === 'dark'
                          ? 'border-slate-700 bg-slate-900 text-cyan-400'
                          : 'border-gray-300 bg-gray-100 text-cyan-700'
                      )}
                    >
                      {dayCount}
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    'absolute bottom-0 left-0 w-full h-[2px] rounded-full overflow-hidden',
                    theme === 'dark' ? 'bg-slate-800/50' : 'bg-gray-200'
                  )}
                >
                  <div
                    className={`h-full transition-all duration-500 ${isOverloaded ? 'bg-red-500' : 'bg-cyan-500/80'} ${isActive ? 'animate-pulse' : ''}`}
                    style={{ width: `${loadPercent}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <main className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-1 overflow-y-auto hide-scrollbar-smooth content-start items-start">
          <AnimatePresence mode="popLayout">
            {activeTasks.map((order) => {
              const isAnomaly = order.taskStatus === 'anomaly';
              const isRework = order.taskStatus === 'Rework';
              const hasCut = !!order.boxNumber;
              const hasAssigned = !!order.worker;
              const totalQ = order.totalQty || order.qty || 1;
              const rep = order.reportedQty ?? 0;
              const pct = Math.min(100, Math.round((rep / Math.max(1, totalQ)) * 100));
              const progressActive = hasAssigned && (rep > 0 || rep >= totalQ);

              const StepperNode = ({ label, active }: { label: string; active: boolean }) => (
                <div className="flex items-center gap-1 shrink-0">
                  <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-cyan-400 animate-pulse' : 'bg-slate-700'}`} />
                  <span className={`text-[10px] font-bold ${active ? 'text-cyan-400' : 'text-slate-600'}`}>{label}</span>
                </div>
              );

              const alarmFlash = !!order.activeAlarm;

              return (
                <motion.div
                  key={order.id}
                  layout
                  layoutId={`card-${order.id}`}
                  initial={{ opacity: 0, scale: 0.94, y: 16 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                  }}
                  exit={{ opacity: 0, scale: 0.92, y: -16 }}
                  transition={{ type: 'tween', duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    'rounded-2xl shadow-xl p-4 flex flex-col relative group w-full min-w-0 h-auto backdrop-blur-md border',
                    theme === 'light' && !isAnomaly && !alarmFlash && !(hasCut && !hasAssigned)
                      ? 'bg-white border-gray-300'
                      : !isAnomaly && !alarmFlash && !(hasCut && !hasAssigned)
                        ? 'bg-slate-900/90 border-slate-700/90'
                        : '',
                    isAnomaly
                      ? 'border-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse overflow-hidden'
                      : alarmFlash
                        ? 'border-red-500 shadow-[0_0_22px_rgba(239,68,68,0.45)] animate-[pulse_1.2s_ease-in-out_infinite]'
                        : hasCut && !hasAssigned
                          ? 'border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.3)] animate-pulse'
                          : ''
                  )}
                >
                  {isRework && (
                    <div className="absolute top-2 left-2 z-10 bg-orange-600 text-white text-[10px] px-2 py-0.5 rounded-md font-black shadow-lg animate-pulse">
                      ⚠️ 返工
                    </div>
                  )}

                  {isAnomaly && (
                    <div className="absolute inset-0 z-20 rounded-2xl overflow-hidden bg-red-900/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center">
                      <h3 className="text-lg font-black text-white mb-3">🚨 生产异常锁定中</h3>
                      <button
                        type="button"
                        onClick={() => updateOrderData(order.id, 'taskStatus', 'normal')}
                        className="bg-emerald-500/80 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-xl flex items-center gap-2 shadow-lg transition-all"
                      >
                        🟢 解除异常，恢复生产
                      </button>
                    </div>
                  )}

                  <div className="flex justify-between items-start mb-2 gap-2 shrink-0">
                    <div className="text-[10px] text-slate-500 font-black tracking-widest bg-slate-800/60 px-2 py-1 rounded-lg truncate border border-slate-700/80">
                      ID-{String(order.id).slice(-4).toUpperCase()}
                    </div>
                    {!isAnomaly && (
                      <button
                        type="button"
                        onClick={() => updateOrderData(order.id, 'taskStatus', 'anomaly')}
                        className="text-slate-600 hover:text-red-500 transition-colors shrink-0"
                        title="提报异常"
                      >
                        <AlertOctagon className="w-5 h-5" />
                      </button>
                    )}
                  </div>

                  {!isAnomaly && (
                    <button
                      type="button"
                      onClick={() => setSopOrderId(order.id)}
                      className="mb-3 w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600/90 to-cyan-600/80 hover:from-sky-500 hover:to-cyan-500 text-white font-black text-sm flex items-center justify-center gap-2 border border-cyan-400/30 shadow-[0_0_18px_rgba(34,211,238,0.25)]"
                    >
                      <FileImage className="w-4 h-4" />
                      查看图纸 (SOP)
                    </button>
                  )}

                  <div className="flex items-center gap-2 mb-3 border-b border-slate-800 pb-3 shrink-0">
                    <StepperNode label="下料" active={hasCut} />
                    <div className="flex-1 min-w-[8px] h-px bg-slate-700" />
                    <StepperNode label="派工" active={hasAssigned} />
                    <div className="flex-1 min-w-[8px] h-px bg-slate-700" />
                    <StepperNode label="进度" active={progressActive} />
                  </div>

                  <div className="shrink-0 w-full min-w-0 mb-1">
                    <div
                      className={cn(
                        'text-2xl font-black mb-1 truncate block w-full min-h-[2rem] leading-tight',
                        theme === 'dark' ? 'text-white' : 'text-gray-900'
                      )}
                      title={order.model || '—'}
                    >
                      {order.model || '—'}
                    </div>
                    <div
                      className={cn(
                        'font-bold mb-3 truncate block w-full min-h-[1.5rem] leading-snug',
                        theme === 'dark' ? 'text-cyan-400' : 'text-cyan-700'
                      )}
                      title={order.client || '—'}
                    >
                      {order.client || '—'}
                    </div>
                  </div>

                  <div
                    className={cn(
                      'flex justify-between text-base mb-2 p-3 rounded-xl border shrink-0',
                      theme === 'dark'
                        ? 'text-slate-300 bg-slate-950/60 border-slate-800/90'
                        : 'text-gray-800 bg-gray-50 border-gray-300'
                    )}
                  >
                    <span className="flex flex-col items-center min-w-0">
                      <span className="text-xs text-slate-500 font-medium mb-1">数量</span>
                      <span className="font-mono text-xl font-black text-emerald-400">{order.qty}</span>
                    </span>
                    <span className="w-px shrink-0 self-stretch bg-slate-700 mx-1" />
                    <span className="flex flex-col items-center min-w-0">
                      <span className="text-xs text-slate-500 font-medium mb-1">工时</span>
                      <span className="font-mono text-xl font-black text-yellow-400">{order.totalHours}</span>
                    </span>
                  </div>

                  {hasAssigned && (
                    <div className="mb-4 shrink-0">
                      <div className="flex justify-between text-[11px] text-slate-500 mb-1 font-mono">
                        <span>报工进度</span>
                        <span className="text-cyan-400 font-bold">
                          {rep} / {totalQ} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                          initial={false}
                          animate={{ width: `${pct}%` }}
                          transition={{ type: 'tween', duration: 0.45, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  )}

                  {!isAnomaly && (
                    <div className="mt-auto pt-4 border-t border-slate-800 shrink-0 space-y-2">
                      {hasCut && !hasAssigned && (
                        <div className="text-center mb-1">
                          <span className="bg-purple-900/80 text-purple-200 text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                            ⚠️ 待组装积压
                          </span>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex items-center justify-center text-xs font-bold rounded-xl py-2 px-1 bg-slate-800/70 border border-slate-700 min-w-0">
                          {hasCut ? (
                            <span className="text-cyan-400 truncate">[📦 {order.boxNumber} 号]</span>
                          ) : (
                            <span className="text-slate-500">未装箱</span>
                          )}
                        </div>
                        <div className="flex items-center justify-center text-xs font-bold rounded-xl py-2 px-1 bg-slate-800/70 border border-slate-700 min-w-0">
                          {hasAssigned ? (
                            <span className="text-emerald-400 truncate">[👷 {order.worker}]</span>
                          ) : (
                            <span className="text-slate-500">待派工</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setAlarmOrderId(order.id)}
                          title="安灯"
                          className={`flex items-center justify-center rounded-xl border-2 min-h-[40px] transition-all ${
                            order.activeAlarm
                              ? 'bg-red-950/80 border-red-500 text-red-300 animate-pulse'
                              : 'bg-slate-800/70 border-red-900/50 text-red-400/90 hover:bg-red-950/40'
                          }`}
                        >
                          <BellRing className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="w-full min-w-0">
                        {!hasCut ? (
                          <button
                            type="button"
                            onClick={() => setBoxModal({ isOpen: true, taskId: order.id })}
                            className="w-full min-h-[44px] text-center py-2.5 rounded-xl bg-blue-600/85 text-white font-bold shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:bg-blue-600 transition-all text-sm"
                          >
                            ✂️ 去裁线
                          </button>
                        ) : !hasAssigned ? (
                          <button
                            type="button"
                            onClick={() => setWorkerModal({ isOpen: true, orderId: order.id })}
                            className="w-full min-h-[44px] text-center py-2.5 rounded-xl bg-purple-600/85 text-white font-bold shadow-[0_0_15px_rgba(168,85,247,0.4)] hover:bg-purple-600 transition-all text-sm"
                          >
                            👤 去派工
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setProgressOrderId(order.id)}
                            className="w-full min-h-[44px] text-center py-2.5 rounded-xl bg-emerald-600/85 text-white font-black shadow-[0_0_20px_rgba(16,185,129,0.45)] hover:bg-emerald-600 transition-all text-sm"
                          >
                            📊 进度提报
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {activeTasks.length === 0 && (
            <div
              className={cn(
                'col-span-full min-h-[30vh] flex flex-col items-center justify-center',
                theme === 'dark' ? 'text-slate-600' : 'text-gray-500'
              )}
            >
              <span className="text-xl font-medium tracking-widest">【当前生产线空闲】</span>
            </div>
          )}
        </main>

        <BoxSelectionModal
          isOpen={boxModal.isOpen}
          onClose={() => setBoxModal({ isOpen: false, taskId: null })}
          occupiedBoxes={occupiedBoxes}
          handleBoxSelect={handleBoxSelect}
        />

        <WorkerSelectionModal
          isOpen={workerModal.isOpen}
          onClose={() => setWorkerModal({ isOpen: false, orderId: null })}
          workers={workers}
          handleWorkerSelect={handleWorkerSelect}
          newWorkerName={newWorkerName}
          setNewWorkerName={setNewWorkerName}
          handleAddWorker={handleAddWorker}
        />

        <WorkshopAnalyticsModal
          isOpen={analyticsOpen}
          onClose={() => setAnalyticsOpen(false)}
          orders={orders}
          workers={workers}
          activityLogs={activityLogs}
        />

        {sopOrder && (
          <SOPViewerModal
            isOpen
            onClose={() => setSopOrderId(null)}
            model={sopOrder.model}
            drawingUrl={sopOrder.drawingUrl}
          />
        )}

        <AlarmPickerModal
          isOpen={!!alarmOrder}
          onClose={() => setAlarmOrderId(null)}
          current={alarmOrder?.activeAlarm ?? null}
          onConfirm={(kind) => {
            if (alarmOrderId) setOrderAlarm(alarmOrderId, kind);
          }}
          onClear={() => {
            if (alarmOrderId) setOrderAlarm(alarmOrderId, null);
          }}
        />

        {progressOrder && (
          <ProgressKeypadModal
            isOpen
            onClose={() => setProgressOrderId(null)}
            model={progressOrder.model}
            totalQty={progressOrder.totalQty || progressOrder.qty || 1}
            reportedQty={progressOrder.reportedQty ?? 0}
            onSubmit={(n) => {
              const cap = progressOrder.totalQty || progressOrder.qty || 1;
              const next = (progressOrder.reportedQty ?? 0) + n;
              submitProgressReport(progressOrder.id, n);
              if (next === cap) {
                confetti({
                  particleCount: 120,
                  spread: 80,
                  origin: { y: 0.72 },
                  colors: ['#34d399', '#22d3ee', '#a78bfa'],
                });
              }
            }}
          />
        )}
      </div>

      {/* 右側極細觸發條 + 抽屜日誌 */}
      <button
        type="button"
        onClick={() => setLogPanelOpen((v) => !v)}
        className={cn(
          'relative z-30 w-9 shrink-0 flex flex-col items-center justify-center gap-1 border-l transition-colors group',
          theme === 'dark'
            ? 'border-cyan-500/25 bg-slate-950/95 hover:bg-slate-900'
            : 'border-gray-300 bg-white hover:bg-gray-50'
        )}
        title="活动日志"
        aria-expanded={logPanelOpen}
      >
        <ListChecks
          className={cn(
            'w-5 h-5 group-hover:scale-110 transition-transform',
            theme === 'dark' ? 'text-cyan-400' : 'text-cyan-700'
          )}
        />
        <span
          className={cn(
            'text-[9px] font-bold tracking-[0.3em]',
            theme === 'dark' ? 'text-slate-500' : 'text-gray-600'
          )}
          style={{ writingMode: 'vertical-rl' as const }}
        >
          LOG
        </span>
      </button>

      <AnimatePresence>
        {logPanelOpen && (
          <>
            <motion.button
              type="button"
              aria-label="关闭日志遮罩"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] lg:bg-black/40"
              onClick={() => setLogPanelOpen(false)}
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="fixed top-0 right-0 z-50 h-full w-[min(100vw,400px)] flex flex-col border-l border-cyan-500/20 bg-[#0c101a]/98 shadow-[-12px_0_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            >
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm truncate">
                  <ScrollText className="w-4 h-4 shrink-0" />
                  Activity Log · 实时生产动态
                </div>
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded-lg border border-slate-700"
                  onClick={() => setLogPanelOpen(false)}
                >
                  关闭
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {activityLogs.length === 0 ? (
                  <p className="text-slate-600 text-xs text-center py-8">暂无操作记录</p>
                ) : (
                  activityLogs.map((log) => (
                    <div
                      key={log.id}
                      className="text-[11px] font-mono text-slate-400 leading-relaxed bg-slate-950/60 border border-slate-800/80 rounded-xl px-2.5 py-2"
                    >
                      {log.text}
                    </div>
                  ))
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
