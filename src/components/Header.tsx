'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  LayoutDashboard,
  Bot,
  Plus,
  UploadCloud,
  Eraser,
  Trash2,
  Search,
  Edit3,
  ClipboardCheck,
  BellRing,
  UserCheck,
  LogOut,
  LayoutGrid,
  List,
  Gauge,
  Sun,
  Moon,
  RefreshCw,
} from 'lucide-react';
import { Order, ViewMode, MainAppView, ActivityLogEntry, AndonNotification } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS, ROLE_SHORT } from '@/types/auth';
import type { AppTheme, LayoutMode } from '@/lib/uiTheme';
import {
  cn,
  headerBar,
  headerTitle,
  headerMuted,
  headerInput,
  headerSelect,
  headerBtnGhost,
} from '@/lib/uiTheme';

interface HeaderProps {
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  layoutMode: LayoutMode;
  setLayoutMode: React.Dispatch<React.SetStateAction<LayoutMode>>;
  theme: AppTheme;
  setTheme: React.Dispatch<React.SetStateAction<AppTheme>>;
  orders: Order[];
  isProcessing: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  triggerBatchAISchedule: () => void;
  setIsAddModalOpen: (val: boolean) => void;
  triggerClearCompletedData: () => void;
  triggerClearAllData: () => void;
  dailyCapacity: number;
  setDailyCapacity: (val: number) => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  statusFilter: string;
  setStatusFilter: (val: string) => void;
  pendingQCCount: number;
  onOpenQCReview: () => void;
  mainAppView: MainAppView;
  setMainAppView: React.Dispatch<React.SetStateAction<MainAppView>>;
  andonNotifications: AndonNotification[];
  onResolveAndon: (orderId: string) => void;
  activityLogs: ActivityLogEntry[];
  auditModalOpen: boolean;
  setAuditModalOpen: (v: boolean) => void;
  /** false = 已成功從伺服器載入資料庫首包；true = 逾時或失敗，使用預設本地資料 */
  offlineMode: boolean;
  /** 手動從雲端重新拉取訂單／設定 */
  onSyncRefresh: () => void | Promise<void>;
  /** 手動同步進行中（按鈕 loading） */
  isSyncing: boolean;
}

