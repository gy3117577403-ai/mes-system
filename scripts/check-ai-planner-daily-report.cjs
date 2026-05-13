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
const reportPath = 'src/lib/aiPlannerDailyReport.ts';
const drawerPath = 'src/components/AiCopilotDrawer.tsx';

const types = read(typesPath);
const report = read(reportPath);
const drawer = read(drawerPath);

const sectionStart = drawer.indexOf('日报仅用于计划沟通与交接');
const sectionEnd = drawer.indexOf('鍙戠幇鐨勯棶棰?', sectionStart);
const reportSection = sectionStart >= 0 ? drawer.slice(sectionStart, sectionEnd > sectionStart ? sectionEnd : sectionStart + 14000) : '';

const checks = [
  check('AiPlannerDailyReport type exists', typesPath, /export\s+type\s+AiPlannerDailyReport\s*=/.test(types), 'src/types/index.ts must export AiPlannerDailyReport', lineOf(types, 'AiPlannerDailyReport')),
  check(
    'buildAiPlannerDailyReport exists',
    reportPath,
    /export\s+function\s+buildAiPlannerDailyReport/.test(report),
    'src/lib/aiPlannerDailyReport.ts must export buildAiPlannerDailyReport',
    lineOf(report, 'buildAiPlannerDailyReport')
  ),
  check(
    'buildDailyReportMarkdown exists',
    reportPath,
    /export\s+function\s+buildDailyReportMarkdown/.test(report),
    'src/lib/aiPlannerDailyReport.ts must export buildDailyReportMarkdown',
    lineOf(report, 'buildDailyReportMarkdown')
  ),
  check('AiCopilotDrawer renders daily report section', drawerPath, drawer.includes('AI 计划员日报'), 'AiCopilotDrawer must render AI 计划员日报', lineOf(drawer, 'AI 计划员日报')),
  check(
    'AiCopilotDrawer daily report localStorage key exists',
    drawerPath,
    drawer.includes('gg-ai.aiPlannerDailyReport.v1'),
    'AiCopilotDrawer must use gg-ai.aiPlannerDailyReport.v1 localStorage key',
    lineOf(drawer, 'gg-ai.aiPlannerDailyReport.v1')
  ),
  check('AiCopilotDrawer has copy report button', drawerPath, drawer.includes('复制日报'), 'Daily report UI must include 复制日报', lineOf(drawer, '复制日报')),
  check('AiCopilotDrawer has markdown download button', drawerPath, drawer.includes('下载 Markdown'), 'Daily report UI must include 下载 Markdown', lineOf(drawer, '下载 Markdown')),
  check(
    'daily report buttons do not mutate orders',
    drawerPath,
    reportSection.length > 0 && !/executeAiCopilotMutationsAction|updateOrderAction|repairMisclassifiedReadyOrdersAction/.test(reportSection),
    'Daily report controls must not execute AI mutations or update orders',
    sectionStart >= 0 ? drawer.slice(0, sectionStart).split(/\r?\n/).length : null
  ),
];

const ok = checks.every((item) => item.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
