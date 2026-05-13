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

const checks = [];
const failures = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}

const mesActions = read('src/actions/mesActions.ts');
const page = read('src/app/page.tsx');

record(
  'mesActions imports normalizeOrderReadyFlags',
  /readyFlagNormalization/.test(mesActions) && /normalizeOrderReadyFlags/.test(mesActions),
  'src/actions/mesActions.ts must import ready flag normalization'
);

record(
  'createOrderAction normalizes ready flags',
  /createOrderAction[\s\S]*normalizeOrderReadyFlags/.test(windowAround(mesActions, 'createOrderAction', 1600)),
  'createOrderAction must call normalizeOrderReadyFlags before normalizeOrder'
);

record(
  'updateOrderAction normalizes ready flags through patch builder',
  /function buildOrderPatch[\s\S]*normalizeOrderReadyFlags/.test(mesActions),
  'buildOrderPatch/updateOrderAction must normalize drawing/materials patches'
);

record(
  'batchUpdateOrdersAction uses normalized patches',
  /batchUpdateOrdersAction[\s\S]*buildOrderPatch/.test(windowAround(mesActions, 'batchUpdateOrdersAction', 1400)) &&
    /function buildOrderPatch[\s\S]*normalizeOrderReadyFlags/.test(mesActions),
  'batchUpdateOrdersAction must flow through normalized buildOrderPatch'
);

record(
  'importOrdersOverwriteWeekAction normalizes imported rows',
  /importOrdersOverwriteWeekAction[\s\S]*normalizeOrderReadyFlags/.test(windowAround(mesActions, 'importOrdersOverwriteWeekAction', 5200)),
  'Excel/import server action must normalize imported drawing/materials text'
);

record(
  'orderUpdateOrCreateFromPatch normalizes fallback creates',
  /orderUpdateOrCreateFromPatch[\s\S]*normalizeOrderReadyFlags/.test(windowAround(mesActions, 'orderUpdateOrCreateFromPatch', 1200)),
  'update-or-create helper must normalize patches before update/create'
);

record(
  'page import path normalizes frontend import rows',
  /readyFlagNormalization/.test(page) && /processExcelData[\s\S]*normalizeOrderReadyFlags/.test(page),
  'src/app/page.tsx import flow should normalize imported rows before optimistic display'
);

record(
  'page editing path normalizes readiness text',
  /updateOrderData[\s\S]*normalizeOrderReadyFlags/.test(windowAround(page, 'updateOrderData', 1800)),
  'src/app/page.tsx edit flow should normalize drawing/materials text before optimistic display'
);

const result = { ok: failures.length === 0, checks };
console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
