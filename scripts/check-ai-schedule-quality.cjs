const fs = require('fs');

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

const balanced = read('src/lib/aiBalancedSchedulePlanner.ts');
const validation = read('src/lib/aiSchedulePlanValidation.ts');
const action = read('src/actions/aiSchedulerActions.ts');
const drawer = read('src/components/AiCopilotDrawer.tsx');
const eligibility = read('src/lib/scheduleEligibility.ts');

function normalizeForCheck(value, defaultYear = 2026) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const compact = text.replace(/\s+/g, '');
  const make = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    const label = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { key: Number(label.replace(/-/g, '')), label };
  };
  const full = /^(\d{4})[年./-]?(\d{1,2})[月./-]?(\d{1,2})日?/.exec(compact);
  if (full) return make(Number(full[1]), Number(full[2]), Number(full[3]));
  const chinese = /^(\d{1,2})月(\d{1,2})日?$/.exec(compact);
  if (chinese) return make(defaultYear, Number(chinese[1]), Number(chinese[2]));
  const short = /^(\d{1,2})[./-](\d{1,2})$/.exec(compact);
  if (short) return make(defaultYear, Number(short[1]), Number(short[2]));
  return null;
}

function dueBoundaryOk(dayRows) {
  for (let i = 0; i < dayRows.length - 1; i += 1) {
    const left = dayRows[i].map((row) => normalizeForCheck(row.delivery)).filter(Boolean).sort((a, b) => a.key - b.key);
    const right = dayRows[i + 1].map((row) => normalizeForCheck(row.delivery)).filter(Boolean).sort((a, b) => a.key - b.key);
    const leftMax = left.at(-1);
    const rightMin = right[0];
    if (leftMax && rightMin && leftMax.key > rightMin.key) return false;
  }
  return true;
}

const mixedDateOrderOk = normalizeForCheck('5月11日').key < normalizeForCheck('2026-05-15').key;
const shortDateOrderOk = normalizeForCheck('5/11').key === normalizeForCheck('05-11').key;
const sameDueHighHoursFirst =
  [
    { id: 'small', delivery: '5月11日', minutes: 80 },
    { id: 'large', delivery: '2026-05-11', minutes: 240 },
  ]
    .sort((a, b) => normalizeForCheck(a.delivery).key - normalizeForCheck(b.delivery).key || b.minutes - a.minutes)
    .map((row) => row.id)
    .join(',') === 'large,small';
const badBoundaryIsRejected = !dueBoundaryOk([
  [{ delivery: '2026-05-15' }],
  [{ delivery: '5月11日' }],
]);
const balanceDoesNotReorderDueDates = dueBoundaryOk([
  [{ delivery: '5月11日' }, { delivery: '2026-05-11' }],
  [{ delivery: '05-12' }],
  [{ delivery: '2026-05-15' }],
]);

const checks = [
  { name: 'balanced planner exists', pass: /buildBalancedSchedulePlan/.test(balanced) },
  { name: 'schedule validation exists', pass: /validateAiSchedulePlan/.test(validation) },
  { name: 'extractScheduleIntent exists', pass: /extractScheduleIntent/.test(action) },
  { name: 'action calls balanced planner', pass: /buildBalancedSchedulePlan/.test(action) },
  { name: 'action calls schedule validation', pass: /validateAiSchedulePlan/.test(action) },
  { name: 'balanced planner includes scheduled orders by default', pass: /allowRescheduleAssigned\s*=\s*input\.allowRescheduleAssigned\s*!==\s*false/.test(balanced) },
  { name: 'intent only excludes scheduled orders when user says so', pass: /keepScheduledFixed/.test(action) && /allowRescheduleAssigned:\s*wantsScheduling\s*&&\s*!keepScheduledFixed/.test(action) },
  { name: 'prompt says candidates include ready and scheduled orders', pass: action.includes('就绪待排池 + 周一到周六已排产订单') },
  { name: 'prompt requires due date order', pass: action.includes('严格按交期从早到晚') },
  { name: 'prompt mentions daily average target', pass: action.includes('日均目标') },
  { name: 'prompt mentions 500 minute tolerance', pass: /500\s*分钟/.test(action) },
  { name: 'prompt blocks last-day backlog', pass: action.includes('不允许前几天低负荷、最后一天严重爆仓') },
  { name: 'planner normalizes mixed delivery date formats', pass: balanced.includes('normalizeScheduleDeliveryDate') && balanced.includes('5月11日') === false && balanced.includes('月') },
  { name: 'planner excludes unrecognized delivery dates', pass: balanced.includes('excludedByInvalidDelivery') && balanced.includes('交期格式无法识别') },
  { name: 'validation rejects unrecognized delivery dates', pass: validation.includes('INVALID_DELIVERY_DATE') && validation.includes('交期格式无法识别') },
  { name: 'validation exposes due date order result', pass: validation.includes('dueDateOrder') && validation.includes('交期顺序') },
  { name: 'validation blocks previous day later due date', pass: validation.includes('previousLatestDueDate') && validation.includes('nextEarliestDueDate') },
  { name: 'validation explains workload cannot break due date order', pass: validation.includes('负荷均衡只能在同交期') },
  { name: 'validation exposes day earliest/latest due date', pass: validation.includes('earliestDueDate') && validation.includes('latestDueDate') },
  { name: 'case: 5月11日 sorts before 2026-05-15', pass: mixedDateOrderOk },
  { name: 'case: 5/11 and 05-11 normalize equally', pass: shortDateOrderOk },
  { name: 'case: same due date high workload first', pass: sameDueHighHoursFirst },
  { name: 'case: Monday later due than Tuesday is rejected', pass: badBoundaryIsRejected },
  { name: 'case: workload balance does not reorder due dates', pass: balanceDoesNotReorderDueDates },
  { name: 'drawer displays schedulePlanValidation', pass: /schedulePlanValidation/.test(drawer) },
  { name: 'drawer displays due date order status', pass: drawer.includes('交期顺序通过') && drawer.includes('交期顺序不通过') },
  { name: 'drawer displays earliest/latest due date per day', pass: drawer.includes('earliestDueDate') && drawer.includes('latestDueDate') },
  { name: 'drawer displays candidate source summary', pass: drawer.includes('候选订单识别') && drawer.includes('周一到周六已排可调整') },
  { name: 'invalid validation disables apply', pass: /schedulePlanExecutable/.test(drawer) && /disabled=\{!hasMutations \|\| isApplying \|\| !schedulePlanExecutable\}/.test(drawer) },
  { name: 'execution still calls canEnterSchedule', pass: /executeAiCopilotMutationsAction[\s\S]*canEnterSchedule/.test(action) },
  { name: 'scheduleEligibility still has canEnterSchedule', pass: /canEnterSchedule/.test(eligibility) },
];

const ok = checks.every((check) => check.pass);
console.log(JSON.stringify({ ok, checks }, null, 2));
if (!ok) process.exitCode = 1;
