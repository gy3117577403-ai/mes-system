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
      'repairMisclassifiedReadyOrdersAction',
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
    file: 'src/components/OrderCard.tsx',
    patterns: [
      'isDrawingReadyForSchedule',
      'isMaterialReadyForSchedule',
      'drawingDisplayValue',
      'materialDisplayValue',
      '标记已发图',
      '标记料齐',
    ],
  },
  {
    file: 'src/app/page.tsx',
    patterns: [
      'scheduleEligibility',
      'canEnterSchedule',
      'getRequiredPool',
      'handleRestoreInvalidScheduledOrders',
      'restoreInvalidScheduledOrdersAction',
      'handleRepairMisclassifiedReadyOrders',
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

const eligibility = read('src/lib/scheduleEligibility.ts');
const canEnterBlock = eligibility.slice(eligibility.indexOf('function canEnterSchedule'));
for (const forbidden of ['SOP_NOT_READY', 'sopReady', 'uploadSop', 'isSopReady']) {
  if (eligibility.includes(forbidden)) {
    failures.push(`src/lib/scheduleEligibility.ts: forbidden SOP hard-block token "${forbidden}" found`);
  }
}
if (/canEnterSchedule[\s\S]*(SOP|sop)/.test(canEnterBlock)) {
  failures.push('src/lib/scheduleEligibility.ts: canEnterSchedule must not inspect SOP state');
}

const projectFiles = [
  'src/actions/aiActions.ts',
  'src/actions/aiSchedulerActions.ts',
  'src/actions/mesActions.ts',
  'src/app/page.tsx',
  'src/components/KanbanBoard.tsx',
  'src/lib/scheduleEligibility.ts',
];
const allProjectText = projectFiles.map((file) => `${file}\n${read(file)}`).join('\n');
const slash = '/';
for (const forbiddenText of [`未下发图纸${slash}SOP`, `缺失图纸${slash}SOP`]) {
  if (allProjectText.includes(forbiddenText)) {
    failures.push(`project text: forbidden mixed SOP blocking copy "${forbiddenText}" found`);
  }
}
if (/restoreInvalidScheduledOrdersAction[\s\S]*(SOP_NOT_READY|sopReady|uploadSop|isSopReady)/.test(mesActions)) {
  failures.push('src/actions/mesActions.ts: restoreInvalidScheduledOrdersAction must not restore by SOP state');
}
if (/SOP[^。\n]*(禁止排产|阻止排产|拦截排产)/.test(aiScheduler)) {
  failures.push('src/actions/aiSchedulerActions.ts: AI prompt appears to treat SOP as a scheduling blocker');
}

const orderCard = read('src/components/OrderCard.tsx');
if (/select[\s\S]{0,400}value=\{task\.drawing\}/.test(orderCard) || /select[\s\S]{0,400}value=\{task\.materials\}/.test(orderCard)) {
  failures.push('src/components/OrderCard.tsx: readiness controls must not use raw text fields as displayed state');
}
if (!orderCard.includes("drawingLooksReady ? '已发图' : '标记已发图'")) {
  failures.push('src/components/OrderCard.tsx: drawing action copy must avoid showing current-state 已发图 when not ready');
}
if (!orderCard.includes("materialsLooksKit ? '料已齐' : '标记料齐'")) {
  failures.push('src/components/OrderCard.tsx: material action copy must avoid showing current-state 料已齐 when not ready');
}

if (failures.length > 0) {
  console.error('Schedule eligibility guard check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Schedule eligibility guard check passed.');
