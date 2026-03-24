/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { Toaster, toast } from 'react-hot-toast';
import { AlertTriangle, Info } from 'lucide-react';
import { DropResult } from '@hello-pangea/dnd';

import {
  Order,
  ViewMode,
  DAYS,
  ActivityLogEntry,
  AlarmKind,
  MainAppView,
  AuditActionType,
  AndonNotification,
} from '@/types';
import Header from '@/components/Header';
import KanbanBoard from '@/components/KanbanBoard';
import WorkshopView from '@/components/WorkshopView';
import BossDashboard from '@/components/BossDashboard';
import { AddOrderModal } from '@/components/Modals';
import QCReviewModal from '@/components/QCReviewModal';
import { normalizeOrder } from '@/lib/mesOrder';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS } from '@/types/auth';
import { canUseKanbanDnD } from '@/lib/rbac';
import type { AppTheme, LayoutMode } from '@/lib/uiTheme';
import { pageShell, alertBanner, cn } from '@/lib/uiTheme';
import {
  fetchInitialData,
  createOrderAction,
  updateOrderAction,
  addWorkerAction,
  createActivityLogAction,
  patchMesSettingsAction,
  softDeleteOrdersAction,
  type FetchInitialDataResult,
} from '@/actions/mesActions';
import { diffOrder } from '@/lib/orderDiff';

const ALARM_MSG: Record<AlarmKind, string> = {
  Material: '物料准备',
  Maintenance: '设备维修',
  QC: '质检支援',
};

