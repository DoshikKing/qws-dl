import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const cli = fileURLToPath(new URL('../scripts/agent-flow.mjs', import.meta.url));
const phases = ['ANALYSIS', 'DEVELOPMENT', 'QA', 'SECURITY', 'NOTES', 'INTEGRATION'];
const roles = ['analyst', 'developer_tester', 'qa', 'security', 'patchnotes_reviewer', 'integrator'];
const leads = ['analysis_lead', 'development_lead', 'qa_lead', 'security_lead', 'release_lead', 'integration_lead'];
const passingCheck = { name: 'verify', argv: [process.execPath, '-e', 'process.stdout.write("fixture check\\n")'], timeoutSeconds: 5 };
function plan() {
  return {
    goal: 'Verify a fixture candidate through independent gates', acceptance: ['Every required gate passes'], pm: 'pm',
    actors: [...roles, ...leads].map(role => ({ id: role, role })),
    tasks: phases.map((phase, i) => ({ id: phase.toLowerCase(), phase, role: roles[i], acceptance: ['Fixture criterion verified'],
      deps: i ? [phases[i - 1].toLowerCase()] : [], paths: i === 1 ? ['src'] : [],
      checks: [2, 5].includes(i) ? [structuredClone(passingCheck)] : [] })),
  };
}
function fixture(t, taskPlan = plan()) {
  const root = mkdtempSync(join(tmpdir(), 'agent-flow-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init', '--quiet'); git('config', 'user.name', 'Workflow Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitignore'), '.agent-workflows/\n');
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'candidate.txt'), 'base\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'Fixture base');
  const invoke = (command, input) => spawnSync(process.execPath, [cli, command, 'fixture', '-'], {
    cwd: root, input: JSON.stringify(input ?? {}), encoding: 'utf8', timeout: 15000,
  });
  const ok = (command, input) => {
    const result = invoke(command, input); assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  const bad = (command, input, pattern) => {
    const result = invoke(command, input); assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
    if (pattern) assert.match(result.stderr, pattern); return result;
  };
  let serial = 0;
  const evidence = () => {
    const path = `.agent-workflows/fixture/evidence/report-${++serial}.txt`;
    writeFileSync(join(root, path), `Fixture observation ${serial}: independent acceptance criteria inspected.\n`); return [path];
  };
  const claim = (task, actor = taskPlan.tasks.find(item => item.id === task).role, extra = {}) => {
    const state = ok('claim', { actor, task, ...extra });
    return { actor, task, assignment: state.tasks.find(item => item.id === task).assignment.id };
  };
  const submit = assignment => ok('submit', { ...assignment, summary: 'Inspected fixture result against acceptance criteria', evidence: evidence() });
  const review = (assignment, verdict = 'PASS', extra = {}) => {
    const task = taskPlan.tasks.find(item => item.id === assignment.task);
    return ok('review', { ...assignment, actor: leads[phases.indexOf(task.phase)], verdict, evidence: evidence(), reason: 'Independent fixture review', ...extra });
  };
  const finish = task => {
    const assignment = claim(task.id);
    for (const check of task.checks ?? []) ok('check', { ...assignment, name: check.name });
    submit(assignment); return review(assignment);
  };
  const through = phase => {
    let state;
    for (const task of taskPlan.tasks) { state = finish(task); if (task.phase === phase) break; }
    return state;
  };
  const background = (command, input) => {
    const child = spawn(process.execPath, [cli, command, 'fixture', '-'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const done = new Promise(resolveDone => child.once('close', code => resolveDone({ code, stdout, stderr })));
    child.stdin.end(JSON.stringify(input));
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    return { child, done };
  };
  ok('init', taskPlan);
  return { root, git, ok, bad, evidence, claim, submit, review, finish, through, background, taskPlan };
}
async function until(predicate, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (predicate()) return; await delay(25); }
  assert.fail(message);
}

test('complete graph runs declared checks, freezes one tree and requires PM approval', t => {
  const f = fixture(t);
  f.bad('decide', { actor: 'pm', verdict: 'APPROVE', reason: 'Too early' }, /All phase gates/);
  let frozen;
  for (const task of f.taskPlan.tasks) {
    const assignment = f.claim(task.id);
    if (task.checks.length) {
      f.bad('submit', { ...assignment, summary: 'Premature', evidence: f.evidence() }, /Required checks/);
      f.bad('check', { ...assignment, name: 'undeclared', argv: [process.execPath, '-e', 'process.exit(0)'] }, /not declared/);
      for (const check of task.checks) {
        const checked = f.ok('check', { ...assignment, name: check.name });
        const result = checked.tasks.find(item => item.id === task.id).checks[0];
        assert.equal(result.exitCode, 0); assert.match(result.outputSha256, /^[a-f0-9]{64}$/); assert.ok(result.outputBytes > 0);
        assert.equal(JSON.stringify(checked).includes('fixture check'), false, 'Raw check output must not enter ledger');
      }
    }
    f.submit(assignment);
    const state = f.review(assignment);
    if (task.phase === 'DEVELOPMENT') frozen = state.candidateTree;
    if (frozen) assert.equal(state.candidateTree, frozen);
  }
  assert.equal(f.ok('status').phase, 'PM_REVIEW');
  f.bad('decide', { actor: 'integrator', verdict: 'APPROVE', reason: 'Wrong actor' }, /Only PM/);
  const accepted = f.ok('decide', { actor: 'pm', verdict: 'APPROVE', reason: 'All independent evidence and checks accepted' });
  assert.equal(accepted.phase, 'APPROVED'); assert.equal(accepted.decision.candidateTree, f.git('write-tree'));
});

test('FAIL resets assignments and three unsuccessful cycles block further work', t => {
  const f = fixture(t);
  for (let cycle = 1; cycle <= 3; cycle++) {
    const assignment = f.claim('analysis'); f.submit(assignment);
    const state = f.review(assignment, 'FAIL');
    assert.equal(state.phase, cycle === 3 ? 'BLOCKED' : 'ANALYSIS'); assert.equal(state.failures, cycle);
    assert.ok(state.tasks.every(task => task.status === 'PENDING' && task.assignment === null));
    f.bad('submit', { ...assignment, summary: 'Late response', evidence: f.evidence() }, /Stale|BLOCKED/);
  }
  f.bad('claim', { actor: 'analyst', task: 'analysis' }, /BLOCKED/);
  assert.equal(f.ok('status').events.filter(event => event.kind === 'RETURN_TO_ANALYSIS').length, 3);
});

test('DAG rejects unknown dependencies, cycles and dependencies on future phases', t => {
  const f = fixture(t);
  for (const [mutate, pattern] of [
    [p => { p.tasks[0].deps = ['absent']; }, /Unknown dependency/],
    [p => { p.tasks.push({ ...p.tasks[0], id: 'second', deps: ['analysis'] }); p.tasks[0].deps = ['second']; }, /cycle/],
    [p => { p.tasks[0].deps = ['qa']; }, /future phase/],
  ]) {
    const p = plan(); mutate(p); f.bad('replan', { actor: 'pm', reason: 'Validate dependency graph', plan: p }, pattern);
  }
  const p = plan(); p.tasks.push({ ...p.tasks[0], id: 'second', deps: ['analysis'] });
  f.ok('replan', { actor: 'pm', reason: 'Add dependent analysis task', plan: p });
  assert.deepEqual(f.ok('ready').ready.map(task => task.id), ['analysis']);
  f.bad('claim', { actor: 'analyst', task: 'second' }, /not ready/);
});

test('simultaneous claims have exactly one winner and persist across CLI restarts', async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, () => f.background('claim', { actor: 'analyst', task: 'analysis' }).done));
  assert.equal(results.filter(result => result.code === 0).length, 1);
  const winner = JSON.parse(results.find(result => result.code === 0).stdout).tasks[0].assignment;
  assert.equal(f.ok('status').tasks[0].assignment.id, winner.id);
  f.ok('heartbeat', { actor: 'analyst', task: 'analysis', assignment: winner.id, leaseSeconds: 30 });
});

