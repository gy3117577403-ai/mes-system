'use client';

import { useMemo, useState, useTransition } from 'react';
import * as XLSX from 'xlsx';
import { Bot, Download, Send, Sparkles, TriangleAlert, Zap, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  executeAiCopilotMutationsAction,
  interactWithAiCopilotAction,
  type AiCopilotResponse,
} from '@/actions/aiSchedulerActions';

type AiCopilotDrawerProps = {
  currentBaseLimit: number;
  onApplied?: () => Promise<void> | void;
};

const quickPrompts = [
  '将丰田单子延后一天，并检查本周是否超负荷',
  '记录缺料停工150分钟，原因是核心物料未到',
  '审查本周交期倒挂和每日工时溢出',
  '把最紧急的订单优先排到本周前两天',
];

function classifyCopilotError(message: string): string {
  const text = message.trim();
  if (!text) return 'AI 排单执行失败，请检查模型配置、数据库连接或稍后重试。';
  if (/DEEPSEEK_API_KEY|API Key|AI Key|未配置/.test(text)) {
    return 'AI Key 未配置：请在 Sealos 环境变量中配置 DEEPSEEK_API_KEY。';
  }
  if (/MesAbnormalClaim|缺表|missing table|does not exist|不可用/.test(text)) {
    return '数据库缺表：异常工时台账表 MesAbnormalClaim 不可用，AI 将降级为仅基于订单上下文分析。';
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

export default function AiCopilotDrawer({ currentBaseLimit, onApplied }: AiCopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [diagnosis, setDiagnosis] = useState<AiCopilotResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [modelPreview, setModelPreview] = useState('');
  const [isThinking, startThinking] = useTransition();
  const [isApplying, startApplying] = useTransition();

  const hasMutations = (diagnosis?.proposedMutations.length ?? 0) > 0;
  const hasExportRows = (diagnosis?.exportDataSummary.length ?? 0) > 0;

  const mutationSummary = useMemo(() => {
    if (!diagnosis?.proposedMutations.length) return '暂无待执行动作';
    const orderMoves = diagnosis.proposedMutations.filter((m) => m.type === 'UPDATE_ORDER_DATE').length;
    const deliveryChanges = diagnosis.proposedMutations.filter((m) => m.type === 'UPDATE_DELIVERY_DATE').length;
    const exceptionLogs = diagnosis.proposedMutations.filter((m) => m.type === 'LOG_EXCEPTION_HOUR').length;
    return [`排单调整 ${orderMoves}`, `交期修改 ${deliveryChanges}`, `异常工时 ${exceptionLogs}`].join(' / ');
  }, [diagnosis]);

  const askCopilot = () => {
    const text = prompt.trim();
    if (!text) {
      toast.error('先输入一句自然语言调度指令');
      return;
    }
    setErrorMessage('');
    setModelPreview('');
    startThinking(async () => {
      try {
        const res = await interactWithAiCopilotAction(text, currentBaseLimit);
        const preview = safePreview(res.rawModelPreview);
        setModelPreview(preview);

        if (!res.ok || !res.data) {
          const message = classifyCopilotError(res.error ?? 'AI 排单执行失败，请检查模型配置、数据库连接或稍后重试。');
          setErrorMessage(message);
          toast.error(message);
          if (res.data) setDiagnosis(res.data);
          return;
        }

        setDiagnosis(res.data);
        setErrorMessage('');
        toast.success('AI 已完成排产沙盘推演');
      } catch (error) {
        const message = classifyCopilotError(error instanceof Error ? error.message : String(error));
        setErrorMessage(message);
        toast.error('AI 排单执行失败，请稍后重试');
      }
    });
  };

  const applyMutations = () => {
    if (!diagnosis?.proposedMutations.length) return;
    setErrorMessage('');
    setModelPreview('');
    startApplying(async () => {
      try {
        const res = await executeAiCopilotMutationsAction(diagnosis.proposedMutations);
        if (!res.ok) {
          if (res.unreasonableAlerts?.length) {
            setDiagnosis((prev) =>
              prev
                ? {
                    ...prev,
                    unreasonableAlerts: [...res.unreasonableAlerts!, ...prev.unreasonableAlerts],
                    proposedMutations: [],
                  }
                : prev
            );
          }
          const message = classifyCopilotError(res.error ?? '执行 AI 建议失败');
          setErrorMessage(message);
          toast.error(message);
          await onApplied?.();
          return;
        }
        toast.success(`已执行：订单更新 ${res.updatedOrders} 条，异常工时 ${res.exceptionLogs} 条`);
        await onApplied?.();
      } catch (error) {
        const message = classifyCopilotError(error instanceof Error ? error.message : String(error));
        setErrorMessage(message);
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
    const summarySheet = XLSX.utils.json_to_sheet(diagnosis.exportDataSummary);
    XLSX.utils.book_append_sheet(workbook, summarySheet, '排产诊断');

    const alertSheet = XLSX.utils.json_to_sheet(
      diagnosis.unreasonableAlerts.map((alert, index) => ({ 序号: index + 1, 合理性预警: alert }))
    );
    XLSX.utils.book_append_sheet(workbook, alertSheet, '合理性预警');

    const mutationSheet = XLSX.utils.json_to_sheet(diagnosis.proposedMutations);
    XLSX.utils.book_append_sheet(workbook, mutationSheet, 'AI建议动作');

    XLSX.writeFile(workbook, `AI排产诊断_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/50 bg-cyan-500 text-slate-950 shadow-[0_0_36px_rgba(34,211,238,0.45)] transition hover:scale-105 hover:bg-cyan-300"
        title="AI 工业调度交互副驾"
      >
        <Bot className="h-7 w-7" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-slate-950/50 backdrop-blur-sm">
          <aside className="flex h-full w-full max-w-[520px] flex-col border-l border-cyan-400/30 bg-[#07111f] shadow-2xl">
            <header className="shrink-0 border-b border-cyan-400/20 bg-slate-950/70 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-cyan-200">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-lg font-bold tracking-wide">Scheduler Copilot</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    DeepSeek 运筹推演 / 主动审查 / 异常工时 / Excel 诊断
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                  title="关闭"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <section className="space-y-3">
                <label className="text-sm font-semibold text-slate-200">自然语言调度指令</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="例如：将丰田单子延后一天，顺便检查本周是否有交期风险；记录缺料停工150分钟。"
                  className="min-h-32 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 p-4 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/20"
                />
                <div className="flex flex-wrap gap-2">
                  {quickPrompts.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPrompt(item)}
                      className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-400/20"
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={askCopilot}
                  disabled={isThinking}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {isThinking ? 'AI 正在推演车间沙盘...' : '发送给 AI 调度副驾'}
                </button>
              </section>

              <section className="mt-5 rounded-lg border border-slate-700 bg-slate-950/60">
                <div className="border-b border-slate-800 px-4 py-3">
                  <div className="text-sm font-bold text-slate-100">AI 诊断舱</div>
                  <div className="mt-1 text-xs text-slate-500">每日产能基准：{currentBaseLimit} 分钟</div>
                </div>

                <div className="space-y-4 p-4">
                  {errorMessage && (
                    <div className="rounded-md border border-red-400/40 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                      {errorMessage}
                    </div>
                  )}

                  {modelPreview && (
                    <div className="rounded-md border border-slate-600 bg-slate-900/80 p-3 text-xs leading-5 text-slate-300">
                      模型/接口安全预览：{modelPreview}
                    </div>
                  )}

                  <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 p-4">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-200">对话回应</div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
                      {diagnosis?.reply ??
                        '等待你的调度指令。AI 会读取当前真实订单、产能基准和异常工时台账后再回答。'}
                    </p>
                  </div>

                  <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-200">
                      <TriangleAlert className="h-4 w-4" />
                      合理性审查警报区
                    </div>
                    {diagnosis?.unreasonableAlerts.length ? (
                      <ul className="space-y-2">
                        {diagnosis.unreasonableAlerts.map((alert, index) => (
                          <li
                            key={`${alert}-${index}`}
                            className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-100"
                          >
                            {alert}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">暂无预警，或尚未运行 AI 审查。</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <button
                      type="button"
                      onClick={applyMutations}
                      disabled={!hasMutations || isApplying}
                      className="flex items-center justify-center gap-2 rounded-lg border border-lime-300/50 bg-lime-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
                    >
                      <Zap className="h-4 w-4" />
                      {isApplying ? '正在执行 AI 建议...' : '确认采纳 AI 建议并刷新车间'}
                    </button>
                    <div className="text-center text-xs text-slate-500">{mutationSummary}</div>

                    <button
                      type="button"
                      onClick={exportExcel}
                      disabled={!hasExportRows}
                      className="flex items-center justify-center gap-2 rounded-lg border border-cyan-300/30 bg-slate-900 px-4 py-3 text-sm font-bold text-cyan-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
                    >
                      <Download className="h-4 w-4" />
                      导出当前排产诊断与异常台账 (Excel)
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
