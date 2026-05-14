const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function lineOf(content, pattern) {
  const index = content.indexOf(pattern);
  if (index < 0) return null;
  return content.slice(0, index).split(/\r?\n/).length;
}

function check(name, file, pass, detail, line = null) {
  return { name, pass, file, line, detail };
}

const files = {
  drawer: 'src/components/AiCopilotDrawer.tsx',
  presenceCard: 'src/components/AiPlannerPresenceCard.tsx',
  templates: 'src/lib/aiPlannerTaskTemplates.ts',
  todos: 'src/lib/aiPlannerTodos.ts',
  dailyReport: 'src/lib/aiPlannerDailyReport.ts',
  morningCheck: 'src/lib/aiPlannerMorningCheck.ts',
  presence: 'src/lib/aiPlannerPresence.ts',
  actions: 'src/actions/aiSchedulerActions.ts',
  eligibility: 'src/lib/scheduleEligibility.ts',
  pkg: 'package.json',
};

const drawer = read(files.drawer);
const card = read(files.presenceCard);
const templates = read(files.templates);
const todos = read(files.todos);
const daily = read(files.dailyReport);
const morning = read(files.morningCheck);
const presence = read(files.presence);
const actions = read(files.actions);
const eligibility = read(files.eligibility);
const pkg = read(files.pkg);

function section(content, startPattern, endPattern, maxLen = 14000) {
  const start = content.indexOf(startPattern);
  if (start < 0) return '';
  const end = content.indexOf(endPattern, start + startPattern.length);
  return content.slice(start, end > start ? end : start + maxLen);
}

const morningFlow = section(drawer, 'const runMorningCheck', 'const askPlanner');
const todoSection = section(drawer, 'AI 计划员待办', '发现的问题');
const dailySection = section(drawer, '日报仅用于计划沟通与交接', '发现的问题');
const requiredScripts = [
  'check:ai-ui-context',
  'check:ai-planner-todos',
  'check:ai-planner-daily-report',
  'check:ai-planner-presence',
  'check:ai-morning-check',
  'check:ai-planner-mvp',
  'check:ai-planner',
];

const checks = [
  check('AiCopilotDrawer exists', files.drawer, exists(files.drawer), 'AI workspace component must exist'),
  check('AiPlannerPresenceCard exists', files.presenceCard, exists(files.presenceCard), 'AI presence card component must exist'),
  check('daily planning template exists', files.templates, templates.includes('DAILY_PLANNING_CHECKUP'), 'Task templates must include DAILY_PLANNING_CHECKUP', lineOf(templates, 'DAILY_PLANNING_CHECKUP')),
  check('todo builder exists', files.todos, todos.includes('buildAiPlannerTodosFromReport'), 'Todo helper must build planner todos', lineOf(todos, 'buildAiPlannerTodosFromReport')),
  check('daily report builder exists', files.dailyReport, daily.includes('buildAiPlannerDailyReport'), 'Daily report helper must build reports', lineOf(daily, 'buildAiPlannerDailyReport')),
  check('morning check storage helper exists', files.morningCheck, morning.includes('saveMorningCheckResultToStorage'), 'Morning check helper must save result', lineOf(morning, 'saveMorningCheckResultToStorage')),
  check('presence reader exists', files.presence, presence.includes('readAiPlannerPresenceFromStorage'), 'Presence helper must read local planner state', lineOf(presence, 'readAiPlannerPresenceFromStorage')),
  check('interact action accepts uiContext', files.actions, /interactWithAiCopilotAction\([\s\S]*uiContext\?:\s*AiPlannerUiContext/.test(actions), 'interactWithAiCopilotAction must accept optional uiContext', lineOf(actions, 'interactWithAiCopilotAction')),
  check('prompt includes page context', files.actions, actions.includes('当前用户页面上下文'), 'AI prompt must include current user page context', lineOf(actions, '当前用户页面上下文')),
  check('drawer has one-click morning check', files.drawer, drawer.includes('AI 计划员一键晨检'), 'Drawer must expose one-click morning check', lineOf(drawer, 'AI 计划员一键晨检')),
  check('drawer has todo section', files.drawer, drawer.includes('AI 计划员待办'), 'Drawer must expose planner todos', lineOf(drawer, 'AI 计划员待办')),
  check('drawer has daily report section', files.drawer, drawer.includes('AI 计划员日报'), 'Drawer must expose planner daily report', lineOf(drawer, 'AI 计划员日报')),
  check('presence card labels planner', files.presenceCard, card.includes('AI 计划员工') || card.includes('AI计划员'), 'Presence card must label AI planner', lineOf(card, 'AI 计划员工')),
  check('all AI check scripts exist', files.pkg, requiredScripts.every((script) => pkg.includes(`"${script}"`)), 'package.json must include all AI planner check scripts', lineOf(pkg, 'check:ai-planner')),
  check('morning flow does not execute mutations', files.drawer, morningFlow.length > 0 && !morningFlow.includes('executeAiCopilotMutationsAction'), 'Morning check must not execute proposed mutations', lineOf(drawer, 'const runMorningCheck')),
  check('todo section does not update orders', files.drawer, todoSection.length > 0 && !/updateOrderAction|batchUpdateOrdersAction|repairMisclassifiedReadyOrdersAction/.test(todoSection), 'Todo controls must not update orders', lineOf(drawer, 'AI 计划员待办')),
  check('daily report section does not update orders', files.drawer, dailySection.length > 0 && !/updateOrderAction|batchUpdateOrdersAction|repairMisclassifiedReadyOrdersAction|executeAiCopilotMutationsAction/.test(dailySection), 'Daily report controls must not update orders or execute mutations', lineOf(drawer, '日报仅用于计划沟通与交接')),
  check('presence card is read-only', files.presenceCard, !/updateOrderAction|batchUpdateOrdersAction|repairMisclassifiedReadyOrdersAction|executeAiCopilotMutationsAction/.test(card), 'Presence card must not mutate orders or execute AI mutations', 1),
  check('schedule eligibility hard rule remains', files.eligibility, eligibility.includes('canEnterSchedule'), 'scheduleEligibility must still export canEnterSchedule', lineOf(eligibility, 'canEnterSchedule')),
  check('manual confirmation copy remains', files.drawer, drawer.includes('人工确认执行区') && drawer.includes('后端会二次校验'), 'proposedMutations execution must remain in manual confirmation area', lineOf(drawer, '人工确认执行区')),
];

const ok = checks.every((item) => item.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
