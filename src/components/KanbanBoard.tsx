/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Cpu, Package, Calendar, Bot, Warehouse } from 'lucide-react';
import { Order, DAYS } from '@/types';
import { UserRole } from '@/types/auth';
import EnhancedOrderCard, { OrderCardRbacProps } from './OrderCard';
import { canUseKanbanDnD } from '@/lib/rbac';
import { isOrderCompletedStatus } from '@/lib/orderStatus';
import type { AppTheme, LayoutMode } from '@/lib/uiTheme';
import {
  cn,
  poolShellOuter,
  poolShellHeader,
  poolShellTitle,
  poolShellSub,
  poolEmpty,
  dayColumnShell,
  dayColumnHeader,
  kanbanOuter,
} from '@/lib/uiTheme';

interface KanbanBoardProps {
  orders: Order[];
  techPoolOrders: Order[];
  warehousePoolOrders: Order[];
  readyPoolOrders: Order[];
  isProcessing: boolean;
  getCardStatus: (task: Order) => string;
  updateOrderData: (orderId: string, field: string, value: any) => void;
  triggerBatchAISchedule: () => void;
  onDragEnd: (result: DropResult) => void;
  dailyCapacity: number;
  role: UserRole;
  orderCardRbac: OrderCardRbacProps;
  layoutMode: LayoutMode;
  theme: AppTheme;
}

