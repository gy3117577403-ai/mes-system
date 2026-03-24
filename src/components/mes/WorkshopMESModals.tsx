'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, FileImage, BellOff } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AlarmKind } from '@/types';

/** 全屏 SOP / 圖紙預覽（占位） */
export function SOPViewerModal({
  isOpen,
  onClose,
  model,
  drawingUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  model: string;
  drawingUrl: string;
}) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    const t0 = window.setTimeout(() => setLoading(true), 0);
    const t1 = window.setTimeout(() => setLoading(false), 1600);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <motion.div
      className="fixed inset-0 z-400 bg-black/90 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/90 shrink-0">
        <div className="flex items-center gap-2 text-cyan-400 font-bold">
          <FileImage className="w-6 h-6" />
          <span>查看图纸 (SOP) — {model}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400"
          aria-label="关闭"
        >
          <X className="w-7 h-7" />
        </button>
      </div>
      <button
        type="button"
        className="flex-1 flex flex-col items-center justify-center min-h-0 p-6 cursor-default"
        onClick={onClose}
        aria-label="点击空白关闭"
      >
        {loading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="h-14 w-14 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
            <p className="text-slate-400 text-sm tracking-widest">正在加载图纸资源…</p>
          </div>
        ) : (
          <div
            className="w-full max-w-5xl aspect-4/3 rounded-xl border border-slate-700 bg-linear-to-br from-slate-800 to-slate-900 flex items-center justify-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center p-8">
              <FileImage className="w-24 h-24 mx-auto text-slate-600 mb-4 opacity-50" />
              <p className="text-slate-500 text-sm mb-2">PDF / 图片阅览器占位</p>
              <p className="text-xs font-mono text-slate-600 break-all max-w-lg">
                {drawingUrl || '(未配置 drawingUrl，演示模式)'}
              </p>
            </div>
          </div>
        )}
      </button>
    </motion.div>
  );
}

const ALARM_LABEL: Record<AlarmKind, string> = {
  Material: '呼叫物料',
  Maintenance: '呼叫维修',
  QC: '呼叫质检',
};

export function AlarmPickerModal({
  isOpen,
  onClose,
  onConfirm,
  current,
  onClear,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (kind: AlarmKind) => void;
  current: AlarmKind | null;
  onClear: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-350 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-slate-900 border border-red-500/40 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-black text-red-400 mb-4 flex items-center gap-2">🚨 安灯 Andon</h3>
        <div className="space-y-2 mb-4">
          {(Object.keys(ALARM_LABEL) as AlarmKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                onConfirm(kind);
                onClose();
              }}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-red-950/50 border border-slate-700 hover:border-red-500/50 text-left px-4 font-bold text-slate-200 transition-colors"
            >
              {ALARM_LABEL[kind]}
            </button>
          ))}
        </div>
        {current && (
          <button
            type="button"
            onClick={() => {
              onClear();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <BellOff className="w-4 h-4" />
            解除呼叫
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-300"
        >
          取消
        </button>
      </motion.div>
    </div>
  );
}

/** 數字鍵盤式進度提報 */
export function ProgressKeypadModal({
  isOpen,
  onClose,
  model,
  totalQty,
  reportedQty,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  model: string;
  totalQty: number;
  reportedQty: number;
  onSubmit: (n: number) => void;
}) {
  const [raw, setRaw] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => setRaw(''), 0);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

  const handleKey = (k: string) => {
    if (k === 'C') {
      setRaw('');
      return;
    }
    if (k === '⌫') {
      setRaw((s) => s.slice(0, -1));
      return;
    }
    if (raw.length >= 8) return;
    setRaw((s) => s + k);
  };

  const handleSubmit = () => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) {
      toast.error('請輸入有效數量');
      return;
    }
    if (reportedQty + n > totalQty) {
      toast.error(`累計不能超過總數 ${totalQty}`);
      return;
    }
    onSubmit(n);
    onClose();
  };

  const preview = parseInt(raw, 10);
  const invalid =
    raw !== '' &&
    (!Number.isFinite(preview) || preview <= 0 || reportedQty + preview > totalQty);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-360 flex flex-col bg-slate-950/98">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <div>
          <p className="text-xs text-slate-500">进度提报</p>
          <p className="text-lg font-black text-white">{model}</p>
          <p className="text-sm text-cyan-400 mt-1">
            已报 {reportedQty} / 总计 {totalQty}
          </p>
        </div>
        <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800">
          <X className="w-7 h-7 text-slate-400" />
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 max-w-md mx-auto w-full">
        <div className="w-full h-16 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-end px-4 text-3xl font-mono font-black text-emerald-400">
          {raw || '0'}
        </div>
        {invalid && (
          <p className="text-red-400 text-sm text-center">
            本次数量无效：累计不能超过总数 {totalQty}
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 w-full">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => handleKey(k)}
              className="h-14 rounded-xl bg-slate-800 border border-slate-600 text-xl font-black text-white hover:bg-slate-700 active:scale-95 transition-transform shadow-lg"
            >
              {k}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={invalid || raw === ''}
          onClick={handleSubmit}
          className="w-full py-4 rounded-xl bg-linear-to-r from-emerald-600 to-cyan-600 text-white font-black text-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          确认提报
        </button>
      </div>
    </div>
  );
}