test('write scopes conflict across active assignments, including literal Nuxt paths', t => {
  const p = plan();
  p.actors.push({ id: 'other-dev', role: 'developer_tester' });
  p.tasks[1].paths = ['pages/[id]'];
  p.tasks.splice(2, 0,
    { ...structuredClone(p.tasks[1]), id: 'nested', paths: ['pages/[id]/[token].vue'] },
    { ...structuredClone(p.tasks[1]), id: 'sibling', paths: ['pages/[token].vue', '.agent-workflows-tools'] });
  const f = fixture(t, p); f.finish(p.tasks[0]);
  const first = f.claim('development'); f.submit(first);
  f.bad('claim', { actor: 'other-dev', task: 'nested' }, /overlap/);
  f.claim('sibling', 'other-dev');
});

test('unsafe glob scopes and runtime evidence directories are rejected', t => {
  const f = fixture(t);
  for (const path of ['src/*', 'src/?.js', '../src', '.agent-workflows', '.agent-workflows/run/evidence']) {
    const p = plan(); p.tasks[1].paths = [path];
    f.bad('replan', { actor: 'pm', reason: 'Reject unsafe scope', plan: p }, /scope|Scopes/);
  }
});

test('five running workers reserve contexts for PM and the independent phase lead', t => {
  const p = plan();
  p.tasks = [...Array.from({ length: 6 }, (_, i) => ({ ...p.tasks[0], id: `analysis-${i}` })), ...p.tasks.slice(1)];
  p.tasks[6].deps = [];
  p.actors.push(...Array.from({ length: 6 }, (_, i) => ({ id: `worker-${i}`, role: 'analyst' })));
  const f = fixture(t, p);
  for (let i = 0; i < 5; i++) f.claim(`analysis-${i}`, `worker-${i}`);
  f.bad('claim', { actor: 'worker-5', task: 'analysis-5' }, /context limit/);
  assert.deepEqual(f.ok('status').contextBudget, { total: 7, reserved: ['project_manager', 'phase_lead'], maximumWorkers: 5 });
});

