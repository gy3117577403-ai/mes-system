const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function lineOf(content, pattern) {
  const index = content.indexOf(pattern);
  if (index < 0) return null;
  return content.slice(0, index).split(/\r?\n/).length;
}

function check(name, file, pass, detail, line = null) {
  return { name, pass, file, line, detail };
}

function section(content, start, end) {
  const startIndex = content.indexOf(start);
  if (startIndex < 0) return '';
  const endIndex = content.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? content.slice(startIndex) : content.slice(startIndex, endIndex);
}

const orderCardPath = 'src/components/OrderCard.tsx';
const pagePath = 'src/app/page.tsx';
const drawerPath = 'src/components/AiCopilotDrawer.tsx';
const packagePath = 'package.json';

const orderCard = read(orderCardPath);
const page = read(pagePath);
const drawer = read(drawerPath);
const pkg = read(packagePath);

const visibleDrawer = drawer.replace(/<div className="hidden grid min-h-0[\s\S]*?\n\s*<\/div>\n\s*<\/motion\.aside>/, '</motion.aside>');
const morningSection = section(visibleDrawer, "activeTab === 'morning'", "activeTab === 'tasks'");
const todoSection = section(visibleDrawer, "activeTab === 'todos'", "activeTab === 'report'");
const reportSection = section(visibleDrawer, "activeTab === 'report'", "activeTab === 'execution'");
const floatingButtonSection = section(visibleDrawer, 'onClick={() => setOpen(true)}', '</button>');
const visibleWithoutLabelMaps = visibleDrawer
  .replace(/const cleanBlockReasonLabel[\s\S]*?\};/, '')
  .replace(/const cleanPriorityLabel[\s\S]*?\};/, '')
  .replace(/const cleanMutationTypeLabel[\s\S]*?\};/, '')
  .replace(/const cleanTodoStatusLabel[\s\S]*?\};/, '')
  .replace(/const cleanTodoSourceLabel[\s\S]*?\};/, '')
  .replace(/const blockedGroupLabel[\s\S]*?\};/, '');
const visibleUi = visibleWithoutLabelMaps.slice(Math.max(0, visibleWithoutLabelMaps.indexOf('return (')));

const checks = [
  check(
    'OrderCard ready debug is gated',
    orderCardPath,
    !orderCard.includes('ready debug') || orderCard.includes('NEXT_PUBLIC_SHOW_READY_DEBUG'),
    'OrderCard must not show ready debug in normal production UI',
    lineOf(orderCard, 'ready debug')
  ),
  check(
    'OrderCard eligible debug is gated',
    orderCardPath,
    !orderCard.includes('eligible=') || orderCard.includes('NEXT_PUBLIC_SHOW_READY_DEBUG'),
    'OrderCard must not show eligible= debug text by default',
    lineOf(orderCard, 'eligible=')
  ),
  check(
    'main page does not render large presence card',
    pagePath,
    !page.includes('<AiPlannerPresenceCard'),
    'Main page must not render a large AI planner presence card in the board body',
    lineOf(page, '<AiPlannerPresenceCard')
  ),
  check(
    'floating AI entry exists',
    drawerPath,
    visibleDrawer.includes('fixed bottom-5 right-5') && visibleDrawer.includes('打开 AI 计划员工作台'),
    'AI planner must be opened from a compact bottom-right floating entry',
    lineOf(visibleDrawer, '打开 AI 计划员工作台')
  ),
  ...['晨检', '任务', '待办', '日报', '建议执行', '诊断'].map((label) =>
    check(
      `drawer has ${label} module`,
      drawerPath,
      visibleDrawer.includes(`label: '${label}'`) || visibleDrawer.includes(`>${label}<`) || visibleDrawer.includes(label),
      `AiCopilotDrawer must expose ${label} module`,
      lineOf(visibleDrawer, label)
    )
  ),
  check(
    'drawer has Chinese enum labels',
    drawerPath,
    visibleDrawer.includes('cleanBlockReasonLabel') && visibleDrawer.includes('cleanMutationTypeLabel') && visibleDrawer.includes('cleanTodoStatusLabel'),
    'Internal enum values must be mapped to Chinese product labels',
    lineOf(visibleDrawer, 'cleanBlockReasonLabel')
  ),
  check(
    'visible drawer does not print raw block enum as standalone UI',
    drawerPath,
    !/\{[^}]*\b(MATERIAL_NOT_READY|DRAWING_NOT_READY|DATA_INCOMPLETE)\b[^}]*\}/.test(visibleUi),
    'Visible drawer UI should not print internal block enums directly',
    lineOf(visibleDrawer, 'MATERIAL_NOT_READY')
  ),
  check(
    'visible drawer does not show raw JSON.stringify',
    drawerPath,
    !/<pre[^>]*>\s*\{?\s*JSON\.stringify/.test(visibleDrawer),
    'Visible drawer UI should not render raw JSON.stringify output',
    lineOf(visibleDrawer, 'JSON.stringify')
  ),
  check(
    'order ids are compacted',
    drawerPath,
    visibleDrawer.includes('compactOrderIds') && visibleDrawer.includes('shortId'),
    'Todo/question cards should shorten IDs and cap visible order lists',
    lineOf(visibleDrawer, 'compactOrderIds')
  ),
  check(
    'morning check does not execute mutations',
    drawerPath,
    !/executeAiCopilotMutationsAction/.test(morningSection),
    'One-click morning check must not execute AI mutations',
    lineOf(visibleDrawer, 'AI 计划员一键晨检')
  ),
  check(
    'todo buttons do not update orders',
    drawerPath,
    !/updateOrderAction|batchUpdateOrdersAction|repairMisclassifiedReadyOrdersAction|executeAiCopilotMutationsAction/.test(todoSection),
    'Todo controls must not mutate orders',
    lineOf(visibleDrawer, 'AI 计划员待办')
  ),
  check(
    'daily report buttons do not update orders',
    drawerPath,
    !/updateOrderAction|batchUpdateOrdersAction|repairMisclassifiedReadyOrdersAction|executeAiCopilotMutationsAction/.test(reportSection),
    'Daily report controls must not mutate orders',
    lineOf(visibleDrawer, 'AI 计划员日报')
  ),
  check(
    'floating entry only opens workspace',
    drawerPath,
    floatingButtonSection.includes('setOpen(true)') && !/executeAiCopilotMutationsAction|updateOrderAction|repairMisclassifiedReadyOrdersAction/.test(floatingButtonSection),
    'Floating entry click should only open the AI workspace',
    lineOf(visibleDrawer, '打开 AI 计划员工作台')
  ),
  check(
    'package script exists',
    packagePath,
    pkg.includes('"check:ai-ui-cleanup"'),
    'package.json must include check:ai-ui-cleanup',
    lineOf(pkg, 'check:ai-ui-cleanup')
  ),
];

const ok = checks.every((item) => item.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
