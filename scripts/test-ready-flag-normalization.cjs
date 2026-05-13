const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadReadyFlagNormalization() {
  const sourcePath = path.join(process.cwd(), 'src', 'lib', 'readyFlagNormalization.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const fn = new Function('exports', 'module', 'require', compiled);
  fn(module.exports, module, require);
  return module.exports;
}

const {
  isDrawingTextReady,
  isMaterialTextReady,
  normalizeOrderReadyFlags,
} = loadReadyFlagNormalization();

const cases = [];

function addCase(name, actual, expected) {
  const pass = Object.is(actual, expected);
  cases.push({ name, pass, actual, expected });
}

for (const text of ['已发', '已发图', '图纸已发', '已下发', '图纸已下发', '已提供图纸', '图纸齐全']) {
  addCase(`drawing true: ${text}`, isDrawingTextReady(text), true);
}

for (const text of ['未发图', '未下发', '待发图', '缺图纸', '无图纸', '', null, undefined, '随机文本']) {
  addCase(`drawing false: ${String(text)}`, isDrawingTextReady(text), false);
}

for (const text of ['料齐', '已配料', '已齐套', '齐套', '物料齐', '物料已齐', '配料完成']) {
  addCase(`material true: ${text}`, isMaterialTextReady(text), true);
}

for (const text of ['未配料', '缺料', '待配料', '物料不足', '欠料', '', null, undefined, '随机文本']) {
  addCase(`material false: ${String(text)}`, isMaterialTextReady(text), false);
}

addCase(
  "normalize drawing='已发图' missing flag",
  normalizeOrderReadyFlags({ drawing: '已发图' }).isDrawingReady,
  true
);
addCase(
  "normalize drawing='未发图' missing flag",
  normalizeOrderReadyFlags({ drawing: '未发图' }).isDrawingReady,
  false
);
addCase(
  "normalize drawing='已发图' explicit false",
  normalizeOrderReadyFlags({ drawing: '已发图', isDrawingReady: false }).isDrawingReady,
  false
);
addCase(
  "normalize materials='料齐' missing flag",
  normalizeOrderReadyFlags({ materials: '料齐' }).isMaterialReady,
  true
);
addCase(
  "normalize materials='缺料' missing flag",
  normalizeOrderReadyFlags({ materials: '缺料' }).isMaterialReady,
  false
);
addCase(
  "normalize materials='料齐' explicit false",
  normalizeOrderReadyFlags({ materials: '料齐', isMaterialReady: false }).isMaterialReady,
  false
);

const failed = cases.filter((item) => !item.pass).length;
const payload = {
  ok: failed === 0,
  passed: cases.length - failed,
  failed,
  cases,
};

console.log(JSON.stringify(payload, null, 2));
if (failed > 0) process.exitCode = 1;

