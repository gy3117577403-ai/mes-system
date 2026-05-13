export type AiPlannerTaskTemplateId =
  | 'DAILY_PLANNING_CHECKUP'
  | 'RISK_ORDER_SCAN'
  | 'SCHEDULABLE_ORDER_RECOMMENDATION'
  | 'BLOCKED_ORDER_ANALYSIS'
  | 'PLANNER_QUESTION_LIST';

export type AiPlannerTaskTemplate = {
  id: AiPlannerTaskTemplateId;
  name: string;
  prompt: string;
};

export const AI_PLANNER_TASK_TEMPLATES: AiPlannerTaskTemplate[] = [
  {
    id: 'DAILY_PLANNING_CHECKUP',
    name: '每日排产体检',
    prompt: '请像生产计划员一样，检查当前订单池，输出今日可排产订单、不可排产订单、交期风险订单，并给出处理优先级。',
  },
  {
    id: 'RISK_ORDER_SCAN',
    name: '风险订单扫描',
    prompt: '请扫描交期临近、已延期、工时异常、图纸未发、物料未齐的订单，按风险等级输出。',
  },
  {
    id: 'SCHEDULABLE_ORDER_RECOMMENDATION',
    name: '可排产订单推荐',
    prompt: '请基于图纸已下发、物料已齐、交期、工时和当前产能，推荐优先排产订单，并说明原因。',
  },
  {
    id: 'BLOCKED_ORDER_ANALYSIS',
    name: '不可排产原因归类',
    prompt: '请把不可排产订单按图纸未发、物料未齐、数据异常、其他原因归类，并给出下一步需要谁处理。',
  },
  {
    id: 'PLANNER_QUESTION_LIST',
    name: 'AI 主动问题清单',
    prompt: '请站在计划员工角度，列出当前必须向主管确认的问题，每个问题说明涉及订单、影响和建议问法。',
  },
];

export function getAiPlannerTaskTemplate(id?: string | null): AiPlannerTaskTemplate | undefined {
  return AI_PLANNER_TASK_TEMPLATES.find((template) => template.id === id);
}

export function buildPromptFromTemplate(id: string, extraUserInput?: string): string {
  const template = getAiPlannerTaskTemplate(id);
  const extra = String(extraUserInput ?? '').trim();
  if (!template) return extra;
  return extra ? `${template.prompt}\n\n补充要求：${extra}` : template.prompt;
}
