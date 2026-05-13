const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function lineOf(content, token) {
  const index = content.indexOf(token);
  if (index < 0) return null;
  return content.slice(0, index).split(/\r?\n/).length;
}

const files = {
  types: 'src/types/index.ts',
  page: 'src/app/page.tsx',
  drawer: 'src/components/AiCopilotDrawer.tsx',
  actions: 'src/actions/aiSchedulerActions.ts',
};

const contents = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)]));
const checks = [];

function record(name, pass, file, token, detail) {
  checks.push({ name, pass, file, line: lineOf(read(file), token), detail });
}

record(
  'AiPlannerUiContext type exists',
  /export type AiPlannerUiContext/.test(contents.types),
  files.types,
  'AiPlannerUiContext',
  'src/types/index.ts must export AiPlannerUiContext'
);

record(
  'page passes uiContext to AiCopilotDrawer',
  /<AiCopilotDrawer[\s\S]*uiContext=\{aiPlannerUiContext\}/.test(contents.page),
  files.page,
  'aiPlannerUiContext',
  'src/app/page.tsx must pass uiContext into AiCopilotDrawer'
);

record(
  'AiCopilotDrawer receives uiContext prop',
  /uiContext\?:\s*AiPlannerUiContext/.test(contents.drawer) && /mergedUiContext/.test(contents.drawer),
  files.drawer,
  'uiContext?: AiPlannerUiContext',
  'AiCopilotDrawer must accept and merge uiContext'
);

record(
  'interactWithAiCopilotAction call passes uiContext',
  /interactWithAiCopilotAction\(text,\s*currentBaseLimit,\s*mergedUiContext\)/.test(contents.drawer),
  files.drawer,
  'interactWithAiCopilotAction(text, currentBaseLimit, mergedUiContext)',
  'Client action invocation must pass merged uiContext'
);

record(
  'interactWithAiCopilotAction accepts uiContext',
  /interactWithAiCopilotAction\([\s\S]*uiContext\?:\s*AiPlannerUiContext/.test(contents.actions),
  files.actions,
  'uiContext?: AiPlannerUiContext',
  'Server Action must accept optional uiContext'
);

record(
  'aiSchedulerActions sanitizes uiContext',
  /function sanitizeUiContext/.test(contents.actions) && /visibleOrderIds[\s\S]*slice\(0,\s*200\)/.test(contents.actions),
  files.actions,
  'sanitizeUiContext',
  'Server Action must sanitize uiContext and cap visibleOrderIds'
);

record(
  'prompt includes current page context',
  /当前用户页面上下文/.test(contents.actions),
  files.actions,
  '当前用户页面上下文',
  'Prompt must include current user page context'
);

const result = { ok: checks.every((check) => check.pass), checks };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
