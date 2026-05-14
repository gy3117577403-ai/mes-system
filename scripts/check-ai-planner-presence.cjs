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

const presencePath = 'src/lib/aiPlannerPresence.ts';
const cardPath = 'src/components/AiPlannerPresenceCard.tsx';
const pagePath = 'src/app/page.tsx';
const drawerPath = 'src/components/AiCopilotDrawer.tsx';
const packagePath = 'package.json';

const presence = read(presencePath);
const card = read(cardPath);
const page = read(pagePath);
const drawer = read(drawerPath);
const pkg = read(packagePath);

const checks = [
  check(
    'readAiPlannerPresenceFromStorage exists',
    presencePath,
    /export\s+function\s+readAiPlannerPresenceFromStorage/.test(presence),
    'src/lib/aiPlannerPresence.ts must export readAiPlannerPresenceFromStorage',
    lineOf(presence, 'readAiPlannerPresenceFromStorage')
  ),
  check(
    'AiPlannerPresenceCard component exists',
    cardPath,
    fs.existsSync(path.join(root, cardPath)) && /export\s+default\s+function\s+AiPlannerPresenceCard/.test(card),
    'src/components/AiPlannerPresenceCard.tsx must export AiPlannerPresenceCard',
    lineOf(card, 'AiPlannerPresenceCard')
  ),
  check(
    'AI planner has floating entry',
    drawerPath,
    drawer.includes('fixed bottom-5 right-5') && drawer.includes('打开 AI 计划员工作台'),
    'AI planner should be opened from a compact floating entry instead of a large page card',
    lineOf(drawer, '打开 AI 计划员工作台')
  ),
  check(
    'drawer dispatches presence update event',
    drawerPath,
    drawer.includes('gg-ai:planner-presence-updated'),
    'AiCopilotDrawer must dispatch gg-ai:planner-presence-updated after localStorage changes',
    lineOf(drawer, 'gg-ai:planner-presence-updated')
  ),
  check(
    'package script exists',
    packagePath,
    pkg.includes('"check:ai-planner-presence"'),
    'package.json must include check:ai-planner-presence',
    lineOf(pkg, 'check:ai-planner-presence')
  ),
  check(
    'presence card does not mutate orders',
    cardPath,
    !/updateOrderAction|executeAiCopilotMutationsAction|repairMisclassifiedReadyOrdersAction/.test(card),
    'AiPlannerPresenceCard must be read-only and must not call order mutation actions',
    1
  ),
];

const ok = checks.every((item) => item.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