test('normal PM tasks and self review are refused; small PM work needs independent evidence', t => {
  const f = fixture(t);
  f.bad('claim', { actor: 'pm', task: 'analysis' }, /role does not match/);
  const analysis = f.claim('analysis'); f.submit(analysis);
  f.bad('review', { ...analysis, verdict: 'PASS', evidence: f.evidence() }, /lead|Self-review/);
  f.review(analysis);
  f.bad('claim', { actor: 'pm', task: 'development' }, /small DEVELOPMENT/);

  const p = plan(); p.tasks[1].small = true;
  const small = fixture(t, p); small.finish(p.tasks[0]);
  const assignment = small.claim('development', 'pm');
  const evidence = small.evidence(); small.ok('submit', { ...assignment, summary: 'Small fixture edit inspected', evidence });
  small.bad('review', { ...assignment, verdict: 'PASS', evidence: small.evidence() }, /lead|Self-review/);
  small.bad('review', { ...assignment, actor: 'development_lead', verdict: 'PASS', evidence }, /independent review evidence/);
  assert.equal(small.review(assignment).phase, 'QA');
});

test('replan invalidates old assignments without erasing revision history', t => {
  const f = fixture(t); const assignment = f.claim('analysis');
  const state = f.ok('replan', { actor: 'pm', reason: 'Clarify the acceptance criteria', plan: plan() });
  assert.equal(state.revision, 2); assert.equal(state.cycle, 2); assert.equal(state.failures, 0);
  assert.ok(state.events.some(event => event.kind === 'REPLANNED' && event.canceledActors.includes('analyst')));
  f.bad('submit', { ...assignment, summary: 'Old revision', evidence: f.evidence() }, /Stale/);
  assert.notEqual(f.claim('analysis').assignment, assignment.assignment);
});

