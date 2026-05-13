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
const todosPath = 'src/lib/aiPlannerTodos.ts';
const drawerPath = 'src/components/AiCopilotDrawer.tsx';

const types = read(typesPath);
const todos = read(todosPath);
const drawer = read(drawerPath);

const todoSectionStart = drawer.indexOf('AI 计划员待办');
const todoSectionEnd = drawer.indexOf('鍙戠幇鐨勯棶棰?', todoSectionStart);
const todoSection = todoSectionStart >= 0 ? drawer.slice(todoSectionStart, todoSectionEnd > todoSectionStart ? todoSectionEnd : todoSectionStart + 12000) : '';

const checks = [
  check('AiPlannerTodo type exists', typesPath, /export\s+type\s+AiPlannerTodo\s*=/.test(types), 'src/types/index.ts must export AiPlannerTodo', lineOf(types, 'AiPlannerTodo')),
  check(
    'buildAiPlannerTodosFromReport exists',
    todosPath,
    /export\s+function\s+buildAiPlannerTodosFromReport/.test(todos),
    'src/lib/aiPlannerTodos.ts must export buildAiPlannerTodosFromReport',
    lineOf(todos, 'buildAiPlannerTodosFromReport')
  ),
  check(
    'buildTodoCopyText exists',
    todosPath,
    /export\s+function\s+buildTodoCopyText/.test(todos),
    'src/lib/aiPlannerTodos.ts must export buildTodoCopyText',
    lineOf(todos, 'buildTodoCopyText')
  ),
  check(
    'AiCopilotDrawer imports aiPlannerTodos helpers',
    drawerPath,
    drawer.includes('@/lib/aiPlannerTodos') && drawer.includes('buildAiPlannerTodosFromReport'),
    'AiCopilotDrawer must import aiPlannerTodos helpers',
    lineOf(drawer, '@/lib/aiPlannerTodos')
  ),
  check(
    'AiCopilotDrawer localStorage key exists',
    drawerPath,
    drawer.includes('gg-ai.aiPlannerTodos.v1'),
    'AiCopilotDrawer must use gg-ai.aiPlannerTodos.v1 localStorage key',
    lineOf(drawer, 'gg-ai.aiPlannerTodos.v1')
  ),
  check(
    'AiCopilotDrawer renders todo section',
    drawerPath,
    drawer.includes('AI 计划员待办'),
    'AiCopilotDrawer must render AI 计划员待办',
    lineOf(drawer, 'AI 计划员待办')
  ),
  check(
    'todo buttons do not mutate orders',
    drawerPath,
    todoSection.length > 0 && !/updateOrderAction|executeAiCopilotMutationsAction|repairMisclassifiedReadyOrdersAction/.test(todoSection),
    'Todo card controls must not call order update actions or execute AI mutations',
    todoSectionStart >= 0 ? drawer.slice(0, todoSectionStart).split(/\r?\n/).length : null
  ),
];

const ok = checks.every((item) => item.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
