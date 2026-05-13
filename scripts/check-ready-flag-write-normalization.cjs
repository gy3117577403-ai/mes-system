const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function windowAround(content, token, size = 900) {
  const index = content.indexOf(token);
  if (index < 0) return '';
  return content.slice(index, index + size);
}

function lineOf(content, token) {
  const index = content.indexOf(token);
  if (index < 0) return null;
  return content.slice(0, index).split(/\r?\n/).length;
}

const checks = [];
const failures = [];

function record(name, pass, file, token, detail) {
  checks.push({ name, pass, file, line: lineOf(read(file), token), detail });
  if (!pass) failures.push(`${name}: ${detail}`);
}

const mesActions = read('src/actions/mesActions.ts');
const page = read('src/app/page.tsx');
const aiScheduler = read('src/actions/aiSchedulerActions.ts');
const aiExecuteBlock = aiScheduler.slice(aiScheduler.indexOf('executeAiCopilotMutationsAction'));

record(
  'mesActions readyFlagNormalization import',
  /readyFlagNormalization/.test(mesActions) && /normalizeOrderReadyFlags/.test(mesActions),
  'src/actions/mesActions.ts',
  'readyFlagNormalization',
  'src/actions/mesActions.ts must import ready flag normalization'
);

record(
  'createOrderAction normalization',
  /createOrderAction[\s\S]*normalizeOrderReadyFlags/.test(windowAround(mesActions, 'createOrderAction', 1600)),
  'src/actions/mesActions.ts',
  'createOrderAction',
  'createOrderAction must call normalizeOrderReadyFlags before normalizeOrder'
);

record(
  'updateOrderAction normalization',
  /function buildOrderPatch[\s\S]*normalizeOrderReadyFlags/.test(mesActions),
  'src/actions/mesActions.ts',
  'function buildOrderPatch',
  'buildOrderPatch/updateOrderAction must normalize drawing/materials patches'
);

record(
  'batchUpdateOrdersAction normalization',
  /batchUpdateOrdersAction[\s\S]*buildOrderPatch/.test(windowAround(mesActions, 'batchUpdateOrdersAction', 1400)) &&
    /function buildOrderPatch[\s\S]*normalizeOrderReadyFlags/.test(mesActions),
  'src/actions/mesActions.ts',
  'batchUpdateOrdersAction',
  'batchUpdateOrdersAction must flow through normalized buildOrderPatch'
);

record(
  'importOrdersOverwriteWeekAction normalization',
  /importOrdersOverwriteWeekAction[\s\S]*normalizeOrderReadyFlags/.test(windowAround(mesActions, 'importOrdersOverwriteWeekAction', 5200)),
  'src/actions/mesActions.ts',
  'importOrdersOverwriteWeekAction',
  'Excel/import server action must normalize imported drawing/materials text'
);

record(
  'orderUpdateOrCreateFromPatch fallback normalization',
  /orderUpdateOrCreateFromPatch[\s\S]*normalizeOrderReadyFlags/.test(windowAround(mesActions, 'orderUpdateOrCreateFromPatch', 1200)),
  'src/actions/mesActions.ts',
  'orderUpdateOrCreateFromPatch',
  'update-or-create helper must normalize patches before update/create'
);

record(
  'frontend Excel parse normalization',
  /readyFlagNormalization/.test(page) && /processExcelData[\s\S]*normalizeOrderReadyFlags/.test(page),
  'src/app/page.tsx',
  'processExcelData',
  'src/app/page.tsx import flow should normalize imported rows before optimistic display'
);

record(
  'frontend edit normalization',
  /updateOrderData[\s\S]*normalizeOrderReadyFlags/.test(windowAround(page, 'updateOrderData', 1800)),
  'src/app/page.tsx',
  'updateOrderData',
  'src/app/page.tsx edit flow should normalize drawing/materials text before optimistic display'
);

record(
  'AI mutation does not update drawing/materials',
  !/data:\s*\{[\s\S]{0,220}\b(drawing|materials|isDrawingReady|isMaterialReady)\b/.test(aiExecuteBlock),
  'src/actions/aiSchedulerActions.ts',
  'executeAiCopilotMutationsAction',
  'AI mutation execution should not update readiness text/flags; if it does, it must call normalizeOrderReadyFlags'
);

const result = { ok: failures.length === 0, checks };
console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
