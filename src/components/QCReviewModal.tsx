'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { X, CheckCircle2, XCircle } from 'lucide-react';
import { Order } from '@/types';

export default function QCReviewModal({
  isOpen,
  onClose,
  orders,
  onApprove,
  onReject,
}: {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const pending = orders.filter((o) => o.taskStatus === 'PendingQC');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[380] flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-900 border border-amber-500/40 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-amber-950/30">
          <h2 className="text-xl font-black text-amber-400">品質審核 · 待處理 {pending.length}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {pending.length === 0 ? (
            <p className="text-center text-slate-500 py-12">暫無待品檢訂單</p>
          ) : (
            pending.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-800/80 border border-slate-700"
              >
                <div className="min-w-0">
                  <p className="font-mono font-black text-white text-lg truncate">{o.model}</p>
                  <p className="text-slate-400 text-sm truncate">{o.client}</p>
                  <p className="text-xs text-amber-400/90 mt-1">
                    報工 {o.reportedQty}/{o.totalQty} · {o.worker ? `派工 ${o.worker}` : '—'}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onApprove(o.id)}
                    className="flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    通過
                  </button>
                  <button
                    type="button"
                    onClick={() => onReject(o.id)}
                    className="flex items-center gap-1 px-4 py-2 rounded-lg bg-red-600/90 hover:bg-red-500 text-white font-bold text-sm"
                  >
                    <XCircle className="w-4 h-4" />
                    打回返工
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