test('expired leases reset on the next fresh CLI process', async t => {
  const f = fixture(t); const assignment = f.claim('analysis', 'analyst', { leaseSeconds: 1 });
  await delay(1100);
  const state = f.ok('status'); assert.equal(state.phase, 'ANALYSIS'); assert.equal(state.failures, 1);
  assert.match(state.lastReturn.reason, /lease expired/);
  f.bad('heartbeat', assignment, /Stale/); assert.equal(f.ok('status').failures, 1);
});

test('evidence tampering invalidates all accepted reports', t => {
  const f = fixture(t); const assignment = f.claim('analysis'); const evidence = f.evidence();
  f.ok('submit', { ...assignment, summary: 'Evidence inspected', evidence }); f.review(assignment);
  writeFileSync(join(f.root, evidence[0]), 'changed after review\n');
  const state = f.ok('status'); assert.equal(state.phase, 'ANALYSIS'); assert.equal(state.failures, 1);
  assert.match(state.lastReturn.reason, /Evidence changed/);
});

for (const mutation of ['staged', 'unstaged', 'untracked']) {
  test(`${mutation} candidate tampering resets frozen gates`, t => {
    const f = fixture(t); const state = f.through('DEVELOPMENT'); assert.ok(state.candidateTree);
    if (mutation === 'untracked') writeFileSync(join(f.root, 'extra.txt'), 'extra\n');
    else { writeFileSync(join(f.root, 'src/candidate.txt'), 'mutated\n'); if (mutation === 'staged') f.git('add', 'src/candidate.txt'); }
    const reset = f.ok('status'); assert.equal(reset.phase, 'ANALYSIS'); assert.equal(reset.failures, 1);
    assert.match(reset.lastReturn.reason, /Candidate tree changed|Unstaged|Untracked/);
  });
}

for (const mutation of ['unstaged', 'untracked']) {
  test(`final DEVELOPMENT freeze failure (${mutation}) persists the ANALYSIS reset`, t => {
    const f = fixture(t); f.finish(f.taskPlan.tasks[0]);
    const assignment = f.claim('development'); f.submit(assignment);
    writeFileSync(join(f.root, mutation === 'untracked' ? 'extra.txt' : 'src/candidate.txt'), 'unfinished\n');
    // Freeze errors must be committed as a return packet, never rolled back to SUBMITTED.
    const result = f.review(assignment);
    assert.equal(result.phase, 'ANALYSIS'); assert.equal(result.failures, 1);
    const persisted = f.ok('status'); assert.equal(persisted.failures, 1); assert.equal(persisted.tasks[1].status, 'PENDING');
  });
}

test('a failed executable check resets the graph and preserves its failure evidence', t => {
  const p = plan(); p.tasks[0].checks = [{ name: 'fail', argv: [process.execPath, '-e', 'process.exit(7)'], timeoutSeconds: 5 }];
  const f = fixture(t, p); const assignment = f.claim('analysis');
  const state = f.ok('check', { ...assignment, name: 'fail' });
  assert.equal(state.phase, 'ANALYSIS'); assert.equal(state.failures, 1); assert.match(state.lastReturn.reason, /exit 7/);
  assert.ok(state.events.some(event => event.kind === 'CHECK_FINISHED' && event.result.exitCode === 7));
});

