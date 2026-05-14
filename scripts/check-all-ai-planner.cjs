const { spawnSync } = require('child_process');

const commands = [
  'pnpm check:ai-ui-context',
  'pnpm check:ai-planner-todos',
  'pnpm check:ai-planner-daily-report',
  'pnpm check:ai-planner-presence',
  'pnpm check:ai-morning-check',
  'pnpm check:ai-planner-mvp',
];

const results = [];

for (const command of commands) {
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

const ok = results.every((result) => result.pass) && results.length === commands.length;
console.log(JSON.stringify({ ok, results }, null, 2));
if (!ok) process.exitCode = 1;
