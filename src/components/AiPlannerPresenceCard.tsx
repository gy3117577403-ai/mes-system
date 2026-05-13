'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, ClipboardList, FileText, Radio, Sparkles } from 'lucide-react';
import {
  getAiPlannerPresenceHint,
  readAiPlannerPresenceFromStorage,
  type AiPlannerPresence,
} from '@/lib/aiPlannerPresence';
import { cn } from '@/lib/uiTheme';

type AiPlannerPresenceCardProps = {
  onOpenPlanner: () => void;
  compact?: boolean;
};

function statusTone(status: AiPlannerPresence['status']): string {
  if (status === 'HAS_MUST') return 'border-rose-300/35 bg-rose-500/10 shadow-rose-500/10';
  if (status === 'HAS_TODOS') return 'border-cyan-300/30 bg-cyan-400/10 shadow-cyan-400/10';
  if (status === 'REPORT_READY') return 'border-emerald-300/30 bg-emerald-400/10 shadow-emerald-400/10';
  return 'border-slate-700/70 bg-slate-900/70 shadow-cyan-500/5';
}

function dotTone(status: AiPlannerPresence['status']): string {
  if (status === 'HAS_MUST') return 'bg-rose-300 shadow-rose-300/70';
  if (status === 'HAS_TODOS') return 'bg-cyan-300 shadow-cyan-300/70';
  if (status === 'REPORT_READY') return 'bg-emerald-300 shadow-emerald-300/70';
  return 'bg-slate-400 shadow-slate-400/50';
}

export default function AiPlannerPresenceCard({ onOpenPlanner, compact = false }: AiPlannerPresenceCardProps) {
  const [presence, setPresence] = useState<AiPlannerPresence>(() => readAiPlannerPresenceFromStorage());

  useEffect(() => {
    const refresh = () => setPresence(readAiPlannerPresenceFromStorage());
    refresh();
    window.addEventListener('gg-ai:planner-presence-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('gg-ai:planner-presence-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const hint = getAiPlannerPresenceHint(presence);

  return (
    <motion.button
      type="button"
      onClick={onOpenPlanner}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        'group mx-auto w-full max-w-[1600px] rounded-2xl border px-4 py-3 text-left shadow-2xl backdrop-blur-xl transition',
        statusTone(presence.status),
        compact ? 'md:px-3 md:py-2' : ''
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/20 bg-slate-950/80 text-cyan-100">
            <Bot className="h-5 w-5" />
            <span className={cn('absolute -right-1 -top-1 h-3 w-3 rounded-full shadow-lg', dotTone(presence.status))} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black text-white">AI 计划员工</span>
              <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-cyan-100">
                {presence.statusText}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{hint}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center text-[11px] md:min-w-[420px]">
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-cyan-100">
            <ClipboardList className="mx-auto mb-1 h-3.5 w-3.5" />
            <div className="text-lg font-black tabular-nums">{presence.pendingCount}</div>
            <div>待办</div>
          </div>
          <div className="rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-rose-100">
            <Radio className="mx-auto mb-1 h-3.5 w-3.5" />
            <div className="text-lg font-black tabular-nums">{presence.mustCount}</div>
            <div>MUST</div>
          </div>
          <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-emerald-100">
            <FileText className="mx-auto mb-1 h-3.5 w-3.5" />
            <div className="text-lg font-black">{presence.hasDailyReport ? '是' : '否'}</div>
            <div>日报</div>
          </div>
          <div className="rounded-xl border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-violet-100">
            <Sparkles className="mx-auto mb-1 h-3.5 w-3.5" />
            <div className="text-lg font-black tabular-nums">{presence.todoTotal}</div>
            <div>总项</div>
          </div>
        </div>
      </div>
    </motion.button>
  );
}
