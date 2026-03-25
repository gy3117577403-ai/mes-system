/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Minus,
  Square,
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

  const electron =
    typeof window !== 'undefined' && (window as any).require
      ? (window as any).require('electron')
      : null;
  const ipcRenderer = electron ? electron.ipcRenderer : null;

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

  const titleBar =
    theme === 'dark'
      ? 'bg-slate-950 border-slate-800'
      : 'bg-gray-100 border-gray-200';
  const titleBarText = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const titleBarBtn = theme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200' : 'hover:bg-gray-200 text-gray-600 hover:text-gray-900';

  return (
    <>
      <div
        className={cn('h-8 flex justify-between items-center shrink-0 border-b select-none', titleBar)}
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center pl-3 gap-2">
          <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-white rounded-full" />
          </div>
          <span className={cn('text-[11px] font-medium tracking-wider', titleBarText)}>GGG-AI SYSTEM</span>
        </div>
        <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            type="button"
            onClick={() => ipcRenderer?.send('window-min')}
            className={cn('h-full px-4 transition-colors flex items-center justify-center', titleBarBtn)}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={() => ipcRenderer?.send('window-max')}
            className={cn('h-full px-4 transition-colors flex items-center justify-center', titleBarBtn)}
          >
            <Square size={12} />
          </button>
          <button
            type="button"
            onClick={() => ipcRenderer?.send('window-close')}
            className="h-full px-4 hover:bg-red-600 text-slate-400 hover:text-white transition-colors flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {viewMode === 'workshop' && (
        <header
          className={cn(
            'backdrop-blur-xl px-4 md:px-6 py-2 z-30 shrink-0 flex flex-wrap justify-between items-center gap-3 border-b',
            headerBar(theme)
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={cn('text-sm font-black tracking-tight', headerTitle(theme))}>车间大屏</span>
            <span
              className={cn(
                'flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium border',
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
                  'w-1.5 h-1.5 rounded-full',
                  offlineMode ? 'bg-amber-400' : 'bg-cyan-400 animate-pulse'
                )}
              />
              {offlineMode ? '離線' : '雲端已連線'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onSyncRefresh()}
              disabled={isSyncing}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-black border transition-all shadow-[0_0_16px_rgba(34,211,238,0.15)]',
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
                'text-cyan-500 border border-cyan-500/50 px-3 py-2 rounded-xl flex items-center gap-2 font-bold text-sm',
                theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-100 hover:bg-gray-200'
              )}
            >
              排产视图
            </button>
          </div>
        </header>
      )}

      {viewMode === 'manager' && (
        <header
          className={cn(
            'backdrop-blur-xl px-4 md:px-6 py-2 z-30 shrink-0 flex flex-wrap justify-between items-center gap-3 transition-all duration-300',
            headerBar(theme)
          )}
        >
          <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
            <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-2.5 rounded-xl shadow-[0_0_24px_rgba(34,211,238,0.35)] shrink-0">
              <LayoutDashboard className="text-white w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1
                  className={cn(
                    'text-xl md:text-2xl font-bold tracking-tight truncate',
                    headerTitle(theme)
                  )}
                >
                  线束车间数字化排产大屏
                </h1>
                {user && (
                  <span className="text-xs font-mono text-cyan-400/90 bg-cyan-950/50 border border-cyan-500/30 px-2 py-0.5 rounded-lg shrink-0">
                    {user.username} · {ROLE_LABELS[user.role]} ({ROLE_SHORT[user.role]})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {user?.role === 'Boss' && (
                  <div
                    className={cn(
                      'flex rounded-xl overflow-hidden border p-0.5 shadow-inner',
                      theme === 'dark'
                        ? 'border-cyan-500/30 bg-slate-950/60'
                        : 'border-cyan-400/40 bg-gray-100'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setMainAppView('kanban')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all duration-300 ${
                        mainAppView === 'kanban'
                          ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_16px_rgba(34,211,238,0.4)]'
                          : theme === 'dark'
                            ? 'text-slate-500 hover:text-slate-300'
                            : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <LayoutGrid className="w-4 h-4" />
                      看板模式
                    </button>
                    <button
                      type="button"
                      onClick={() => setMainAppView('dashboard')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all duration-300 ${
                        mainAppView === 'dashboard'
                          ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-[0_0_16px_rgba(167,139,250,0.4)]'
                          : theme === 'dark'
                            ? 'text-slate-500 hover:text-slate-300'
                            : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Gauge className="w-4 h-4" />
                      仪表盘
                    </button>
                  </div>
                )}
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium border',
                    offlineMode
                      ? theme === 'dark'
                        ? 'bg-amber-950/60 text-amber-300 border-amber-500/30'
                        : 'bg-amber-50 text-amber-900 border-amber-300'
                      : theme === 'dark'
                        ? 'bg-cyan-950/60 text-cyan-300 border-cyan-500/25'
                        : 'bg-cyan-50 text-cyan-900 border-cyan-300'
                  )}
                  title={
                    offlineMode
                      ? '首包資料未從伺服器取得（逾時或錯誤），畫面為預設空資料'
                      : '已從雲端 PostgreSQL 同步首包資料'
                  }
                >
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full animate-pulse',
                      offlineMode ? 'bg-amber-400' : 'bg-cyan-400'
                    )}
                  />{' '}
                  {offlineMode ? '離線預設 · 未同步資料庫' : '雲端資料庫已連線'}
                </span>
                <button
                  type="button"
                  onClick={() => void onSyncRefresh()}
                  disabled={isSyncing}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black border transition-all shadow-[0_0_14px_rgba(34,211,238,0.12)]',
                    theme === 'dark'
                      ? 'bg-gradient-to-r from-cyan-600/85 to-blue-600/85 border-cyan-400/35 text-white hover:from-cyan-500 hover:to-blue-500'
                      : 'bg-gradient-to-r from-cyan-500 to-blue-600 border-cyan-400 text-white hover:opacity-95',
                    isSyncing && 'opacity-80 cursor-wait'
                  )}
                  title="從雲端重新載入訂單與設定"
                >
                  {isSyncing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
                  ) : (
                    <span className="shrink-0" aria-hidden>
                      🔄
                    </span>
                  )}
                  同步/刷新
                </button>
                <span className={cn('text-sm font-medium', headerMuted(theme))}>
                  总计 <strong className="text-cyan-500 text-lg">{orders.length}</strong> 份排单
                </span>
                <span
                  className={cn(
                    'text-sm font-medium flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer transition-colors border',
                    theme === 'dark'
                      ? 'text-slate-400 bg-slate-800/50 hover:bg-slate-700/80 border-slate-700/50'
                      : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border-gray-300'
                  )}
                  onClick={handleEditCapacity}
                  title="点击修改日上限"
                >
                  单日上限: <strong className="text-indigo-500">{dailyCapacity}</strong> 分钟
                  <Edit3 size={12} className={cn('ml-1', theme === 'dark' ? 'text-slate-500' : 'text-gray-500')} />
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:gap-3 justify-end">
            <div
              className={cn(
                'flex rounded-xl border overflow-hidden h-10 shrink-0',
                theme === 'dark' ? 'border-slate-600 bg-slate-900/80' : 'border-gray-300 bg-gray-100'
              )}
              title="看板视图：卡片 / 精简列表"
            >
              <button
                type="button"
                onClick={() => setLayoutMode('card')}
                className={cn(
                  'px-2.5 flex items-center justify-center transition-colors',
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
                  'px-2.5 flex items-center justify-center transition-colors border-l',
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
                'h-10 w-10 flex items-center justify-center rounded-xl border transition-all shrink-0',
                headerBtnGhost(theme)
              )}
              title={theme === 'dark' ? '切換為白晝模式' : '切換為深色模式'}
              aria-label={theme === 'dark' ? '白晝模式' : '深色模式'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-700" />}
            </button>

            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className={`relative flex items-center gap-2 h-10 px-3 rounded-xl border text-sm font-bold transition-all duration-300 ${
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
                'h-10 w-10 flex items-center justify-center rounded-xl border transition-all duration-300',
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
                'h-10 flex items-center gap-1.5 px-3 rounded-xl border text-xs font-bold transition-all',
                theme === 'dark'
                  ? 'border-slate-600 bg-slate-900/80 text-slate-400 hover:text-red-400 hover:border-red-500/40'
                  : 'border-gray-300 bg-white text-gray-700 hover:text-red-600 hover:border-red-400'
              )}
            >
              <LogOut className="w-4 h-4" />
              退出
            </button>

            <div className={cn('w-px h-8 hidden sm:block', theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300')} />

            <div
              className={cn(
                'flex items-center rounded-xl overflow-hidden h-10 px-2 shadow-inner border',
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
                  'bg-transparent border-none outline-none text-sm w-28 sm:w-36 focus:w-44 transition-all',
                  theme === 'dark' ? 'text-slate-200 placeholder:text-slate-600' : 'text-gray-900 placeholder:text-gray-500'
                )}
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={cn('h-10 px-3 rounded-xl text-sm outline-none cursor-pointer border', headerSelect(theme))}
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
                className="hidden sm:flex items-center gap-1.5 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/50 text-amber-200 h-10 px-3 rounded-xl text-sm font-bold transition-all"
              >
                <ClipboardCheck size={18} />
                质检审核
              </button>
            )}

            <div className="w-px h-8 bg-slate-700 hidden lg:block" />

            <button
              type="button"
              onClick={triggerBatchAISchedule}
              disabled={isProcessing}
              className={cn(
                'border border-blue-500/50 px-4 py-2 rounded-xl shadow-[0_0_12px_rgba(59,130,246,0.2)] flex items-center gap-2 transition-all font-bold text-sm',
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
                'border border-blue-500/50 px-3 py-2 rounded-xl shadow-[0_0_8px_rgba(59,130,246,0.2)] flex items-center gap-2 transition-all font-bold text-sm',
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
                'text-blue-500 border border-blue-500/50 px-3 py-2 rounded-xl flex items-center gap-2 transition-all font-bold text-sm',
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
                'text-cyan-500 border border-cyan-500/50 px-3 py-2 rounded-xl flex items-center gap-2 transition-all font-bold text-sm',
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
                'border px-3 py-2 rounded-xl flex items-center gap-2 transition-all font-bold text-sm',
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
                'text-red-500 border border-red-500/50 px-3 py-2 rounded-xl flex items-center gap-2 transition-all font-bold text-sm',
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
