#!/usr/bin/env node
// Trusted local coordinator ledger, not an agent authentication or sandbox boundary.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, fstatSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASES = ['ANALYSIS', 'DEVELOPMENT', 'QA', 'SECURITY', 'NOTES', 'INTEGRATION'];
const WORKERS = { ANALYSIS: ['analyst'], DEVELOPMENT: ['developer_tester', 'patchnotes_author'], QA: ['qa'], SECURITY: ['security'], NOTES: ['patchnotes_reviewer'], INTEGRATION: ['integrator'] };
const LEADS = { ANALYSIS: 'analysis_lead', DEVELOPMENT: 'development_lead', QA: 'qa_lead', SECURITY: 'security_lead', NOTES: 'release_lead', INTEGRATION: 'integration_lead' };
const ROLES = new Set(['project_manager', ...Object.values(WORKERS).flat(), ...Object.values(LEADS)]);
const TERMINAL = new Set(['APPROVED', 'DISCARDED', 'BLOCKED']);
const MAX_WORKERS = 5; // PM and one active phase lead reserve two of seven contexts.
const hash = data => createHash('sha256').update(data).digest('hex');
const requireThat = (value, message) => { if (!value) throw Error(message); };
const identifier = (value, label) => { requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value), `Invalid ${label}`); return value; };
const text = (value, label, limit = 8000) => { requireThat(typeof value === 'string' && value.trim() && value.length <= limit && !value.includes('\0'), `${label} must be non-empty text (maximum ${limit} characters)`); return value; };
const actorId = value => text(value, 'actor ID', 160);
const list = (value, label) => { requireThat(Array.isArray(value), `${label} must be an array`); return value; };
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024**2 }).trim();

function privateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const info = lstatSync(path);
  requireThat(info.isDirectory() && !info.isSymbolicLink(), 'State directories must not be symlinks');
  chmodSync(path, 0o700);
}
function safeScope(path) {
  requireThat(typeof path === 'string' && path.length <= 500 && path && !path.startsWith('/') && !/[\\\0*?]/.test(path), 'Scopes must be literal relative paths');
  const clean = path.replace(/\/$/, '');
  requireThat(clean.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git'), 'Invalid write scope');
  requireThat(clean !== '.agent-workflows' && !clean.startsWith('.agent-workflows/'), 'Evidence is not an implementation write scope');
  return clean;
}
function overlap(a, b) { return a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); }
function validatePlan(plan) {
  text(plan.goal, 'goal');
  list(plan.acceptance, 'acceptance').forEach(value => text(value, 'acceptance criterion'));
  requireThat(plan.acceptance.length, 'At least one acceptance criterion is required');
  actorId(plan.pm);
  const actors = [{ id: plan.pm, role: 'project_manager' }];
  for (const actor of list(plan.actors ?? [], 'actors')) {
    actorId(actor.id); requireThat(ROLES.has(actor.role), 'Unknown actor role');
    requireThat(actor.role !== 'project_manager' || actor.id === plan.pm, 'Only one project manager is allowed');
    const existing = actors.find(item => item.id === actor.id);
    requireThat(!existing || existing.role === actor.role, 'An actor ID cannot change roles');
    if (!existing) actors.push({ id: actor.id, role: actor.role });
  }
  const tasks = list(plan.tasks, 'tasks').map(task => {
    identifier(task.id, 'task ID'); requireThat(PHASES.includes(task.phase), 'Unknown task phase');
    requireThat(WORKERS[task.phase].includes(task.role), 'Worker role does not match phase');
    const acceptance = list(task.acceptance, 'task acceptance'); requireThat(acceptance.length, 'Every task needs acceptance criteria'); acceptance.forEach(value => text(value, 'task criterion'));
    const paths = list(task.paths ?? [], 'paths').map(safeScope);
    requireThat(task.phase === 'DEVELOPMENT' || paths.length === 0, 'Review/analysis tasks must not declare implementation write scopes');
    requireThat(task.small === undefined || typeof task.small === 'boolean', 'small must be a boolean');
    const checks = list(task.checks ?? [], 'checks').map(check => {
      identifier(check.name, 'check name');
      const argv = list(check.argv, 'check argv'); requireThat(argv.length && argv.length <= 64, 'Check argv must contain 1–64 arguments');
      argv.forEach(arg => text(arg, 'argv argument', 16000));
      const timeoutSeconds = check.timeoutSeconds ?? 60;
      requireThat(Number.isSafeInteger(timeoutSeconds) && timeoutSeconds >= 1 && timeoutSeconds <= 1800, 'Check timeout must be 1–1800 seconds');
      return { name: check.name, argv, timeoutSeconds };
    });
    requireThat(new Set(checks.map(item => item.name)).size === checks.length, 'Duplicate check names');
    requireThat(!['QA', 'INTEGRATION'].includes(task.phase) || checks.length, 'QA and INTEGRATION tasks require executable checks');
    return { id: task.id, phase: task.phase, role: task.role, title: task.title ? text(task.title, 'title', 500) : task.id, acceptance, paths, deps: list(task.deps ?? [], 'deps'), small: task.small === true, checks, status: 'PENDING', assignment: null, submission: null, review: null, results: [] };
  });
  requireThat(tasks.length <= 200, 'At most 200 tasks are allowed');
  const ids = new Set(tasks.map(task => task.id)); requireThat(ids.size === tasks.length, 'Duplicate task IDs');
  for (const phase of PHASES) requireThat(tasks.some(task => task.phase === phase), `Missing phase ${phase}`);
  for (const task of tasks) for (const dependency of task.deps) {
    identifier(dependency, 'dependency'); const parent = tasks.find(item => item.id === dependency);
    requireThat(parent, `Unknown dependency ${dependency}`);
    requireThat(PHASES.indexOf(parent.phase) <= PHASES.indexOf(task.phase), 'A task cannot depend on a future phase');
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) { requireThat(!visiting.has(id), 'Dependency cycle'); if (visited.has(id)) return; visiting.add(id); for (const parent of tasks.find(task => task.id === id).deps) visit(parent); visiting.delete(id); visited.add(id); }
  for (const task of tasks) visit(task.id);
  return { goal: plan.goal, acceptance: plan.acceptance, pm: plan.pm, actors, tasks };
}

