'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileWarning,
  Gauge,
  Loader2,
  LockKeyhole,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  executeAiCopilotMutationsAction,
  generateRuleSchedulePlanAction,
  interactWithAiCopilotAction,
  type AiCopilotActionResult,
  type AiCopilotContextSummary,
  type AiCopilotResponse,
} from '@/actions/aiSchedulerActions';
import { checkAiPlannerAuditWritableAction, listAiPlannerRunsAction } from '@/actions/aiPlannerAuditActions';
import { repairMisclassifiedReadyOrdersAction } from '@/actions/mesActions';
import type { AiPlannerDailyReport, AiPlannerMorningCheckResult, AiPlannerMorningCheckStatus, AiPlannerTodo, AiPlannerTodoStatus, AiPlannerUiContext, Order } from '@/types';
import {
  canEnterSchedule,
  getScheduleBlockReasons,
  isScheduleAssigned,
} from '@/lib/scheduleEligibility';
import {
  AI_PLANNER_TASK_TEMPLATES,
  buildPromptFromTemplate,
  getAiPlannerTaskTemplate,
  type AiPlannerTaskTemplateId,
} from '@/lib/aiPlannerTaskTemplates';
import {
  buildAiPlannerTodosFromReport,
  buildTodoCopyText,
  mergeTodoStatuses,
} from '@/lib/aiPlannerTodos';
import { buildAiPlannerDailyReport } from '@/lib/aiPlannerDailyReport';
import {
  buildMorningCheckSummary,
  createMorningCheckId,
  loadMorningCheckResultFromStorage,
  saveMorningCheckResultToStorage,
} from '@/lib/aiPlannerMorningCheck';
import {
  getAiPlannerPresenceHint,
  readAiPlannerPresenceFromStorage,
  type AiPlannerPresence,
} from '@/lib/aiPlannerPresence';
import { isOrderCompletedStatus } from '@/lib/orderStatus';
import { cn } from '@/lib/uiTheme';

type AiCopilotDrawerProps = {
  currentBaseLimit: number;
  orders: Order[];
  onApplied?: () => Promise<void> | void;
  uiContext?: AiPlannerUiContext;
  openToken?: number;
};

type WorkerState = 'standby' | 'thinking' | 'confirming' | 'done' | 'error';

type AiStatusPayload = {
  configured?: boolean;
  provider?: string;
  model?: string;
  missing?: string[];
};

type DbStatusPayload = {
  ok?: boolean;
  connected?: boolean;
  provider?: string;
  checkedTables?: string[];
  requiredTables?: string[];
  optionalTables?: string[];
  missingTables?: string[];
  optionalMissingTables?: string[];
  optionalStatus?: string;
  aiAuditStatus?: {
    enabled: boolean;
    missingTables: string[];
    deployedTables: string[];
    message: string;
  };
  schemaStatus?: string;
  message?: string;
};

type AiAuditRef = {
  enabled: boolean;
  aiRunId?: string;
  persistenceWarning?: string;
};

type AiRunListItem = {
  id: string;
  createdAt: string | Date;
  status: string;
  userPrompt: string;
  provider?: string | null;
  model?: string | null;
  durationMs?: number | null;
  executedAt?: string | Date | null;
  _count?: { suggestions?: number };
};