export default function KanbanApp() {
  const router = useRouter();
  const { user, isHydrated, logout } = useAuth();
  /** 僅在客戶端掛載完成後為 true，與 SSR 首屏一致，避免 Hydration mismatch */
  const [isMounted, setIsMounted] = useState(false);
  /** 已從 SQLite（Prisma）載入首包資料 */
  const [dataReady, setDataReady] = useState(false);
  /** 載入失敗／逾時：僅用預設本地資料，不阻塞 UI */
  const [offlineMode, setOfflineMode] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [workers, setWorkers] = useState<string[]>([]);

  const [dailyCapacity, setDailyCapacity] = useState<number>(980);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  /** 車間操作流水（倒序由展示端處理；此處最新在前） */
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('manager');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('card');
  const [theme, setTheme] = useState<AppTheme>('dark');
  const [mainAppView, setMainAppView] = useState<MainAppView>('kanban');

  const appendAuditLog = useCallback(
    (actionType: AuditActionType, description: string) => {
      if (!user) return;
      const time = dayjs().format('HH:mm');
      const roleLabel = ROLE_LABELS[user.role];
      const text = `${time} - ${roleLabel}${user.username} ${description}`;
      const entry = {
        id: uuidv4(),
        ts: Date.now(),
        text,
        operator: user.username,
        role: user.role,
        actionType,
      };
      setActivityLogs((prev) => [entry, ...prev].slice(0, 500));
      void createActivityLogAction(entry);
    },
    [user]
  );

  /** 車間流水等：併入審計格式 */
  const appendActivityLog = useCallback(
    (actionLabel: string, description: string) => {
      if (!user) {
        const time = dayjs().format('HH:mm');
        const text = `${time} - [${actionLabel}] ${description}`;
        const entry = { id: uuidv4(), ts: Date.now(), text };
        setActivityLogs((prev) => [entry, ...prev].slice(0, 500));
        void createActivityLogAction(entry);
        return;
      }
      appendAuditLog('legacy', `[${actionLabel}] ${description}`);
    },
    [user, appendAuditLog]
  );

  useEffect(() => {
    queueMicrotask(() => setIsMounted(true));
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (!user) router.replace('/login');
  }, [isHydrated, user, router]);

  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => {
      setMainAppView(user.role === 'Boss' ? 'dashboard' : 'kanban');
    }, 0);
    return () => window.clearTimeout(t);
  }, [user]);

  useEffect(() => {
    if (!isMounted || !user) {
      if (!user) {
        const t = window.setTimeout(() => setDataReady(false), 0);
        return () => window.clearTimeout(t);
      }
      return;
    }
    let cancelled = false;
    /* 載入開始前須同步重置，避免與下方 fetch 完成回調的競態 */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional load lifecycle reset
    setDataReady(false);
    setOfflineMode(false);

    const clientFallback: FetchInitialDataResult = {
      ok: false,
      error: 'CLIENT_TIMEOUT',
      orders: [],
      workers: ['1号员工', '2号员工'],
      activityLogs: [],
      dailyCapacity: 980,
      theme: 'dark',
      layoutMode: 'card',
    };

    /** 若 Server Action 長時間無回應，避免永遠卡在「載入中」 */
    const CLIENT_MAX_MS = 12000;

    void (async () => {
      const res = await Promise.race([
        fetchInitialData(),
        new Promise<FetchInitialDataResult>((resolve) =>
          setTimeout(() => resolve(clientFallback), CLIENT_MAX_MS)
        ),
      ]);
      if (cancelled) return;
      setOrders(res.orders ?? []);
      setWorkers(res.workers ?? ['1号员工', '2号员工']);
      setActivityLogs(res.activityLogs ?? []);
      setDailyCapacity(res.dailyCapacity);
      setTheme(res.theme);
      setLayoutMode(res.layoutMode);
      if (!res.ok) {
        setOfflineMode(true);
        console.error('fetchInitialData:', res.error);
        if (res.error === 'LOAD_TIMEOUT') {
          toast.error('資料庫讀取逾時，已進入離線模式');
        } else if (res.error === 'CLIENT_TIMEOUT') {
          toast.error('資料載入逾時，已進入離線模式');
        } else {
          toast.error('載入資料失敗，已進入離線模式（使用預設值）');
        }
      }
      setDataReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isMounted, user]);

  const setDailyCapacityPersist = useCallback((val: number) => {
    setDailyCapacity(val);
    void patchMesSettingsAction({ dailyCapacity: val });
  }, []);

  const setThemePersist = useCallback((v: React.SetStateAction<AppTheme>) => {
    setTheme((prev) => {
      const next = typeof v === 'function' ? (v as (p: AppTheme) => AppTheme)(prev) : v;
      queueMicrotask(() => {
        void patchMesSettingsAction({ theme: next });
      });
      return next;
    });
  }, []);

  const setLayoutModePersist = useCallback((v: React.SetStateAction<LayoutMode>) => {
    setLayoutMode((prev) => {
      const next = typeof v === 'function' ? (v as (p: LayoutMode) => LayoutMode)(prev) : v;
      queueMicrotask(() => {
        void patchMesSettingsAction({ layoutMode: next });
      });
      return next;
    });
  }, []);

  const handleAddWorkerMes = useCallback((name: string) => {
    const n = name.trim();
    if (!n) return;
    setWorkers((prev) => (prev.includes(n) ? prev : [...prev, n]));
    void addWorkerAction(n);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [qcReviewOpen, setQcReviewOpen] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState({
    client: '',
    model: '',
    qty: 1,
    totalHours: 30,
    deliveryDate: '',
    sales: '跟单员',
    autoSchedule: true,
    isUrgent: false,
  });

  const [dialog, setDialog] = useState({
    isOpen: false,
    type: 'alert', 
    title: '',
    message: '',
    onConfirm: null as any
  });

  const showAlert = (title: string, message: string) => {
    toast(message, {
      icon: 'ℹ️',
      duration: 4000
    });
  };

  const showConfirm = (title: string, message: string, onConfirmCallback: () => void) => {
    setDialog({ isOpen: true, type: 'confirm', title, message, onConfirm: onConfirmCallback });
  };

  // 工业级防呆逻辑：实时锁定已占用的周转箱编号
  const occupiedBoxes = useMemo(
    () =>
      orders
        .filter((o) => o.taskStatus !== 'completed' && o.boxNumber)
        .map((o) => o.boxNumber as number),
    [orders]
  );

  const pendingQCCount = useMemo(
    () => orders.filter((o) => o.taskStatus === 'PendingQC').length,
    [orders]
  );

  const alarmCount = useMemo(
    () => orders.filter((o) => o.activeAlarm != null && o.taskStatus !== 'completed').length,
    [orders]
  );

  const andonNotifications = useMemo<AndonNotification[]>(() => {
    return orders
      .filter((o) => o.activeAlarm != null && o.taskStatus !== 'completed')
      .map((o) => ({
        id: `andon-${o.id}-${o.activeAlarm}`,
        ts: o.createdAt,
        orderId: o.id,
        model: o.model,
        kind: o.activeAlarm!,
        message: `${dayjs(o.createdAt).format('HH:mm')} - 车间 ${o.model} 型号呼叫${ALARM_MSG[o.activeAlarm!]}`,
        resolved: false,
      }));
  }, [orders]);

  const onResolveAndon = useCallback(
    (orderId: string) => {
      setOrders((prev) =>
        prev.map((x) => (x.id === orderId ? { ...x, activeAlarm: null } : x))
      );
      void updateOrderAction(orderId, { activeAlarm: null });
      if (user) {
        appendAuditLog('alarm_resolve', `${user.username} 解决了安灯呼叫`);
      }
    },
    [user, appendAuditLog]
  );

  // ==========================================
  // 3. 核心业务规则与三大状态池 (隔离、待排产、已排产)
  // ==========================================
  const getCardStatus = (task: Order) => {
    if (task.taskStatus === 'completed') return 'completed';
    if (task.taskStatus === 'PendingQC') return 'pendingQC';
    if (task.taskStatus === 'Rework') return 'rework';
    if (task.taskStatus === 'anomaly') return 'anomaly';
    if (task.isImportError) return 'red';

    const isReady = task.drawing === '已发' && ['料齐', '已配料'].includes(task.materials);
    const isScheduled = task.assignedDay !== 'Unscheduled';

    if (isReady) return 'green';
    if (!isReady && isScheduled) return 'red';
    return 'yellow';
  };

  const filteredOrders = useMemo(() => {
    return orders.filter(t => {
      // 搜索过滤
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!t.client.toLowerCase().includes(query) && !t.model.toLowerCase().includes(query)) {
          return false;
        }
      }
      // 状态过滤
      if (statusFilter !== 'all') {
        if (statusFilter === 'completed' && t.taskStatus !== 'completed') return false;
        if (statusFilter === 'normal' && t.taskStatus !== 'normal') return false;
        if (statusFilter === 'anomaly' && t.taskStatus !== 'anomaly') return false;
        if (statusFilter === 'pendingQC' && t.taskStatus !== 'PendingQC') return false;
        if (statusFilter === 'rework' && t.taskStatus !== 'Rework') return false;
      }
      return true;
    });
  }, [orders, searchQuery, statusFilter]);

  const redAlertTasks = useMemo(() => filteredOrders.filter(t => getCardStatus(t) === 'red' || t.taskStatus === 'anomaly'), [filteredOrders]);

  /** 左側三池：技術 / 倉庫 / 就緒（僅就緒可拖入日曆） */
  const { techPoolOrders, warehousePoolOrders, readyPoolOrders } = useMemo(() => {
    const tech: Order[] = [];
    const wh: Order[] = [];
    const ready: Order[] = [];

    filteredOrders.forEach((task) => {
      if (task.taskStatus === 'completed') return;
      if (task.taskStatus === 'PendingQC') return;
      if (task.assignedDay !== 'Unscheduled') return;

      const drawingOk = task.drawing === '已发';
      const materialOk = ['料齐', '已配料'].includes(task.materials);

      if (!drawingOk) {
        tech.push(task);
      } else if (task.isUrgent) {
        // 急單：僅需圖紙已發即可進入就緒池，無視物料
        ready.push(task);
      } else if (!materialOk) {
        wh.push(task);
      } else {
        ready.push(task);
      }
    });

    return {
      techPoolOrders: tech,
      warehousePoolOrders: wh,
      readyPoolOrders: ready,
    };
  }, [filteredOrders]);

  // ==========================================
  // 4. 数据操作与 AI 分配算法 (纯内存版)
  // ==========================================
  const findBestDayForTaskTime = (taskTime: number, currentOrdersExcludingTask: Order[]) => {
    const currentLoads: Record<string, number> = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0 };
    currentOrdersExcludingTask.forEach(task => {
      if (task.taskStatus !== 'completed' && task.assignedDay !== 'Unscheduled' && DAYS.find(d => d.key === task.assignedDay)) {
        currentLoads[task.assignedDay] += (Number(task.totalHours) || 0);
      }
    });

    const workDays = DAYS.slice(0, 5).map(d => d.key);
    workDays.sort((a, b) => currentLoads[a] - currentLoads[b]);

    for (const dayKey of workDays) {
      if (currentLoads[dayKey] + taskTime <= dailyCapacity) return dayKey;
    }

    if (currentLoads['Saturday'] + taskTime <= dailyCapacity) return 'Saturday';
    
    let 分钟LoadDay = DAYS[0].key;
    let 分钟Load = currentLoads[DAYS[0].key];
    for (const day of DAYS) {
      if (currentLoads[day.key] < 分钟Load) {
        分钟Load = currentLoads[day.key];
        分钟LoadDay = day.key;
      }
    }
    return 分钟LoadDay;
  };

  const updateOrderData = useCallback(
    (orderId: string, field: string, value: any) => {
      setOrders((prev) => {
        const o = prev.find((x) => x.id === orderId);
        if (o && user) {
          if (field === 'drawing') {
            queueMicrotask(() =>
              appendAuditLog('upload_sop', `将 ${o.model} 图纸状态更新为 ${value}`)
            );
          }
          if (field === 'materials') {
            queueMicrotask(() =>
              appendAuditLog('material_change', `将 ${o.model} 配料更新为 ${value}`)
            );
          }
        }
        return prev.map((order) =>
          order.id === orderId ? { ...order, [field]: value } : order
        );
      });
      void updateOrderAction(orderId, { [field]: value });
    },
    [user, appendAuditLog]
  );

  const submitProgressReport = useCallback(
    (orderId: string, amount: number) => {
      let blocked = false;
      let patch: { reportedQty: number; taskStatus?: string } | null = null;
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o;
          const next = o.reportedQty + amount;
          if (next > o.totalQty) {
            blocked = true;
            return o;
          }
          if (next === o.totalQty) {
            queueMicrotask(() =>
              appendActivityLog('進度提報', `訂單 ${o.model} 已報滿 ${o.totalQty}，流轉待質檢`)
            );
            patch = { reportedQty: next, taskStatus: 'PendingQC' };
            return { ...o, reportedQty: next, taskStatus: 'PendingQC' };
          }
          queueMicrotask(() =>
            appendActivityLog('進度提報', `訂單 ${o.model} 本次 +${amount}，累計 ${next}/${o.totalQty}`)
          );
          patch = { reportedQty: next };
          return { ...o, reportedQty: next };
        })
      );
      if (blocked) {
        toast.error('累計報工不能超過總數');
        return;
      }
      if (patch) void updateOrderAction(orderId, patch);
      toast.success('進度已更新');
    },
    [appendActivityLog]
  );

  const approveQC = useCallback(
    (orderId: string) => {
      setOrders((prev) => {
        const o = prev.find((x) => x.id === orderId);
        if (o) {
          queueMicrotask(() =>
            appendActivityLog('質檢通過', `訂單 ${o.model} 質檢通過，已完結`)
          );
        }
        return prev.map((x) => (x.id === orderId ? { ...x, taskStatus: 'completed' } : x));
      });
      void updateOrderAction(orderId, { taskStatus: 'completed' });
      toast.success('質檢通過');
    },
    [appendActivityLog]
  );

  const rejectToRework = useCallback(
    (orderId: string) => {
      setOrders((prev) => {
        const o = prev.find((x) => x.id === orderId);
        if (o) {
          queueMicrotask(() =>
            appendActivityLog(
              '質檢打回',
              `訂單 ${o.model} 已返工，退回待派工（原 ${o.worker || '—'}）`
            )
          );
        }
        return prev.map((x) =>
          x.id === orderId
            ? {
                ...x,
                taskStatus: 'Rework',
                assignedDay: 'Unscheduled',
                reportedQty: 0,
                activeAlarm: null,
              }
            : x
        );
      });
      void updateOrderAction(orderId, {
        taskStatus: 'Rework',
        assignedDay: 'Unscheduled',
        reportedQty: 0,
        activeAlarm: null,
      });
      toast.error('已打回返工');
    },
    [appendActivityLog]
  );

  const setOrderAlarm = useCallback(
    (orderId: string, alarm: AlarmKind | null) => {
      setOrders((prev) => {
        const o = prev.find((x) => x.id === orderId);
        if (!o) return prev;
        if (alarm) {
          queueMicrotask(() =>
            appendActivityLog('安燈', `訂單 ${o.model} 發起 ${alarm}`)
          );
        } else if (o.activeAlarm) {
          queueMicrotask(() => appendActivityLog('安燈解除', `訂單 ${o.model} 已解除呼叫`));
        }
        return prev.map((x) => (x.id === orderId ? { ...x, activeAlarm: alarm } : x));
      });
      void updateOrderAction(orderId, { activeAlarm: alarm });
    },
    [appendActivityLog]
  );

  const handleAddOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (newOrderForm.qty <= 0 || newOrderForm.totalHours <= 0) {
      toast.error("排产数量和所需工时必须大于 0！");
      return;
    }
    
    try {
      const newId = uuidv4();
      let targetDay = 'Unscheduled';
      if (newOrderForm.autoSchedule) {
        targetDay = findBestDayForTaskTime(Number(newOrderForm.totalHours) || 0, orders);
      }

      const newOrder = normalizeOrder({
        id: newId,
        client: newOrderForm.client,
        model: newOrderForm.model,
        qty: newOrderForm.qty,
        totalHours: newOrderForm.totalHours,
        sales: newOrderForm.sales,
        deliveryDate: newOrderForm.deliveryDate,
        drawing: '未发图',
        materials: '未配料',
        assignedDay: targetDay,
        taskStatus: 'normal',
        cutStatus: 'pending',
        boxNumber: null,
        createdAt: Date.now(),
        totalQty: newOrderForm.qty,
        reportedQty: 0,
        drawingUrl: '',
        activeAlarm: null,
        isUrgent: newOrderForm.isUrgent === true,
      });

      setOrders((prev) => [newOrder, ...prev]);
      void createOrderAction(newOrder);
      setIsAddModalOpen(false);
      setNewOrderForm({
        client: '',
        model: '',
        qty: 1,
        totalHours: 30,
        deliveryDate: '',
        sales: '跟单员',
        autoSchedule: true,
        isUrgent: false,
      });
    } catch (e: any) {
      showAlert("错误", "新增失败：" + e.message);
    }
  };

  const triggerClearCompletedData = () => {
    const completedOrders = orders.filter(t => t.taskStatus === 'completed');
    if (completedOrders.length === 0) {
      showAlert("提示", "当前没有已完成的订单需要清理。");
      return;
    }
    showConfirm(
      "🧹 清理确认",
      `将从看板中永久移除 ${completedOrders.length} 份【已完成】的订单记录。\n未完成的排单将予以保留，确定执行清理吗？`,
      () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        setOrders(prev => prev.filter(t => t.taskStatus !== 'completed'));
        void softDeleteOrdersAction('completed');
        showAlert("成功", "已完成的订单清理完毕！");
      }
    );
  };

  const triggerClearAllData = () => {
    if (orders.length === 0) {
      showAlert("提示", "当前看板已为空，无需清盘。");
      return;
    }
    showConfirm(
      "🚨 新周期清盘确认",
      "此操作将彻底清空当前看板上的【所有数据】！\n是否确认清盘并开启全新的排产周期？",
      () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        setOrders([]);
        void softDeleteOrdersAction('all');
        showAlert("成功", "看板数据已彻底清空，您可以导入新一周期的排单了！");
      }
    );
  };

  const triggerBatchAISchedule = () => {
    const aiEligiblePool = readyPoolOrders.filter((o) => !o.isUrgent);
    if (aiEligiblePool.length === 0) {
      if (readyPoolOrders.length > 0) {
        showAlert(
          "提示",
          "就绪池中仅有【急单】或为空：急单不会进入 AI 自动排产，请计划员手动拖拽到日历。"
        );
      } else {
        showAlert("提示", "当前没有待排产的订单，无需执行AI排产。");
      }
      return;
    }
    showConfirm(
      "🤖 启动 AI 智能排产",
      `将对就绪池中「非急单」自动分配（急单已被排除，仅可手动拖拽）。\n优先周一至周五，超出负荷则安排周六。\n确定执行吗？`,
      () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        setIsProcessing(true);
        try {
          const ordersBeforeAi = orders;
          const currentLoads: Record<string, number> = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0 };
          orders.forEach(task => {
            if (task.taskStatus !== 'completed' && task.assignedDay !== 'Unscheduled' && DAYS.find(d => d.key === task.assignedDay)) {
              currentLoads[task.assignedDay] += (Number(task.totalHours) || 0);
            }
          });

          const today = dayjs();
          const isDeliverySoon = (dateStr: string) =>
            dayjs(dateStr).isBefore(today.add(2, 'day'), 'day');

          const tasksToSchedule = [...aiEligiblePool].map((t) => ({ ...t }));
          let successCount = 0;
          const updatedOrders = [...orders];

          const workDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

          while (tasksToSchedule.length > 0) {
            tasksToSchedule.sort((a, b) => {
              const aU = isDeliverySoon(a.deliveryDate) ? -1 : 1;
              const bU = isDeliverySoon(b.deliveryDate) ? -1 : 1;
              if (aU !== bU) return aU - bU;
              const tA = new Date(a.deliveryDate).getTime() || 9999999999999;
              const tB = new Date(b.deliveryDate).getTime() || 9999999999999;
              return tA - tB;
            });

            const task = tasksToSchedule.shift()!;
            const taskTime = Number(task.totalHours) || 0;
            let assignedDay: string | null = null;

            const sortedDays = [...workDays].sort((a, b) => currentLoads[a] - currentLoads[b]);
            for (const dayKey of sortedDays) {
              if (currentLoads[dayKey] + taskTime <= dailyCapacity) {
                assignedDay = dayKey;
                break;
              }
            }

            if (!assignedDay && currentLoads['Saturday'] + taskTime <= dailyCapacity) {
              assignedDay = 'Saturday';
            }

            if (assignedDay) {
              const orderIndex = updatedOrders.findIndex(o => o.id === task.id);
              if (orderIndex !== -1) {
                updatedOrders[orderIndex] = { ...updatedOrders[orderIndex], assignedDay };
              } else {
                updatedOrders.push({ ...task, assignedDay });
              }
              currentLoads[assignedDay] += taskTime;
              successCount++;
              continue;
            }

            // If doesn't fit entirely, check if urgent and needs to evict（交期最远优先，其次工时最大）
            if (isDeliverySoon(task.deliveryDate)) {
              let evictCandidate: Order | null = null;
              let evictDay: string | null = null;
              let bestDel = -Infinity;
              let bestHrs = -Infinity;

              for (const day of [...workDays, 'Saturday']) {
                const dayTasks = updatedOrders.filter(
                  (t) =>
                    t.assignedDay === day &&
                    t.taskStatus !== 'completed' &&
                    !isDeliverySoon(t.deliveryDate)
                );
                for (const dt of dayTasks) {
                  const dtH = Number(dt.totalHours) || 0;
                  if (currentLoads[day] - dtH + taskTime <= dailyCapacity) {
                    const del = new Date(dt.deliveryDate).getTime() || 0;
                    const hrs = dtH;
                    if (del > bestDel || (del === bestDel && hrs > bestHrs)) {
                      bestDel = del;
                      bestHrs = hrs;
                      evictCandidate = dt;
                      evictDay = day;
                    }
                  }
                }
              }

              if (evictCandidate && evictDay) {
                const eIdx = updatedOrders.findIndex((o) => o.id === evictCandidate!.id);
                if (eIdx !== -1) {
                  updatedOrders[eIdx] = { ...updatedOrders[eIdx], assignedDay: 'Unscheduled' };
                  currentLoads[evictDay] -= Number(evictCandidate.totalHours) || 0;
                  tasksToSchedule.push(updatedOrders[eIdx]);
                }

                const orderIndex = updatedOrders.findIndex((o) => o.id === task.id);
                if (orderIndex !== -1) {
                  updatedOrders[orderIndex] = { ...updatedOrders[orderIndex], assignedDay: evictDay };
                } else {
                  updatedOrders.push({ ...task, assignedDay: evictDay });
                }
                currentLoads[evictDay] += taskTime;
                successCount++;
                continue;
              }
            }

            // Must split
            const bestDay = [...workDays, 'Saturday'].reduce((a, b) => currentLoads[a] < currentLoads[b] ? a : b);
            const avail = dailyCapacity - currentLoads[bestDay];

            if (avail > 10) {
              const hA = avail;
              const hB = taskTime - avail;
              const totalQtyBase = task.totalQty || task.qty || 1;
              const qtyA = Math.max(1, Math.round((totalQtyBase * hA) / taskTime));
              const qtyB = Math.max(1, totalQtyBase - qtyA);
              const taskA = normalizeOrder({
                ...task,
                id: task.id,
                totalHours: hA,
                assignedDay: bestDay,
                totalQty: qtyA,
                qty: qtyA,
                reportedQty: 0,
              });
              const taskB = normalizeOrder({
                ...task,
                id: uuidv4(),
                model: `${task.model} (拆分)`,
                totalHours: hB,
                assignedDay: 'Unscheduled',
                totalQty: qtyB,
                qty: qtyB,
                reportedQty: 0,
              });

              const orderIndex = updatedOrders.findIndex(o => o.id === task.id);
              if (orderIndex !== -1) {
                updatedOrders[orderIndex] = taskA;
              } else {
                updatedOrders.push(taskA);
              }
              currentLoads[bestDay] += avail;
              successCount++;
              
              tasksToSchedule.push(taskB);
              updatedOrders.push(taskB);
            } else {
              const orderIndex = updatedOrders.findIndex(o => o.id === task.id);
              if (orderIndex !== -1) {
                updatedOrders[orderIndex] = { ...updatedOrders[orderIndex], assignedDay: bestDay };
              } else {
                updatedOrders.push({ ...task, assignedDay: bestDay });
              }
              currentLoads[bestDay] += taskTime;
              successCount++;
            }
          }
          
          setOrders(updatedOrders);
          const prevById = new Map(ordersBeforeAi.map((o) => [o.id, o]));
          for (const o of updatedOrders) {
            const prev = prevById.get(o.id);
            if (!prev) {
              void createOrderAction(o);
            } else {
              const d = diffOrder(prev, o);
              if (Object.keys(d).length > 0) void updateOrderAction(o.id, d);
            }
          }
          showAlert("✅ 排产完成", `已根据交期和日均上限，自动拆分并均衡排入了 ${successCount} 份订单。`);
        } catch (e: any) {
          showAlert("错误", `排产处理遇到异常：${e.message}`);
        }
        setIsProcessing(false);
      }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    
    try {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
          
          await processExcelData(jsonData);
        } catch (error: any) {
          console.error(error);
          toast.error("底层报错: " + (error.message || error));
          setIsProcessing(false);
        }
      };
      reader.onerror = (error) => {
        showAlert("文件读取失败", "无法读取上传的文件。");
        setIsProcessing(false);
      }
      reader.readAsArrayBuffer(file); 
    } catch (error: any) {
      showAlert("加载失败", "底层报错: " + (error.message || error));
      setIsProcessing(false);
    }
  };

  const processExcelData = async (rows: any[]) => {
    try {
      if (!rows || rows.length < 2) {
        showAlert("提示", "文件内容为空或格式不正确！");
        setIsProcessing(false);
        return;
      }

      let headerRowIndex = -1;
      let headers: string[] = [];

      // 智能雷达扫描前10行，寻找表头
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        if (!rows[i]) continue;
        const rowStrings = rows[i].map((h: any) => String(h || '').trim());
        const rowText = rowStrings.join('');
        if (rowText.includes('客户') && rowText.includes('型号')) {
          headerRowIndex = i;
          headers = rowStrings;
          break;
        }
      }

      if (headerRowIndex === -1) {
        showAlert("解析失败", "未能在前10行探测到有效的表头(缺少'客户'或'型号'列)！");
        setIsProcessing(false);
        return;
      }
      
      const idx = {
        sales: headers.findIndex((h: string) => h.includes('销售')),
        client: headers.findIndex((h: string) => h.includes('客户')),
        model: headers.findIndex((h: string) => h.includes('型号')),
        qty: headers.findIndex((h: string) => h.includes('数量')),
        hours: headers.findIndex((h: string) => h.includes('每款合计工时') || h.includes('合计工时') || h.includes('工时')),
        draw: headers.findIndex((h: string) => h.includes('图纸')),
        mat: headers.findIndex((h: string) => h.includes('配料')),
        del: headers.findIndex((h: string) => h.includes('交货') || h.includes('交期')),
      };

      const newOrders: Order[] = [];
      const baseTime = Date.now();

      // 从表头的下一行开始读取数据
      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const columns = rows[i];
        if (!columns || columns.length < 3) continue;

        const getCol = (index: number) => index >= 0 && index < columns.length ? String(columns[index]).trim() : '';

        const client = getCol(idx.client);
        const model = getCol(idx.model);
        
        // 跳过完全空行或合计行
        if (columns.join('').trim() === '' || client.includes('合计') || model.includes('合计')) continue;

        let isError = false;
        let errorReason = '';

        if (!client) {
          isError = true;
          errorReason = '缺少客户名称';
        } else if (!model) {
          isError = true;
          errorReason = '缺少产品型号';
        }

        const rawDate = getCol(idx.del);
        let formattedDate = rawDate;
        if (rawDate) {
          const parsedDay = dayjs(rawDate);
          if (parsedDay.isValid()) {
            formattedDate = parsedDay.format('YYYY-MM-DD');
          }
        }

        const newId = uuidv4();

        const qty = parseInt(getCol(idx.qty), 10) || 1;
        newOrders.push(
          normalizeOrder({
            id: newId,
            sales: getCol(idx.sales) || '系统导入',
            client: client || '未知客户',
            model: model || '未知型号',
            qty,
            totalHours: Number(getCol(idx.hours)) || 0,
            drawing: isError ? '错误' : getCol(idx.draw) || '未发图',
            materials: isError ? '错误' : getCol(idx.mat) || '未配料',
            deliveryDate: formattedDate,
            assignedDay: 'Unscheduled',
            taskStatus: 'normal',
            cutStatus: 'pending',
            boxNumber: null,
            createdAt: baseTime - i,
            isImportError: isError,
            errorReason: errorReason,
            totalQty: qty,
            reportedQty: 0,
            drawingUrl: '',
            activeAlarm: null,
          })
        );
      }
      
      if (newOrders.length > 0) {
        setOrders((prev) => [...newOrders, ...prev]);
        for (const o of newOrders) {
          void createOrderAction(o);
        }
      }
      toast.success(`成功导入 ${newOrders.length} 条订单！\n您现在可以点击顶部【⚡ 全局 AI 智能排产】进行分配。`);
    } catch (e: any) {
      console.error(e);
      showAlert("导入异常", "解析异常: " + (e.message || e));
    }
    
    setIsProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = ''; 
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (!user || !canUseKanbanDnD(user.role)) return;

    const { draggableId, destination, source } = result;
    const validDroppables = [
      'ReadyPool',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];

    if (!validDroppables.includes(destination.droppableId)) return;

    const nextDay =
      destination.droppableId === 'ReadyPool' ? 'Unscheduled' : destination.droppableId;

    if (source.droppableId !== destination.droppableId) {
      const o = orders.find((x) => x.id === draggableId);
      if (o && user) {
        appendAuditLog(
          'schedule_drag',
          `将 ${o.model} 调度至 ${nextDay === 'Unscheduled' ? '就绪待排池' : nextDay}`
        );
      }
    }

    updateOrderData(draggableId, 'assignedDay', nextDay);
  };

  const orderCardRbac = useMemo(
    () => ({
      role: user?.role ?? 'Employee',
    }),
    [user?.role]
  );

  // 與 SSR 首屏一致：僅掛載完成後再渲染依賴瀏覽器的完整 UI，避免 Hydration mismatch
  if (!isMounted) {
    return (
      <div
        className="h-screen w-full bg-slate-900 flex items-center justify-center"
        suppressHydrationWarning
      >
        <div
          className="flex flex-col items-center gap-4"
          aria-busy="true"
          aria-live="polite"
          suppressHydrationWarning
        >
          <div className="h-9 w-9 rounded-full border-2 border-slate-600 border-t-cyan-500 animate-spin" />
          <p className="text-slate-500 text-sm tracking-wide" suppressHydrationWarning>
            載入中…
          </p>
        </div>
      </div>
    );
  }

  if (!isHydrated || !user) {
    return (
      <div
        className="h-screen w-full bg-[#05080f] flex items-center justify-center"
        suppressHydrationWarning
      >
        <div className="h-10 w-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!dataReady) {
    return (
      <div
        className="h-screen w-full bg-[#070b12] flex flex-col items-center justify-center gap-4"
        suppressHydrationWarning
      >
        <div className="h-10 w-10 rounded-full border-2 border-slate-600 border-t-cyan-500 animate-spin" />
        <p className="text-slate-400 text-sm tracking-wide" suppressHydrationWarning>
          正在從本地資料庫同步…
        </p>
      </div>
    );
  }

  const toastSurface =
    theme === 'dark'
      ? { background: '#1e293b', color: '#f8fafc', border: '1px solid #334155' }
      : { background: '#ffffff', color: '#111827', border: '1px solid #d1d5db' };
  const toastIconSecondary = theme === 'dark' ? '#f8fafc' : '#111827';

  return (
    <div
      className={cn(
        'h-screen w-full font-sans flex flex-col overflow-hidden transition-colors duration-500',
        pageShell(theme)
      )}
      suppressHydrationWarning
    >
      <Toaster
        position="top-center"
        toastOptions={{
          style: toastSurface,
          success: { iconTheme: { primary: '#10b981', secondary: toastIconSecondary } },
          error: { iconTheme: { primary: '#ef4444', secondary: toastIconSecondary } },
        }}
      />

      {offlineMode && (
        <div
          role="status"
          className="shrink-0 border-b border-amber-600/40 bg-amber-950/90 px-4 py-2 text-center text-sm text-amber-100"
        >
          離線模式：無法從本地資料庫載入或已逾時，畫面使用預設資料；請檢查終端日誌或重新整理。
        </div>
      )}

      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutModePersist}
        theme={theme}
        setTheme={setThemePersist}
        orders={orders}
        isProcessing={isProcessing}
        fileInputRef={fileInputRef}
        handleFileUpload={handleFileUpload}
        triggerBatchAISchedule={triggerBatchAISchedule}
        setIsAddModalOpen={setIsAddModalOpen}
        triggerClearCompletedData={triggerClearCompletedData}
        triggerClearAllData={triggerClearAllData}
        dailyCapacity={dailyCapacity}
        setDailyCapacity={setDailyCapacityPersist}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        pendingQCCount={pendingQCCount}
        onOpenQCReview={() => setQcReviewOpen(true)}
        mainAppView={mainAppView}
        setMainAppView={setMainAppView}
        andonNotifications={andonNotifications}
        onResolveAndon={onResolveAndon}
        activityLogs={activityLogs}
        auditModalOpen={auditModalOpen}
        setAuditModalOpen={setAuditModalOpen}
      />

      {/* 浮动警报拦截横幅 */}
      {redAlertTasks.length > 0 && viewMode === 'manager' && (
        <div
          className={cn(
            'p-3 shrink-0 animate-in slide-in-from-top-2',
            alertBanner(theme)
          )}
        >
          <div className="flex items-start gap-3 max-w-[1600px] mx-auto">
            <AlertTriangle className="w-6 h-6 text-red-500 animate-pulse mt-0.5 shrink-0" />
            <div className="flex-1 overflow-hidden">
              <h3
                className={cn(
                  'font-bold text-sm mb-1',
                  theme === 'dark' ? 'text-red-400' : 'text-red-700'
                )}
              >
                ⚠️ 异常拦截：发现 {redAlertTasks.length} 份“缺料排产”或“车间报错”的订单！
              </h3>
              <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                {redAlertTasks.map((t: any) => (
                  <div
                    key={t.id}
                    className={cn(
                      'border px-2 py-0.5 rounded shadow-sm text-xs font-mono whitespace-nowrap shrink-0',
                      theme === 'dark'
                        ? 'bg-slate-800 border-red-800/50 text-red-400'
                        : 'bg-white border-red-300 text-red-700'
                    )}
                  >
                    {t.model} {t.taskStatus === 'anomaly' && '(车间提报异常)'}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 核心看板区域 */}
      {viewMode === 'workshop' ? (
        <WorkshopView
          orders={orders}
          updateOrderData={updateOrderData}
          occupiedBoxes={occupiedBoxes}
          workers={workers}
          setWorkers={setWorkers}
          setViewMode={setViewMode}
          dailyCapacity={dailyCapacity}
          activityLogs={activityLogs}
          appendActivityLog={appendActivityLog}
          submitProgressReport={submitProgressReport}
          setOrderAlarm={setOrderAlarm}
          alarmCount={alarmCount}
          theme={theme}
          setTheme={setThemePersist}
          onAddWorker={handleAddWorkerMes}
        />
      ) : user.role === 'Boss' && mainAppView === 'dashboard' ? (
        <BossDashboard orders={orders} />
      ) : (
        <KanbanBoard
          orders={filteredOrders}
          techPoolOrders={techPoolOrders}
          warehousePoolOrders={warehousePoolOrders}
          readyPoolOrders={readyPoolOrders}
          isProcessing={isProcessing}
          getCardStatus={getCardStatus}
          updateOrderData={updateOrderData}
          triggerBatchAISchedule={triggerBatchAISchedule}
          onDragEnd={onDragEnd}
          dailyCapacity={dailyCapacity}
          role={user.role}
          orderCardRbac={orderCardRbac}
          layoutMode={layoutMode}
          theme={theme}
        />
      )}

      <AddOrderModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        newOrderForm={newOrderForm}
        setNewOrderForm={setNewOrderForm}
        handleAddOrder={handleAddOrder}
      />

      <QCReviewModal
        isOpen={qcReviewOpen}
        onClose={() => setQcReviewOpen(false)}
        orders={orders}
        onApprove={approveQC}
        onReject={rejectToRework}
      />

      {/* 全局自定义弹窗组件 */}
      {dialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-100 flex items-center justify-center animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden transform scale-100 transition-transform">
            
            <div className={`px-6 py-4 flex items-center gap-3 text-white ${dialog.type === 'confirm' ? 'bg-orange-500' : 'bg-blue-600'}`}>
              {dialog.type === 'confirm' ? <AlertTriangle size={24} /> : <Info size={24} />}
              <h2 className="text-lg font-bold tracking-wide">{dialog.title}</h2>
            </div>
            <div className="p-6 text-slate-200 whitespace-pre-wrap leading-relaxed text-sm">
              {dialog.message}
            </div>
            <div className="px-6 py-4 bg-slate-800/50 border-t border-gray-100 flex justify-end gap-3">
              {dialog.type === 'confirm' && (
                <button
                  onClick={() => setDialog({ ...dialog, isOpen: false })}
                  className="px-5 py-2 text-slate-400 hover:bg-gray-200 rounded-lg font-medium text-sm transition-colors"
                >
                  取消
                </button>
              )}
              <button
                onClick={() => {
                  if (dialog.onConfirm) {
                    dialog.onConfirm();
                  } else {
                    setDialog({ ...dialog, isOpen: false });
                  }
                }}
                className={`px-6 py-2 text-white rounded-lg font-bold text-sm shadow-md transition-colors ${dialog.type === 'confirm' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #d1d5db; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #9ca3af; }
        
        .hide-scrollbar-smooth::-webkit-scrollbar { height: 10px; }
        .hide-scrollbar-smooth::-webkit-scrollbar-track { background: #f4f7f9; }
        .hide-scrollbar-smooth::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; border: 2px solid #f4f7f9;}
        .hide-scrollbar-smooth::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
      `}} />
    </div>
  );
}