function snapshot(root, baseCommit) {
  requireThat(git(root, 'rev-parse', 'HEAD') === baseCommit, 'Base commit changed');
  requireThat(!git(root, 'diff', '--name-only'), 'Unstaged changes: stage the complete candidate before freezing');
  requireThat(!git(root, 'ls-files', '--others', '--exclude-standard'), 'Untracked files: stage the complete candidate before freezing');
  return git(root, 'write-tree');
}
function readEvidence(root, run, paths) {
  requireThat(Array.isArray(paths) && paths.length > 0 && paths.length <= 32, 'Provide 1–32 evidence files');
  const prefix = `.agent-workflows/${run}/evidence/`;
  return paths.map(path => {
    requireThat(typeof path === 'string' && path.startsWith(prefix) && !/[\\\0]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'), `Evidence must be inside ${prefix}`);
    const absolute = resolve(root, path); let directory = dirname(absolute);
    while (directory !== root) { requireThat(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), 'Evidence directory must not be a symlink'); directory = dirname(directory); }
    const before = lstatSync(absolute);
    requireThat(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= 1024**2, 'Evidence must be a regular unlinked 1 MiB-or-smaller file');
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd); requireThat(opened.dev === before.dev && opened.ino === before.ino, 'Evidence changed while opening');
      return { path, sha256: hash(readFileSync(fd)), size: opened.size };
    } finally { closeSync(fd); }
  });
}
function verifyEvidence(root, state) {
  for (const task of state.tasks) for (const report of [task.submission, task.review].filter(Boolean)) {
    for (const evidence of report.evidence) {
      const current = readEvidence(root, state.id, [evidence.path])[0];
      requireThat(current.sha256 === evidence.sha256 && current.size === evidence.size, `Evidence changed: ${evidence.path}`);
    }
  }
}
function event(state, kind, details = {}) { state.events.push({ at: new Date().toISOString(), kind, cycle: state.cycle, revision: state.revision, ...details }); }
function returnToAnalysis(state, reason, taskId = null) {
  const canceledActors = [...new Set(state.tasks.filter(task => ['RUNNING', 'SUBMITTED'].includes(task.status)).map(task => task.assignment.actor))];
  const reports = state.tasks.filter(task => task.submission || task.review).map(task => ({ task: task.id, assignment: task.assignment, submission: task.submission, review: task.review, results: task.results }));
  state.failures++; state.cycle++; state.candidateTree = null;
  state.phase = state.failures >= 3 ? 'BLOCKED' : 'ANALYSIS';
  state.lastReturn = { reason, task: taskId, canceledActors, failedCycle: state.cycle - 1, action: 'PM must interrupt canceled agents, reanalyse the cause and issue fresh assignments.' };
  for (const task of state.tasks) { task.status = 'PENDING'; task.assignment = null; task.submission = null; task.review = null; task.results = []; }
  event(state, 'RETURN_TO_ANALYSIS', { packet: state.lastReturn, reports });
}
function preflight(root, state) {
  if (TERMINAL.has(state.phase)) return false;
  let reason;
  const expired = state.tasks.find(task => ['RUNNING', 'SUBMITTED'].includes(task.status) && task.assignment.expiresAt <= Date.now());
  if (expired) reason = `Assignment lease expired: ${expired.id}`;
  try {
    requireThat(git(root, 'rev-parse', 'HEAD') === state.baseCommit, 'Base commit changed');
    if (state.candidateTree) requireThat(snapshot(root, state.baseCommit) === state.candidateTree, 'Candidate tree changed');
    verifyEvidence(root, state);
  } catch (error) { reason ||= error.message; }
  if (reason) { returnToAnalysis(state, reason, expired?.id); return true; }
  return false;
}
function actor(state, id) { const found = state.actors.find(item => item.id === id); requireThat(found, 'Actor is not registered'); return found; }
function taskFor(state, id) { const task = state.tasks.find(item => item.id === id); requireThat(task, 'Unknown task'); return task; }
function assignment(state, input, submitted = false) {
  actor(state, input.actor); const task = taskFor(state, input.task);
  requireThat(task.assignment && task.assignment.id === input.assignment && task.assignment.cycle === state.cycle && task.assignment.revision === state.revision, 'Stale or unknown assignment');
  requireThat(task.assignment.actor === input.actor, 'Assignment belongs to a different actor');
  requireThat(task.status === (submitted ? 'SUBMITTED' : 'RUNNING'), 'Task is not in the required assignment state');
  return task;
}
function ready(state) { return state.tasks.filter(task => task.phase === state.phase && task.status === 'PENDING' && task.deps.every(id => taskFor(state, id).status === 'PASSED')); }
function advance(root, state) {
  if (!state.tasks.filter(task => task.phase === state.phase).every(task => task.status === 'PASSED')) return;
  if (state.phase === 'DEVELOPMENT') {
    try { state.candidateTree = snapshot(root, state.baseCommit); }
    catch (error) { returnToAnalysis(state, error.message); return; }
  }
  state.phase = PHASES[PHASES.indexOf(state.phase) + 1] ?? 'PM_REVIEW'; event(state, 'PHASE_PASSED', { nextPhase: state.phase });
}
function view(state) {
  return { id: state.id, phase: state.phase, cycle: state.cycle, revision: state.revision, failures: state.failures, baseCommit: state.baseCommit, candidateTree: state.candidateTree, contextBudget: { total: 7, reserved: ['project_manager', 'phase_lead'], maximumWorkers: MAX_WORKERS },
    ready: ready(state).map(task => ({ id: task.id, role: task.role, title: task.title, acceptance: task.acceptance, paths: task.paths, deps: task.deps, checks: task.checks })),
    tasks: state.tasks.map(task => ({ id: task.id, phase: task.phase, role: task.role, status: task.status, assignment: task.assignment, checks: task.results })),
    actors: state.actors, lastReturn: state.lastReturn, decision: state.decision, events: state.events };
}