type ReadyFlagsPayload = {
  ok?: boolean;
  generatedAt?: string;
  totalProblemOrders?: number;
  legacyTextReadyButFlagBlocked?: number;
  drawingTextReadyButFlagFalse?: number;
  materialTextReadyButFlagFalse?: number;
  latestProblemUpdatedAt?: string | null;
  oldestProblemCreatedAt?: string | null;
  recent24hProblemCount?: number;
  recent7dProblemCount?: number;
  sourceRiskLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  possibleReasons?: string[];
  examples?: Array<{
    id: string;
    client: string;
    model: string;
    deliveryDate?: string;
    drawing: string;
    materials: string;
    isDrawingReady: boolean;
    isMaterialReady: boolean;
    assignedDay?: string;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
  message?: string;
};

type ContextDiagnostics = {
  ai?: AiStatusPayload;
  db?: DbStatusPayload;
  readyFlags?: ReadyFlagsPayload;
  aiError?: string;
  dbError?: string;
  readyFlagsError?: string;
  checkedAt?: string;
};

const quickPrompts = [
  '按交期生成本周排产建议',
  '检查今天哪些订单可以排',
  '找出无法排产的订单和原因',
  '重新平衡本周排产负荷',
];

const priorityTone: Record<string, string> = {
  MUST: 'border-rose-300/30 bg-rose-400/10 text-rose-50',
  SHOULD: 'border-amber-300/30 bg-amber-400/10 text-amber-50',
  WATCH: 'border-cyan-300/25 bg-cyan-400/10 text-cyan-50',
};

const cleanPriorityLabel: Record<string, string> = {
  MUST: '必须处理',
  SHOULD: '建议处理',
  WATCH: '持续观察',
};

const cleanBlockReasonLabel: Record<string, string> = {
  DRAWING_NOT_READY: '图纸未发',
  MATERIAL_NOT_READY: '物料未齐',
  DATA_INCOMPLETE: '数据不完整',
  OTHER: '其他原因',
};

const cleanTodoStatusLabel: Record<AiPlannerTodoStatus, string> = {
  PENDING: '待处理',
  DONE: '已处理',
  IGNORED: '已忽略',
};

const cleanMutationTypeLabel: Record<string, string> = {
  ASSIGN_ORDER_DAY: '安排排产日',
  UPDATE_ORDER_DATE: '调整排产日期',
  UPDATE_DELIVERY_DATE: '修改交期',
  LOG_EXCEPTION_HOUR: '记录异常工时',
};

const cleanTodoSourceLabel: Record<AiPlannerTodo['source'], string> = {
  PRIORITY_ACTION: '优先动作',
  QUESTION_FOR_HUMAN: '主动问题',
  BLOCKED_GROUP: '阻塞归类',
  SYSTEM_FALLBACK: '系统体检',
};

const cleanSourceRiskLabel: Record<string, string> = {
  HIGH: '近期窗口包含问题，建议用基线验收',
  MEDIUM: '近 7 天存在问题，导入后请做 delta 检查',
  LOW: '当前更像历史遗留',
};

const technicalPlanTextPattern =
  /(AI\s*输出格式异常|输出格式异常|JSON|非标准|fallback|系统规则补充|系统均衡规则|proposedMutations|validation(?:\.ok)?|schedulePlan|canEnterSchedule|debug|[A-Z]{2,}_[A-Z_]{2,})/i;

type TodoFilter = 'ALL' | AiPlannerTodoStatus;
type PlannerTab = 'morning' | 'tasks' | 'todos' | 'report' | 'execution' | 'diagnostics';

const TODO_STORAGE_KEY = 'gg-ai.aiPlannerTodos.v1';
const DAILY_REPORT_STORAGE_KEY = 'gg-ai.aiPlannerDailyReport.v1';

const plannerTabs: Array<{ id: PlannerTab; label: string; description: string }> = [
  { id: 'morning', label: '晨检', description: '一键体检和今日概览' },
  { id: 'tasks', label: '任务', description: '计划任务与分析结果' },
  { id: 'todos', label: '待办', description: '跟进事项闭环' },
  { id: 'report', label: '日报', description: '交接班报告' },
  { id: 'execution', label: '建议执行', description: '人工确认写入' },
  { id: 'diagnostics', label: '诊断', description: '配置和上下文' },
];

const blockedGroupLabel: Record<string, string> = {
  DRAWING_NOT_READY: '图纸未发',
  MATERIAL_NOT_READY: '物料未齐',
  DATA_INCOMPLETE: '数据不完整',
  OTHER: '其他',
};

const stateLabel: Record<WorkerState, string> = {
  standby: '待命',
  thinking: '正在分析',
  confirming: '等待人工确认',
  done: '执行完成',
  error: '发生异常',
};

const stateTone: Record<WorkerState, string> = {
  standby: 'bg-cyan-400 shadow-cyan-400/70',
  thinking: 'bg-amber-300 shadow-amber-300/70 animate-pulse',
  confirming: 'bg-violet-300 shadow-violet-300/70 animate-pulse',
  done: 'bg-emerald-300 shadow-emerald-300/70',
  error: 'bg-rose-400 shadow-rose-400/70',
};

const todoStatusLabel: Record<AiPlannerTodoStatus, string> = {
  PENDING: '待处理',
  DONE: '已处理',
  IGNORED: '已忽略',
};

const todoSourceLabel: Record<AiPlannerTodo['source'], string> = {
  PRIORITY_ACTION: '优先动作',
  QUESTION_FOR_HUMAN: '主动问题',
  BLOCKED_GROUP: '阻塞归类',
  SYSTEM_FALLBACK: '系统体检',
};

const todoStatusTone: Record<AiPlannerTodoStatus, string> = {
  PENDING: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
  DONE: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
  IGNORED: 'border-slate-500/35 bg-slate-800/45 text-slate-300',
};

const morningCheckStatusLabel: Record<AiPlannerMorningCheckStatus, string> = {
  IDLE: '尚未执行今日晨检',
  ANALYZING: 'AI 正在读取订单和页面上下文',
  BUILDING_TODOS: '正在生成计划员待办',
  BUILDING_REPORT: '正在生成日报草稿',
  DONE: '今日晨检已完成',
  FAILED: '晨检失败',
};

function formatDateTime(value?: string | Date | null): string {
  if (!value) return '未知';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function classifyCopilotError(message: string): string {
  const text = message.trim();
  if (!text) return 'AI 排单执行失败，请检查模型配置、数据库连接或稍后重试。';
  if (/DEEPSEEK_API_KEY|API Key|AI Key|未配置/.test(text)) {
    return 'AI Key 未配置：请在 Sealos 环境变量中配置 DEEPSEEK_API_KEY。';
  }
  if (/MesAbnormalClaim|缺表|missing table|does not exist|不可用/.test(text)) {
    return '数据库缺表：异常工时台账表 MesAbnormalClaim 不可用，AI 会降级为仅基于订单上下文分析。';
  }
  if (/DATABASE_URL|数据库连接|Prisma|Order 表|connect|connection/i.test(text)) {
    return '数据库连接失败：AI 无法读取订单排产上下文，请检查 DATABASE_URL 和数据库状态。';
  }
  if (/JSON|格式|解析|format/i.test(text)) {
    return '模型返回格式异常：AI 返回内容无法按结构化 JSON 渲染。';
  }
  if (/fetch|network|timeout|ECONN|ENOTFOUND/i.test(text)) {
    return '网络或模型服务异常：请稍后重试，或检查 DeepSeek 服务可用性。';
  }
  return text;
}

function safePreview(preview?: string): string {
  if (!preview) return '';
  if (/sk-[A-Za-z0-9]|postgres(?:ql)?:\/\/|DATABASE_URL|Bearer\s+/i.test(preview)) return '';
  return preview.slice(0, 180);
}

function shortId(value?: string | null): string {
  if (!value) return '';
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

function compactOrderIds(ids?: string[]): string {
  const list = (ids ?? []).filter(Boolean);
  if (list.length === 0) return '未指定订单';
  const shown = list.slice(0, 3).map(shortId).join('、');
  return list.length > 3 ? `${shown} 等 ${list.length} 单` : shown;
}

type SchedulePlanItemForDisplay = NonNullable<AiCopilotResponse['schedulePlan']>['items'][number];

function toBusinessPlanNotice(text: string): string | null {
  const value = String(text ?? '').trim();
  if (!value) return null;
  if (!technicalPlanTextPattern.test(value)) return value;
  if (/格式|JSON|输出/.test(value)) {
    return 'AI 返回内容未形成标准排产草案，系统已根据当前订单、交期、工时和产能重新生成规则排产建议。';
  }
  return '已根据当前订单、交期、工时和产能生成排产建议。';
}

function buildBusinessScheduleReason(item: SchedulePlanItemForDisplay, order?: Order): string {
  const planItemWithDue = item as SchedulePlanItemForDisplay & { deliveryDate?: string | null };
  const due = String(planItemWithDue.deliveryDate || order?.deliveryDate || '未填交期');
  const minutes = Math.max(0, Math.round(Number(item.estimatedMinutes ?? order?.totalHours ?? 0) || 0));
  const source = order && isScheduleAssigned(order) ? '该订单来自已排池，本次按交期重新平衡。' : '该订单来自就绪待排池。';
  const workload =
    minutes >= 1200
      ? '该订单工时较高，按同交期大工时优先原则靠前安排。'
      : '该订单用于补齐当日负荷，帮助保持本周排产均衡。';
  return `交期 ${due} 优先，排入${item.targetDay}；${workload}${source}图纸已发、物料齐套，满足排产条件。`;
}

function cleanScheduleReason(item: SchedulePlanItemForDisplay, order?: Order): string {
  const reason = String(item.reason ?? '').trim();
  if (!reason || technicalPlanTextPattern.test(reason)) {
    return buildBusinessScheduleReason(item, order);
  }
  return reason;
}

function cleanLabel(map: Record<string, string>, value?: string | null): string {
  if (!value) return '未分类';
  return map[value] ?? value.replace(/_/g, ' ').toLowerCase();
}

function isRiskOrder(order: Order): boolean {
  if (!order.deliveryDate || isOrderCompletedStatus(order.taskStatus)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return order.deliveryDate < today && !isScheduleAssigned(order);
}

function buildLocalSummary(orders: Order[], dailyCapacity: number): AiCopilotContextSummary {
  const blockedByDrawing = orders.filter((order) =>
    getScheduleBlockReasons(order).includes('DRAWING_NOT_READY')
  ).length;
  const blockedByMaterial = orders.filter((order) => {
    const reasons = getScheduleBlockReasons(order);
    return !reasons.includes('DRAWING_NOT_READY') && reasons.includes('MATERIAL_NOT_READY');
  }).length;

  return {
    totalOrders: orders.length,
    schedulableOrders: orders.filter(canEnterSchedule).length,
    blockedByDrawing,
    blockedByMaterial,
    scheduledOrders: orders.filter(isScheduleAssigned).length,
    urgentOrders: orders.filter((order) => order.isUrgent).length,
    riskOrders: orders.filter(isRiskOrder).length,
    dailyCapacity,
    contextWarnings: [],
  };
}

function metricCard(label: string, value: number | string, detail: string, tone = 'cyan') {
  const toneClass =
    tone === 'red'
      ? 'border-rose-400/25 bg-rose-500/10 text-rose-100'
      : tone === 'amber'
        ? 'border-amber-300/25 bg-amber-400/10 text-amber-100'
        : tone === 'emerald'
          ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
          : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100';
  return (
    <div className={cn('rounded-xl border p-3', toneClass)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-slate-400">{detail}</div>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 404) throw new Error(`${url} 返回 404，线上可能不是最新镜像。`);
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return (await response.json()) as T;
}

export default function AiCopilotDrawer({ currentBaseLimit, orders, onApplied, uiContext, openToken }: AiCopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [taskNote, setTaskNote] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<AiPlannerTaskTemplateId | null>(null);
  const [diagnosis, setDiagnosis] = useState<AiCopilotResponse | null>(null);
  const [serverSummary, setServerSummary] = useState<AiCopilotContextSummary | null>(null);
  const [summarySource, setSummarySource] = useState<'local' | 'server'>('local');
  const [errorMessage, setErrorMessage] = useState('');
  const [modelPreview, setModelPreview] = useState('');
  const [lastAnalysisAt, setLastAnalysisAt] = useState('');
  const [workerState, setWorkerState] = useState<WorkerState>('standby');
  const [diagnostics, setDiagnostics] = useState<ContextDiagnostics | null>(null);
  const [auditRef, setAuditRef] = useState<AiAuditRef | null>(null);
  const [ignoredMutationIndexes, setIgnoredMutationIndexes] = useState<number[]>([]);
  const [executionResult, setExecutionResult] = useState<{
    executedAt: string;
    successCount: number;
    blockedCount: number;
    failedCount: number;
    details: Array<{ reason: string; orderId?: string; type?: string }>;
  } | null>(null);
  const [plannerTodos, setPlannerTodos] = useState<AiPlannerTodo[]>([]);
  const [todoFilter, setTodoFilter] = useState<TodoFilter>('ALL');
  const [dailyReport, setDailyReport] = useState<AiPlannerDailyReport | null>(null);
  const [showDailyMarkdown, setShowDailyMarkdown] = useState(false);
  const [morningCheckStatus, setMorningCheckStatus] = useState<AiPlannerMorningCheckStatus>('IDLE');
  const [morningCheckResult, setMorningCheckResult] = useState<AiPlannerMorningCheckResult | null>(null);
  const [activeTab, setActiveTab] = useState<PlannerTab>('morning');
  const [presence, setPresence] = useState<AiPlannerPresence>(() => readAiPlannerPresenceFromStorage());
  const [history, setHistory] = useState<{ ok: boolean; error?: string; data: AiRunListItem[] } | null>(null);
  const [auditWritableResult, setAuditWritableResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isThinking, startThinking] = useTransition();
  const [isApplying, startApplying] = useTransition();
  const [isChecking, startChecking] = useTransition();
  const [isRepairingReadyFlags, startRepairingReadyFlags] = useTransition();
  const [isLoadingHistory, startLoadingHistory] = useTransition();
  const [isCheckingAuditWrite, startCheckingAuditWrite] = useTransition();
  const [isMorningChecking, startMorningChecking] = useTransition();

  const localSummary = useMemo(
    () => buildLocalSummary(orders, currentBaseLimit),
    [orders, currentBaseLimit]
  );
  const activeSummary = serverSummary ?? localSummary;
  const hasMutations = (diagnosis?.proposedMutations.length ?? 0) > 0;
  const scheduleMutations = useMemo(
    () => (diagnosis?.proposedMutations ?? []).filter((m) => m.type === 'ASSIGN_ORDER_DAY' || m.type === 'UPDATE_ORDER_DATE'),
    [diagnosis?.proposedMutations]
  );
  const hasScheduleDraft = scheduleMutations.length > 0 || (diagnosis?.schedulePlan?.items.length ?? 0) > 0;
  const schedulePlanValidation = diagnosis?.schedulePlanValidation;
  const schedulePlanExecutable = schedulePlanValidation ? schedulePlanValidation.ok : true;
  const hasExportRows = (diagnosis?.exportDataSummary.length ?? 0) > 0;
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const selectedTask = selectedTaskId ? getAiPlannerTaskTemplate(selectedTaskId) : undefined;
  const plannerReport = diagnosis?.plannerReport;
  const visibleTodos = useMemo(
    () => (todoFilter === 'ALL' ? plannerTodos : plannerTodos.filter((todo) => todo.status === todoFilter)),
    [plannerTodos, todoFilter]
  );
  const todoStats = useMemo(
    () => ({
      pending: plannerTodos.filter((todo) => todo.status === 'PENDING').length,
      done: plannerTodos.filter((todo) => todo.status === 'DONE').length,
      ignored: plannerTodos.filter((todo) => todo.status === 'IGNORED').length,
      must: plannerTodos.filter((todo) => todo.level === 'MUST' && todo.status === 'PENDING').length,
    }),
    [plannerTodos]
  );
  const mergedUiContext = useMemo<AiPlannerUiContext>(
    () => ({
      ...uiContext,
      selectedTaskId,
      selectedTaskName: selectedTask?.name ?? null,
      planWeekSelected: uiContext?.planWeekSelected,
      planWeekLabel: uiContext?.planWeekLabel,
      visibleOrderIds: (uiContext?.visibleOrderIds ?? orders.slice(0, 200).map((order) => order.id)).slice(0, 200),
      loadedOrderCount: uiContext?.loadedOrderCount ?? orders.length,
      localSummary: uiContext?.localSummary ?? {
        totalOrders: localSummary.totalOrders,
        schedulableOrders: localSummary.schedulableOrders,
        blockedByDrawing: localSummary.blockedByDrawing,
        blockedByMaterial: localSummary.blockedByMaterial,
        scheduledOrders: localSummary.scheduledOrders,
        urgentOrders: localSummary.urgentOrders,
        riskOrders: localSummary.riskOrders,
      },
      readyFlagGuard: {
        baselineModeRecommended: true,
        ...uiContext?.readyFlagGuard,
        historicalMismatchCount: diagnostics?.readyFlags?.legacyTextReadyButFlagBlocked ?? uiContext?.readyFlagGuard?.historicalMismatchCount,
        recentProblemCount: diagnostics?.readyFlags?.recent24hProblemCount ?? uiContext?.readyFlagGuard?.recentProblemCount,
        sourceRiskLevel: diagnostics?.readyFlags?.sourceRiskLevel ?? uiContext?.readyFlagGuard?.sourceRiskLevel,
      },
      aiAuditStatus: {
        ...uiContext?.aiAuditStatus,
        enabled: diagnostics?.db?.aiAuditStatus?.enabled ?? uiContext?.aiAuditStatus?.enabled,
        missingTables: diagnostics?.db?.aiAuditStatus?.missingTables ?? uiContext?.aiAuditStatus?.missingTables,
      },
    }),
    [diagnostics?.db?.aiAuditStatus, diagnostics?.readyFlags, localSummary, orders, selectedTask?.name, selectedTaskId, uiContext]
  );

  const loadSummary = useMemo(() => {
    const todayKey = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: 'Asia/Shanghai',
    }).format(new Date());
    const dayNames = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    const scheduled = orders.filter((order) => dayNames.has(order.assignedDay) && !isOrderCompletedStatus(order.taskStatus));
    const todayMinutes = scheduled
      .filter((order) => order.assignedDay === todayKey)
      .reduce((sum, order) => sum + (Number(order.totalHours) || 0), 0);
    const weekMinutes = scheduled.reduce((sum, order) => sum + (Number(order.totalHours) || 0), 0);
    return { todayMinutes, weekMinutes };
  }, [orders]);

  const abnormalCount = useMemo(
    () => orders.filter((order) => order.activeAlarm || order.taskStatus === 'anomaly').length,
    [orders]
  );

  const mutationSummary = useMemo(() => {
    if (!diagnosis?.proposedMutations.length) return '暂无待执行动作';
    const orderMoves = diagnosis.proposedMutations.filter((m) => m.type === 'UPDATE_ORDER_DATE' || m.type === 'ASSIGN_ORDER_DAY').length;
    const deliveryChanges = diagnosis.proposedMutations.filter((m) => m.type === 'UPDATE_DELIVERY_DATE').length;
    const exceptionLogs = diagnosis.proposedMutations.filter((m) => m.type === 'LOG_EXCEPTION_HOUR').length;
    return [`排产调整 ${orderMoves}`, `交期修改 ${deliveryChanges}`, `异常工时 ${exceptionLogs}`].join(' / ');
  }, [diagnosis]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TODO_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AiPlannerTodo[];
      if (Array.isArray(parsed)) {
        setPlannerTodos(parsed.filter((todo) => todo && typeof todo.id === 'string').slice(0, 80));
      }
    } catch {
      setPlannerTodos([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(plannerTodos.slice(0, 80)));
      window.dispatchEvent(new Event('gg-ai:planner-presence-updated'));
    } catch {
      // localStorage is a convenience cache only; ignoring failures keeps the planner usable.
    }
  }, [plannerTodos]);

  useEffect(() => {
    if (openToken === undefined) return;
    setOpen(true);
  }, [openToken]);

  useEffect(() => {
    const refreshPresence = () => setPresence(readAiPlannerPresenceFromStorage());
    refreshPresence();
    window.addEventListener('gg-ai:planner-presence-updated', refreshPresence);
    window.addEventListener('storage', refreshPresence);
    return () => {
      window.removeEventListener('gg-ai:planner-presence-updated', refreshPresence);
      window.removeEventListener('storage', refreshPresence);
    };
  }, []);

  useEffect(() => {
    if (!plannerReport) return;
    const newTodos = buildAiPlannerTodosFromReport({
      plannerReport,
      aiRunId: auditRef?.aiRunId,
      selectedTaskName: selectedTask?.name ?? null,
    });
    setPlannerTodos((existing) => mergeTodoStatuses(existing, newTodos));
  }, [auditRef?.aiRunId, plannerReport, selectedTask?.name]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_REPORT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AiPlannerDailyReport;
      if (parsed && typeof parsed.id === 'string' && typeof parsed.markdown === 'string') {
        setDailyReport(parsed);
      }
    } catch {
      setDailyReport(null);
    }
  }, []);

  useEffect(() => {
    const result = loadMorningCheckResultFromStorage();
    if (result) {
      setMorningCheckResult(result);
      setMorningCheckStatus(result.status);
    }
  }, []);

  useEffect(() => {
    try {
      if (dailyReport) {
        window.localStorage.setItem(DAILY_REPORT_STORAGE_KEY, JSON.stringify(dailyReport));
      } else {
        window.localStorage.removeItem(DAILY_REPORT_STORAGE_KEY);
      }
      window.dispatchEvent(new Event('gg-ai:planner-presence-updated'));
    } catch {
      // Daily report drafts are local convenience data only.
    }
  }, [dailyReport]);

  const updateTodoStatus = (todoId: string, status: AiPlannerTodoStatus) => {
    setPlannerTodos((current) => current.map((todo) => (todo.id === todoId ? { ...todo, status } : todo)));
  };

  const copyTodoText = async (todo: AiPlannerTodo) => {
    try {
      await navigator.clipboard.writeText(buildTodoCopyText(todo));
      toast.success('已复制 AI 计划员跟进话术');
    } catch {
      toast.error('复制失败，请手动复制待办内容');
    }
  };

  const generateDailyReport = () => {
    const report = buildAiPlannerDailyReport({
      plannerReport,
      plannerTodos,
      contextSummary: activeSummary,
      uiContext: mergedUiContext,
      selectedTaskName: selectedTask?.name ?? null,
    });
    setDailyReport(report);
    setShowDailyMarkdown(false);
    toast.success('AI 计划员日报已生成');
  };

  const copyDailyReport = async () => {
    if (!dailyReport) {
      toast.error('请先生成 AI 计划员日报');
      return;
    }
    try {
      await navigator.clipboard.writeText(dailyReport.markdown);
      toast.success('已复制 AI 计划员日报');
    } catch {
      toast.error('复制日报失败，请展开 Markdown 后手动复制');
    }
  };

  const downloadDailyReport = () => {
    if (!dailyReport) {
      toast.error('请先生成 AI 计划员日报');
      return;
    }
    const blob = new Blob([dailyReport.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-planner-daily-report-${new Date(dailyReport.createdAt).toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success('Markdown 日报已下载');
  };

  const runMorningCheck = () => {
    const template = getAiPlannerTaskTemplate('DAILY_PLANNING_CHECKUP');
    if (!template) {
      toast.error('每日排产体检模板不可用');
      return;
    }

    const checkId = createMorningCheckId();
    const startedAt = new Date().toISOString();
    setSelectedTaskId('DAILY_PLANNING_CHECKUP');
    setTaskNote('');
    setPrompt(template.prompt);
    setErrorMessage('');
    setModelPreview('');
    setMorningCheckStatus('ANALYZING');
    setWorkerState('thinking');

    startMorningChecking(async () => {
      try {
        const checkUiContext: AiPlannerUiContext = {
          ...mergedUiContext,
          selectedTaskId: 'DAILY_PLANNING_CHECKUP',
          selectedTaskName: template.name,
        };
        const res: AiCopilotActionResult = await interactWithAiCopilotAction(template.prompt, currentBaseLimit, checkUiContext);
        setModelPreview(safePreview(res.rawModelPreview));
        setAuditRef(res.audit ?? null);
        setIgnoredMutationIndexes([]);

        if (res.contextSummary) {
          setServerSummary(res.contextSummary);
          setSummarySource('server');
        }

        if (!res.data) {
          throw new Error(res.error ?? 'AI 计划员晨检未返回可用报告');
        }

        setDiagnosis(res.data);
        setLastAnalysisAt(new Date().toLocaleString('zh-CN', { hour12: false }));
        setWorkerState(res.data.proposedMutations.length > 0 ? 'confirming' : 'done');
        setMorningCheckStatus('BUILDING_TODOS');

        const todos = buildAiPlannerTodosFromReport({
          plannerReport: res.data.plannerReport,
          aiRunId: res.audit?.aiRunId,
          selectedTaskName: template.name,
        });
        const existingTodos = (() => {
          try {
            const raw = window.localStorage.getItem(TODO_STORAGE_KEY);
            const parsed = raw ? (JSON.parse(raw) as AiPlannerTodo[]) : [];
            return Array.isArray(parsed) ? parsed : plannerTodos;
          } catch {
            return plannerTodos;
          }
        })();
        const mergedTodos = mergeTodoStatuses(existingTodos, todos);
        setPlannerTodos(mergedTodos);

        setMorningCheckStatus('BUILDING_REPORT');
        const report = buildAiPlannerDailyReport({
          plannerReport: res.data.plannerReport,
          plannerTodos: mergedTodos,
          contextSummary: res.contextSummary ?? activeSummary,
          uiContext: checkUiContext,
          selectedTaskName: template.name,
        });
        setDailyReport(report);

        const result: AiPlannerMorningCheckResult = {
          id: checkId,
          createdAt: startedAt,
          status: 'DONE',
          taskName: template.name,
          aiRunId: res.audit?.aiRunId,
          todoCount: mergedTodos.filter((todo) => todo.status === 'PENDING').length,
          reportId: report.id,
          summary: buildMorningCheckSummary({
            plannerReport: res.data.plannerReport,
            todos: mergedTodos,
            dailyReport: report,
          }),
        };
        saveMorningCheckResultToStorage(result);
        setMorningCheckResult(result);
        setMorningCheckStatus('DONE');
        loadAuditHistory();
        toast.success('AI 计划员晨检已完成，待办和日报草稿已生成');
      } catch (error) {
        const message = classifyCopilotError(error instanceof Error ? error.message : String(error));
        const result: AiPlannerMorningCheckResult = {
          id: checkId,
          createdAt: startedAt,
          status: 'FAILED',
          taskName: template.name,
          errorMessage: message,
        };
        saveMorningCheckResultToStorage(result);
        setMorningCheckResult(result);
        setMorningCheckStatus('FAILED');
        setWorkerState('error');
        setErrorMessage(message);
        toast.error('AI 计划员晨检失败');
      }
    });
  };

  const askPlanner = () => {
    const text = selectedTaskId ? buildPromptFromTemplate(selectedTaskId, taskNote) : prompt.trim();
    if (!text) {
      toast.error('请先向 AI 计划员下达任务');
      return;
    }
    setErrorMessage('');
    setModelPreview('');
    setWorkerState('thinking');
    startThinking(async () => {
      try {
        const res: AiCopilotActionResult = await interactWithAiCopilotAction(text, currentBaseLimit, mergedUiContext);
        const preview = safePreview(res.rawModelPreview);
        setModelPreview(preview);
        setAuditRef(res.audit ?? null);
        setIgnoredMutationIndexes([]);
        if (res.contextSummary) {
          setServerSummary(res.contextSummary);
          setSummarySource('server');
        }

        if (!res.ok || !res.data) {
          const message = classifyCopilotError(res.error ?? 'AI 排单执行失败，请检查模型配置、数据库连接或稍后重试。');
          setErrorMessage(message);
          setWorkerState('error');
          toast.error(message);
          if (res.data) setDiagnosis(res.data);
          return;
        }

        setDiagnosis(res.data);
        setErrorMessage('');
        setLastAnalysisAt(new Date().toLocaleString('zh-CN', { hour12: false }));
        setWorkerState(res.data.proposedMutations.length > 0 ? 'confirming' : 'done');
        loadAuditHistory();
        toast.success('AI 计划员已完成本轮分析');
      } catch (error) {
        const message = classifyCopilotError(error instanceof Error ? error.message : String(error));
        setErrorMessage(message);
        setWorkerState('error');
        toast.error('AI 计划员执行失败，请稍后重试');
      }
    });
  };

  const selectTaskTemplate = (id: AiPlannerTaskTemplateId) => {
    const template = getAiPlannerTaskTemplate(id);
    if (!template) return;
    setSelectedTaskId(id);
    setPrompt(template.prompt);
    setTaskNote('');
  };

  const applyMutations = () => {
    if (!diagnosis?.proposedMutations.length) return;
    setErrorMessage('');
    setModelPreview('');
    setWorkerState('confirming');
    const executableMutations = diagnosis.proposedMutations.filter((_, index) => !ignoredMutationIndexes.includes(index));
    const scheduleCount = executableMutations.filter((m) => m.type === 'ASSIGN_ORDER_DAY' || m.type === 'UPDATE_ORDER_DATE').length;
    const confirmed = window.confirm(
      scheduleCount > 0
        ? `将执行 ${scheduleCount} 条排产建议，目标范围为周一到周六。系统会再次校验图纸/物料状态，不符合条件的订单会被拦截。是否继续？`
        : `将执行 ${executableMutations.length} 条 AI 建议。系统会在后端再次校验权限和业务规则。是否继续？`
    );
    if (!confirmed) {
      toast('已取消执行，未写入订单。');
      return;
    }
    startApplying(async () => {
      try {
        const res = await executeAiCopilotMutationsAction(executableMutations, auditRef?.aiRunId);
        const rejected = res.rejectedMutations ?? [];
        setExecutionResult({
          executedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
          successCount: Math.max(0, res.updatedOrders + res.exceptionLogs),
          blockedCount: rejected.filter((item) => /拦截|禁止|图纸|物料|DRAWING|MATERIAL/.test(item.reason)).length,
          failedCount: rejected.filter((item) => !/拦截|禁止|图纸|物料|DRAWING|MATERIAL/.test(item.reason)).length,
          details: rejected.map((item) => ({
            reason: item.reason,
            type: item.mutation.type,
            orderId: 'orderId' in item.mutation ? item.mutation.orderId : undefined,
          })),
        });
        if (res.unreasonableAlerts?.length) {
          setDiagnosis((prev) =>
            prev
              ? {
                  ...prev,
                  unreasonableAlerts: [...res.unreasonableAlerts!, ...prev.unreasonableAlerts],
                  proposedMutations: res.ok ? prev.proposedMutations : [],
                }
              : prev
          );
        }
        if (!res.ok) {
          const message = classifyCopilotError(res.error ?? '执行 AI 建议失败');
          setErrorMessage(message);
          setWorkerState('error');
          toast.error(message);
          await onApplied?.();
          return;
        }
        setWorkerState('done');
        toast.success(`已执行：订单更新 ${res.updatedOrders} 条，异常工时 ${res.exceptionLogs} 条`);
        await onApplied?.();
      } catch (error) {
        const message = classifyCopilotError(error instanceof Error ? error.message : String(error));
        setErrorMessage(message);
        setWorkerState('error');
        toast.error(message);
      }
    });
  };

  const generateRuleScheduleDraft = () => {
    setErrorMessage('');
    setWorkerState('thinking');
    startThinking(async () => {
      try {
        const res = await generateRuleSchedulePlanAction(currentBaseLimit, {
          ...mergedUiContext,
          selectedTaskId: 'DAILY_PLANNING_CHECKUP',
          selectedTaskName: '规则排产草案',
        });
        if (!res.ok || !res.data) {
          const message = classifyCopilotError(res.error ?? '生成规则排产草案失败');
          setErrorMessage(message);
          setWorkerState('error');
          toast.error(message);
          return;
        }
        setDiagnosis(res.data);
        setServerSummary(res.contextSummary ?? null);
        setSummarySource(res.contextSummary ? 'server' : 'local');
        setAuditRef(res.audit ?? null);
        setActiveTab('execution');
        setWorkerState(res.data.proposedMutations.length > 0 ? 'confirming' : 'done');
        toast.success('已生成规则排产草案，等待人工确认执行');
      } catch (error) {
        const message = classifyCopilotError(error instanceof Error ? error.message : String(error));
        setErrorMessage(message);
        setWorkerState('error');
        toast.error(message);
      }
    });
  };

  const exportExcel = () => {
    if (!diagnosis?.exportDataSummary.length) {
      toast.error('当前没有可导出的诊断数据');
      return;
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(diagnosis.exportDataSummary), '排产诊断');
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(diagnosis.unreasonableAlerts.map((alert, index) => ({ 序号: index + 1, 风险预警: alert }))),
      '风险预警'
    );
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(diagnosis.proposedMutations), 'AI建议动作');
    XLSX.writeFile(workbook, `AI计划员工诊断_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const checkContext = () => {
    startChecking(async () => {
      const next: ContextDiagnostics = { checkedAt: new Date().toLocaleString('zh-CN', { hour12: false }) };
      const [aiResult, dbResult, readyFlagsResult] = await Promise.allSettled([
        fetchJson<AiStatusPayload>('/api/ai/status'),
        fetchJson<DbStatusPayload>('/api/db/status'),
        fetchJson<ReadyFlagsPayload>('/api/db/ready-flags'),
      ]);

      if (aiResult.status === 'fulfilled') next.ai = aiResult.value;
      else next.aiError = aiResult.reason instanceof Error ? aiResult.reason.message : String(aiResult.reason);

      if (dbResult.status === 'fulfilled') next.db = dbResult.value;
      else next.dbError = dbResult.reason instanceof Error ? dbResult.reason.message : String(dbResult.reason);

      if (readyFlagsResult.status === 'fulfilled') next.readyFlags = readyFlagsResult.value;
      else next.readyFlagsError = readyFlagsResult.reason instanceof Error ? readyFlagsResult.reason.message : String(readyFlagsResult.reason);

      setDiagnostics(next);
    });
  };

  const loadAuditHistory = () => {
    startLoadingHistory(async () => {
      const res = await listAiPlannerRunsAction(10);
      if (!res.ok) {
        setHistory({ ok: false, error: res.error, data: [] });
        return;
      }
      setHistory({ ok: true, data: (res.data ?? []) as AiRunListItem[] });
    });
  };

  const checkAuditWritable = () => {
    setAuditWritableResult(null);
    startCheckingAuditWrite(async () => {
      const res = await checkAiPlannerAuditWritableAction();
      if (res.ok) {
        setAuditWritableResult({ ok: true, message: 'AI 记忆写入正常' });
        toast.success('AI 记忆写入正常');
        return;
      }
      const message = res.reason || 'AI 记忆写入自检失败';
      setAuditWritableResult({ ok: false, message });
      toast.error(message);
    });
  };

  const rejectMutation = (index: number) => {
    setIgnoredMutationIndexes((prev) => (prev.includes(index) ? prev : [...prev, index]));
    if (auditRef?.aiRunId) toast('已在前端标记忽略；审计建议 ID 尚未映射，暂不写入后端拒绝状态。');
  };

  const repairReadyFlags = () => {
    const confirmed = window.confirm(
      '历史数据当前可暂不处理。该可选操作会把历史文本中明确为已发图/料齐的订单，同步到排产布尔字段；不会自动排产，也不会绕过排产硬规则。是否继续？'
    );
    if (!confirmed) return;

    startRepairingReadyFlags(async () => {
      try {
        const res = await repairMisclassifiedReadyOrdersAction();
        if (!res.ok) {
          const message = res.error || '同步历史图纸/物料状态失败';
          toast.error(message);
          setErrorMessage(classifyCopilotError(message));
          return;
        }
        toast.success(`已同步 ${res.repairedCount} 单图纸/配料状态，请重新排产。`);
        await onApplied?.();
        loadAuditHistory();
        checkContext();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error('同步历史图纸/物料状态失败');
        setErrorMessage(classifyCopilotError(message));
      }
    });
  };

  const contextWarnings = activeSummary.contextWarnings ?? [];
  const readyFlagProblems = diagnostics?.readyFlags?.legacyTextReadyButFlagBlocked ?? 0;

  const renderSchedulePlanPreview = () => {
    if (!diagnosis?.schedulePlan) return null;
    const scheduleWarnings = Array.from(
      new Set((diagnosis.schedulePlan.warnings ?? []).map((warning) => toBusinessPlanNotice(warning)).filter(Boolean))
    ) as string[];
    return (
      <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-black text-white">{diagnosis.schedulePlan.title || '排产草案'}</div>
            <p className="mt-1 text-sm leading-6 text-cyan-50/85">{diagnosis.schedulePlan.summary}</p>
          </div>
          <div className="rounded-xl border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100">
            共 {diagnosis.schedulePlan.items.length} 条建议
          </div>
        </div>
        {diagnosis.schedulePlan.candidateSummary ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="mb-3 text-sm font-black text-white">候选订单识别</div>
            <div className="grid gap-2 text-xs leading-5 text-slate-300 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">就绪待排池：{diagnosis.schedulePlan.candidateSummary.readyPoolCount} 单</div>
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">周一到周六已排可调整：{diagnosis.schedulePlan.candidateSummary.scheduledAdjustableCount} 单</div>
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">本次纳入草案：{diagnosis.schedulePlan.candidateSummary.includedCount} 单</div>
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">图纸未发排除：{diagnosis.schedulePlan.candidateSummary.excludedByDrawing} 单</div>
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">物料未齐排除：{diagnosis.schedulePlan.candidateSummary.excludedByMaterial} 单</div>
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">完成/归档/删除排除：{diagnosis.schedulePlan.candidateSummary.excludedByDoneArchivedDeleted} 单</div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              {diagnosis.schedulePlan.candidateSummary.allowRescheduleAssigned
                ? '本次按生产计划员权限纳入已排订单重新平衡。'
                : '本次按用户要求不移动已排订单，仅处理待排订单。'}
            </p>
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {['周一', '周二', '周三', '周四', '周五', '周六'].map((day) => {
            const items = diagnosis.schedulePlan?.items.filter((item) => item.targetDay === day) ?? [];
            const minutes = items.reduce((sum, item) => sum + (Number(item.estimatedMinutes) || 0), 0);
            const overloaded = minutes > currentBaseLimit;
            return (
              <div key={day} className={cn('rounded-2xl border p-3', overloaded ? 'border-amber-300/30 bg-amber-400/10' : 'border-white/10 bg-slate-950/45')}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-white">{day}</div>
                  <div className={cn('text-xs font-bold', overloaded ? 'text-amber-100' : 'text-slate-400')}>
                    {items.length} 单 / {minutes} 分钟
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {items.slice(0, 4).map((item) => {
                    const order = orderById.get(item.orderId);
                    return (
                      <div key={`${day}-${item.orderId}`} className="rounded-xl border border-white/10 bg-white/[0.035] p-2 text-xs leading-5 text-slate-300">
                        <div className="font-bold text-white">{order ? `${order.client || '客户'} · ${order.model || '型号'}` : shortId(item.orderId)}</div>
                        <div>订单：<span title={item.orderId}>{shortId(item.orderId)}</span></div>
                        <div>原因：{cleanScheduleReason(item, order)}</div>
                      </div>
                    );
                  })}
                  {items.length > 4 ? <div className="text-xs text-slate-500">等 {items.length - 4} 单</div> : null}
                  {!items.length ? <div className="text-xs text-slate-500">暂无安排</div> : null}
                </div>
              </div>
            );
          })}
        </div>
        {scheduleWarnings.length ? (
          <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
            {scheduleWarnings.slice(0, 3).map((warning, index) => <div key={`${warning}-${index}`}>{warning}</div>)}
          </div>
        ) : null}
        {schedulePlanValidation ? (
          <div className={cn('mt-3 rounded-xl border p-3 text-xs leading-5', schedulePlanValidation.ok ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-rose-300/25 bg-rose-400/10 text-rose-100')}>
            <div className="font-black">{schedulePlanValidation.ok ? '排产质量校验通过' : '当前排单草案未通过计划逻辑校验，不能执行。'}</div>
            <div className="mt-1">{schedulePlanValidation.summary}</div>
            <div className={cn('mt-3 rounded-lg border p-3', schedulePlanValidation.dueDateOrder.ok ? 'border-emerald-200/20 bg-emerald-300/10' : 'border-rose-200/25 bg-rose-400/10')}>
              <div className="font-black">{schedulePlanValidation.dueDateOrder.ok ? '交期顺序通过' : '交期顺序不通过'}</div>
              <p className="mt-1 text-[11px] leading-5 opacity-85">
                为了保证交期优先，负荷均衡只能在同交期范围内或不破坏前后交期顺序的前提下调整。
              </p>
              {schedulePlanValidation.dueDateOrder.conflicts.length ? (
                <div className="mt-2 space-y-1">
                  {schedulePlanValidation.dueDateOrder.conflicts.slice(0, 3).map((conflict, index) => (
                    <div key={`${conflict.previousDay}-${conflict.nextDay}-${index}`}>{conflict.message}</div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {schedulePlanValidation.dayLoads.map((row) => (
                <div key={row.day} className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                  <div className="font-bold text-white">{row.day}</div>
                  <div>{row.orderCount} 单 / {row.minutes} 分钟</div>
                  <div>偏差：{row.deltaFromAverage >= 0 ? '+' : ''}{row.deltaFromAverage} 分钟</div>
                  <div>{row.withinTolerance ? '在 ±500 合理区间' : '超出 ±500，需关注'}</div>
                </div>
              ))}
            </div>
            {schedulePlanValidation.errors.length ? (
              <div className="mt-3 space-y-1">
                {schedulePlanValidation.errors.slice(0, 5).map((item, index) => <div key={`${item.code}-${index}`}>错误：{item.message}</div>)}
              </div>
            ) : null}
            {schedulePlanValidation.warnings.length ? (
              <div className="mt-3 space-y-1">
                {schedulePlanValidation.warnings.slice(0, 5).map((item, index) => <div key={`${item.code}-${index}`}>提醒：{item.message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/35 bg-slate-950/90 text-cyan-100 shadow-[0_0_30px_rgba(34,211,238,0.28)] backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-200 hover:text-white"
        title={`打开 AI 计划员工作台：${getAiPlannerPresenceHint(presence)}`}
      >
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]" />
        <Bot className="h-7 w-7" />
        {presence.pendingCount > 0 && (
          <span className="absolute -left-2 -top-2 rounded-full border border-cyan-100/40 bg-cyan-300 px-1.5 py-0.5 text-[10px] font-black text-slate-950">
            {presence.pendingCount}
          </span>
        )}
        {presence.mustCount > 0 && (
          <span className="absolute -right-2 bottom-0 rounded-full border border-rose-100/40 bg-rose-400 px-1.5 py-0.5 text-[10px] font-black text-white">
            必
          </span>
        )}
        {presence.morningCheckDone && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-emerald-200/30 bg-emerald-300 px-2 py-0.5 text-[10px] font-black text-slate-950">
            晨检
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-slate-950/60 p-2 backdrop-blur-sm sm:p-4">
          <motion.aside
            initial={{ opacity: 0, x: 42, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-cyan-300/20 bg-[#06101c]/95 text-slate-100 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          >
            <header className="relative shrink-0 overflow-hidden border-b border-white/10 bg-gradient-to-r from-slate-950 via-cyan-950/40 to-slate-950 px-5 py-4">
              <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,rgba(125,211,252,0.18)_1px,transparent_0)] [background-size:22px_22px]" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200/30 bg-cyan-400/10 shadow-[0_0_30px_rgba(34,211,238,0.18)]">
                    <span className={cn('absolute -right-1 -top-1 h-3 w-3 rounded-full shadow-[0_0_16px_currentColor]', stateTone[workerState])} />
                    <Bot className="h-8 w-8 text-cyan-200" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-black tracking-tight text-white">AI 计划员</h2>
                      <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-bold text-cyan-100">
                        工作台 v1
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      以数据库已保存订单为依据，输出计划建议；所有排产写入仍需人工确认和后端资格校验。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
                  title="关闭"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mx-auto flex max-w-5xl flex-col gap-5">
                  <section className="rounded-3xl border border-cyan-300/20 bg-slate-950/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-200/75">Plan Request</div>
                        <h3 className="mt-2 text-2xl font-black text-white">向 AI 计划员下达任务</h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                          直接描述你要完成的计划工作。AI 会先生成建议，不会自动修改订单；排产写入必须由你确认。
                        </p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-300">
                        状态：{stateLabel[workerState]}
                      </span>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {quickPrompts.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            setPrompt(item);
                            setSelectedTaskId(null);
                          }}
                          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-bold leading-5 text-slate-200 transition hover:border-cyan-200/40 hover:bg-cyan-300/10 hover:text-white"
                        >
                          {item}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={prompt}
                      onChange={(event) => {
                        setPrompt(event.target.value);
                        setSelectedTaskId(null);
                      }}
                      rows={5}
                      placeholder="例如：把现在能排单的计划按交期从周一排到周六，交期一定优先，同一天交期工时高的排前面，每天尽量按本周总工时平均值上下浮动500分钟。"
                      className="mt-5 w-full resize-none rounded-3xl border border-white/10 bg-slate-950/75 p-5 text-base leading-7 text-white outline-none placeholder:text-slate-500 focus:border-cyan-200/50"
                    />

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs leading-5 text-slate-500">
                        规则边界：只排图纸已发、物料已齐订单；交期优先；同交期工时高优先；本周负荷按日均值均衡分配。
                      </p>
                      <button
                        type="button"
                        onClick={askPlanner}
                        disabled={isThinking}
                        className="flex min-w-44 items-center justify-center gap-2 rounded-2xl bg-cyan-200 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {isThinking ? '正在生成建议' : '生成计划建议'}
                      </button>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-emerald-300/20 bg-emerald-300/[0.055] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-200/75">Plan Result</div>
                        <h3 className="mt-2 text-2xl font-black text-white">执行建议</h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                          这里仅展示可理解、可执行的计划信息。通过系统校验后，才允许人工确认执行。
                        </p>
                      </div>
                      {schedulePlanValidation ? (
                        <span className={cn('rounded-full border px-3 py-1.5 text-xs font-black', schedulePlanValidation.ok ? 'border-emerald-200/35 bg-emerald-300/15 text-emerald-100' : 'border-rose-200/35 bg-rose-400/15 text-rose-100')}>
                          {schedulePlanValidation.ok ? '已通过计划校验' : '未通过计划校验'}
                        </span>
                      ) : (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-400">等待建议</span>
                      )}
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-sm font-black text-white">AI 计划结论</div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                        {plannerReport?.conclusion ?? diagnosis?.reply ?? '尚未生成计划建议。请先在上方输入任务，点击“生成计划建议”。'}
                      </p>
                    </div>

                    <div className="mt-5">
                      {renderSchedulePlanPreview()}
                      {!hasScheduleDraft ? (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-slate-300">
                          当前还没有可执行排产草案。你可以直接输入排产需求，或点击下方按钮生成排产草案。
                          <div className="mt-4">
                            <button
                              type="button"
                              onClick={generateRuleScheduleDraft}
                              disabled={isThinking}
                              className="rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-4 py-2.5 text-xs font-black text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50"
                            >
                              生成规则排产建议
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {diagnosis?.unreasonableAlerts.length ? (
                      <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
                        <div className="text-sm font-black text-amber-100">需要注意</div>
                        <div className="mt-2 space-y-1 text-sm leading-6 text-amber-50">
                          {diagnosis.unreasonableAlerts.slice(0, 5).map((alert, index) => (
                            <div key={`${alert}-${index}`}>{alert}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {executionResult ? (
                      <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                        <div className="text-sm font-black text-emerald-100">执行结果</div>
                        <div className="mt-3 grid gap-2 text-sm text-slate-200 md:grid-cols-4">
                          <span>时间：{executionResult.executedAt}</span>
                          <span>成功：{executionResult.successCount} 单</span>
                          <span>拦截：{executionResult.blockedCount} 单</span>
                          <span>失败：{executionResult.failedCount} 单</span>
                        </div>
                        {executionResult.details.length ? (
                          <details className="mt-3 text-xs leading-5 text-emerald-50">
                            <summary className="cursor-pointer font-bold">查看拦截或失败原因</summary>
                            {executionResult.details.slice(0, 8).map((item, index) => (
                              <div key={`${item.orderId ?? item.type}-${index}`} className="mt-2 rounded-xl border border-white/10 bg-slate-950/40 p-2">
                                {item.orderId ? `订单 ${shortId(item.orderId)}：` : ''}
                                {item.reason}
                              </div>
                            ))}
                          </details>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-slate-950/60 p-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                        <div className="text-sm leading-6 text-slate-300">
                          执行前必须人工确认。确认后才会调用后端写入；后端仍会重新校验图纸、物料和排产资格。
                          {!schedulePlanExecutable ? ' 当前排单草案未通过计划逻辑校验，不能执行。' : ''}
                        </div>
                        <button
                          type="button"
                          onClick={applyMutations}
                          disabled={!hasMutations || isApplying || !schedulePlanExecutable}
                          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                        >
                          {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                          确认并执行排单建议
                        </button>
                      </div>
                    </div>
                  </section>

                  <details className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <summary className="cursor-pointer text-sm font-black text-slate-200">更多功能与诊断</summary>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <button type="button" onClick={runMorningCheck} disabled={isMorningChecking} className="rounded-xl border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50">一键晨检</button>
                      <button type="button" onClick={generateDailyReport} className="rounded-xl border border-emerald-200/25 bg-emerald-300/10 px-3 py-2 text-xs font-black text-emerald-100 hover:bg-emerald-300/15">生成日报</button>
                      <button type="button" onClick={copyDailyReport} disabled={!dailyReport} className="rounded-xl border border-violet-200/25 bg-violet-300/10 px-3 py-2 text-xs font-black text-violet-100 hover:bg-violet-300/15 disabled:opacity-50">复制日报</button>
                      <button type="button" onClick={checkContext} disabled={isChecking} className="rounded-xl border border-slate-300/20 bg-slate-700/35 px-3 py-2 text-xs font-black text-slate-200 hover:bg-slate-700/50 disabled:opacity-50">检查配置</button>
                    </div>
                    <div className="mt-4 grid gap-3 text-xs leading-5 text-slate-400 md:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-slate-950/45 p-3">待办：{todoStats.pending} 待处理 / {todoStats.must} 必须处理</div>
                      <div className="rounded-xl border border-white/10 bg-slate-950/45 p-3">日报：{dailyReport ? `已生成 ${formatDateTime(dailyReport.createdAt)}` : '尚未生成'}</div>
                      <div className="rounded-xl border border-white/10 bg-slate-950/45 p-3">诊断：{diagnostics?.db?.connected ? '数据库连接正常' : '可按需检查'}</div>
                    </div>
                    {diagnostics?.readyFlags ? (
                      <p className="mt-3 text-xs leading-5 text-slate-500">
                        新导入数据验收仍以“导入前基线 + 导入后 delta 检查”为准；历史不一致数据本阶段不处理。
                      </p>
                    ) : null}
                  </details>

                  {errorMessage ? (
                    <p className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">{errorMessage}</p>
                  ) : null}
                </div>
              </div>

              <nav className="hidden shrink-0 border-b border-white/10 bg-slate-950/55 px-4 py-3">
                <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                  {plannerTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'rounded-2xl border px-3 py-2 text-left transition',
                        activeTab === tab.id
                          ? 'border-cyan-200/50 bg-cyan-300/15 text-white shadow-[0_0_24px_rgba(34,211,238,0.14)]'
                          : 'border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="text-sm font-black">{tab.label}</div>
                      <div className="mt-0.5 hidden text-[11px] text-slate-400 lg:block">{tab.description}</div>
                    </button>
                  ))}
                </div>
              </nav>

              <div className="hidden min-h-0 flex-1 overflow-y-auto p-4">
                {activeTab === 'morning' && (
                  <section className="space-y-4">
                    <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.06] p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/80">Morning Check</div>
                          <h3 className="mt-2 text-2xl font-black text-white">AI 计划员一键晨检</h3>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">只做分析、待办和日报草稿；不会修改订单，也不会执行 AI 建议动作。</p>
                        </div>
                        <button type="button" onClick={runMorningCheck} disabled={isMorningChecking} className="flex items-center gap-2 rounded-2xl bg-cyan-200 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60">
                          {isMorningChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          {isMorningChecking ? '晨检执行中' : '开始今日晨检'}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      {metricCard('总订单', activeSummary.totalOrders, '系统已保存')}
                      {metricCard('可排产', activeSummary.schedulableOrders, '图纸和物料就绪', 'emerald')}
                      {metricCard('图纸未发', activeSummary.blockedByDrawing, '技术攻坚池', 'red')}
                      {metricCard('物料未齐', activeSummary.blockedByMaterial, '仓库配料池', 'amber')}
                      {metricCard('今日负荷', `${loadSummary.todayMinutes}/${currentBaseLimit}`, '分钟')}
                      {metricCard('本周负荷', loadSummary.weekMinutes, '分钟')}
                      {metricCard('交期风险', activeSummary.riskOrders, '需关注', activeSummary.riskOrders > 0 ? 'red' : 'emerald')}
                      {metricCard('异常/安灯', abnormalCount, '车间反馈', abnormalCount > 0 ? 'red' : 'emerald')}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-sm font-black text-white">晨检状态</div>
                      <p className="mt-1 text-sm text-slate-400">{morningCheckStatusLabel[morningCheckStatus]}</p>
                      {morningCheckResult?.summary && <p className="mt-3 rounded-xl border border-cyan-200/15 bg-slate-950/40 p-3 text-sm leading-6 text-slate-200">{morningCheckResult.summary}</p>}
                      {morningCheckResult?.errorMessage && <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{morningCheckResult.errorMessage}</p>}
                    </div>
                  </section>
                )}

                {activeTab === 'tasks' && (
                  <section className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      {AI_PLANNER_TASK_TEMPLATES.map((item) => (
                        <button key={item.id} type="button" onClick={() => { setSelectedTaskId(item.id); setPrompt(buildPromptFromTemplate(item.id, taskNote)); }} className={cn('rounded-2xl border p-4 text-left transition', selectedTaskId === item.id ? 'border-cyan-200/50 bg-cyan-300/15 text-white' : 'border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.06]')}>
                          <div className="text-sm font-black">{item.name}</div>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{item.prompt}</p>
                        </button>
                      ))}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-black text-white">向 AI 计划员下达任务</h3>
                        {selectedTask && <span className="rounded-full border border-cyan-200/25 bg-cyan-300/10 px-3 py-1 text-xs font-bold text-cyan-100">当前任务：{selectedTask.name}</span>}
                      </div>
                      <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setSelectedTaskId(null); }} rows={4} placeholder="例如：检查今天哪些订单可以排产，哪些不能排产，并说明原因。" className="w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-200/50" />
                      <div className="mt-3 flex flex-wrap gap-2">
                        {quickPrompts.map((item) => <button key={item} type="button" onClick={() => { setPrompt(item); setSelectedTaskId(null); }} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.08]">{item}</button>)}
                      </div>
                      <button type="button" onClick={askPlanner} disabled={isThinking} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60">
                        {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {isThinking ? 'AI 正在分析' : selectedTaskId ? '执行计划任务' : '下达任务'}
                      </button>
                    </div>
                    <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
                      <div className="mb-2 text-sm font-black text-cyan-100">计划员结论</div>
                      <p className="text-sm leading-6 text-slate-200">{plannerReport?.conclusion ?? diagnosis?.reply ?? '等待任务。运行晨检或计划任务后，这里会显示 AI 计划员的业务结论。'}</p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4">
                        <div className="mb-3 text-sm font-black text-rose-100">优先动作</div>
                        {(plannerReport?.priorityActions ?? []).slice(0, 6).map((action, index) => <div key={`${action.title}-${index}`} className={cn('mb-2 rounded-xl border p-3 text-xs leading-5', priorityTone[action.level] ?? priorityTone.SHOULD)}><div className="font-black">{cleanLabel(cleanPriorityLabel, action.level)}：{action.title}</div><div className="mt-1 opacity-85">{action.reason}</div><div className="mt-1 text-[11px] opacity-70">涉及订单：{compactOrderIds(action.relatedOrderIds)}</div></div>)}
                        {!(plannerReport?.priorityActions ?? []).length && <p className="text-sm text-slate-400">暂无优先动作。</p>}
                      </div>
                      <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
                        <div className="mb-3 text-sm font-black text-amber-100">不可排产归类</div>
                        {(plannerReport?.blockedGroups ?? []).filter((group) => group.count > 0).slice(0, 6).map((group, index) => <div key={`${group.reasonType}-${index}`} className="mb-2 rounded-xl border border-amber-200/20 bg-slate-950/35 p-3 text-xs leading-5 text-amber-50"><div className="font-black">{cleanLabel(cleanBlockReasonLabel, group.reasonType)}：{group.count} 单</div><div className="mt-1">{group.suggestion}</div><div className="mt-1 text-[11px] text-amber-100/70">涉及订单：{compactOrderIds(group.orderIds)}</div></div>)}
                        {!((plannerReport?.blockedGroups ?? []).filter((group) => group.count > 0).length) && <p className="text-sm text-slate-400">暂无阻塞归类。</p>}
                      </div>
                      <div className="rounded-2xl border border-violet-300/20 bg-violet-400/10 p-4">
                        <div className="mb-3 text-sm font-black text-violet-100">AI 需要确认的问题</div>
                        {(plannerReport?.questionsForHuman ?? []).slice(0, 6).map((question, index) => <div key={`${question.question}-${index}`} className="mb-2 rounded-xl border border-violet-200/20 bg-slate-950/35 p-3 text-xs leading-5 text-violet-50"><div className="font-black">{question.question}</div><div className="mt-1 opacity-85">{question.whyItMatters}</div><div className="mt-1 text-[11px] opacity-70">负责人：{question.suggestedOwner || '计划员确认'}；订单：{compactOrderIds(question.relatedOrderIds)}</div></div>)}
                        {!(plannerReport?.questionsForHuman ?? []).length && <p className="text-sm text-slate-400">暂无需要主管确认的问题。</p>}
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === 'todos' && (
                  <section className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div><h3 className="text-lg font-black text-white">AI 计划员待办</h3><p className="mt-1 text-xs text-slate-400">待办只保存在本机；标记状态不会修改订单。</p></div>
                        <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-cyan-300/15 px-3 py-1 text-cyan-100">待处理 {todoStats.pending}</span><span className="rounded-full bg-rose-300/15 px-3 py-1 text-rose-100">必须 {todoStats.must}</span><span className="rounded-full bg-emerald-300/15 px-3 py-1 text-emerald-100">已处理 {todoStats.done}</span></div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">{(['ALL', 'PENDING', 'DONE', 'IGNORED'] as TodoFilter[]).map((filter) => <button key={filter} type="button" onClick={() => setTodoFilter(filter)} className={cn('rounded-full border px-3 py-1.5 text-xs font-bold', todoFilter === filter ? 'border-cyan-200/50 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-white/[0.035] text-slate-300')}>{filter === 'ALL' ? '全部' : cleanTodoStatusLabel[filter]}</button>)}</div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {visibleTodos.length ? visibleTodos.map((todo) => (
                        <div key={todo.id} className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
                          <div className="flex flex-wrap items-center gap-2"><span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', todoStatusTone[todo.status])}>{cleanTodoStatusLabel[todo.status]}</span>{todo.level && <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', priorityTone[todo.level])}>{cleanLabel(cleanPriorityLabel, todo.level)}</span>}<span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">{cleanTodoSourceLabel[todo.source]}</span></div>
                          <div className="mt-3 text-sm font-black text-white">{todo.title}</div>
                          {todo.reason && <p className="mt-2 text-xs leading-5 text-slate-300">{todo.reason}</p>}
                          {todo.detail && <p className="mt-2 text-xs leading-5 text-slate-400">{todo.detail}</p>}
                          <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2"><span>负责人：{todo.suggestedOwner || '计划员确认'}</span><span title={(todo.relatedOrderIds ?? []).join(', ')}>订单：{compactOrderIds(todo.relatedOrderIds)}</span><span>任务：{todo.taskName || '自由任务'}</span><span>创建：{formatDateTime(todo.createdAt)}</span></div>
                          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => copyTodoText(todo)} className="rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-300/15">复制跟进话术</button>{todo.status !== 'DONE' && <button type="button" onClick={() => updateTodoStatus(todo.id, 'DONE')} className="rounded-xl border border-emerald-200/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-300/15">标记已处理</button>}{todo.status !== 'PENDING' && <button type="button" onClick={() => updateTodoStatus(todo.id, 'PENDING')} className="rounded-xl border border-slate-400/30 bg-slate-700/40 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700/60">标记待处理</button>}{todo.status !== 'IGNORED' && <button type="button" onClick={() => updateTodoStatus(todo.id, 'IGNORED')} className="rounded-xl border border-slate-500/30 bg-slate-800/50 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800/70">忽略</button>}</div>
                        </div>
                      )) : <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-slate-400 lg:col-span-2">当前 AI 没有生成待办。可以执行“每日排产体检”或“AI 主动问题清单”。</div>}
                    </div>
                  </section>
                )}

                {activeTab === 'report' && (
                  <section className="space-y-4">
                    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-black text-white">AI 计划员日报</h3><p className="mt-1 text-xs leading-5 text-slate-400">日报仅用于计划沟通与交接，不会修改订单。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={generateDailyReport} className="rounded-xl border border-emerald-200/30 bg-emerald-300/15 px-3 py-2 text-xs font-black text-emerald-100 hover:bg-emerald-300/20">生成日报</button><button type="button" onClick={copyDailyReport} disabled={!dailyReport} className="rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50">复制日报</button><button type="button" onClick={downloadDailyReport} disabled={!dailyReport} className="rounded-xl border border-violet-200/30 bg-violet-300/10 px-3 py-2 text-xs font-black text-violet-100 hover:bg-violet-300/15 disabled:opacity-50">下载 Markdown</button><button type="button" onClick={() => setDailyReport(null)} disabled={!dailyReport} className="rounded-xl border border-slate-500/30 bg-slate-800/50 px-3 py-2 text-xs font-black text-slate-300 hover:bg-slate-800/70 disabled:opacity-50">清空日报</button></div></div>
                    </div>
                    {dailyReport ? <div className="space-y-3"><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-base font-black text-white">{dailyReport.title}</div><div className="mt-1 text-xs text-slate-400">生成时间：{formatDateTime(dailyReport.createdAt)}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{dailyReport.summary}</p></div><div className="grid gap-3 md:grid-cols-4">{metricCard('总订单', dailyReport.contextOverview.totalOrders ?? '暂无', '日报摘要')}{metricCard('可排产', dailyReport.contextOverview.schedulableOrders ?? '暂无', '就绪订单', 'emerald')}{metricCard('待处理', dailyReport.todoStats.pending, 'AI 待办', 'amber')}{metricCard('必须处理', dailyReport.todoStats.must, '高优先级', 'red')}</div><button type="button" onClick={() => setShowDailyMarkdown((value) => !value)} className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/[0.06]">{showDailyMarkdown ? '收起 Markdown 预览' : '展开 Markdown 预览'}</button>{showDailyMarkdown && <pre className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-5 text-slate-300">{dailyReport.markdown}</pre>}</div> : <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-slate-400">暂无日报草稿。可以先执行晨检，也可以基于当前页面摘要生成简版日报。</div>}
                  </section>
                )}

                {activeTab === 'execution' && (
                  <section className="space-y-4">
                    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4"><div className="mb-2 text-lg font-black text-white">建议执行</div><p className="text-sm leading-6 text-slate-300">AI 只提出建议。涉及排产写入必须人工确认，后端仍会校验图纸和物料状态。</p><div className="mt-2 text-xs text-slate-500">{mutationSummary}</div></div>
                    {renderSchedulePlanPreview()}
                    {!hasScheduleDraft ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-slate-300">
                        ?? AI ??????????????????????????????????????????????????????????
                    {executionResult ? (
                      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                        <div className="text-sm font-black text-emerald-100">????</div>
                        <div className="mt-2 grid gap-2 text-sm text-slate-200 md:grid-cols-4">
                          <span>???{executionResult.executedAt}</span>
                          <span>???{executionResult.successCount}</span>
                          <span>???{executionResult.blockedCount}</span>
                          <span>???{executionResult.failedCount}</span>
                        </div>
                        {executionResult.details.length ? <details className="mt-3 text-xs leading-5 text-emerald-50"><summary className="cursor-pointer font-bold">????/????</summary>{executionResult.details.slice(0, 8).map((item, index) => <div key={`${item.orderId ?? item.type}-${index}`} className="mt-2 rounded-xl border border-white/10 bg-slate-950/40 p-2">{item.orderId ? `?? ${shortId(item.orderId)}?` : ""}{item.reason}</div>)}</details> : null}
                      </div>
                    ) : null}
                        <div className="mt-3"><button type="button" onClick={generateRuleScheduleDraft} disabled={isThinking} className="rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50">????????</button></div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 lg:grid-cols-2">{diagnosis?.proposedMutations.length ? diagnosis.proposedMutations.map((mutation, index) => <div key={`${mutation.type}-${index}`} className="rounded-2xl border border-violet-300/20 bg-violet-400/10 p-4 text-sm leading-6 text-violet-50"><div className="font-black">{cleanLabel(cleanMutationTypeLabel, mutation.type)}</div>{'orderId' in mutation && mutation.orderId && <div className="text-xs text-violet-100/75">订单：<span title={mutation.orderId}>{shortId(mutation.orderId)}</span></div>}{'newDate' in mutation && <div className="text-xs text-violet-100/75">目标日期：{mutation.newDate}</div>}{'minutes' in mutation && <div className="text-xs text-violet-100/75">异常工时：{mutation.minutes} 分钟；原因：{mutation.reason}</div>}<button type="button" onClick={() => rejectMutation(index)} disabled={ignoredMutationIndexes.includes(index)} className="mt-3 rounded-xl border border-violet-200/30 px-3 py-2 text-xs font-bold text-violet-100 disabled:opacity-50">{ignoredMutationIndexes.includes(index) ? '已忽略' : '忽略此建议'}</button></div>) : <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-slate-400 lg:col-span-2">暂无待人工确认的执行建议。</div>}</div>
                    <div className="rounded-2xl border border-emerald-300/20 bg-slate-950/60 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="text-sm leading-6 text-slate-300">确认后才会调用后端执行建议；后端仍会校验图纸/物料状态，执行层仍受排产资格硬规则保护。{!schedulePlanExecutable ? ' 当前排单草案未通过计划逻辑校验，不能执行。' : ''}</div><button type="button" onClick={applyMutations} disabled={!hasMutations || isApplying || !schedulePlanExecutable} className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500">{isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}{scheduleMutations.length ? '一键执行排单建议' : '确认执行建议'}</button></div></div>
                    <div className="rounded-2xl border border-slate-600/40 bg-slate-950/55 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div className="text-sm font-bold text-slate-100">可导出的汇总数据</div><button type="button" onClick={exportExcel} disabled={!hasExportRows} className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" />导出 Excel</button></div><p className="text-sm text-slate-400">{hasExportRows ? `当前可导出 ${diagnosis?.exportDataSummary.length ?? 0} 条 AI 汇总。` : 'AI 返回汇总数据后可导出 Excel。'}</p></div>
                  </section>
                )}

                {activeTab === 'diagnostics' && (
                  <section className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-black text-white">诊断</h3><p className="mt-1 text-xs text-slate-400">仅显示业务化诊断，不展示原始 JSON、密钥或数据库连接串。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={checkContext} disabled={isChecking} className="rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50">{isChecking ? '检查中' : '检查 AI 上下文'}</button>{diagnostics?.db?.aiAuditStatus?.enabled ? <button type="button" onClick={checkAuditWritable} disabled={isCheckingAuditWrite} className="rounded-xl border border-emerald-200/30 bg-emerald-300/10 px-3 py-2 text-xs font-black text-emerald-100 hover:bg-emerald-300/15 disabled:opacity-50">{isCheckingAuditWrite ? '测试中' : '测试 AI 记忆写入'}</button> : null}</div></div></div>
                    <div className="grid gap-3 md:grid-cols-3"><div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4"><div className="text-sm font-black text-cyan-100">模型配置</div><p className="mt-2 text-sm text-slate-300">{diagnostics?.ai ? (diagnostics.ai.configured ? `已配置 ${diagnostics.ai.provider ?? ''} ${diagnostics.ai.model ?? ''}` : '未配置 AI Key') : '尚未检查'}</p></div><div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4"><div className="text-sm font-black text-emerald-100">数据库</div><p className="mt-2 text-sm text-slate-300">{diagnostics?.db ? (diagnostics.db.connected ? '连接正常' : '连接异常') : '尚未检查'}</p></div><div className="rounded-2xl border border-violet-300/20 bg-violet-300/10 p-4"><div className="text-sm font-black text-violet-100">AI 记忆</div><p className="mt-2 text-sm text-slate-300">{diagnostics?.db?.aiAuditStatus?.enabled ? '已启用，历史和建议可持久化' : '未启用，AI 分析仍可使用'}</p></div></div>
                    <div className="rounded-2xl border border-sky-300/20 bg-sky-400/10 p-4 text-sm leading-6 text-sky-50"><div className="font-black">AI 当前页面视角</div><div className="mt-3 grid gap-2 md:grid-cols-4"><span>当前视图：{mergedUiContext.currentView ?? '未知'}</span><span>已加载订单：{mergedUiContext.loadedOrderCount ?? orders.length} 单</span><span>当前任务：{mergedUiContext.selectedTaskName ?? '自由输入'}</span><span>可见范围：{mergedUiContext.visibleOrderIds?.length ?? 0} 个订单 ID</span></div></div>
                    <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-50"><div className="font-black">数据一致性风险</div><p className="mt-2">历史数据当前选择暂不处理；新导入数据验收以“导入前基线 + 导入后 delta 检查”为准。</p>{diagnostics?.readyFlags ? <div className="mt-3 space-y-1 text-xs text-amber-100/90"><p>历史不一致：{diagnostics.readyFlags.legacyTextReadyButFlagBlocked ?? 0} 单</p><p>最近 24 小时：{diagnostics.readyFlags.recent24hProblemCount ?? 0} 单；最近 7 天：{diagnostics.readyFlags.recent7dProblemCount ?? 0} 单</p><p>源头判断：{cleanSourceRiskLabel[diagnostics.readyFlags.sourceRiskLevel ?? 'LOW']}</p></div> : <p className="mt-2 text-xs">点击“检查 AI 上下文”后读取 ready-flags 诊断。</p>}</div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="font-black text-white">历史任务</div>{!history || !history.ok ? <p className="mt-2 text-sm text-slate-400">AI 历史任务暂不可用。若 AI 审计表未部署，分析仍可使用，但历史不会持久化。</p> : history.data.length === 0 ? <p className="mt-2 text-sm text-slate-400">暂无历史任务。</p> : <div className="mt-3 grid gap-2">{history.data.slice(0, 5).map((run) => <div key={run.id} className="rounded-xl border border-white/10 bg-slate-950/45 p-3 text-xs text-slate-300"><div className="font-bold text-white">{run.userPrompt.slice(0, 80)}</div><div className="mt-1">时间：{formatDateTime(run.createdAt)}；状态：{run.status}; 建议：{run._count?.suggestions ?? 0}</div></div>)}</div>}{auditWritableResult && <p className={cn('mt-3 rounded-xl border p-3 text-xs', auditWritableResult.ok ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100' : 'border-rose-300/20 bg-rose-400/10 text-rose-100')}>{auditWritableResult.message}</p>}</div>
                    {errorMessage && <p className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">{errorMessage}</p>}
                    {safePreview(modelPreview) && <p className="rounded-2xl border border-slate-600/40 bg-slate-950/55 p-4 text-xs text-slate-400">模型预览：{safePreview(modelPreview)}</p>}
                  </section>
                )}
              </div>
            </div>

            <div className="hidden grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
              <section className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200/80">Employee State</div>
                      <div className="mt-2 flex items-center gap-2 text-lg font-black">
                        <span className={cn('h-2.5 w-2.5 rounded-full shadow-[0_0_14px_currentColor]', stateTone[workerState])} />
                        {stateLabel[workerState]}
                      </div>
                    </div>
                    <Radio className="h-6 w-6 text-cyan-200" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <div className="text-slate-500">模型配置</div>
                      <div className="mt-1 font-bold text-cyan-100">
                        {diagnostics?.ai ? (diagnostics.ai.configured ? '已配置' : '缺失配置') : '待检测'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <div className="text-slate-500">数据库连接</div>
                      <div className="mt-1 font-bold text-cyan-100">
                        {diagnostics?.db ? (diagnostics.db.connected ? '已连接' : '连接异常') : '待检测'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
                    最近一次分析：{lastAnalysisAt || '尚未执行'}
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-300/20 bg-sky-400/10 p-4 text-xs leading-5 text-sky-50">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-sky-100">AI 当前页面视角</div>
                      <p className="mt-1 text-sky-100/75">AI 读取范围：数据库 + 当前页面上下文。页面上下文只辅助理解，不参与写入判定。</p>
                    </div>
                    <Database className="h-5 w-5 text-sky-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-sky-200/15 bg-slate-950/35 p-3">
                      <div className="text-sky-100/60">当前视图</div>
                      <div className="mt-1 font-black text-white">{mergedUiContext.currentView ?? '未知'}</div>
                    </div>
                    <div className="rounded-xl border border-sky-200/15 bg-slate-950/35 p-3">
                      <div className="text-sky-100/60">已加载订单</div>
                      <div className="mt-1 font-black text-white">{mergedUiContext.loadedOrderCount ?? orders.length} 单</div>
                    </div>
                    <div className="rounded-xl border border-sky-200/15 bg-slate-950/35 p-3">
                      <div className="text-sky-100/60">当前任务</div>
                      <div className="mt-1 font-black text-white">{mergedUiContext.selectedTaskName ?? '自由输入'}</div>
                    </div>
                    <div className="rounded-xl border border-sky-200/15 bg-slate-950/35 p-3">
                      <div className="text-sky-100/60">可见订单 ID</div>
                      <div className="mt-1 font-black text-white">{mergedUiContext.visibleOrderIds?.length ?? 0} 条</div>
                    </div>
                  </div>
                  {(uiContext?.visibleOrderIds?.length ?? 0) >= 200 && (
                    <p className="mt-2 text-[11px] text-amber-100">仅传递前 200 条可见订单 ID，避免页面上下文过大。</p>
                  )}
                  <p className="mt-2 text-[11px] text-sky-100/75">
                    导入验收建议：使用 `pnpm ready-flags:baseline` + `pnpm check:ready-flags:delta`，历史不一致仅作为背景。
                  </p>
                </div>

                <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.055] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-white">当前上下文总览</h3>
                      <p className="text-xs text-slate-400">
                        {summarySource === 'server' ? 'AI 本次实际读取摘要' : '页面本地摘要'}
                      </p>
                    </div>
                    <Gauge className="h-5 w-5 text-cyan-200" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {metricCard('总订单', activeSummary.totalOrders, '已保存订单')}
                    {metricCard('可排产', activeSummary.schedulableOrders, '图纸与物料均就绪', 'emerald')}
                    {metricCard('图纸未下发', activeSummary.blockedByDrawing, '进入技术攻坚池', 'red')}
                    {metricCard('物料未齐', activeSummary.blockedByMaterial, '进入仓库配料池', 'amber')}
                    {metricCard('已排产', activeSummary.scheduledOrders, '已有排产状态')}
                    {metricCard('交期风险', activeSummary.riskOrders, '逾期且未排产', activeSummary.riskOrders > 0 ? 'red' : 'emerald')}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {metricCard('今日负荷', `${loadSummary.todayMinutes}/${currentBaseLimit}`, '分钟')}
                    {metricCard('本周负荷', loadSummary.weekMinutes, '分钟')}
                    {metricCard('急单', activeSummary.urgentOrders, '需人工关注', 'amber')}
                    {metricCard('异常/安灯', abnormalCount, '车间反馈', abnormalCount > 0 ? 'red' : 'emerald')}
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-xs leading-5 text-slate-300">
                    AI 本次实际读取订单：{activeSummary.totalOrders} 条；可排产 {activeSummary.schedulableOrders} 条；图纸未下发 {activeSummary.blockedByDrawing} 条；物料未齐 {activeSummary.blockedByMaterial} 条；已排产 {activeSummary.scheduledOrders} 条。
                  </div>
                  {contextWarnings.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {contextWarnings.map((warning, index) => (
                        <div key={`${warning}-${index}`} className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-bold text-white">AI 能读取什么</h3>
                    <Database className="h-5 w-5 text-cyan-200" />
                  </div>
                  <div className="grid gap-3 text-xs leading-5 text-slate-300">
                    <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/10 p-3">
                      <div className="mb-2 font-bold text-emerald-100">当前能读取</div>
                      <p>数据库已保存订单、图纸/物料布尔状态、交期、工时、assignedDay、plannedDate、dailyCapacity；如果 MesAbnormalClaim 表存在，也会读取异常工时台账。</p>
                    </div>
                    <div className="rounded-xl border border-slate-500/20 bg-slate-950/45 p-3">
                      <div className="mb-2 font-bold text-slate-100">当前不能读取</div>
                      <p>未保存的临时编辑、页面筛选/滚动状态、完整物料明细、设备能力、班次、工序路线、AI 决策历史。因为这些目前没有独立数据模型或未显式传入。</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-xs leading-5 text-amber-50">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-amber-100">数据一致性风险</div>
                      <p className="mt-1 text-amber-100/80">
                        历史不一致数量仅作为背景；当前用户已选择暂不处理历史数据。新导入数据验收以“导入前基线 + 导入后 delta 检查”为准。
                      </p>
                    </div>
                    <ShieldCheck className="h-5 w-5 text-amber-100" />
                  </div>
                  {diagnostics?.readyFlags ? (
                    <div className="space-y-2">
                      <p>
                        状态不一致：{diagnostics.readyFlags.legacyTextReadyButFlagBlocked ?? 0} 单；图纸文本已发但布尔 false：
                        {diagnostics.readyFlags.drawingTextReadyButFlagFalse ?? 0} 单；物料文本料齐但布尔 false：
                        {diagnostics.readyFlags.materialTextReadyButFlagFalse ?? 0} 单。
                      </p>
                      <p className="text-amber-100/85">
                        最近问题更新时间：{formatDateTime(diagnostics.readyFlags.latestProblemUpdatedAt)}；最早问题创建时间：
                        {formatDateTime(diagnostics.readyFlags.oldestProblemCreatedAt)}。
                      </p>
                      <p className="text-amber-100/85">
                        最近 24 小时问题：{diagnostics.readyFlags.recent24hProblemCount ?? 0} 单；最近 7 天问题：
                        {diagnostics.readyFlags.recent7dProblemCount ?? 0} 单；源头风险：
                        {diagnostics.readyFlags.sourceRiskLevel ?? 'LOW'}。
                      </p>
                      {(diagnostics.readyFlags.sourceRiskLevel ?? 'LOW') === 'HIGH' ? (
                        <p className="font-bold text-rose-100">
                          最近 24 小时窗口包含已知历史更新时间问题，建议使用基线方式验收新导入数据。
                        </p>
                      ) : (
                        <p className="font-bold text-emerald-100">最近窗口未发现状态不一致；导入验收仍建议使用基线 delta 检查。</p>
                      )}
                      {(diagnostics.readyFlags.possibleReasons ?? []).length > 0 && (
                        <div className="rounded-xl border border-amber-200/20 bg-slate-950/30 p-3">
                          <div className="mb-1 font-bold text-amber-100">来源判断</div>
                          <ul className="space-y-1">
                            {(diagnostics.readyFlags.possibleReasons ?? []).map((reason) => (
                              <li key={reason}>- {reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(diagnostics.readyFlags.examples ?? []).slice(0, 3).length > 0 && (
                        <div className="rounded-xl border border-amber-200/20 bg-slate-950/30 p-3 text-[11px] text-amber-100/85">
                          <div className="mb-1 font-bold text-amber-100">示例订单</div>
                          {(diagnostics.readyFlags.examples ?? []).slice(0, 3).map((order) => (
                            <p key={order.id}>
                              {order.client} / {order.model}：drawing={order.drawing || '-'} materials={order.materials || '-'} flag=
                              {String(order.isDrawingReady)}/{String(order.isMaterialReady)}；创建 {formatDateTime(order.createdAt)}；更新{' '}
                              {formatDateTime(order.updatedAt)}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="font-bold text-amber-100">这不是 AI 模型问题，是订单历史字段与排产布尔字段不一致。</p>
                      {readyFlagProblems > 0 && (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={repairReadyFlags}
                            disabled={isRepairingReadyFlags}
                            className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200/40 bg-amber-200 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isRepairingReadyFlags ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                            历史数据可选修复
                          </button>
                          <p className="text-[11px] text-amber-100/75">当前用户已选择暂不处理历史数据；此按钮仅保留为人工可选动作。</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p>点击“检查 AI 上下文”后，会读取只读诊断接口并展示历史状态不一致数量和近期新增风险。</p>
                  )}
                </div>

                <div className="rounded-2xl border border-violet-300/20 bg-violet-400/10 p-4 text-xs leading-5 text-violet-50">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-violet-100">AI 任务编号</div>
                      <p className="mt-1 text-violet-100/80">
                        {auditRef?.aiRunId ? `本次任务 ID：${auditRef.aiRunId}` : '尚未产生本次 AI 审计任务'}
                      </p>
                    </div>
                    <ClipboardList className="h-5 w-5 text-violet-100" />
                  </div>
                  <p>审计状态：{auditRef ? (auditRef.enabled ? '已记录' : '未记录') : '待分析'}</p>
                  {auditRef?.persistenceWarning && <p className="mt-2 text-amber-100">{auditRef.persistenceWarning}</p>}
                </div>

                <button
                  type="button"
                  onClick={checkContext}
                  disabled={isChecking}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  检查 AI 上下文
                </button>

                {diagnostics && (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs leading-5 text-slate-300">
                    <div className="mb-2 font-bold text-white">上下文诊断结果</div>
                    <p>检查时间：{diagnostics.checkedAt}</p>
                    <p>AI Key：{diagnostics.ai ? (diagnostics.ai.configured ? '已配置' : `缺失 ${diagnostics.ai.missing?.join(', ') || '未知变量'}`) : '检测失败'}</p>
                    <p>Provider/Model：{diagnostics.ai?.provider ?? '未知'} / {diagnostics.ai?.model ?? '未知'}</p>
                    <p>数据库：{diagnostics.db ? (diagnostics.db.connected ? '连接成功' : '连接失败') : '检测失败'}</p>
                    <p>缺失表：{diagnostics.db?.missingTables?.length ? diagnostics.db.missingTables.join(', ') : '无'}</p>
                    {diagnostics.db?.aiAuditStatus && (
                      <div className="mt-2 rounded-xl border border-violet-300/20 bg-violet-400/10 p-3 text-violet-50">
                        <p className="font-bold">AI 记忆：{diagnostics.db.aiAuditStatus.enabled ? '已启用' : '未启用'}</p>
                        <p className="mt-1">{diagnostics.db.aiAuditStatus.message}</p>
                        {diagnostics.db.aiAuditStatus.enabled ? (
                          <p className="mt-1 text-violet-100/80">历史任务、上下文快照、建议审批将持久化。</p>
                        ) : (
                          <p className="mt-1 text-amber-100">
                            缺失表：{diagnostics.db.aiAuditStatus.missingTables.join(', ') || '未知'}。这不会影响 AI 分析订单，但历史任务和建议审批无法长期保存。
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={checkAuditWritable}
                          disabled={!diagnostics.db.aiAuditStatus.enabled || isCheckingAuditWrite}
                          className="mt-3 rounded-xl border border-violet-200/30 bg-violet-300/10 px-3 py-2 text-xs font-bold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isCheckingAuditWrite ? '测试中...' : '测试 AI 记忆写入'}
                        </button>
                        {auditWritableResult && (
                          <p className={cn('mt-2', auditWritableResult.ok ? 'text-emerald-200' : 'text-rose-200')}>
                            {auditWritableResult.message}
                          </p>
                        )}
                      </div>
                    )}
                    {diagnostics.db?.missingTables?.includes('MesAbnormalClaim') && (
                      <p className="mt-2 text-amber-200">MesAbnormalClaim 缺表时，异常工时上下文会降级，但订单上下文不一定失败。</p>
                    )}
                    {diagnostics.readyFlags && (
                      <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-amber-50">
                        <p>
                          ready-flags：{diagnostics.readyFlags.message || '已完成只读诊断'}；状态不一致{' '}
                          {diagnostics.readyFlags.legacyTextReadyButFlagBlocked ?? 0} 单。
                        </p>
                        <p className="mt-1">
                          最近问题更新时间：{formatDateTime(diagnostics.readyFlags.latestProblemUpdatedAt)}；最早问题创建时间：
                          {formatDateTime(diagnostics.readyFlags.oldestProblemCreatedAt)}。
                        </p>
                        <p className="mt-1">
                          最近 24 小时问题：{diagnostics.readyFlags.recent24hProblemCount ?? 0} 单；最近 7 天问题：
                          {diagnostics.readyFlags.recent7dProblemCount ?? 0} 单；源头风险：
                          {diagnostics.readyFlags.sourceRiskLevel ?? 'LOW'}。
                        </p>
                        {(diagnostics.readyFlags.sourceRiskLevel ?? 'LOW') === 'HIGH' ? (
                          <p className="mt-1 font-bold text-rose-100">
                            最近 24 小时窗口包含已知历史更新时间问题，建议使用基线方式验收新导入数据。
                          </p>
                        ) : (
                          <p className="mt-1 font-bold text-emerald-100">最近窗口未发现状态不一致；导入验收仍建议使用基线 delta 检查。</p>
                        )}
                        {(diagnostics.readyFlags.possibleReasons ?? []).length > 0 && (
                          <div className="mt-2 space-y-1 text-[11px] text-amber-100/85">
                            {(diagnostics.readyFlags.possibleReasons ?? []).map((reason) => (
                              <p key={reason}>- {reason}</p>
                            ))}
                          </div>
                        )}
                        {(diagnostics.readyFlags.examples ?? []).slice(0, 5).length > 0 && (
                          <div className="mt-2 space-y-1 text-[11px] text-amber-100/85">
                            {(diagnostics.readyFlags.examples ?? []).slice(0, 5).map((order) => (
                              <p key={order.id}>
                                {order.client} / {order.model}：drawing={order.drawing || '-'} materials={order.materials || '-'} flag=
                                {String(order.isDrawingReady)}/{String(order.isMaterialReady)}；创建 {formatDateTime(order.createdAt)}；更新{' '}
                                {formatDateTime(order.updatedAt)}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {(diagnostics.aiError || diagnostics.dbError || diagnostics.readyFlagsError) && (
                      <div className="mt-2 rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-rose-100">
                        {diagnostics.aiError && <p>AI 状态异常：{diagnostics.aiError}</p>}
                        {diagnostics.dbError && <p>数据库状态异常：{diagnostics.dbError}</p>}
                        {diagnostics.readyFlagsError && <p>ready-flags 状态异常：{diagnostics.readyFlagsError}</p>}
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs leading-5 text-slate-300">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="font-bold text-white">历史任务</div>
                    <button
                      type="button"
                      onClick={loadAuditHistory}
                      disabled={isLoadingHistory}
                      className="rounded-xl border border-violet-300/25 bg-violet-300/10 px-3 py-1.5 text-xs font-bold text-violet-100 disabled:opacity-60"
                    >
                      {isLoadingHistory ? '读取中...' : '刷新'}
                    </button>
                  </div>
                  {diagnostics?.db?.aiAuditStatus && !diagnostics.db.aiAuditStatus.enabled && (
                    <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-amber-100">
                      <p className="font-bold">AI 历史任务暂不可用</p>
                      <p>原因：AI 审计表尚未部署或数据库不可达。</p>
                      <p>当前 AI 仍可分析订单，但分析记录不会持久化。</p>
                    </div>
                  )}
                  {!history && <p>点击刷新可查看最近 10 次 AI 分析记录。</p>}
                  {history && !history.ok && (
                    <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-amber-100">
                      <p className="font-bold">AI 历史任务暂不可用</p>
                      <p>原因：AI 审计表尚未部署或数据库不可达。</p>
                      <p>{history.error}</p>
                      <p>当前 AI 仍可分析订单，但分析记录不会持久化。</p>
                    </div>
                  )}
                  {history?.ok && history.data.length === 0 && <p>暂无历史任务。</p>}
                  {history?.ok && history.data.length > 0 && (
                    <div className="space-y-2">
                      {history.data.slice(0, 10).map((item) => (
                        <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-white">{item.status}</span>
                            <span>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                          </div>
                          <p className="mt-1 line-clamp-2">{item.userPrompt}</p>
                          <p className="mt-1 text-slate-500">
                            建议 {item._count?.suggestions ?? 0} 条 / {item.provider ?? '-'} {item.model ?? ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-black text-white">
                        <Sparkles className="h-5 w-5 text-emerald-200" />
                        AI 计划员晨检
                      </div>
                      <p className="mt-1 text-xs leading-5 text-emerald-50/80">
                        一键执行“每日排产体检”，只生成分析、待办和日报草稿；不会修改订单，也不会执行 AI 建议动作。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={runMorningCheck}
                      disabled={isMorningChecking}
                      className="rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isMorningChecking ? '晨检执行中...' : 'AI 计划员一键晨检'}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-4">
                    <div className="rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs text-emerald-50">
                      <div className="text-slate-400">当前状态</div>
                      <div className="mt-1 font-black text-white">{morningCheckStatusLabel[morningCheckStatus]}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs text-emerald-50">
                      <div className="text-slate-400">最近晨检</div>
                      <div className="mt-1 font-black text-white">{morningCheckResult ? formatDateTime(morningCheckResult.createdAt) : '暂无'}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs text-emerald-50">
                      <div className="text-slate-400">生成待办</div>
                      <div className="mt-1 font-black text-white">{morningCheckResult?.todoCount ?? 0} 项</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs text-emerald-50">
                      <div className="text-slate-400">日报草稿</div>
                      <div className="mt-1 font-black text-white">{morningCheckResult?.reportId ? '已生成' : '未生成'}</div>
                    </div>
                  </div>
                  {(morningCheckResult?.summary || morningCheckResult?.errorMessage) && (
                    <p className="mt-3 rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs leading-5 text-emerald-50">
                      {morningCheckResult.errorMessage ?? morningCheckResult.summary}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-cyan-200" />
                    <h3 className="font-bold text-white">向 AI 计划员下达任务</h3>
                  </div>
                  <div className="mb-4">
                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">计划员工任务区</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {AI_PLANNER_TASK_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => selectTaskTemplate(template.id)}
                          className={cn(
                            'rounded-2xl border p-3 text-left transition hover:-translate-y-0.5',
                            selectedTaskId === template.id
                              ? 'border-cyan-200 bg-cyan-300/15 shadow-[0_0_24px_rgba(34,211,238,0.18)]'
                              : 'border-white/10 bg-slate-950/45 hover:border-cyan-300/35 hover:bg-cyan-300/10'
                          )}
                        >
                          <div className="text-sm font-black text-white">{template.name}</div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">{template.prompt}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={selectedTaskId ? taskNote : prompt}
                    onChange={(event) => {
                      if (selectedTaskId) setTaskNote(event.target.value);
                      else setPrompt(event.target.value);
                    }}
                    placeholder={
                      selectedTaskId
                        ? '可选：补充本次任务的特殊要求，例如重点看某个客户或本周产能。'
                        : '例如：分析今天哪些订单可以排产，哪些不能排产，并说明原因'
                    }
                    className="min-h-28 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  {selectedTask && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
                      <span>当前任务：{selectedTask.name}</span>
                      <button type="button" onClick={() => setSelectedTaskId(null)} className="font-bold text-cyan-50 hover:text-white">
                        切回自由输入
                      </button>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {quickPrompts.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setSelectedTaskId(null);
                          setPrompt(item);
                        }}
                        className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/15"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={askPlanner}
                    disabled={isThinking}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isThinking ? 'AI 计划员正在读取上下文并分析...' : selectedTaskId ? '执行计划任务' : '下达任务'}
                  </button>
                </div>

                {errorMessage && (
                  <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100">
                    {errorMessage}
                  </div>
                )}

                {modelPreview && (
                  <div className="rounded-2xl border border-slate-600/50 bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">
                    模型/接口安全预览：{modelPreview}
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.055] p-4 lg:col-span-2">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold text-cyan-100">
                      <ClipboardList className="h-4 w-4" />
                      计划员结论{selectedTask ? ` · ${selectedTask.name}` : ''}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">
                      {plannerReport?.conclusion ?? diagnosis?.reply ?? '等待任务。AI 计划员会读取数据库已保存订单、产能基准和可用异常工时台账，然后给出计划建议。'}
                    </p>
                  </div>

                  {plannerReport && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 lg:col-span-2">
                      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                        <Gauge className="h-4 w-4 text-cyan-200" />
                        计划员工结构化汇报
                      </div>
                      <div className="grid gap-3 xl:grid-cols-3">
                        <div className="space-y-2 xl:col-span-2">
                          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">优先动作</div>
                          {plannerReport.priorityActions.length ? (
                            plannerReport.priorityActions.map((action, index) => (
                              <div
                                key={`${action.level}-${action.title}-${index}`}
                                className={cn('rounded-xl border p-3 text-xs leading-5', priorityTone[action.level] ?? priorityTone.WATCH)}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-black text-white">{action.title}</span>
                                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-black">{action.level}</span>
                                </div>
                                <p className="mt-1">{action.reason}</p>
                                {!!action.relatedOrderIds?.length && (
                                  <p className="mt-1 text-[11px] opacity-75">订单：{action.relatedOrderIds.slice(0, 6).join(', ')}</p>
                                )}
                              </div>
                            ))
                          ) : (
                            <p className="rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs text-slate-400">暂无优先动作。</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">不可排产归类</div>
                          {plannerReport.blockedGroups.length ? (
                            plannerReport.blockedGroups.map((group, index) => (
                              <div key={`${group.reasonType}-${index}`} className="rounded-xl border border-amber-300/15 bg-amber-400/10 p-3 text-xs leading-5 text-amber-50">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-black text-white">{blockedGroupLabel[group.reasonType] ?? group.reasonType}</span>
                                  <span>{group.count} 单</span>
                                </div>
                                <p className="mt-1">{group.suggestion}</p>
                                {!!group.orderIds.length && <p className="mt-1 text-[11px] opacity-75">示例：{group.orderIds.slice(0, 5).join(', ')}</p>}
                              </div>
                            ))
                          ) : (
                            <p className="rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs text-slate-400">暂无阻塞归类。</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">AI 需要向你确认的问题</div>
                        {plannerReport.questionsForHuman.length ? (
                          <div className="grid gap-2 md:grid-cols-2">
                            {plannerReport.questionsForHuman.map((question, index) => (
                              <div key={`${question.question}-${index}`} className="rounded-xl border border-violet-300/15 bg-violet-400/10 p-3 text-xs leading-5 text-violet-50">
                                <div className="font-black text-white">{question.question}</div>
                                <p className="mt-1">{question.whyItMatters}</p>
                                <p className="mt-1 text-[11px] text-violet-100/75">负责人：{question.suggestedOwner || '待确认'}</p>
                                {!!question.relatedOrderIds?.length && (
                                  <p className="mt-1 text-[11px] text-violet-100/75">订单：{question.relatedOrderIds.slice(0, 6).join(', ')}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs text-slate-400">暂无需要人工确认的问题。</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/60 p-4 lg:col-span-2">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-black text-white">
                          <ClipboardList className="h-4 w-4 text-cyan-200" />
                          AI 计划员待办
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          待办状态只保存在本机 localStorage，用于计划跟进；标记已处理或忽略不会修改订单，也不会执行排产写入。
                        </p>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                        <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-cyan-100">
                          <div className="text-lg font-black">{todoStats.pending}</div>
                          <div>待处理</div>
                        </div>
                        <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-emerald-100">
                          <div className="text-lg font-black">{todoStats.done}</div>
                          <div>已处理</div>
                        </div>
                        <div className="rounded-xl border border-slate-500/30 bg-slate-800/45 px-3 py-2 text-slate-300">
                          <div className="text-lg font-black">{todoStats.ignored}</div>
                          <div>已忽略</div>
                        </div>
                        <div className="rounded-xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-rose-100">
                          <div className="text-lg font-black">{todoStats.must}</div>
                          <div>MUST</div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      {(['ALL', 'PENDING', 'DONE', 'IGNORED'] as TodoFilter[]).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setTodoFilter(filter)}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-xs font-bold transition',
                            todoFilter === filter
                              ? 'border-cyan-200 bg-cyan-300/20 text-cyan-50'
                              : 'border-white/10 bg-white/[0.035] text-slate-400 hover:border-cyan-300/30 hover:text-cyan-100'
                          )}
                        >
                          {filter === 'ALL' ? '全部' : todoStatusLabel[filter]}
                        </button>
                      ))}
                    </div>

                    {visibleTodos.length ? (
                      <div className="grid gap-3 xl:grid-cols-2">
                        {visibleTodos.map((todo) => (
                          <div key={todo.id} className={cn('rounded-2xl border p-3', todoStatusTone[todo.status])}>
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-black">
                                  {todoStatusLabel[todo.status]}
                                </span>
                                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-black">
                                  {todoSourceLabel[todo.source]}
                                </span>
                                {todo.level && (
                                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', priorityTone[todo.level] ?? priorityTone.WATCH)}>
                                    {todo.level}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400">{formatDateTime(todo.createdAt)}</span>
                            </div>
                            <div className="text-sm font-black leading-5 text-white">{todo.title}</div>
                            {(todo.reason || todo.detail) && <p className="mt-2 text-xs leading-5 text-slate-300">{todo.reason || todo.detail}</p>}
                            <div className="mt-2 grid gap-1 text-[11px] leading-4 text-slate-400">
                              <span>建议负责人：{todo.suggestedOwner || '待指定'}</span>
                              <span>当前任务：{todo.taskName || '自由任务'}</span>
                              <span>涉及订单：{todo.relatedOrderIds?.length ? todo.relatedOrderIds.join(', ') : '无指定订单'}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => copyTodoText(todo)}
                                className="rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-300/15"
                              >
                                复制跟进话术
                              </button>
                              {todo.status !== 'DONE' && (
                                <button
                                  type="button"
                                  onClick={() => updateTodoStatus(todo.id, 'DONE')}
                                  className="rounded-xl border border-emerald-200/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-300/15"
                                >
                                  标记已处理
                                </button>
                              )}
                              {todo.status !== 'PENDING' && (
                                <button
                                  type="button"
                                  onClick={() => updateTodoStatus(todo.id, 'PENDING')}
                                  className="rounded-xl border border-slate-400/30 bg-slate-700/40 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700/60"
                                >
                                  标记待处理
                                </button>
                              )}
                              {todo.status !== 'IGNORED' && (
                                <button
                                  type="button"
                                  onClick={() => updateTodoStatus(todo.id, 'IGNORED')}
                                  className="rounded-xl border border-slate-500/30 bg-slate-800/50 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800/70"
                                >
                                  忽略
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-slate-400">
                        当前 AI 没有生成待办。你可以执行“每日排产体检”或“AI 主动问题清单”。
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-emerald-300/20 bg-slate-950/60 p-4 lg:col-span-2">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-black text-white">
                          <FileWarning className="h-4 w-4 text-emerald-200" />
                          AI 计划员日报
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          日报仅用于计划沟通与交接，不会修改订单。实际排产仍以系统排产结果和后端硬规则为准。
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={generateDailyReport}
                          className="rounded-xl border border-emerald-200/30 bg-emerald-300/15 px-3 py-2 text-xs font-black text-emerald-100 hover:bg-emerald-300/20"
                        >
                          生成日报
                        </button>
                        <button
                          type="button"
                          onClick={copyDailyReport}
                          disabled={!dailyReport}
                          className="rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          复制日报
                        </button>
                        <button
                          type="button"
                          onClick={downloadDailyReport}
                          disabled={!dailyReport}
                          className="rounded-xl border border-violet-200/30 bg-violet-300/10 px-3 py-2 text-xs font-black text-violet-100 hover:bg-violet-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          下载 Markdown
                        </button>
                        <button
                          type="button"
                          onClick={() => setDailyReport(null)}
                          disabled={!dailyReport}
                          className="rounded-xl border border-slate-500/30 bg-slate-800/50 px-3 py-2 text-xs font-black text-slate-300 hover:bg-slate-800/70 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          清空日报
                        </button>
                      </div>
                    </div>

                    {dailyReport ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-base font-black text-white">{dailyReport.title}</div>
                              <div className="mt-1 text-xs text-slate-400">生成时间：{formatDateTime(dailyReport.createdAt)}</div>
                            </div>
                            <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-[11px] font-bold text-emerald-100">
                              当前报告基于系统已保存数据和页面上下文生成
                            </span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{dailyReport.summary}</p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-cyan-100">
                            <div className="text-[11px] font-bold text-slate-400">今日排产概览</div>
                            <div className="mt-2 text-xs leading-5">
                              总订单 {dailyReport.contextOverview.totalOrders ?? '暂无数据'} / 可排产 {dailyReport.contextOverview.schedulableOrders ?? '暂无数据'} / 已排产 {dailyReport.contextOverview.scheduledOrders ?? '暂无数据'}
                            </div>
                          </div>
                          <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-amber-100">
                            <div className="text-[11px] font-bold text-slate-400">风险订单摘要</div>
                            <div className="mt-2 text-xs leading-5">
                              风险 {dailyReport.contextOverview.riskOrders ?? '暂无数据'} / 图纸未发 {dailyReport.contextOverview.blockedByDrawing ?? '暂无数据'} / 物料未齐 {dailyReport.contextOverview.blockedByMaterial ?? '暂无数据'}
                            </div>
                          </div>
                          <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-emerald-100">
                            <div className="text-[11px] font-bold text-slate-400">待办处理统计</div>
                            <div className="mt-2 text-xs leading-5">
                              待处理 {dailyReport.todoStats.pending} / 已处理 {dailyReport.todoStats.done} / 已忽略 {dailyReport.todoStats.ignored} / MUST {dailyReport.todoStats.must}
                            </div>
                          </div>
                          <div className="rounded-xl border border-violet-300/20 bg-violet-300/10 p-3 text-violet-100">
                            <div className="text-[11px] font-bold text-slate-400">待主管确认</div>
                            <div className="mt-2 text-xs leading-5">{dailyReport.pendingQuestions.length} 项需要确认</div>
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-3">
                          <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3">
                            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-rose-100">必须处理事项</div>
                            <ul className="space-y-2 text-xs leading-5 text-rose-50">
                              {dailyReport.nextActions.slice(0, 6).map((item, index) => (
                                <li key={`${item}-${index}`}>{index + 1}. {item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-2xl border border-violet-300/20 bg-violet-400/10 p-3">
                            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-violet-100">待主管确认</div>
                            <ul className="space-y-2 text-xs leading-5 text-violet-50">
                              {dailyReport.pendingQuestions.slice(0, 6).map((item, index) => (
                                <li key={`${item}-${index}`}>{index + 1}. {item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-3">
                            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-cyan-100">明日/下一步建议</div>
                            <ul className="space-y-2 text-xs leading-5 text-cyan-50">
                              {dailyReport.riskSummary.slice(0, 6).map((item, index) => (
                                <li key={`${item}-${index}`}>{index + 1}. {item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setShowDailyMarkdown((value) => !value)}
                          className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/[0.06]"
                        >
                          {showDailyMarkdown ? '收起 Markdown 预览' : '展开 Markdown 预览'}
                        </button>
                        {showDailyMarkdown && (
                          <pre className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-5 text-slate-300">
                            {dailyReport.markdown}
                          </pre>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-slate-400">
                        暂无日报草稿。执行每日排产体检或 AI 主动问题清单后，可生成用于交接班的计划员日报；也可以先基于当前页面摘要生成简版日报。
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-100">
                      <AlertTriangle className="h-4 w-4" />
                      发现的问题
                    </div>
                    {diagnosis?.unreasonableAlerts.length ? (
                      <ul className="space-y-2">
                        {diagnosis.unreasonableAlerts.map((alert, index) => (
                          <li key={`${alert}-${index}`} className="rounded-xl border border-amber-300/15 bg-slate-950/35 px-3 py-2 text-sm leading-5 text-amber-50">
                            {alert}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">暂无风险项，或尚未运行 AI 计划员。</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-violet-300/20 bg-violet-400/10 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-violet-100">
                      <Zap className="h-4 w-4" />
                      建议动作
                    </div>
                    {diagnosis?.proposedMutations.length ? (
                      <ul className="space-y-2">
                        {diagnosis.proposedMutations.map((mutation, index) => (
                          <li key={`${mutation.type}-${index}`} className="rounded-xl border border-violet-300/15 bg-slate-950/35 px-3 py-2 text-xs leading-5 text-violet-50">
                            <span className="font-black">{mutation.type}</span>
                            {'orderId' in mutation && mutation.orderId ? ` · ${mutation.orderId}` : ''}
                            {'newDate' in mutation ? ` · ${mutation.newDate}` : ''}
                            {'minutes' in mutation ? ` · ${mutation.minutes} 分钟 · ${mutation.reason}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">暂无待人工确认的执行项。</p>
                    )}
                  </div>

                  {hasMutations && (
                    <div className="rounded-2xl border border-violet-300/20 bg-violet-400/10 p-4 lg:col-span-2">
                      <div className="mb-2 text-sm font-bold text-violet-100">建议审批状态</div>
                      <p className="text-xs leading-5 text-violet-50">
                        当前建议 {diagnosis?.proposedMutations.length ?? 0} 条；已忽略 {ignoredMutationIndexes.length} 条；其余为待人工确认。
                      </p>
                      <button
                        type="button"
                        onClick={() => rejectMutation(0)}
                        disabled={ignoredMutationIndexes.includes(0)}
                        className="mt-3 rounded-xl border border-violet-200/30 px-3 py-2 text-xs font-bold text-violet-100 disabled:opacity-50"
                      >
                        忽略第一条建议
                      </button>
                    </div>
                  )}

                  <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 lg:col-span-2">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-100">
                      <CheckCircle2 className="h-4 w-4" />
                      人工确认执行区
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="text-sm leading-6 text-slate-300">
                        AI 只提出建议；涉及排产写入必须人工确认。后端会二次校验 `canEnterSchedule`，图纸未发或物料未齐的订单不会被 AI 强行排产。
                        <div className="mt-1 text-xs text-slate-500">{mutationSummary}</div>
                      </div>
                      <button
                        type="button"
                        onClick={applyMutations}
                        disabled={!hasMutations || isApplying}
                        className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                      >
                        {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                        确认执行建议
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-600/40 bg-slate-950/55 p-4 lg:col-span-2">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
                        <FileWarning className="h-4 w-4" />
                        可导出的汇总数据
                      </div>
                      <button
                        type="button"
                        onClick={exportExcel}
                        disabled={!hasExportRows}
                        className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Download className="h-4 w-4" />
                        导出 Excel
                      </button>
                    </div>
                    {diagnosis?.exportDataSummary.length ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        {diagnosis.exportDataSummary.slice(0, 6).map((row, index) => (
                          <div key={index} className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-slate-300">
                            <div className="font-black text-white">{row.型号 || `汇总 ${index + 1}`}</div>
                            <div>状态：{row.状态 || '-'}</div>
                            <div>计划工时：{row.计划工时 ?? 0}</div>
                            <div>交期风险：{row.交期风险 || '-'}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">AI 返回 exportDataSummary 后，这里会展示并支持导出。</p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </motion.aside>
        </div>
      )}
    </>
  );
}
