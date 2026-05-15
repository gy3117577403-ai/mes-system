const fs = require('fs');

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

const balanced = read('src/lib/aiBalancedSchedulePlanner.ts');
const validation = read('src/lib/aiSchedulePlanValidation.ts');
const action = read('src/actions/aiSchedulerActions.ts');
const drawer = read('src/components/AiCopilotDrawer.tsx');
const eligibility = read('src/lib/scheduleEligibility.ts');

const checks = [
  { name: 'balanced planner exists', pass: /buildBalancedSchedulePlan/.test(balanced) },
  { name: 'schedule validation exists', pass: /validateAiSchedulePlan/.test(validation) },
  { name: 'extractScheduleIntent exists', pass: /extractScheduleIntent/.test(action) },
  { name: 'action calls balanced planner', pass: /buildBalancedSchedulePlan/.test(action) },
  { name: 'action calls schedule validation', pass: /validateAiSchedulePlan/.test(action) },
  { name: 'balanced planner includes scheduled orders by default', pass: /allowRescheduleAssigned\s*=\s*input\.allowRescheduleAssigned\s*!==\s*false/.test(balanced) },
  { name: 'intent only excludes scheduled orders when user says so', pass: /keepScheduledFixed/.test(action) && /allowRescheduleAssigned:\s*wantsScheduling\s*&&\s*!keepScheduledFixed/.test(action) },
  { name: 'prompt says candidates include ready and scheduled orders', pass: action.includes('就绪待排池 + 周一到周六已排产订单') },
  { name: 'prompt requires due date order', pass: action.includes('严格按交期从早到晚') },
  { name: 'prompt mentions daily average target', pass: action.includes('日均目标') },
  { name: 'prompt mentions 500 minute tolerance', pass: /500\s*分钟/.test(action) },
  { name: 'prompt blocks last-day backlog', pass: action.includes('不允许前几天低负荷、最后一天严重爆仓') },
  { name: 'validation exposes due date order result', pass: validation.includes('dueDateOrder') && validation.includes('交期顺序') },
  { name: 'validation blocks previous day later due date', pass: validation.includes('previousLatestDueDate') && validation.includes('nextEarliestDueDate') },
  { name: 'validation explains workload cannot break due date order', pass: validation.includes('负荷均衡只能在同交期') },
  { name: 'drawer displays schedulePlanValidation', pass: /schedulePlanValidation/.test(drawer) },
  { name: 'drawer displays due date order status', pass: drawer.includes('交期顺序通过') && drawer.includes('交期顺序不通过') },
  { name: 'drawer displays candidate source summary', pass: drawer.includes('候选订单识别') && drawer.includes('周一到周六已排可调整') },
  { name: 'invalid validation disables apply', pass: /schedulePlanExecutable/.test(drawer) && /disabled=\{!hasMutations \|\| isApplying \|\| !schedulePlanExecutable\}/.test(drawer) },
  { name: 'execution still calls canEnterSchedule', pass: /executeAiCopilotMutationsAction[\s\S]*canEnterSchedule/.test(action) },
  { name: 'scheduleEligibility still has canEnterSchedule', pass: /canEnterSchedule/.test(eligibility) },
];

const ok = checks.every((check) => check.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
