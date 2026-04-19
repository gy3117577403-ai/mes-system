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
  Monitor,
  BarChart3,
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
  /** 打開本週生產執行審計全屏層 */
  onOpenProductionAudit: () => void;
  /** 批次導入／新建：相對週位移（-1…2）→ 週一 yyyy-MM-dd */
  weekOffset: number;
  setWeekOffset: (v: number) => void;
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
  onOpenProductionAudit,
  weekOffset,
  setWeekOffset,
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
          <div className="flex w-full flex-nowrap items-center gap-1 overflow-hidden px-1 py-1.5 sm:gap-2">
            <span
              className={cn(
                'max-w-[4.5rem] shrink-0 truncate text-xs font-black tracking-tight sm:max-w-[6rem] sm:text-sm',
                headerTitle(theme)
              )}
              title="车间大屏"
            >
              车间大屏
            </span>
            <div
              role="status"
              className={cn(
                'h-3 w-3 shrink-0 rounded-full sm:h-4 sm:w-4',
                offlineMode
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.55)]'
                  : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
              )}
              title={
                offlineMode
                  ? '離線：無法從伺服器載入資料或已逾時'
                  : '云端资料库已连线'
              }
            />
            <button
              type="button"
              onClick={() => void onSyncRefresh()}
              disabled={isSyncing}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-black shadow-[0_0_12px_rgba(34,211,238,0.12)] transition-all md:h-10 md:w-10 md:rounded-xl',
                theme === 'dark'
                  ? 'border-cyan-400/40 bg-gradient-to-r from-cyan-600/90 to-blue-600/90 text-white hover:from-cyan-500 hover:to-blue-500'
                  : 'border-cyan-400 bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-95',
                isSyncing && 'cursor-wait opacity-80'
              )}
              title="從雲端重新載入訂單與設定"
              aria-label="從雲端重新載入訂單與設定"
            >
              {isSyncing ? (
                <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <span className="shrink-0" aria-hidden>
                  🔄
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onOpenProductionAudit()}
              className={cn(
                'flex h-9 max-w-full shrink-0 items-center justify-center gap-1 rounded-lg border border-amber-500/40 px-2 text-amber-300 md:h-10 md:rounded-xl md:px-2.5',
                theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-100 hover:bg-gray-200'
              )}
              title="📊 全局效能审计"
              aria-label="📊 全局效能审计"
            >
              <BarChart3 className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" strokeWidth={2.25} aria-hidden />
              <span className="hidden max-w-[9rem] truncate text-[10px] font-black sm:inline md:max-w-[11rem] md:text-xs">
                📊 全局效能审计
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('manager')}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-500/50 text-cyan-500 md:h-10 md:w-10 md:rounded-xl',
                theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-100 hover:bg-gray-200'
              )}
              title="排产视图"
              aria-label="排产视图"
            >
              <Monitor className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" strokeWidth={2.25} aria-hidden />
            </button>
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
          <div className="flex w-full flex-nowrap items-center gap-1 overflow-hidden px-1 py-1.5 sm:gap-2">
            <div className="flex shrink-0 items-center gap-1">
              <div className="rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 p-1 shadow-[0_0_20px_rgba(34,211,238,0.3)] md:rounded-xl md:p-1.5 lg:p-2.5">
                <LayoutDashboard className="h-4 w-4 text-white md:h-5 md:w-5 lg:h-6 lg:w-6" />
              </div>
              {user && (
                <span
                  className={cn(
                    'max-w-[6rem] shrink-0 truncate rounded border border-cyan-500/30 bg-cyan-950/50 px-2 py-1 font-mono text-[9px] sm:max-w-[8rem] sm:text-[10px] md:text-xs',
                    theme === 'dark' ? 'text-cyan-400/90' : 'text-cyan-800'
                  )}
                  title={
                    user.username.trim()
                      ? `${user.username} · ${ROLE_LABELS[user.role]}`
                      : ROLE_LABELS[user.role]
                  }
                >
                  {ROLE_LABELS[user.role]} ({ROLE_SHORT[user.role]})
                </span>
              )}
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
                  'flex h-8 shrink-0 items-center overflow-hidden rounded-lg border p-0.5 shadow-inner md:h-9 md:rounded-xl',
                  theme === 'dark'
                    ? 'border-cyan-500/30 bg-slate-950/60'
                    : 'border-cyan-400/40 bg-gray-100'
                )}
              >
                <button
                  type="button"
                  onClick={() => setMainAppView('kanban')}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black transition-all duration-300 md:h-9 md:w-9 ${
                    mainAppView === 'kanban'
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_16px_rgba(34,211,238,0.4)]'
                      : theme === 'dark'
                        ? 'text-slate-500 hover:text-slate-300'
                        : 'text-gray-500 hover:text-gray-800'
                  }`}
                  title="看板模式"
                  aria-label="看板模式"
                >
                  <LayoutGrid className="h-3.5 w-3.5 shrink-0 md:h-4 md:w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMainAppView('dashboard')}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black transition-all duration-300 md:h-9 md:w-9 ${
                    mainAppView === 'dashboard'
                      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-[0_0_16px_rgba(167,139,250,0.4)]'
                      : theme === 'dark'
                        ? 'text-slate-500 hover:text-slate-300'
                        : 'text-gray-500 hover:text-gray-800'
                  }`}
                  title="仪表盘"
                  aria-label="仪表盘"
                >
                  <Gauge className="h-3.5 w-3.5 shrink-0 md:h-4 md:w-4" />
                </button>
              </div>
            )}
            <div
              role="status"
              className={cn(
                'h-3 w-3 shrink-0 rounded-full sm:h-4 sm:w-4',
                offlineMode
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.55)]'
                  : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
              )}
              title={
                offlineMode
                  ? '離線：無法從伺服器載入資料或已逾時（使用預設本地資料）'
                  : '云端资料库已连线'
              }
            />
            <button
              type="button"
              onClick={() => void onSyncRefresh()}
              disabled={isSyncing}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-black shadow-[0_0_12px_rgba(34,211,238,0.12)] transition-all md:h-10 md:w-10 md:rounded-xl',
                theme === 'dark'
                  ? 'border-cyan-400/35 bg-gradient-to-r from-cyan-600/85 to-blue-600/85 text-white hover:from-cyan-500 hover:to-blue-500'
                  : 'border-cyan-400 bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-95',
                isSyncing && 'cursor-wait opacity-80'
              )}
              title="從雲端重新載入訂單與設定"
              aria-label="從雲端重新載入訂單與設定"
            >
              {isSyncing ? (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin md:h-4 md:w-4" aria-hidden />
              ) : (
                <span className="shrink-0" aria-hidden>
                  🔄
                </span>
              )}
            </button>
            <span
              className={cn(
                'shrink-0 whitespace-nowrap px-0 text-[10px] font-medium leading-none sm:text-xs',
                headerMuted(theme)
              )}
            >
              计<strong className="text-cyan-500 sm:text-sm">{orders.length}</strong>单
            </span>
            <span
              className={cn(
                'flex h-7 shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap rounded border px-0.5 py-0 text-[10px] font-medium transition-colors sm:h-8 sm:text-xs md:h-9 md:rounded-md md:px-1',
                theme === 'dark'
                  ? 'border-slate-700/50 bg-slate-800/50 text-slate-400 hover:bg-slate-700/80'
                  : 'border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
              onClick={handleEditCapacity}
              title="点击修改日上限"
            >
              <span className="hidden xl:inline-block">上限 </span>
              <strong className="text-indigo-500">{dailyCapacity}</strong>
              <span className="hidden xl:inline-block">′</span>
              <Edit3 className={cn('h-3 w-3 shrink-0 md:h-3.5 md:w-3.5', theme === 'dark' ? 'text-slate-500' : 'text-gray-500')} />
            </span>
            <div
              className={cn(
                'hidden h-10 w-px shrink-0 md:block',
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'
              )}
            />
            <div
              className={cn(
                'flex h-9 shrink-0 overflow-hidden rounded-lg border md:h-10 md:rounded-xl',
                theme === 'dark' ? 'border-slate-600 bg-slate-900/80' : 'border-gray-300 bg-gray-100'
              )}
              title="看板视图：卡片 / 精简列表"
            >
              <button
                type="button"
                onClick={() => setLayoutMode('card')}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center transition-colors md:h-10 md:w-10',
                  layoutMode === 'card'
                    ? theme === 'dark'
                      ? 'bg-cyan-600/40 text-cyan-400'
                      : 'bg-gray-200 text-gray-900'
                    : headerMuted(theme)
                )}
                aria-pressed={layoutMode === 'card'}
              >
                <LayoutGrid className="h-4 w-4 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('compact')}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center border-l transition-colors md:h-10 md:w-10',
                  layoutMode === 'compact'
                    ? theme === 'dark'
                      ? 'bg-cyan-600/40 text-cyan-400'
                      : 'bg-gray-200 text-gray-900'
                    : headerMuted(theme),
                  theme === 'dark' ? 'border-slate-600' : 'border-gray-300'
                )}
                aria-pressed={layoutMode === 'compact'}
              >
                <List className="h-4 w-4 shrink-0" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all md:h-10 md:w-10 md:rounded-xl',
                headerBtnGhost(theme)
              )}
              title={theme === 'dark' ? '切換為白晝模式' : '切換為深色模式'}
              aria-label={theme === 'dark' ? '白晝模式' : '深色模式'}
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 shrink-0 text-amber-400 md:h-5 md:w-5" />
              ) : (
                <Moon className="h-4 w-4 shrink-0 text-slate-700 md:h-5 md:w-5" />
              )}
            </button>

            <div ref={notifRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                title="安灯调度"
                aria-label="安灯调度"
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition-all duration-300 md:h-10 md:w-10 md:rounded-xl md:text-sm ${
                  warehouseUrgent
                    ? 'bg-red-950/80 border-red-500 text-red-300 animate-pulse shadow-[0_0_22px_rgba(239,68,68,0.45)]'
                    : theme === 'dark'
                      ? 'bg-slate-800/80 border-slate-600 text-slate-200 hover:border-red-500/40'
                      : 'bg-gray-100 border-gray-300 text-gray-900 hover:border-red-400'
                }`}
              >
                <BellRing
                  className={`h-4 w-4 shrink-0 md:h-5 md:w-5 ${andonNotifications.length > 0 ? 'text-red-400' : theme === 'dark' ? 'text-slate-500' : 'text-gray-500'}`}
                />
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
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 md:h-10 md:w-10 md:rounded-xl',
                theme === 'dark'
                  ? 'border-slate-600 bg-slate-800/80 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/40'
                  : 'border-gray-300 bg-white text-gray-600 hover:text-cyan-700 hover:border-cyan-400'
              )}
              title="审计日志"
            >
              <UserCheck className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
            </button>

            <button
              type="button"
              onClick={() => onOpenProductionAudit()}
              className={cn(
                'flex h-9 max-w-full shrink-0 items-center justify-center gap-1 rounded-lg border px-1.5 transition-all duration-300 md:h-10 md:rounded-xl md:px-2',
                theme === 'dark'
                  ? 'border-slate-600 bg-slate-800/80 text-slate-400 hover:text-amber-300 hover:border-amber-500/40'
                  : 'border-gray-300 bg-white text-gray-600 hover:text-amber-700 hover:border-amber-400'
              )}
              title="📊 全局效能审计"
              aria-label="📊 全局效能审计"
            >
              <BarChart3 className="h-4 w-4 shrink-0 md:h-5 md:w-5" strokeWidth={2.25} aria-hidden />
              <span className="hidden max-w-[9rem] truncate text-[10px] font-black sm:inline md:max-w-[11rem] md:text-xs">
                📊 全局效能审计
              </span>
            </button>

            <button
              type="button"
              onClick={() => logout()}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-bold transition-all md:h-10 md:rounded-xl md:px-2.5',
                theme === 'dark'
                  ? 'border-slate-600 bg-slate-900/80 text-slate-400 hover:text-red-400 hover:border-red-500/40'
                  : 'border-gray-300 bg-white text-gray-700 hover:text-red-600 hover:border-red-400'
              )}
              title="退出"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline-block">退出</span>
            </button>

            <div
              className={cn(
                'hidden h-8 w-px shrink-0 sm:block',
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'
              )}
            />

            <div
              className={cn(
                'flex h-8 max-w-[200px] min-w-[60px] w-16 flex-1 shrink items-center overflow-hidden rounded-lg border px-1 shadow-inner sm:h-9 sm:w-24 md:w-32 md:rounded-xl md:px-1.5 lg:w-48 lg:px-2',
                headerInput(theme)
              )}
            >
              <Search size={14} className={cn('mr-1 shrink-0 md:mr-2 md:h-4 md:w-4', theme === 'dark' ? 'text-slate-500' : 'text-gray-500')} />
              <input
                type="text"
                placeholder="搜索客户 / 型号..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn(
                  'min-w-0 w-full flex-1 border-none bg-transparent text-xs outline-none md:text-sm',
                  theme === 'dark' ? 'text-slate-200 placeholder:text-slate-600' : 'text-gray-900 placeholder:text-gray-500'
                )}
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={cn(
                'h-9 min-w-0 max-w-[5.25rem] shrink-0 cursor-pointer truncate rounded-lg border px-1.5 text-[11px] outline-none sm:max-w-[6.5rem] sm:px-2 md:h-10 md:max-w-none md:rounded-xl md:px-3 md:text-sm',
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
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/50 bg-amber-600/30 text-xs font-bold text-amber-200 transition-all hover:bg-amber-600/50 sm:flex md:h-10 md:w-10 md:rounded-xl md:text-sm"
                title="质检审核"
                aria-label="质检审核"
              >
                <ClipboardCheck className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" />
              </button>
            )}

            <div className="hidden h-8 w-px shrink-0 bg-slate-700 lg:block" />

            <button
              type="button"
              onClick={triggerBatchAISchedule}
              disabled={isProcessing}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-500/50 text-xs font-bold shadow-[0_0_10px_rgba(59,130,246,0.2)] transition-all md:h-10 md:w-10 md:rounded-xl md:text-sm',
                theme === 'dark'
                  ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200',
                isProcessing && 'cursor-wait opacity-70'
              )}
              title="AI 排产"
              aria-label="AI 排产"
            >
              {isProcessing ? (
                <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent md:h-4 md:w-4" />
              ) : (
                <Bot className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" strokeWidth={2.5} />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-500/50 text-xs font-bold shadow-[0_0_8px_rgba(59,130,246,0.2)] transition-all md:h-10 md:w-10 md:rounded-xl md:text-sm',
                theme === 'dark'
                  ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              )}
              title="录入"
              aria-label="录入"
            >
              <Plus className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" strokeWidth={3} />
            </button>

            <label className="flex shrink-0 flex-col justify-center">
              <span className="sr-only">排产周</span>
              <select
                value={weekOffset}
                onChange={(e) => setWeekOffset(Number(e.target.value))}
                className={cn(
                  'h-9 max-w-[10.5rem] shrink-0 cursor-pointer truncate rounded-md border px-1.5 py-1 text-[11px] font-bold outline-none sm:max-w-[12rem] md:h-10 md:max-w-[13rem] md:px-2 md:text-xs',
                  theme === 'dark'
                    ? 'border-slate-700 bg-slate-800 text-slate-200'
                    : 'border-gray-300 bg-white text-gray-900'
                )}
                title="导入/新建订单绑定至所选周的周一（上海时区）"
                aria-label="智能相对周排产"
              >
                <option value={0} className={theme === 'dark' ? 'bg-slate-900' : ''}>
                  本周排产计划
                </option>
                <option value={1} className={theme === 'dark' ? 'bg-slate-900' : ''}>
                  下周排产计划
                </option>
                <option value={2} className={theme === 'dark' ? 'bg-slate-900' : ''}>
                  下下周计划
                </option>
                <option value={-1} className={theme === 'dark' ? 'bg-slate-900' : ''}>
                  上周补录
                </option>
              </select>
            </label>

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
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-500/50 text-xs font-bold text-blue-500 transition-all md:h-10 md:w-10 md:rounded-xl md:text-sm',
                theme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700'
                  : 'bg-gray-100 hover:bg-gray-200',
                isProcessing && 'cursor-wait opacity-70'
              )}
              title="Excel 导入"
              aria-label="Excel 导入"
            >
              <UploadCloud className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" strokeWidth={2.5} />
            </button>

            <button
              type="button"
              onClick={() => setViewMode((v) => (v === 'manager' ? 'workshop' : 'manager'))}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-500/50 text-xs font-bold text-cyan-500 transition-all md:h-10 md:w-10 md:rounded-xl md:text-sm',
                theme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700'
                  : 'bg-gray-100 hover:bg-gray-200'
              )}
              title={viewMode === 'manager' ? '车间大屏' : '排产视图'}
              aria-label={viewMode === 'manager' ? '车间大屏' : '排产视图'}
            >
              <Monitor className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" strokeWidth={2.25} />
            </button>

            <button
              type="button"
              onClick={triggerClearCompletedData}
              disabled={isProcessing}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition-all md:h-10 md:w-10 md:rounded-xl md:text-sm',
                theme === 'dark'
                  ? 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  : 'border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200',
                isProcessing && 'cursor-wait opacity-70'
              )}
              title="仅清除已完成"
              aria-label="仅清除已完成"
            >
              <Eraser className="h-4 w-4 shrink-0 text-slate-400 md:h-[18px] md:w-[18px]" strokeWidth={2.5} />
            </button>

            <button
              type="button"
              onClick={triggerClearAllData}
              disabled={isProcessing}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-500/50 text-xs font-bold text-red-500 transition-all md:h-10 md:w-10 md:rounded-xl md:text-sm',
                theme === 'dark'
                  ? 'bg-slate-900 hover:bg-red-950/50'
                  : 'bg-white hover:bg-red-50',
                isProcessing && 'cursor-wait opacity-70'
              )}
              title="清空全部"
              aria-label="清空全部"
            >
              <Trash2 className="h-4 w-4 shrink-0 md:h-[18px] md:w-[18px]" strokeWidth={2.5} />
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
