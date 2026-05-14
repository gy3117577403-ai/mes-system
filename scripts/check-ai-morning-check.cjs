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

const typesPath = 'src/types/index.ts';
const toolPath = 'src/lib/aiPlannerMorningCheck.ts';
const drawerPath = 'src/components/AiCopilotDrawer.tsx';
const presencePath = 'src/lib/aiPlannerPresence.ts';
const cardPath = 'src/components/AiPlannerPresenceCard.tsx';
const pkgPath = 'package.json';

const types = read(typesPath);
const tool = read(toolPath);
const drawer = read(drawerPath);
const presence = read(presencePath);
const card = read(cardPath);
const pkg = read(pkgPath);

const morningStart = drawer.indexOf('const runMorningCheck');
const morningEnd = drawer.indexOf('const askPlanner', morningStart);
const morningFlow = morningStart >= 0 ? drawer.slice(morningStart, morningEnd > morningStart ? morningEnd : morningStart + 12000) : '';

const checks = [
  check('AiPlannerMorningCheckResult type exists', typesPath, /export\s+type\s+AiPlannerMorningCheckResult\s*=/.test(types), 'src/types/index.ts must export AiPlannerMorningCheckResult', lineOf(types, 'AiPlannerMorningCheckResult')),
  check('aiPlannerMorningCheck tool exists', toolPath, fs.existsSync(path.join(root, toolPath)) && tool.includes('createMorningCheckId'), 'src/lib/aiPlannerMorningCheck.ts must exist and export workflow helpers', lineOf(tool, 'createMorningCheckId')),
  check('drawer renders one-click morning check', drawerPath, drawer.includes('AI 计划员一键晨检'), 'AiCopilotDrawer must render AI 计划员一键晨检', lineOf(drawer, 'AI 计划员一键晨检')),
  check('drawer uses daily planning template', drawerPath, drawer.includes('DAILY_PLANNING_CHECKUP'), 'Morning check must use DAILY_PLANNING_CHECKUP', lineOf(drawer, 'DAILY_PLANNING_CHECKUP')),
  check('drawer persists morning check result', drawerPath, drawer.includes('gg-ai.aiPlannerMorningCheck.v1') || drawer.includes('saveMorningCheckResultToStorage'), 'Morning check result must be persisted through localStorage helper', lineOf(drawer, 'saveMorningCheckResultToStorage')),
  check('presence reads morning check status', presencePath, presence.includes('gg-ai.aiPlannerMorningCheck.v1') || card.includes('morningCheckDone'), 'Presence must read or display morning check state', lineOf(presence, 'gg-ai.aiPlannerMorningCheck.v1')),
  check('morning flow does not execute AI mutations', drawerPath, morningFlow.length > 0 && !morningFlow.includes('executeAiCopilotMutationsAction'), 'Morning check flow must not call executeAiCopilotMutationsAction', morningStart >= 0 ? drawer.slice(0, morningStart).split(/\r?\n/).length : null),
  check('morning flow does not update orders', drawerPath, morningFlow.length > 0 && !/updateOrderAction|batchUpdateOrdersAction|repairMisclassifiedReadyOrdersAction/.test(morningFlow), 'Morning check flow must not call order mutation actions', morningStart >= 0 ? drawer.slice(0, morningStart).split(/\r?\n/).length : null),
  check('package script exists', pkgPath, pkg.includes('"check:ai-morning-check"'), 'package.json must include check:ai-morning-check', lineOf(pkg, 'check:ai-morning-check')),
];

const ok = checks.every((item) => item.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