function checkAssignment(state, job) {
  const task = state.tasks.find(item => item.id === job.task);
  return state.cycle === job.cycle && state.revision === job.revision && !TERMINAL.has(state.phase)
    && task?.status === 'RUNNING' && task.assignment?.id === job.assignment && task.assignment.actor === job.actor
    && task.assignment.cycle === job.cycle && task.assignment.revision === job.revision ? task : null;
}
async function executeCheck(root, check, isLive) {
  return new Promise(resolveResult => {
    const started = Date.now(); let outputBytes = 0, stopped = false, reason = null;
    const digest = createHash('sha256');
    const child = spawn(check.argv[0], check.argv.slice(1), { cwd: root, detached: process.platform !== 'win32', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = why => { reason ||= why; if (stopped) return; stopped = true; try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } };
    const timeout = setTimeout(() => stop('timeout'), check.timeoutSeconds * 1000);
    const poll = setInterval(() => {
      try { if (!isLive()) stop('assignment cancelled'); }
      catch { stop('ledger unavailable'); }
    }, 100);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { outputBytes += chunk.length; digest.update(chunk); if (outputBytes > 1024**2) stop('output limit'); });
    child.once('error', () => { reason ||= 'spawn error'; });
    child.once('close', (code, signal) => { clearTimeout(timeout); clearInterval(poll); stop(reason); resolveResult({ name: check.name, exitCode: code, signal, error: reason, durationMs: Date.now() - started, outputBytes, outputSha256: digest.digest('hex') }); });
  });
}

