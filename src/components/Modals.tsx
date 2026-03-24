/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, XCircle, CheckCircle2, Package, X, UserCircle } from 'lucide-react';

export function AddOrderModal({
  isOpen,
  onClose,
  newOrderForm,
  setNewOrderForm,
  handleAddOrder
}: any) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden">
        <div className="bg-blue-600 px-6 py-4 flex justify-between items-center text-white">
          <h2 className="text-xl font-bold flex items-center gap-2"><Plus size={20} /> 实时新增排单</h2>
          <button type="button" onClick={onClose} className="hover:bg-blue-700 p-1 rounded-full"><XCircle size={24} /></button>
        </div>
        <form onSubmit={handleAddOrder} className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">客户名称</label>
              <input required value={newOrderForm.client} onChange={e => setNewOrderForm({...newOrderForm, client: e.target.value})} className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="如: 杭州电章鱼" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">产品型号</label>
              <input required value={newOrderForm.model} onChange={e => setNewOrderForm({...newOrderForm, model: e.target.value})} className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="如: T25Z2-80210" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">排产数量</label>
              <input type="number" required min="1" value={newOrderForm.qty} onChange={e => setNewOrderForm({...newOrderForm, qty: Number(e.target.value)})} className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">所需工时(分钟)</label>
              <input type="number" required min="1" value={newOrderForm.totalHours} onChange={e => setNewOrderForm({...newOrderForm, totalHours: Number(e.target.value)})} className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">销售跟单员</label>
              <input required value={newOrderForm.sales} onChange={e => setNewOrderForm({...newOrderForm, sales: e.target.value})} className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-400 mb-1">交货日期 (AI排序依据)</label>
            <input type="date" required value={newOrderForm.deliveryDate} onChange={e => setNewOrderForm({...newOrderForm, deliveryDate: e.target.value})} className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          
          <div className="flex flex-col gap-3 mt-4">
            <div className="flex items-center gap-2 bg-rose-50 p-3 rounded-lg border border-rose-200">
              <input
                type="checkbox"
                id="isUrgent"
                checked={!!newOrderForm.isUrgent}
                onChange={(e) =>
                  setNewOrderForm({ ...newOrderForm, isUrgent: e.target.checked })
                }
                className="w-4 h-4 text-rose-600 rounded focus:ring-rose-500 cursor-pointer"
              />
              <label
                htmlFor="isUrgent"
                className="text-sm font-bold text-rose-900 cursor-pointer select-none leading-snug"
              >
                🚨 标记为急单（无视图纸外的其他条件，强制进入排产池）
              </label>
            </div>
            <div className="flex items-center gap-2 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
              <input
                type="checkbox"
                id="autoSchedule"
                checked={newOrderForm.autoSchedule}
                onChange={(e) =>
                  setNewOrderForm({ ...newOrderForm, autoSchedule: e.target.checked })
                }
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <label
                htmlFor="autoSchedule"
                className="text-sm font-bold text-indigo-800 cursor-pointer flex items-center gap-1.5 select-none"
              >
                录入后直接由 AI 自动排入空闲生产日
              </label>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100 flex justify-end gap-3 mt-2">
            <button type="button" onClick={onClose} className="px-5 py-2 text-slate-400 hover:bg-slate-800/50 rounded-lg font-medium text-sm transition-colors">取消</button>
            <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm shadow-md transition-colors flex items-center gap-2">
              <CheckCircle2 size={16} /> 确认生成
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BoxSelectionModal({
  isOpen,
  onClose,
  occupiedBoxes,
  handleBoxSelect
}: any) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[200] flex items-center justify-center p-4"
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="bg-slate-900 border border-slate-700 p-8 rounded-3xl shadow-[0_0_50px_rgba(34,211,238,0.2)] w-full max-w-4xl"
          >
            <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-3xl font-black text-cyan-400 flex items-center gap-3 tracking-wider">
                  <Package className="w-8 h-8" /> 锁定周转箱编号
                </h2>
                <p className="text-slate-500 text-sm mt-1 font-mono uppercase tracking-tighter">Select available storage box for cutting task</p>
              </div>
              <button 
                onClick={onClose}
                className="text-slate-500 hover:text-white transition-all bg-slate-800 p-3 rounded-full hover:rotate-90"
              >
                <X className="w-8 h-8" />
              </button>
            </div>

            <div className="grid grid-cols-6 gap-4">
              {Array.from({ length: 30 }, (_, i) => i + 1).map(num => {
                const isOccupied = occupiedBoxes.includes(num);
                return (
                  <button
                    key={num}
                    disabled={isOccupied}
                    onClick={() => handleBoxSelect(num)}
                    className={`
                      h-20 rounded-xl font-black text-2xl transition-all duration-300 relative group overflow-hidden
                      ${isOccupied 
                        ? 'bg-slate-950 text-slate-700 border border-slate-800 cursor-not-allowed' 
                        : 'bg-slate-800 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-900/40 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:-translate-y-1 active:scale-95'
                      }
                    `}
                  >
                    {num}
                    {isOccupied && (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
                        <span className="text-[10px] text-red-500/70 rotate-12 border border-red-500/30 px-1 font-mono uppercase tracking-tighter">Occupied</span>
                      </div>
                    )}
                    {!isOccupied && (
                      <div className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus className="w-6 h-6 text-cyan-400/30" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            
            <div className="mt-8 flex justify-center gap-8 text-slate-500 text-xs font-mono uppercase tracking-widest border-t border-slate-800 pt-6">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-cyan-500/20 border border-cyan-500/50 rounded-sm"></div>
                <span>Available</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-slate-950 border border-slate-800 rounded-sm"></div>
                <span>Occupied</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function WorkerSelectionModal({
  isOpen,
  onClose,
  workers,
  handleWorkerSelect,
  newWorkerName,
  setNewWorkerName,
  handleAddWorker
}: any) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center"
        >
          <div className="bg-slate-900 border border-slate-700 w-[500px] rounded-2xl p-6 shadow-2xl relative">
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
            
            <h3 className="text-xl font-bold text-cyan-400 mb-6 flex items-center gap-2">
              <UserCircle className="w-6 h-6" /> 派发生产任务
            </h3>

            <div className="space-y-4 mb-8">
              <p className="text-slate-400 text-sm font-medium">选择现有员工：</p>
              <div className="grid grid-cols-2 gap-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                {workers.map((workerName: string) => (
                  <button
                    key={workerName}
                    onClick={() => handleWorkerSelect(workerName)}
                    className="py-3 px-4 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 hover:bg-cyan-900/30 hover:border-cyan-500/50 transition-all text-sm font-bold"
                  >
                    {workerName}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-slate-800">
              <p className="text-slate-400 text-sm font-medium mb-3">新增临时人员：</p>
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={newWorkerName}
                  onChange={(e) => setNewWorkerName(e.target.value)}
                  placeholder="输入姓名..."
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-white outline-none focus:border-cyan-500 transition-all"
                />
                <button 
                  onClick={handleAddWorker}
                  className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold transition-all"
                >
                  新增
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
