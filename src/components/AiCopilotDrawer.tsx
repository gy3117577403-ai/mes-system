'use client';

import { useMemo, useState, useTransition } from 'react';
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
  interactWithAiCopilotAction,
  type AiCopilotActionResult,
  type AiCopilotContextSummary,
  type AiCopilotResponse,
} from '@/actions/aiSchedulerActions';
import { repairMisclassifiedReadyOrdersAction } from '@/actions/mesActions';
import type { Order } from '@/types';
import {
  canEnterSchedule,
  getScheduleBlockReasons,
  isScheduleAssigned,
} from '@/lib/scheduleEligibility';
import { isOrderCompletedStatus } from '@/lib/orderStatus';
import { cn } from '@/lib/uiTheme';

type AiCopilotDrawerProps = {
  currentBaseLimit: number;
  orders: Order[];
  onApplied?: () => Promise<void> | void;
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
  missingTables?: string[];
  schemaStatus?: string;
  message?: string;
};

type ReadyFlagsPayload = {
  ok?: boolean;
  totalProblemOrders?: number;
  legacyTextReadyButFlagBlocked?: number;
  drawingTextReadyButFlagFalse?: number;
  materialTextReadyButFlagFalse?: number;
  examples?: Array<{
    id: string;
    client: string;
    model: string;
    drawing: string;
    materials: string;
    isDrawingReady: boolean;
    isMaterialReady: boolean;
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
  '分析今天哪些订单可以排产，哪些不能排产，并说明原因',
  '帮我找出图纸已发但还没排的订单',
  '检查有没有交期风险和产能风险',
  '按交期和工时给出本周排产建议',
];

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

export default function AiCopilotDrawer({ currentBaseLimit, orders, onApplied }: AiCopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [diagnosis, setDiagnosis] = useState<AiCopilotResponse | null>(null);
  const [serverSummary, setServerSummary] = useState<AiCopilotContextSummary | null>(null);
  const [summarySource, setSummarySource] = useState<'local' | 'server'>('local');
  const [errorMessage, setErrorMessage] = useState('');
  const [modelPreview, setModelPreview] = useState('');
  const [lastAnalysisAt, setLastAnalysisAt] = useState('');
  const [workerState, setWorkerState] = useState<WorkerState>('standby');
  const [diagnostics, setDiagnostics] = useState<ContextDiagnostics | null>(null);
  const [isThinking, startThinking] = useTransition();
  const [isApplying, startApplying] = useTransition();
  const [isChecking, startChecking] = useTransition();
  const [isRepairingReadyFlags, startRepairingReadyFlags] = useTransition();

  const localSummary = useMemo(
    () => buildLocalSummary(orders, currentBaseLimit),
    [orders, currentBaseLimit]
  );
  const activeSummary = serverSummary ?? localSummary;
  const hasMutations = (diagnosis?.proposedMutations.length ?? 0) > 0;
  const hasExportRows = (diagnosis?.exportDataSummary.length ?? 0) > 0;

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
    const orderMoves = diagnosis.proposedMutations.filter((m) => m.type === 'UPDATE_ORDER_DATE').length;
    const deliveryChanges = diagnosis.proposedMutations.filter((m) => m.type === 'UPDATE_DELIVERY_DATE').length;
    const exceptionLogs = diagnosis.proposedMutations.filter((m) => m.type === 'LOG_EXCEPTION_HOUR').length;
    return [`排产调整 ${orderMoves}`, `交期修改 ${deliveryChanges}`, `异常工时 ${exceptionLogs}`].join(' / ');
  }, [diagnosis]);

  const askPlanner = () => {
    const text = prompt.trim();
    if (!text) {
      toast.error('请先向 AI 计划员下达任务');
      return;
    }
    setErrorMessage('');
    setModelPreview('');
    setWorkerState('thinking');
    startThinking(async () => {
      try {
        const res: AiCopilotActionResult = await interactWithAiCopilotAction(text, currentBaseLimit);
        const preview = safePreview(res.rawModelPreview);
        setModelPreview(preview);
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
        toast.success('AI 计划员已完成本轮分析');
      } catch (error) {
        const message = classifyCopilotError(error instanceof Error ? error.message : String(error));
        setErrorMessage(message);
        setWorkerState('error');
        toast.error('AI 计划员执行失败，请稍后重试');
      }
    });
  };

  const applyMutations = () => {
    if (!diagnosis?.proposedMutations.length) return;
    setErrorMessage('');
    setModelPreview('');
    setWorkerState('confirming');
    startApplying(async () => {
      try {
        const res = await executeAiCopilotMutationsAction(diagnosis.proposedMutations);
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

  const repairReadyFlags = () => {
    const confirmed = window.confirm(
      '该操作会把历史文本中明确为已发图/料齐的订单，同步到排产布尔字段。系统仍会保留排产硬规则。是否继续？'
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/40 bg-slate-950/90 text-cyan-200 shadow-[0_0_36px_rgba(34,211,238,0.35)] backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-200 hover:text-white"
        title="AI 计划员工工作台"
      >
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]" />
        <Bot className="h-8 w-8" />
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

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
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
                        历史订单如果存在文本状态与布尔字段不一致，AI 和排产系统会以布尔字段为准。这是历史数据问题，不是 AI 模型问题。
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
                      {readyFlagProblems > 0 && (
                        <button
                          type="button"
                          onClick={repairReadyFlags}
                          disabled={isRepairingReadyFlags}
                          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200/40 bg-amber-200 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRepairingReadyFlags ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                          同步历史图纸/物料状态
                        </button>
                      )}
                    </div>
                  ) : (
                    <p>点击“检查 AI 上下文”后，会读取只读诊断接口并展示历史状态不一致数量。</p>
                  )}
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
                    {diagnostics.db?.missingTables?.includes('MesAbnormalClaim') && (
                      <p className="mt-2 text-amber-200">MesAbnormalClaim 缺表时，异常工时上下文会降级，但订单上下文不一定失败。</p>
                    )}
                    {diagnostics.readyFlags && (
                      <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-amber-50">
                        <p>
                          ready-flags：{diagnostics.readyFlags.message || '已完成只读诊断'}；状态不一致{' '}
                          {diagnostics.readyFlags.legacyTextReadyButFlagBlocked ?? 0} 单。
                        </p>
                        {(diagnostics.readyFlags.examples ?? []).slice(0, 5).length > 0 && (
                          <div className="mt-2 space-y-1 text-[11px] text-amber-100/85">
                            {(diagnostics.readyFlags.examples ?? []).slice(0, 5).map((order) => (
                              <p key={order.id}>
                                {order.client} / {order.model}：drawing={order.drawing || '-'} materials={order.materials || '-'} flag=
                                {String(order.isDrawingReady)}/{String(order.isMaterialReady)}
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
              </section>

              <section className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-cyan-200" />
                    <h3 className="font-bold text-white">向 AI 计划员下达任务</h3>
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="例如：分析今天哪些订单可以排产，哪些不能排产，并说明原因"
                    className="min-h-28 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {quickPrompts.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPrompt(item)}
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
                    {isThinking ? 'AI 计划员正在读取上下文并分析...' : '下达任务'}
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
                      计划员结论
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">
                      {diagnosis?.reply ?? '等待任务。AI 计划员会读取数据库已保存订单、产能基准和可用异常工时台账，然后给出计划建议。'}
                    </p>
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
