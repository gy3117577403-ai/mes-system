const fs = require('fs');

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

const action = read('src/actions/aiSchedulerActions.ts');
const drawer = read('src/components/AiCopilotDrawer.tsx');
const eligibility = read('src/lib/scheduleEligibility.ts');

const checks = [
  {
    name: 'ai action supports schedule proposed mutation',
    pass: /ASSIGN_ORDER_DAY|UPDATE_ORDER_DATE/.test(action) && /schedulePlan/.test(action),
  },
  {
    name: 'execution action calls canEnterSchedule',
    pass: /executeAiCopilotMutationsAction[\s\S]*canEnterSchedule/.test(action),
  },
  {
    name: 'execution validates target day',
    pass: /normalizeScheduleDay/.test(action) && /周一[\s\S]*周六/.test(action),
  },
  {
    name: 'schedule mutation type exists',
    pass: /ASSIGN_ORDER_DAY/.test(action),
  },
  {
    name: 'ui exposes one-click apply button',
    pass: /一键执行排单建议/.test(drawer),
  },
  {
    name: 'ui confirms before apply',
    pass: /window\.confirm/.test(drawer) && /是否继续/.test(drawer),
  },
  {
    name: 'apply action is user-click only',
    pass: /onClick=\{applyMutations\}/.test(drawer) && /executeAiCopilotMutationsAction/.test(drawer),
  },
  {
    name: 'morning check does not execute mutations',
    pass: !/runMorningCheck[\s\S]{0,3000}executeAiCopilotMutationsAction/.test(drawer),
  },
  {
    name: 'scheduleEligibility still exports canEnterSchedule',
    pass: /canEnterSchedule/.test(eligibility),
  },
  {
    name: 'ui tells user backend revalidates drawing/material state',
    pass: /后端仍会校验图纸\/物料状态|后端仍会校验图纸和物料状态/.test(drawer),
  },
];

const ok = checks.every((check) => check.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