export async function run(command, id, input = {}, cwd = process.cwd()) {
  identifier(id, 'run ID');
  const root = git(cwd, 'rev-parse', '--show-toplevel'); requireThat(resolve(cwd) === resolve(root), 'Run from the repository root');
  const store = join(root, '.agent-workflows'), folder = join(store, id), file = join(folder, 'state.sqlite3');
  if (command === 'init') {
    git(root, 'check-ignore', '--no-index', '--quiet', '.agent-workflows/probe');
    requireThat(!git(root, 'ls-files', '.agent-workflows'), 'Runtime state must not be tracked');
    privateDirectory(store); privateDirectory(folder); privateDirectory(join(folder, 'evidence'));
  } else requireThat(existsSync(file), 'Unknown run; use init first');
  requireThat(lstatSync(store).isDirectory() && !lstatSync(store).isSymbolicLink() && lstatSync(folder).isDirectory() && !lstatSync(folder).isSymbolicLink(), 'State directories must not be symlinks');
  if (!existsSync(file)) closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600));
  requireThat(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'State database must be a regular file');
  chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);');
  const get = () => { const row = db.prepare('SELECT state FROM runs WHERE id=1').get(); return row ? JSON.parse(row.state) : null; };
  const save = state => db.prepare('INSERT INTO runs VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(JSON.stringify(state));
  function transaction(callback) { db.exec('BEGIN IMMEDIATE'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  try {
    if (command === 'init') return transaction(() => {
      requireThat(!get(), 'Run already exists'); const plan = validatePlan(input);
      const state = { id, ...plan, phase: 'ANALYSIS', cycle: 1, revision: 1, failures: 0, baseCommit: git(root, 'rev-parse', 'HEAD'), candidateTree: null, events: [], lastReturn: null, decision: null };
      event(state, 'INITIALIZED'); save(state); return view(state);
    });
    let checkJob;
    const result = transaction(() => {
      const state = get(); requireThat(state, 'Unknown run');
      if (preflight(root, state)) { save(state); return { ...view(state), interrupted: true }; }
      if (command === 'status' || command === 'ready') return view(state);
      requireThat(!TERMINAL.has(state.phase), `Run is ${state.phase}`);
      if (command === 'register') {
        requireThat(input.actor === state.pm, 'Only PM may register actors'); actorId(input.id); requireThat(ROLES.has(input.role), 'Unknown actor role');
        requireThat(input.role !== 'project_manager' || input.id === state.pm, 'Only one PM is allowed');
        const existing = state.actors.find(item => item.id === input.id); requireThat(!existing || existing.role === input.role, 'An actor ID cannot change roles');
        if (!existing) state.actors.push({ id: input.id, role: input.role }); event(state, 'ACTOR_REGISTERED', { actor: input.id, role: input.role });
      } else if (command === 'replan') {
        requireThat(input.actor === state.pm && state.phase === 'ANALYSIS', 'Only PM in ANALYSIS may replan'); text(input.reason, 'replan reason');
        const plan = validatePlan(input.plan); requireThat(plan.pm === state.pm, 'PM cannot change during a run');
        for (const person of plan.actors) { const existing = state.actors.find(item => item.id === person.id); requireThat(!existing || existing.role === person.role, 'An actor ID cannot change roles'); }
        const canceledActors = state.tasks.filter(task => ['RUNNING', 'SUBMITTED'].includes(task.status)).map(task => task.assignment.actor);
        event(state, 'REPLANNED', { reason: input.reason, canceledActors, previousTasks: state.tasks });
        Object.assign(state, plan, { actors: [...state.actors, ...plan.actors.filter(person => !state.actors.some(old => old.id === person.id))], revision: state.revision + 1, cycle: state.cycle + 1, baseCommit: git(root, 'rev-parse', 'HEAD'), candidateTree: null });
      } else if (command === 'claim') {
        const person = actor(state, input.actor), task = taskFor(state, input.task);
        requireThat(ready(state).includes(task), 'Task is not ready in the current phase');
        requireThat(person.role === task.role || (person.id === state.pm && task.small && task.phase === 'DEVELOPMENT'), 'Actor role does not match task (PM exception requires small DEVELOPMENT task)');
        requireThat(!state.tasks.some(item => item.status === 'RUNNING' && item.assignment.actor === input.actor), 'Actor already has a running task');
        requireThat(input.actor === state.pm || state.tasks.filter(item => item.status === 'RUNNING' && item.assignment.actor !== state.pm).length < MAX_WORKERS, 'Worker context limit reached');
        for (const other of state.tasks.filter(item => ['RUNNING', 'SUBMITTED'].includes(item.status))) requireThat(!task.paths.some(path => other.paths.some(otherPath => overlap(path, otherPath))), 'Write scopes overlap an active assignment');
        const leaseSeconds = input.leaseSeconds ?? 900; requireThat(Number.isSafeInteger(leaseSeconds) && leaseSeconds >= 1 && leaseSeconds <= 3600, 'Lease must be 1–3600 seconds');
        task.status = 'RUNNING'; task.assignment = { id: randomUUID(), actor: input.actor, cycle: state.cycle, revision: state.revision, expiresAt: Date.now() + leaseSeconds * 1000 }; event(state, 'CLAIMED', { task: task.id, assignment: task.assignment });
      } else if (command === 'heartbeat') {
        const task = assignment(state, input); const leaseSeconds = input.leaseSeconds ?? 900; requireThat(Number.isSafeInteger(leaseSeconds) && leaseSeconds >= 1 && leaseSeconds <= 3600, 'Lease must be 1–3600 seconds'); task.assignment.expiresAt = Date.now() + leaseSeconds * 1000;
      } else if (command === 'submit') {
        const task = assignment(state, input); requireThat(!task.results.some(item => item.running), 'A check is still running');
        text(input.summary, 'submission summary');
        requireThat(task.checks.every(check => task.results.some(item => item.name === check.name && item.exitCode === 0 && !item.error)), 'Required checks have not passed');
        task.submission = { actor: input.actor, summary: input.summary, evidence: readEvidence(root, id, input.evidence), baseCommit: state.baseCommit, revision: state.revision, candidateTree: state.candidateTree };
        task.status = 'SUBMITTED'; event(state, 'SUBMITTED', { task: task.id, submission: task.submission });
      } else if (command === 'check') {
        const task = assignment(state, input); const check = task.checks.find(item => item.name === input.name); requireThat(check, 'Check is not declared in the plan'); requireThat(!task.results.some(item => item.running), 'A check is already running');
        task.results = task.results.filter(item => item.name !== check.name); task.results.push({ name: check.name, running: true }); task.assignment.expiresAt = Date.now() + (check.timeoutSeconds + 30) * 1000;
        checkJob = { check, assignment: task.assignment.id, task: task.id, actor: input.actor, cycle: state.cycle, revision: state.revision, before: state.candidateTree ? snapshot(root, state.baseCommit) : null };
        event(state, 'CHECK_STARTED', { task: task.id, name: check.name });
      } else if (command === 'review') {
        const person = actor(state, input.actor), task = taskFor(state, input.task);
        requireThat(person.role === LEADS[state.phase] && task.phase === state.phase, 'Only the current phase lead can review this task');
        requireThat(task.status === 'SUBMITTED' && task.assignment.id === input.assignment && task.assignment.cycle === state.cycle && task.assignment.revision === state.revision, 'Stale or unsubmitted assignment');
        requireThat(task.assignment.actor !== input.actor, 'Self-review is not allowed');
        requireThat(['PASS', 'FAIL'].includes(input.verdict), 'Review verdict must be PASS or FAIL');
        text(input.reason ?? 'Criteria and evidence checked.', 'review reason'); const evidence = readEvidence(root, id, input.evidence);
        requireThat(evidence.every(item => !task.submission.evidence.some(author => author.path === item.path)), 'Lead must provide independent review evidence');
        task.review = { actor: input.actor, verdict: input.verdict, reason: input.reason ?? 'Criteria and evidence checked.', evidence, candidateTree: state.candidateTree, revision: state.revision };
        event(state, 'REVIEWED', { task: task.id, review: task.review });
        if (input.verdict === 'FAIL') returnToAnalysis(state, task.review.reason, task.id);
        else { task.status = 'PASSED'; advance(root, state); }
      } else if (command === 'fail') {
        const person = actor(state, input.actor); text(input.reason, 'failure reason');
        requireThat(person.id === state.pm || person.role === LEADS[state.phase] || state.tasks.some(task => task.assignment?.actor === person.id && ['RUNNING', 'SUBMITTED'].includes(task.status)), 'Actor cannot fail this stage');
        returnToAnalysis(state, input.reason, input.task ?? null);
      } else if (command === 'decide') {
        requireThat(input.actor === state.pm, 'Only PM may decide'); requireThat(['APPROVE', 'DISCARD'].includes(input.verdict), 'Decision must be APPROVE or DISCARD'); text(input.reason, 'decision reason');
        if (input.verdict === 'APPROVE') { requireThat(state.phase === 'PM_REVIEW' && state.tasks.every(task => task.status === 'PASSED'), 'All phase gates must pass'); requireThat(state.candidateTree && snapshot(root, state.baseCommit) === state.candidateTree, 'Candidate must match accepted tree'); verifyEvidence(root, state); state.phase = 'APPROVED'; }
        else state.phase = 'DISCARDED';
        const canceledActors = state.tasks.filter(task => ['RUNNING', 'SUBMITTED'].includes(task.status)).map(task => task.assignment.actor);
        state.decision = { actor: input.actor, verdict: input.verdict, reason: input.reason, candidateTree: state.candidateTree, canceledActors }; event(state, 'DECIDED', { decision: state.decision });
      } else throw Error('Unknown command');
      save(state); return view(state);
    });
    if (!checkJob) return result;
    const checkResult = await executeCheck(root, checkJob.check, () => {
      const task = checkAssignment(get(), checkJob);
      return task && task.assignment.expiresAt > Date.now();
    });
    return transaction(() => {
      const state = get(); const task = checkAssignment(state, checkJob); requireThat(task, 'Stale check result');
      const recovered = preflight(root, state); if (recovered) { save(state); return { ...view(state), interrupted: true }; }
      task.results = task.results.filter(item => item.name !== checkResult.name); task.results.push({ ...checkResult, baseCommit: state.baseCommit, candidateTree: state.candidateTree, revision: state.revision }); event(state, 'CHECK_FINISHED', { task: task.id, result: checkResult });
      if (checkResult.exitCode !== 0 || checkResult.error) returnToAnalysis(state, `Check ${checkResult.name} failed (${checkResult.error ?? `exit ${checkResult.exitCode}`})`, task.id);
      save(state); return view(state);
    });
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    const [command, id, inputFile] = process.argv.slice(2);
    if (!command || !id) throw Error('Usage: node scripts/agent-flow.mjs <command> <run-id> [input.json|-]');
    let input = {};
    if (inputFile) { const data = readFileSync(inputFile === '-' ? 0 : inputFile); requireThat(data.length <= 512 * 1024, 'Input exceeds 512 KiB'); input = JSON.parse(data.toString('utf8')); }
    console.log(JSON.stringify(await run(command, id, input), null, 2));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
