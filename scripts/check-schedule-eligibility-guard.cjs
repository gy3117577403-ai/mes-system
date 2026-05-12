const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const checks = [
  {
    file: 'src/actions/mesActions.ts',
    patterns: [
      'scheduleEligibility',
      'canEnterSchedule',
      'batchUpdateAssignedDaysAction',
      'rejectIneligibleScheduleWrite',
      'restoreInvalidScheduledOrdersAction',
    ],
  },
  {
    file: 'src/actions/aiSchedulerActions.ts',
    patterns: ['scheduleEligibility', 'executeAiCopilotMutationsAction', 'canEnterSchedule', 'rejectedMutations'],
  },
  {
    file: 'src/components/KanbanBoard.tsx',
    patterns: ['scheduleEligibility', 'canEnterSchedule', '禁止排产'],
  },
  {
    file: 'src/app/page.tsx',
    patterns: [
      'scheduleEligibility',
      'canEnterSchedule',
      'getRequiredPool',
      'handleRestoreInvalidScheduledOrders',
      'restoreInvalidScheduledOrdersAction',
    ],
  },
];

const failures = [];

for (const check of checks) {
  const abs = path.join(root, check.file);
  if (!fs.existsSync(abs)) {
    failures.push(`${check.file}: missing file`);
    continue;
  }
  const content = read(check.file);
  for (const pattern of check.patterns) {
    if (!content.includes(pattern)) {
      failures.push(`${check.file}: missing "${pattern}"`);
    }
  }
}

const aiScheduler = read('src/actions/aiSchedulerActions.ts');
const aiExecuteBlock = aiScheduler.slice(aiScheduler.indexOf('executeAiCopilotMutationsAction'));
if (!/UPDATE_ORDER_DATE[\s\S]*canEnterSchedule/.test(aiExecuteBlock)) {
  failures.push('src/actions/aiSchedulerActions.ts: executeAiCopilotMutationsAction lacks UPDATE_ORDER_DATE canEnterSchedule guard');
}

const mesActions = read('src/actions/mesActions.ts');
const assignedBlock = mesActions.slice(mesActions.indexOf('batchUpdateAssignedDaysAction'));
if (!/batchUpdateAssignedDaysAction[\s\S]*rejectIneligibleScheduleWrite/.test(assignedBlock)) {
  failures.push('src/actions/mesActions.ts: batchUpdateAssignedDaysAction lacks canEnterSchedule guard');
}

if (failures.length > 0) {
  console.error('Schedule eligibility guard check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Schedule eligibility guard check passed.');