export default function Header({
  viewMode,
  setViewMode,
  layoutMode,
  setLayoutMode,
  theme,
  setTheme,
  orders,
  isProcessing,
  fileInputRef,
  handleFileUpload,
  triggerBatchAISchedule,
  setIsAddModalOpen,
  triggerClearCompletedData,
  triggerClearAllData,
  dailyCapacity,
  setDailyCapacity,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  pendingQCCount,
  onOpenQCReview,
  mainAppView,
  setMainAppView,
  andonNotifications,
  onResolveAndon,
  activityLogs,
  auditModalOpen,
  setAuditModalOpen,
  offlineMode,
  onSyncRefresh,
  isSyncing,
}: HeaderProps) {
  const { user, logout } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const handleEditCapacity = () => {
    const input = window.prompt('请输入新的每日排产工时上限（分钟）：', String(dailyCapacity));
    if (input !== null) {
      const num = parseInt(input, 10);
      if (!isNaN(num) && num > 0) {
        setDailyCapacity(num);
      }
    }
  };

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    if (notifOpen) document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [notifOpen]);

  const warehouseUrgent = user?.role === 'Warehouse' && andonNotifications.length > 0;

  return (
    <>
      {viewMode === 'workshop' && (
        <header
          className={cn(
            'z-30 shrink-0 border-b backdrop-blur-xl',
            headerBar(theme)
          )}
        >
          <div className="w-full max-w-full min-w-0 overflow-x-auto scrollbar-hide [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center gap-3 px-2 py-4 md:px-6">
            <span className={cn('shrink-0 whitespace-nowrap text-sm font-black tracking-tight', headerTitle(theme))}>
              车间大屏
            </span>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
                offlineMode
                  ? theme === 'dark'
                    ? 'bg-amber-950/60 text-amber-300 border-amber-500/30'
                    : 'bg-amber-50 text-amber-900 border-amber-300'
                  : theme === 'dark'
                    ? 'bg-cyan-950/60 text-cyan-300 border-cyan-500/25'
                    : 'bg-cyan-50 text-cyan-900 border-cyan-300'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  offlineMode ? 'bg-amber-400' : 'bg-cyan-400 animate-pulse'
                )}
              />
              {offlineMode ? '離線' : '雲端已連線'}
            </span>
            <button
              type="button"
              onClick={() => void onSyncRefresh()}
              disabled={isSyncing}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-black shadow-[0_0_16px_rgba(34,211,238,0.15)] transition-all',
                theme === 'dark'
                  ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600/90 border-cyan-400/40 text-white hover:from-cyan-500 hover:to-blue-500'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 border-cyan-400 text-white hover:opacity-95',
                isSyncing && 'opacity-80 cursor-wait'
              )}
              title="從雲端重新載入訂單與設定"
            >
              {isSyncing ? (
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" aria-hidden />
              ) : (
                <span className="shrink-0" aria-hidden>
                  🔄
                </span>
              )}
              同步/刷新
            </button>
            <button
              type="button"
              onClick={() => setViewMode('manager')}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-cyan-500/50 px-3 py-2 text-sm font-bold text-cyan-500',
                theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-100 hover:bg-gray-200'
              )}
            >
              排产视图
            </button>
            </div>
          </div>
        </header>
      )}

      {viewMode === 'manager' && (
        <header
          className={cn(
            'z-30 shrink-0 border-b backdrop-blur-xl transition-all duration-300',
            headerBar(theme)
          )}
        >
          <div className="w-full max-w-full min-w-0 overflow-x-auto scrollbar-hide [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center gap-3 px-2 py-4 md:px-6">
            <div className="shrink-0 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 p-2.5 shadow-[0_0_24px_rgba(34,211,238,0.35)]">
              <LayoutDashboard className="h-6 w-6 text-white" />
            </div>
            <div className="flex shrink-0 flex-col justify-center gap-1 pr-1">
              <div className="flex items-center gap-2">
                <h1
                  className={cn(
                    'whitespace-nowrap text-lg font-bold tracking-tight md:text-xl',
                    headerTitle(theme)
                  )}
                >
                  线束车间数字化排产大屏
                </h1>
                {user && (
                  <span className="shrink-0 whitespace-nowrap rounded-lg border border-cyan-500/30 bg-cyan-950/50 px-2 py-0.5 font-mono text-[10px] text-cyan-400/90 sm:text-xs">
                    {user.username} · {ROLE_LABELS[user.role]} ({ROLE_SHORT[user.role]})
                  </span>
                )}
              </div>
            </div>
            <div
              className={cn(
                'hidden h-10 w-px shrink-0 sm:block',
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'
              )}
            />
            {user?.role === 'Boss' && (
              <div
                className={cn(
                  'flex shrink-0 overflow-hidden rounded-xl border p-0.5 shadow-inner',
                  theme === 'dark'
                    ? 'border-cyan-500/30 bg-slate-950/60'
                    : 'border-cyan-400/40 bg-gray-100'
                )}
              >
                <button
                  type="button"
                  onClick={() => setMainAppView('kanban')}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-black transition-all duration-300 ${
                    mainAppView === 'kanban'
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_16px_rgba(34,211,238,0.4)]'
                      : theme === 'dark'
                        ? 'text-slate-500 hover:text-slate-300'
                        : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <LayoutGrid className="h-4 w-4 shrink-0" />
                  看板模式
                </button>
                <button
                  type="button"
                  onClick={() => setMainAppView('dashboard')}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-black transition-all duration-300 ${
                    mainAppView === 'dashboard'
                      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-[0_0_16px_rgba(167,139,250,0.4)]'
                      : theme === 'dark'
                        ? 'text-slate-500 hover:text-slate-300'
                        : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Gauge className="h-4 w-4 shrink-0" />
                  仪表盘
                </button>
              </div>
            )}
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
                offlineMode
                  ? theme === 'dark'
                    ? 'border-amber-500/30 bg-amber-950/60 text-amber-300'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                  : theme === 'dark'
                    ? 'border-cyan-500/25 bg-cyan-950/60 text-cyan-300'
                    : 'border-cyan-300 bg-cyan-50 text-cyan-900'
              )}
              title={
                offlineMode
                  ? '首包資料未從伺服器取得（逾時或錯誤），畫面為預設空資料'
                  : '已從雲端 PostgreSQL 同步首包資料'
              }
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full animate-pulse',
                  offlineMode ? 'bg-amber-400' : 'bg-cyan-400'
                )}
              />
              {offlineMode ? '離線預設 · 未同步資料庫' : '雲端資料庫已連線'}
            </span>
            <button
              type="button"
              onClick={() => void onSyncRefresh()}
              disabled={isSyncing}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-black shadow-[0_0_14px_rgba(34,211,238,0.12)] transition-all',
                theme === 'dark'
                  ? 'border-cyan-400/35 bg-gradient-to-r from-cyan-600/85 to-blue-600/85 text-white hover:from-cyan-500 hover:to-blue-500'
                  : 'border-cyan-400 bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-95',
                isSyncing && 'cursor-wait opacity-80'
              )}
              title="從雲端重新載入訂單與設定"
            >
              {isSyncing ? (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <span className="shrink-0" aria-hidden>
                  🔄
                </span>
              )}
              同步/刷新
            </button>
            <span className={cn('shrink-0 whitespace-nowrap text-sm font-medium', headerMuted(theme))}>
              总计 <strong className="text-lg text-cyan-500">{orders.length}</strong> 份排单
            </span>
            <span
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-sm font-medium transition-colors',
                theme === 'dark'
                  ? 'border-slate-700/50 bg-slate-800/50 text-slate-400 hover:bg-slate-700/80'
                  : 'border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
              onClick={handleEditCapacity}
              title="点击修改日上限"
            >
              单日上限: <strong className="text-indigo-500">{dailyCapacity}</strong> 分钟
              <Edit3 size={12} className={cn('ml-1', theme === 'dark' ? 'text-slate-500' : 'text-gray-500')} />
            </span>
            <div
              className={cn(
                'hidden h-10 w-px shrink-0 md:block',
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'
              )}
            />
            <div
              className={cn(
                'flex h-10 shrink-0 overflow-hidden rounded-xl border',
                theme === 'dark' ? 'border-slate-600 bg-slate-900/80' : 'border-gray-300 bg-gray-100'
              )}
              title="看板视图：卡片 / 精简列表"
            >
              <button
                type="button"
                onClick={() => setLayoutMode('card')}
                className={cn(
                  'flex shrink-0 items-center justify-center px-2.5 transition-colors',
                  layoutMode === 'card'
                    ? theme === 'dark'
                      ? 'bg-cyan-600/40 text-cyan-400'
                      : 'bg-gray-200 text-gray-900'
                    : headerMuted(theme)
                )}
                aria-pressed={layoutMode === 'card'}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('compact')}
                className={cn(
                  'flex shrink-0 items-center justify-center border-l px-2.5 transition-colors',
                  layoutMode === 'compact'
                    ? theme === 'dark'
                      ? 'bg-cyan-600/40 text-cyan-400'
                      : 'bg-gray-200 text-gray-900'
                    : headerMuted(theme),
                  theme === 'dark' ? 'border-slate-600' : 'border-gray-300'
                )}
                aria-pressed={layoutMode === 'compact'}
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border transition-all',
                headerBtnGhost(theme)
              )}
              title={theme === 'dark' ? '切換為白晝模式' : '切換為深色模式'}
              aria-label={theme === 'dark' ? '白晝模式' : '深色模式'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-700" />}
            </button>

            <div ref={notifRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className={`relative flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-bold transition-all duration-300 ${
                  warehouseUrgent
                    ? 'bg-red-950/80 border-red-500 text-red-300 animate-pulse shadow-[0_0_22px_rgba(239,68,68,0.45)]'
                    : theme === 'dark'
                      ? 'bg-slate-800/80 border-slate-600 text-slate-200 hover:border-red-500/40'
                      : 'bg-gray-100 border-gray-300 text-gray-900 hover:border-red-400'
                }`}
              >
                <BellRing
                  className={`w-5 h-5 ${andonNotifications.length > 0 ? 'text-red-400' : theme === 'dark' ? 'text-slate-500' : 'text-gray-500'}`}
                />
                <span>安灯调度</span>
                {andonNotifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white border border-red-400">
                    {andonNotifications.length}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 mt-2 w-[min(100vw-24px,380px)] rounded-2xl border border-red-500/30 bg-slate-950/95 backdrop-blur-xl shadow-[0_0_40px_rgba(239,68,68,0.15)] z-[80] overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-red-950/40">
                      <span className="text-sm font-black text-red-300">安灯调度通知中心</span>
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-slate-300"
                        onClick={() => setNotifOpen(false)}
                      >
                        关闭
                      </button>
                    </div>
                    <div className="max-h-[min(60vh,320px)] overflow-y-auto custom-scrollbar p-2 space-y-2">
                      {andonNotifications.length === 0 ? (
                        <p className="text-center text-slate-600 text-xs py-8">暂无待处理安灯</p>
                      ) : (
                        andonNotifications.map((n) => (
                          <div
                            key={n.id}
                            className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-xs"
                          >
                            <p className="text-slate-300 leading-relaxed mb-2">{n.message}</p>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  onResolveAndon(n.orderId);
                                  setNotifOpen(false);
                                }}
                                className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-emerald-600/80 text-white hover:bg-emerald-500"
                              >
                                已解决
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              type="button"
              onClick={() => setAuditModalOpen(true)}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border transition-all duration-300',
                theme === 'dark'
                  ? 'border-slate-600 bg-slate-800/80 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/40'
                  : 'border-gray-300 bg-white text-gray-600 hover:text-cyan-700 hover:border-cyan-400'
              )}
              title="审计日志"
            >
              <UserCheck className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => logout()}
              className={cn(
                'flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-xs font-bold transition-all',
                theme === 'dark'
                  ? 'border-slate-600 bg-slate-900/80 text-slate-400 hover:text-red-400 hover:border-red-500/40'
                  : 'border-gray-300 bg-white text-gray-700 hover:text-red-600 hover:border-red-400'
              )}
            >
              <LogOut className="w-4 h-4" />
              退出
            </button>

            <div
              className={cn(
                'hidden h-8 w-px shrink-0 sm:block',
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'
              )}
            />

            <div
              className={cn(
                'flex h-10 min-w-[180px] w-[180px] flex-1 shrink-0 items-center overflow-hidden rounded-xl border px-2 shadow-inner sm:min-w-[240px] sm:w-[240px]',
                headerInput(theme)
              )}
            >
              <Search size={16} className={cn('mr-2 shrink-0', theme === 'dark' ? 'text-slate-500' : 'text-gray-500')} />
              <input
                type="text"
                placeholder="搜索客户 / 型号..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn(
                  'min-w-0 w-full flex-1 border-none bg-transparent text-sm outline-none',
                  theme === 'dark' ? 'text-slate-200 placeholder:text-slate-600' : 'text-gray-900 placeholder:text-gray-500'
                )}
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={cn(
                'h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-xl border px-3 text-sm outline-none',
                headerSelect(theme)
              )}
            >
              <option value="all">所有状态</option>
              <option value="normal">正常排产</option>
              <option value="anomaly">异常告警</option>
              <option value="completed">已完成</option>
              <option value="pendingQC">待质检</option>
              <option value="rework">返工</option>
            </select>

            {pendingQCCount > 0 && (
              <button
                type="button"
                onClick={onOpenQCReview}
                className="hidden h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-500/50 bg-amber-600/30 px-3 text-sm font-bold text-amber-200 transition-all hover:bg-amber-600/50 sm:flex"
              >
                <ClipboardCheck size={18} />
                质检审核
              </button>
            )}

            <div className="hidden h-8 w-px shrink-0 bg-slate-700 lg:block" />

            <button
              type="button"
              onClick={triggerBatchAISchedule}
              disabled={isProcessing}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-blue-500/50 px-4 py-2 text-sm font-bold shadow-[0_0_12px_rgba(59,130,246,0.2)] transition-all',
                theme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-900',
                isProcessing && 'opacity-70 cursor-wait'
              )}
            >
              {isProcessing ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Bot size={18} strokeWidth={2.5} />
              )}
              <span className="hidden xl:inline">⚡ AI 排产</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-blue-500/50 px-3 py-2 text-sm font-bold shadow-[0_0_8px_rgba(59,130,246,0.2)] transition-all',
                theme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
              )}
            >
              <Plus size={18} strokeWidth={3} /> <span className="hidden sm:inline">录入</span>
            </button>

            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={isProcessing}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-blue-500/50 px-3 py-2 text-sm font-bold text-blue-500 transition-all',
                theme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700'
                  : 'bg-gray-100 hover:bg-gray-200',
                isProcessing && 'opacity-70 cursor-wait'
              )}
            >
              <UploadCloud size={18} strokeWidth={2.5} />
              <span className="hidden lg:inline">Excel</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode((v) => (v === 'manager' ? 'workshop' : 'manager'))}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-cyan-500/50 px-3 py-2 text-sm font-bold text-cyan-500 transition-all',
                theme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700'
                  : 'bg-gray-100 hover:bg-gray-200'
              )}
            >
              {viewMode === 'manager' ? '车间大屏' : '排产视图'}
            </button>

            <button
              type="button"
              onClick={triggerClearCompletedData}
              disabled={isProcessing}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-bold transition-all',
                theme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300',
                isProcessing && 'opacity-70 cursor-wait'
              )}
              title="仅清除已完成"
            >
              <Eraser size={18} strokeWidth={2.5} className="text-slate-400" />
              <span className="hidden xl:inline">清理完成</span>
            </button>

            <button
              type="button"
              onClick={triggerClearAllData}
              disabled={isProcessing}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-red-500/50 px-3 py-2 text-sm font-bold text-red-500 transition-all',
                theme === 'dark'
                  ? 'bg-slate-900 hover:bg-red-950/50'
                  : 'bg-white hover:bg-red-50',
                isProcessing && 'opacity-70 cursor-wait'
              )}
              title="清空全部"
            >
              <Trash2 size={18} strokeWidth={2.5} />
              <span className="hidden xl:inline">清盘</span>
            </button>
            </div>
          </div>
        </header>
      )}

      <AnimatePresence>
        {auditModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
            onClick={() => setAuditModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 12 }}
              transition={{ duration: 0.25 }}
              className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-cyan-500/25 bg-slate-950/95 shadow-[0_0_60px_rgba(34,211,238,0.12)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/80">
                <h2 className="text-lg font-black text-cyan-400 flex items-center gap-2">
                  <UserCheck className="w-5 h-5" />
                  审计日志流水
                </h2>
                <button
                  type="button"
                  onClick={() => setAuditModalOpen(false)}
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                {activityLogs.length === 0 ? (
                  <p className="text-center text-slate-600 py-12 text-sm">暂无记录</p>
                ) : (
                  activityLogs.map((log) => (
                    <div
                      key={log.id}
                      className="text-[12px] font-mono text-slate-400 leading-relaxed bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2"
                    >
                      {log.text}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