export default function KanbanBoard({
  orders,
  techPoolOrders,
  warehousePoolOrders,
  readyPoolOrders,
  isProcessing,
  getCardStatus,
  updateOrderData,
  triggerBatchAISchedule,
  onDragEnd,
  dailyCapacity,
  role,
  orderCardRbac,
  layoutMode,
  theme,
}: KanbanBoardProps) {
  const canDrag = canUseKanbanDnD(role);
  const cardGap = layoutMode === 'compact' ? 'space-y-1.5' : 'space-y-3';

  const poolShell = (
    title: string,
    subtitle: string,
    accent: 'red' | 'yellow' | 'green',
    children: React.ReactNode
  ) => {
    const ring =
      accent === 'red'
        ? 'border border-red-500/50 shadow-[0_0_28px_rgba(239,68,68,0.25),inset_0_0_40px_rgba(239,68,68,0.06)]'
        : accent === 'yellow'
          ? 'border border-yellow-400/50 shadow-[0_0_28px_rgba(250,204,21,0.2),inset_0_0_40px_rgba(250,204,21,0.05)]'
          : 'border border-emerald-500/50 shadow-[0_0_28px_rgba(16,185,129,0.22),inset_0_0_40px_rgba(16,185,129,0.06)]';
    const bar =
      accent === 'red' ? 'bg-red-500' : accent === 'yellow' ? 'bg-yellow-400' : 'bg-emerald-500';
    return (
      <div
        className={cn(
          'w-[300px] min-w-[300px] shrink-0 h-full flex flex-col rounded-2xl backdrop-blur-md transition-all duration-500',
          poolShellOuter(theme),
          ring
        )}
      >
        <div
          className={cn(
            'px-4 py-3 rounded-t-2xl relative overflow-hidden border-b',
            poolShellHeader(theme)
          )}
        >
          <div className={`absolute top-0 left-0 w-full h-1 ${bar} shadow-[0_0_12px_currentColor]`} />
          <h2 className={cn('font-black flex items-center gap-2 text-sm tracking-wide mt-1', poolShellTitle(theme))}>
            {accent === 'red' && <Cpu className="w-5 h-5 text-red-400" />}
            {accent === 'yellow' && <Warehouse className="w-5 h-5 text-yellow-500" />}
            {accent === 'green' && <Package className="w-5 h-5 text-emerald-500" />}
            {title}
          </h2>
          <span className={cn('text-[11px] mt-1 font-medium block', poolShellSub(theme))}>{subtitle}</span>
        </div>
        {children}
      </div>
    );
  };

  return (
    <div className={cn('flex-1 w-full overflow-hidden flex flex-col relative', kanbanOuter(theme))}>
      <DragDropContext onDragEnd={onDragEnd}>
        <main className="flex-1 overflow-x-auto overflow-y-hidden p-2 flex gap-3 items-start hide-scrollbar-smooth">
          {poolShell(
            '技术攻坚池',
            `缺失图纸 / SOP · ${techPoolOrders.length} 单`,
            'red',
            <div className={cn('flex-1 overflow-y-auto p-3 custom-scrollbar min-h-[200px]', cardGap)}>
              {techPoolOrders.map((task) => (
                <EnhancedOrderCard
                  key={task.id}
                  task={task}
                  status={getCardStatus(task)}
                  updateTask={updateOrderData}
                  rbac={orderCardRbac}
                  layoutMode={layoutMode}
                  theme={theme}
                />
              ))}
              {techPoolOrders.length === 0 && (
                <div
                  className={cn(
                    'flex flex-col items-center justify-center py-12 border border-dashed rounded-xl',
                    poolEmpty(theme)
                  )}
                >
                  <Cpu className="w-8 h-8 text-slate-600 mb-2" />
                  <span className="text-xs font-medium">暂无攻坚单</span>
                </div>
              )}
            </div>
          )}

          {poolShell(
            '仓库配料池',
            `待发料 · ${warehousePoolOrders.length} 单`,
            'yellow',
            <div className={cn('flex-1 overflow-y-auto p-3 custom-scrollbar min-h-[200px]', cardGap)}>
              {warehousePoolOrders.map((task) => (
                <EnhancedOrderCard
                  key={task.id}
                  task={task}
                  status={getCardStatus(task)}
                  updateTask={updateOrderData}
                  rbac={orderCardRbac}
                  layoutMode={layoutMode}
                  theme={theme}
                />
              ))}
              {warehousePoolOrders.length === 0 && (
                <div
                  className={cn(
                    'flex flex-col items-center justify-center py-12 border border-dashed rounded-xl',
                    poolEmpty(theme)
                  )}
                >
                  <Warehouse className="w-8 h-8 text-slate-600 mb-2" />
                  <span className="text-xs font-medium">配料已同步</span>
                </div>
              )}
            </div>
          )}

          {poolShell(
            '就绪待排池',
            `仅本池可拖入日历 · ${readyPoolOrders.length} 单`,
            'green',
            <div className="flex flex-col flex-1 min-h-0">
              <div className="px-3 pt-2 pb-1 flex justify-end">
                <button
                  type="button"
                  onClick={triggerBatchAISchedule}
                  disabled={isProcessing || readyPoolOrders.length === 0}
                  className="bg-indigo-600/80 hover:bg-indigo-500 text-white p-2 rounded-xl transition-all disabled:opacity-40 shadow-[0_0_16px_rgba(99,102,241,0.35)]"
                  title="AI 智能排产（仅就绪池）"
                >
                  <Bot size={20} />
                </button>
              </div>
              <Droppable droppableId="ReadyPool">
                {(provided) => (
                  <div
                    className={cn(
                      'flex-1 overflow-y-auto p-3 pt-0 custom-scrollbar min-h-[200px]',
                      cardGap
                    )}
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                  >
                    {readyPoolOrders.map((task, index) => (
                      <Draggable
                        key={task.id}
                        draggableId={task.id}
                        index={index}
                        isDragDisabled={!canDrag}
                      >
                        {(prov) => (
                          <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}>
                            <EnhancedOrderCard
                              task={task}
                              status={getCardStatus(task)}
                              updateTask={updateOrderData}
                              rbac={orderCardRbac}
                              layoutMode={layoutMode}
                              theme={theme}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {readyPoolOrders.length === 0 && (
                      <div className="flex flex-col items-center justify-center text-slate-500 py-12 border border-dashed border-emerald-700/40 rounded-xl bg-emerald-950/10">
                        <Package className="w-8 h-8 text-emerald-700/50 mb-2" />
                        <span className="text-xs font-medium">就绪池为空</span>
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          )}

          {DAYS.map((day) => {
            const dayTasks = orders.filter((t) => t.assignedDay === day.key);
            const totalMins = dayTasks
              .filter((t) => !isOrderCompletedStatus(t.taskStatus))
              .reduce((sum, t) => sum + (Number(t.totalHours) || 0), 0);
            const loadPercent = Math.min(100, Math.round((totalMins / dailyCapacity) * 100));
            const isOverloaded = totalMins > dailyCapacity;

            return (
              <div
                key={day.key}
                className={cn(
                  'w-[300px] min-w-[300px] shrink-0 h-full flex flex-col rounded-2xl shadow-[0_0_24px_rgba(15,23,42,0.4)]',
                  dayColumnShell(theme)
                )}
              >
                <div
                  className={cn(
                    'px-4 py-1.5 border-b rounded-t-2xl relative overflow-hidden',
                    dayColumnHeader(theme)
                  )}
                >
                  <div className={`absolute top-0 left-0 w-full h-1 ${day.color}`} />
                  <div className="flex justify-between items-center mb-3 mt-1">
                    <h2
                      className={cn(
                        'font-bold flex items-center gap-2 text-base',
                        theme === 'dark' ? 'text-slate-200' : 'text-gray-900'
                      )}
                    >
                      <Calendar className={cn('w-5 h-5', theme === 'dark' ? 'text-slate-400' : 'text-gray-600')} />{' '}
                      {day.label}
                    </h2>
                    <span
                      className={cn(
                        'font-bold text-[10px] px-2 py-0.5 rounded border',
                        theme === 'dark'
                          ? 'bg-slate-800 text-slate-300 border-slate-600'
                          : 'bg-gray-100 text-gray-800 border-gray-300'
                      )}
                    >
                      {dayTasks.length} 单
                    </span>
                  </div>

                  <div
                    className={cn(
                      'flex flex-col gap-1.5 mt-2 px-2.5 py-2 rounded-xl border',
                      theme === 'dark'
                        ? 'bg-slate-900/60 border-slate-700/80'
                        : 'bg-white border-gray-300'
                    )}
                  >
                    <div className="flex justify-between items-center text-xs font-medium">
                      <span className={theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}>
                        排单负荷预估：
                      </span>
                      <strong
                        className={`font-mono text-[13px] ${isOverloaded ? 'text-red-500 drop-shadow-[0_0_5px_rgba(248,113,113,0.8)]' : 'text-blue-500 drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]'}`}
                      >
                        {totalMins.toLocaleString()}{' '}
                        <span
                          className={cn(
                            'text-[10px] font-normal',
                            theme === 'dark' ? 'text-slate-500' : 'text-gray-500'
                          )}
                        >
                          分钟
                        </span>
                      </strong>
                    </div>
                    <div
                      className={cn(
                        'h-1.5 w-full rounded-full overflow-hidden shadow-inner',
                        theme === 'dark' ? 'bg-slate-800' : 'bg-gray-200'
                      )}
                    >
                      <div
                        className={`h-full transition-all shadow-[0_0_8px_currentColor] ${isOverloaded ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${loadPercent}%` }}
                      />
                    </div>
                    <div
                      className={cn(
                        'flex justify-between text-[9px]',
                        theme === 'dark' ? 'text-slate-500' : 'text-gray-600'
                      )}
                    >
                      <span>0</span>
                      <span className={isOverloaded ? 'text-red-500' : ''}>上限: {dailyCapacity} 分钟</span>
                    </div>
                  </div>
                </div>

                <Droppable droppableId={day.key}>
                  {(provided) => (
                    <div
                      className={cn(
                        'flex-1 overflow-y-auto p-3 custom-scrollbar',
                        day.bg,
                        cardGap
                      )}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      {dayTasks.map((task, index) => (
                        <Draggable
                          key={task.id}
                          draggableId={task.id}
                          index={index}
                          isDragDisabled={!canDrag}
                        >
                          {(prov) => (
                            <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}>
                              <EnhancedOrderCard
                                task={task}
                                status={getCardStatus(task)}
                                updateTask={updateOrderData}
                                rbac={orderCardRbac}
                                layoutMode={layoutMode}
                                theme={theme}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {dayTasks.length === 0 && (
                        <div
                          className={cn(
                            'flex flex-col items-center justify-center py-16 border border-dashed rounded-xl',
                            theme === 'dark'
                              ? 'text-slate-500 border-slate-700/80 bg-slate-950/20'
                              : 'text-gray-500 border-gray-300 bg-gray-50'
                          )}
                        >
                          <Package className="w-8 h-8 text-slate-600 mb-2" />
                          <span className="text-sm font-medium">当前无排产</span>
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </main>
      </DragDropContext>
    </div>
  );
}
