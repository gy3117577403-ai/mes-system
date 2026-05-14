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

const visibleMain = section(drawer, '向 AI 计划员下达任务', '<nav className="hidden');
const taskSection = section(visibleMain, 'Plan Request', 'Plan Result');
const applySection = section(visibleMain, 'Plan Result', '更多功能与诊断');
const advancedSection = section(visibleMain, '更多功能与诊断', '</details>');
const floatingButtonSection = section(drawer, 'onClick={() => setOpen(true)}', '</button>');

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
    drawer.includes('fixed bottom-5 right-5') && drawer.includes('打开 AI 计划员工作台'),
    'AI planner must be opened from a compact bottom-right floating entry',
    lineOf(drawer, '打开 AI 计划员工作台')
  ),
  check(
    'main UI has task request section',
    drawerPath,
    visibleMain.includes('向 AI 计划员下达任务') && visibleMain.includes('生成计划建议'),
    'Main AI planner UI should focus on issuing a planning task',
    lineOf(drawer, '向 AI 计划员下达任务')
  ),
  check(
    'main UI has apply suggestion section',
    drawerPath,
    visibleMain.includes('执行建议') && visibleMain.includes('确认并执行排单建议'),
    'Main AI planner UI should focus on reviewing and confirming executable suggestions',
    lineOf(drawer, '执行建议')
  ),
  check(
    'advanced features are collapsed',
    drawerPath,
    visibleMain.includes('<details') && visibleMain.includes('更多功能与诊断'),
    'Morning check, report, diagnostics, and secondary tools should be collapsed by default',
    lineOf(drawer, '更多功能与诊断')
  ),
  check(
    'main UI does not expose tab navigation',
    drawerPath,
    drawer.includes('<nav className="hidden'),
    'Old multi-tab navigation should not be visible in the primary AI planner flow',
    lineOf(drawer, '<nav className="hidden')
  ),
  check(
    'main task section does not show raw JSON',
    drawerPath,
    !/JSON\.stringify|<pre/.test(taskSection),
    'Task request section must not show raw JSON/debug output',
    lineOf(taskSection, 'JSON.stringify')
  ),
  check(
    'main apply section does not show raw block enums',
    drawerPath,
    !/\b(MATERIAL_NOT_READY|DRAWING_NOT_READY|DATA_INCOMPLETE|ASSIGN_ORDER_DAY)\b/.test(applySection),
    'Primary apply section must not print internal enums directly',
    lineOf(applySection, 'MATERIAL_NOT_READY')
  ),
  check(
    'order ids are compacted',
    drawerPath,
    drawer.includes('shortId') && drawer.includes('compactOrderIds'),
    'Cards should shorten IDs and cap visible order lists',
    lineOf(drawer, 'compactOrderIds')
  ),
  check(
    'task request does not execute mutations',
    drawerPath,
    !/executeAiCopilotMutationsAction|updateOrderAction|repairMisclassifiedReadyOrdersAction/.test(taskSection),
    'Issuing a task must not mutate orders',
    lineOf(drawer, '生成计划建议')
  ),
  check(
    'apply section is manually confirmed',
    drawerPath,
    applySection.includes('执行前必须人工确认') && applySection.includes('后端仍会重新校验'),
    'Suggestion apply area must tell users execution is manual and backend revalidates eligibility',
    lineOf(drawer, '执行前必须人工确认')
  ),
  check(
    'advanced section does not auto-mutate orders',
    drawerPath,
    !/updateOrderAction|batchUpdateOrdersAction|repairMisclassifiedReadyOrdersAction|executeAiCopilotMutationsAction/.test(advancedSection),
    'Collapsed advanced controls must not auto-update orders',
    lineOf(drawer, '更多功能与诊断')
  ),
  check(
    'floating entry only opens workspace',
    drawerPath,
    floatingButtonSection.includes('setOpen(true)') && !/executeAiCopilotMutationsAction|updateOrderAction|repairMisclassifiedReadyOrdersAction/.test(floatingButtonSection),
    'Floating entry click should only open the AI planner',
    lineOf(drawer, '打开 AI 计划员工作台')
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