for (const cancel of ['fail', 'replan', 'discard']) {
  test(`running check is killed after ${cancel}; late results cannot create another failure`, async t => {
    const p = plan();
    p.tasks[0].checks = [{ name: 'delayed', argv: [process.execPath, '-e',
      `const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", 'const fs = require("node:fs"); fs.writeFileSync(".agent-workflows/fixture/started", "started"); setTimeout(() => fs.writeFileSync(".agent-workflows/fixture/late-marker", "must not run"), 1100);']); setTimeout(() => process.exit(9), 1400);`], timeoutSeconds: 5 }];
    const f = fixture(t, p); const assignment = f.claim('analysis');
    const job = f.background('check', { ...assignment, name: 'delayed' });
    await until(() => existsSync(join(f.root, '.agent-workflows/fixture/started')), 'Declared check did not start');
    let state;
    if (cancel === 'fail') state = f.ok('fail', { actor: 'pm', reason: 'Cancel invalid analysis check' });
    else if (cancel === 'replan') state = f.ok('replan', { actor: 'pm', reason: 'Replace analysis contract', plan: p });
    else state = f.ok('decide', { actor: 'pm', verdict: 'DISCARD', reason: 'Reject this candidate' });
    const failures = state.failures;
    await job.done;
    await delay(1150);
    assert.equal(existsSync(join(f.root, '.agent-workflows/fixture/late-marker')), false, 'Canceled check continued executing');
    assert.equal(f.ok('status').failures, failures, 'Late check result counted a second failed cycle');
    assert.equal(f.ok('status').phase, cancel === 'discard' ? 'DISCARDED' : 'ANALYSIS');
  });
}

test('DISCARD preserves staged, unstaged, untracked files, evidence and ledger history', t => {
  const f = fixture(t); const assignment = f.claim('analysis'); const evidence = f.evidence();
  writeFileSync(join(f.root, 'src/candidate.txt'), 'staged edit\n'); f.git('add', 'src/candidate.txt');
  writeFileSync(join(f.root, 'src/candidate.txt'), 'unstaged edit\n'); writeFileSync(join(f.root, 'untracked.txt'), 'keep me\n');
  const before = f.git('status', '--porcelain');
  const state = f.ok('decide', { actor: 'pm', verdict: 'DISCARD', reason: 'Preserve rejected work for inspection' });
  assert.equal(state.phase, 'DISCARDED'); assert.deepEqual(state.decision.canceledActors, [assignment.actor]);
  assert.equal(f.git('status', '--porcelain'), before); assert.equal(readFileSync(join(f.root, 'untracked.txt'), 'utf8'), 'keep me\n');
  assert.ok(existsSync(join(f.root, evidence[0]))); assert.ok(state.events.some(event => event.kind === 'CLAIMED'));
});

test('late canceled completion cannot preflight or reset a newer revision', { skip: process.platform === 'win32' }, async t => {
  const p = plan();
  p.tasks[0].checks = [{ name: 'wait', argv: [process.execPath, '-e',
    'require("node:fs").writeFileSync(".agent-workflows/fixture/started", "started"); setTimeout(() => process.exit(0), 900);'], timeoutSeconds: 5 }];
  const f = fixture(t, p); const assignment = f.claim('analysis');
  const job = f.background('check', { ...assignment, name: 'wait' });
  await until(() => existsSync(join(f.root, '.agent-workflows/fixture/started')), 'Declared check did not start');
  // Hold the old coordinator so its completion certainly arrives after a new revision.
  job.child.kill('SIGSTOP');
  try {
    f.ok('replan', { actor: 'pm', reason: 'Replace original analysis revision', plan: p });
    f.git('commit', '--allow-empty', '--quiet', '-m', 'New revision now needs its own preflight');
  } finally { job.child.kill('SIGCONT'); }
  const result = await job.done;
  assert.notEqual(result.code, 0); assert.match(result.stderr, /Stale check result/);
  // status intentionally performs preflight, so inspect persistence without invoking it.
  const db = new DatabaseSync(join(f.root, '.agent-workflows/fixture/state.sqlite3'), { readOnly: true });
  try {
    const persisted = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=1').get().state);
    assert.equal(persisted.revision, 2); assert.equal(persisted.cycle, 2); assert.equal(persisted.failures, 0);
    assert.equal(persisted.events.filter(event => event.kind === 'RETURN_TO_ANALYSIS').length, 0);
  } finally { db.close(); }
  assert.equal(f.ok('status').failures, 1, 'Only the newer revision’s own preflight may invalidate it');
});
