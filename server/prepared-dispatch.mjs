import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function fail(message, code='invalid_prepared_dispatch') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function within(root, value) {
  if (typeof value !== 'string' || !value.trim()) fail('Prepared dispatch path is missing.');
  const target = resolve(value);
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('Prepared dispatch path is outside the allowed work root.');
  return target;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive:true, mode:0o700 });
  const tmp = path + '.tmp-' + process.pid;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode:0o600 });
  await rename(tmp, path);
}

export function createPreparedDispatch(options={}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const workRoot = resolve(options.workRoot ?? join(homedir(), 'WORK'));
  const statePath = resolve(options.statePath ?? join(homedir(), '.local/state/execution-delivery-harness/prepared-dispatch.json'));
  const runner = resolve(options.runner ?? join(repoRoot, 'scripts/run-detached-gateway.mjs'));

  async function state() {
    let raw;
    try {
      raw = JSON.parse(await readFile(statePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { ready:false, status:'NONE' };
      throw error;
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Prepared dispatch state must be an object.');
    if (raw.status !== 'READY') {
      return {
        ready:false,
        status:String(raw.status ?? 'INVALID'),
        label:typeof raw.label === 'string' ? raw.label : null,
        task_id:typeof raw.task_id === 'string' ? raw.task_id : null,
        goal:typeof raw.goal === 'string' ? raw.goal : null,
        prepared_at:typeof raw.prepared_at === 'string' ? raw.prepared_at : null
      };
    }

    if (raw.schema_version !== '1.0') fail('Unsupported prepared dispatch schema.');
    if (typeof raw.label !== 'string' || !raw.label.trim()) fail('Prepared dispatch label is missing.');
    if (typeof raw.goal !== 'string' || !raw.goal.trim()) fail('Prepared dispatch goal is missing.');

    const context_path = within(workRoot, raw.context_path);
    const task_path = within(workRoot, raw.task_path);
    const run_dir = within(workRoot, raw.run_dir);

    const [contextText, taskText] = await Promise.all([
      readFile(context_path, 'utf8'),
      readFile(task_path, 'utf8')
    ]);
    const context = JSON.parse(contextText);
    const task = JSON.parse(taskText);
    if (!context || typeof context !== 'object' || Array.isArray(context)) fail('Prepared context is invalid.');
    if (!task || typeof task !== 'object' || Array.isArray(task)) fail('Prepared task is invalid.');

    return {
      ready:true,
      status:'READY',
      schema_version:'1.0',
      label:raw.label.trim(),
      goal:raw.goal.trim(),
      task_id:typeof raw.task_id === 'string' ? raw.task_id : (typeof task.task_id === 'string' ? task.task_id : null),
      prepared_at:typeof raw.prepared_at === 'string' ? raw.prepared_at : null,
      context_path,
      task_path,
      run_dir
    };
  }

  async function prepare(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Prepared dispatch input must be an object.');
    const context_path=within(workRoot,input.context_path);
    const task_path=within(workRoot,input.task_path);
    const run_dir=within(workRoot,input.run_dir);
    const [contextText,taskText]=await Promise.all([readFile(context_path,'utf8'),readFile(task_path,'utf8')]);
    let context,task;
    try { context=JSON.parse(contextText); task=JSON.parse(taskText); }
    catch { fail('Prepared context/task JSON is invalid.'); }
    if(!context||typeof context!=='object'||Array.isArray(context)) fail('Prepared context is invalid.');
    if(!task||typeof task!=='object'||Array.isArray(task)) fail('Prepared task is invalid.');
    const value={
      schema_version:'1.0',status:'READY',
      label:String(input.label||task.task_id||'Prepared task').trim(),
      goal:String(input.goal||task.goal||'').trim(),
      task_id:String(input.task_id||task.task_id||'').trim(),
      prepared_at:new Date().toISOString(),context_path,task_path,run_dir
    };
    if(!value.label||!value.goal||!value.task_id) fail('Prepared dispatch label, goal and task_id are required.');
    await atomicJson(statePath,value);
    return state();
  }

  async function dispatch(admission) {
    const prepared = await state();
    if (!prepared.ready) fail('No prepared Harness task is ready.', 'no_prepared_dispatch');
    if (!admission || typeof admission !== 'object' || Array.isArray(admission)) fail('Conversation admission is required before dispatch.', 'conversation_admission_required');
    const conversation_id=typeof admission.conversation_id==='string'&&admission.conversation_id.trim()?admission.conversation_id.trim():null;
    const binding_id=typeof admission.binding_id==='string'&&admission.binding_id.trim()?admission.binding_id.trim():null;
    const client=typeof admission.client==='string'&&admission.client.trim()?admission.client.trim():'chatgpt-web';
    if (!conversation_id || !binding_id) fail('Conversation admission is incomplete.', 'conversation_admission_required');

    const context=JSON.parse(await readFile(prepared.context_path,'utf8'));
    if (context.conversation_id && context.conversation_id!==conversation_id) {
      fail('Prepared context is already bound to another conversation.', 'conversation_binding_conflict');
    }
    const turn_id='turn:'+randomUUID();
    const admitted_context_path=join(prepared.run_dir,'admitted-context.json');
    const admitted_context={
      ...context,
      client,
      conversation_id,
      turn_id,
      message_id:null,
      binding_id,
      locator:typeof admission.platform_locator==='string'?admission.platform_locator:(context.locator??null),
      source_quality:admission.source_quality==='transport_observed'?'transport_observed':'declared'
    };
    await atomicJson(admitted_context_path,admitted_context);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        runner,
        '--context', admitted_context_path,
        '--task', prepared.task_path,
        '--repo', repoRoot,
        '--run-dir', prepared.run_dir
      ],
      { cwd:repoRoot, timeout:5000, maxBuffer:256*1024 }
    );

    let launch;
    try { launch = JSON.parse(stdout.trim()); }
    catch { fail('Detached gateway returned invalid launch state.', 'dispatch_launch_invalid'); }

    const next = {
      schema_version:'1.0',
      status:'DISPATCHED',
      label:prepared.label,
      goal:prepared.goal,
      task_id:prepared.task_id,
      prepared_at:prepared.prepared_at,
      dispatched_at:new Date().toISOString(),
      context_path:prepared.context_path,
      admitted_context_path,
      conversation_id,
      turn_id,
      binding_id,
      task_path:prepared.task_path,
      run_dir:prepared.run_dir,
      controller_id:launch.controller_id ?? null,
      pid:launch.pid ?? null
    };
    await atomicJson(statePath, next);

    return {
      ok:true,
      status:'DISPATCHED',
      label:prepared.label,
      task_id:prepared.task_id,
      controller_id:launch.controller_id ?? null,
      pid:launch.pid ?? null,
      run_dir:prepared.run_dir,
      conversation_id,
      turn_id,
      binding_id
    };
  }

  return { state, prepare, dispatch, statePath };
}
