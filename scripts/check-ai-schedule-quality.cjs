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
  { name: 'prompt requires due date order', pass: /严格按交期从早到晚/.test(action) },
  { name: 'prompt mentions daily average target', pass: /日均目标/.test(action) },
  { name: 'prompt mentions 500 minute tolerance', pass: /500\s*分钟|500 分钟/.test(action) },
  { name: 'prompt blocks last-day backlog', pass: /不允许前几天低负荷、最后一天严重爆仓/.test(action) },
  { name: 'drawer displays schedulePlanValidation', pass: /schedulePlanValidation/.test(drawer) },
  { name: 'invalid validation disables apply', pass: /schedulePlanExecutable/.test(drawer) && /disabled=\{!hasMutations \|\| isApplying \|\| !schedulePlanExecutable\}/.test(drawer) },
  { name: 'execution still calls canEnterSchedule', pass: /executeAiCopilotMutationsAction[\s\S]*canEnterSchedule/.test(action) },
  { name: 'scheduleEligibility still has canEnterSchedule', pass: /canEnterSchedule/.test(eligibility) },
];

const ok = checks.every((check) => check.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
