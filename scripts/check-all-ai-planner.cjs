const { spawnSync } = require('child_process');

const scripts = [
  'check:ai-ui-context',
  'check:ai-planner-todos',
  'check:ai-planner-daily-report',
  'check:ai-planner-presence',
  'check:ai-morning-check',
  'check:ai-planner-mvp',
  'check:ai-ui-cleanup',
  'check:ai-schedule-apply',
  'check:ai-schedule-quality',
];

const pnpmAvailable =
  spawnSync('pnpm --version', {
    shell: true,
    encoding: 'utf8',
    stdio: 'pipe',
  }).status === 0;

const commandFor = (script) => (pnpmAvailable ? `pnpm ${script}` : `npm run ${script}`);

const results = [];

for (const script of scripts) {
  const command = commandFor(script);
  const child = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const output = `${child.stdout || ''}${child.stderr || ''}`.trim();
  results.push({
    command,
    pass: child.status === 0,
    status: child.status,
    outputTail: output.split(/\r?\n/).slice(-20).join('\n'),
  });
  if (child.status !== 0) break;
}

const ok = results.every((result) => result.pass) && results.length === scripts.length;
console.log(JSON.stringify({ ok, runner: pnpmAvailable ? 'pnpm' : 'npm', results }, null, 2));
if (!ok) process.exitCode = 1;
