#!/usr/bin/env python3
"""Run one scoped local OpenCode task with persistent logs, deadline and STOP."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import pty
import shlex
import signal
import subprocess
import time
import urllib.request

STATE_FILE = Path.home() / '.local/state/execution-delivery-harness/local-agent.json'
OBSERVER_EVENTS = Path.home() / '.local/state/execution-delivery-harness/observer-events.jsonl'

def publish_state(*, replace=False, **values):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    current = {}
    if not replace:
        try:
            current = json.loads(STATE_FILE.read_text())
        except (OSError, ValueError):
            pass
    current.update(values)
    tmp = STATE_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(current, indent=2) + '\n')
    tmp.replace(STATE_FILE)


def append_observer_event(actor, event, *, correlation_id=None, run_id=None, plan_id=None, task_id=None,
                          span_id=None, parent_span_id=None, message='', source=None, meta=None):
    OBSERVER_EVENTS.parent.mkdir(parents=True, exist_ok=True)
    src = source if isinstance(source, dict) else {}
    value = {
        'schema_version':'1.0',
        'ts':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
        'actor':actor,
        'event':event,
        'correlation_id':correlation_id,
        'run_id':run_id,
        'plan_id':plan_id,
        'task_id':task_id,
        'span_id':span_id or ':'.join(x for x in [run_id,actor,event] if x),
        'parent_span_id':parent_span_id,
        'message':message,
        'source':{
            'client':src.get('client'),
            'conversation_id':src.get('conversation_id'),
            'turn_id':src.get('turn_id'),
            'message_id':src.get('message_id'),
            'action_id':src.get('action_id'),
            'action_label':src.get('action_label'),
            'locator':src.get('locator'),
            'source_quality':src.get('source_quality') or 'declared'
        },
        'meta':meta or {}
    }
    with OBSERVER_EVENTS.open('a', encoding='utf-8') as f:
        f.write(json.dumps(value, ensure_ascii=False) + '\n')
    return value


def llama_slots():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:8080/slots', timeout=0.8) as response:
        slots = json.load(response)
    return slots if isinstance(slots, list) else []


def llama_busy():
    return any(s.get('is_processing') for s in llama_slots())


def opencode_progress(path):
    steps = 0
    last_tool = None
    last_tool_status = None
    try:
        lines = path.read_text(errors='replace').splitlines()[-1000:]
    except OSError:
        return steps, last_tool, last_tool_status
    for raw in lines:
        try:
            event = json.loads(raw)
        except ValueError:
            continue
        if event.get('type') == 'step_finish':
            steps += 1
        if event.get('type') == 'tool_use':
            part = event.get('part') or {}
            state = part.get('state') or {}
            last_tool = part.get('tool')
            last_tool_status = state.get('status')
    return steps, last_tool, last_tool_status


def process_stats(pid):
    if not pid:
        return {}
    try:
        out = subprocess.run(['ps','-o','%cpu=,rss=','-p',str(pid)], text=True, capture_output=True, timeout=1).stdout.strip().split()
        if len(out) >= 2:
            return {'process_cpu_percent':float(out[0]), 'process_rss_mb':round(int(out[1])/1024,1)}
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return {}


def scoped_path(repo, name):
    path = (repo / name).resolve()
    if not path.is_relative_to(repo.resolve()) or path == repo.resolve():
        raise ValueError('Allowed files must be inside the repository')
    return path


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def configuration(repo, reads, writes, steps, tokens):
    permission = {'*': 'deny', 'external_directory': 'deny'}
    for tool, names in [('read', reads + writes), ('edit', writes), ('write', writes)]:
        rules = {'*': 'deny'}
        for name in names:
            path = scoped_path(repo, name)
            rules[str(path.relative_to(repo))] = 'allow'
            rules[str(path)] = 'allow'
        permission[tool] = rules
    model = 'llamacpp/qwen3.8-27b'
    return {'model': model, 'small_model': model, 'autoupdate': False,
        'share': 'disabled', 'permission': permission,
        'provider': {'llamacpp': {'npm': '@ai-sdk/openai-compatible',
            'options': {'baseURL': 'http://127.0.0.1:8080/v1'},
            'models': {'qwen3.8-27b': {'name': 'Local Qwen', 'tool_call': True,
                'reasoning': True, 'limit': {'context': 65536, 'output': tokens}}}}},
        'agent': {'scoped-task': {'mode': 'primary', 'model': model, 'steps': steps,
            'temperature': 0, 'permission': permission,
            'prompt': 'Complete this single bounded task using permitted read/edit/write tools. '
                'Make small edits. Do not browse, delegate, run shell commands, alter Git, '
                'or change other files. Report only what the artifact demonstrates.'}}}


def stop_child(child):
    if child.poll() is not None:
        return
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task', type=Path, required=True)
    parser.add_argument('--read', action='append', default=[])
    parser.add_argument('--write', action='append', required=True)
    parser.add_argument('--expect', required=True, help='Allowed output file that must change')
    parser.add_argument('--seconds', type=int, default=180)
    parser.add_argument('--steps', type=int, default=4)
    parser.add_argument('--tokens', type=int, default=1200)
    parser.add_argument('--opencode', type=Path, default=Path('/opt/homebrew/bin/opencode'),
        help='OpenCode binary to run; system Homebrew binary remains the default')
    parser.add_argument('--run-root', type=Path, required=True,
        help='External directory for task logs and STOP; must be outside the repository')
    parser.add_argument('--run-id')
    parser.add_argument('--plan-id')
    parser.add_argument('--task-id')
    parser.add_argument('--correlation-id')
    parser.add_argument('--parent-span-id')
    parser.add_argument('--source-json', default='{}')
    args = parser.parse_args()
    try:
        source = json.loads(args.source_json)
        if not isinstance(source, dict):
            raise ValueError('source must be an object')
    except ValueError as error:
        parser.error('--source-json: '+str(error))
    repo = Path.cwd().resolve()
    try:
        task = scoped_path(repo, args.task).read_text(encoding='utf-8')
        task = task.strip()
        if not task or len(task) > 3000:
            raise ValueError('Task must contain 1–3000 characters')
        expected = scoped_path(repo, args.expect)
        writes = [scoped_path(repo, name) for name in args.write]
        if expected not in writes:
            raise ValueError('--expect must name a permitted write file')
        if not 1 <= args.seconds <= 420 or not 1 <= args.steps <= 6 or not 1 <= args.tokens <= 2048:
            raise ValueError('Limits: 1–420 seconds, 1–6 steps, 1–2048 output tokens per turn')
        config = configuration(repo, args.read, args.write, args.steps, args.tokens)
        root = args.run_root.expanduser().resolve()
        if root == repo or root.is_relative_to(repo):
            raise ValueError('--run-root must be outside the repository')
        opencode = args.opencode.expanduser().resolve()
        if not opencode.is_file() or not os.access(opencode, os.X_OK):
            raise ValueError('--opencode must name an executable file')
    except (OSError, ValueError) as error:
        parser.error(str(error))
    output = root / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output.mkdir(parents=True)
    stop = root / 'STOP'
    before = fingerprint(expected)
    before_writes = {str(path): fingerprint(path) for path in writes}
    try:
        opencode_version = subprocess.run([str(opencode), '--version'], text=True,
            capture_output=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        opencode_version = 'unknown'
    report = {'status': 'failed', 'model': 'llamacpp/qwen3.8-27b',
        'opencode': str(opencode), 'opencode_version': opencode_version,
        'expected': str(expected), 'before_sha256': before, 'stop_file': str(stop),
        'deadline_seconds': args.seconds, 'steps': args.steps, 'tokens_per_turn': args.tokens,
        'reads': args.read, 'writes': args.write, 'expected_relative': args.expect,
        'correlation_id': args.correlation_id, 'run_id': args.run_id, 'plan_id': args.plan_id,
        'task_id': args.task_id, 'source': source}
    child = None
    master = None
    started = time.monotonic()
    oc_span=(args.run_id or ('worker:'+str(args.task_id or output.name)))+':oc'
    model_cycle=0
    qwen_span=None
    llama_span=None
    model_busy=False
    try:
        if stop.exists():
            raise RuntimeError('STOP file exists; no task was started')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:8080/slots', timeout=3) as response:
            slots = json.load(response)
        if not isinstance(slots, list) or not slots or any(s.get('is_processing') for s in slots):
            raise RuntimeError('Local model is busy or slot state is unknown')
        (output / 'task.txt').write_text(task)
        (output / 'config.json').write_text(json.dumps(config, indent=2))
        event_context = {
            'schema_version':'1.0',
            'correlation_id':args.correlation_id,
            'run_id':args.run_id,
            'plan_id':args.plan_id,
            'task_id':args.task_id,
            'oc_span_id':oc_span,
            'parent_span_id':args.parent_span_id,
            'source':source
        }
        (output / 'event-context.json').write_text(json.dumps(event_context, indent=2) + '\n')
        env = os.environ.copy()
        env['OPENCODE_CONFIG_CONTENT'] = json.dumps(config)
        for kind in ['DATA', 'STATE', 'CACHE', 'CONFIG']:
            env['XDG_' + kind + '_HOME'] = str(output / ('xdg-' + kind.lower()))
        command = [str(opencode), 'run', '--pure', '--print-logs',
            '--agent', 'scoped-task', '--model', report['model'], '--format', 'json', task]
        (output / 'command.json').write_text(json.dumps({'cwd': str(repo), 'argv': command}, indent=2))
        publish_state(replace=True, status='running', run_dir=str(output), repo=str(repo), model=report['model'], opencode_version=opencode_version, task_id=args.task_id, run_id=args.run_id, plan_id=args.plan_id, deadline_seconds=args.seconds, max_steps=args.steps, started_at=time.time(), updated_at=time.time())
        append_observer_event('OC','START',correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,
            span_id=oc_span,parent_span_id=args.parent_span_id,message='OpenCode bounded worker started',source=source,
            meta={'opencode_version':opencode_version,'model':report['model']})
        print('RUN_COMMAND', shlex.join(command), flush=True)
        print('AGENT_LOG:', output / 'events.log', 'STOP:', stop, flush=True)
        with (output / 'events.log').open('w') as log:
            master, slave = pty.openpty()
            try:
                child = subprocess.Popen(command, cwd=repo, env=env, stdin=slave,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            finally:
                os.close(slave)
            last_progress_publish = 0.0
            while child.poll() is None:
                slots = []
                try:
                    slots=llama_slots()
                    busy=any(s.get('is_processing') for s in slots)
                except Exception:
                    busy=model_busy
                if busy and not model_busy:
                    model_cycle += 1
                    qwen_span=f"{oc_span}:qwen:{model_cycle}"
                    llama_span=f"{oc_span}:llama:{model_cycle}"
                    append_observer_event('QWEN','START',correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,
                        span_id=qwen_span,parent_span_id=oc_span,message='Qwen worker model active',source=source)
                    append_observer_event('LLAMA','REQUEST_START',correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,
                        span_id=llama_span,parent_span_id=qwen_span,message='llama.cpp inference active',source=source,
                        meta={'model':report['model']})
                elif model_busy and not busy:
                    append_observer_event('LLAMA','REQUEST_DONE',correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,
                        span_id=llama_span,parent_span_id=qwen_span,message='llama.cpp inference idle',source=source)
                    append_observer_event('QWEN','DONE',correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,
                        span_id=qwen_span,parent_span_id=oc_span,message='Qwen worker model cycle completed',source=source)
                    qwen_span=llama_span=None
                model_busy=busy
                now_mono=time.monotonic()
                if now_mono-last_progress_publish>=1.0:
                    elapsed=max(0.0,now_mono-started)
                    step_count,last_tool,last_tool_status=opencode_progress(output / 'events.log')
                    slot=next((x for x in slots if x.get('is_processing')), slots[0] if slots else {})
                    progress={
                        'status':'running','updated_at':time.time(),'elapsed_seconds':round(elapsed,1),
                        'remaining_seconds':round(max(0,args.seconds-elapsed),1),'deadline_seconds':args.seconds,
                        'model_busy':model_busy,'model_cycle':model_cycle,'step_count':step_count,'max_steps':args.steps,
                        'last_tool':last_tool,'last_tool_status':last_tool_status,'host_load_1m':round(os.getloadavg()[0],2),
                        'thermal':'unavailable_without_privileged_sensor',
                        'llama':{
                            'is_processing':bool(slot.get('is_processing')),'n_ctx':slot.get('n_ctx'),
                            'prompt_tokens':slot.get('n_prompt_tokens'),'prompt_tokens_processed':slot.get('n_prompt_tokens_processed'),
                            'prompt_tokens_cache':slot.get('n_prompt_tokens_cache')
                        },
                        **process_stats(child.pid)
                    }
                    publish_state(**progress)
                    last_progress_publish=now_mono
                if stop.exists() or now_mono - started >= args.seconds:
                    report['termination'] = 'STOP' if stop.exists() else 'deadline'
                    stop_child(child)
                    break
                time.sleep(0.25)
        edits = []
        touched = []
        fatal = False
        max_steps = False
        for line in (output / 'events.log').read_text().splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            part = event.get('part', {})
            fatal |= event.get('type') == 'error'
            if event.get('type') == 'text' and 'MAXIMUM STEPS REACHED' in str(part.get('text') or ''):
                max_steps = True
            state = part.get('state', {})
            if event.get('type') == 'tool_use' and part.get('tool') in ('edit', 'write') and state.get('status') == 'completed':
                filename = state.get('input', {}).get('filePath')
                if filename:
                    try:
                        path = scoped_path(repo, filename)
                    except ValueError:
                        continue
                    touched.append(str(path.relative_to(repo)))
                    if path == expected:
                        edits.append(part['tool'])
        after = fingerprint(expected)
        changed = [
            str(path.relative_to(repo)) for path in writes
            if fingerprint(path) != before_writes.get(str(path))
        ]
        accepted = child.returncode == 0 and not fatal and not max_steps and not report.get('termination') and edits and after != before and expected.is_file() and expected.stat().st_size > 0
        if accepted:
            reason = 'acceptance_passed'
        elif report.get('termination'):
            reason = report['termination']
        elif max_steps:
            reason = 'max_steps_reached'
        elif fatal:
            reason = 'opencode_error_event'
        elif child.returncode != 0:
            reason = f'process_exit_{child.returncode}'
        elif after == before:
            reason = 'expected_artifact_unchanged'
        elif not edits:
            reason = 'expected_edit_not_confirmed'
        else:
            reason = 'acceptance_failed'
        report.update(status='artifact_ready_for_review' if accepted else 'failed',
            outcome_reason=reason, exit=child.returncode, after_sha256=after,
            confirmed_edit_tools=edits, touched_files=sorted(set(touched)),
            changed_files=changed)
    except (OSError, ValueError, RuntimeError) as error:
        report.update(error_type=type(error).__name__, error=str(error))
    except KeyboardInterrupt:
        report['termination'] = 'interrupt'
    finally:
        if child is not None:
            stop_child(child)
        if master is not None:
            os.close(master)
        if model_busy:
            append_observer_event('LLAMA','REQUEST_ERROR' if report.get('status')=='failed' else 'REQUEST_DONE',
                correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,span_id=llama_span,parent_span_id=qwen_span,
                message='llama.cpp inference closed with worker',source=source)
            append_observer_event('QWEN','ERROR' if report.get('status')=='failed' else 'DONE',
                correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,span_id=qwen_span,parent_span_id=oc_span,
                message='Qwen worker model closed with worker',source=source)
        append_observer_event('OC','ERROR' if report.get('status')=='failed' else 'DONE',
            correlation_id=args.correlation_id,run_id=args.run_id,plan_id=args.plan_id,task_id=args.task_id,span_id=oc_span,
            parent_span_id=args.parent_span_id,
            message='OpenCode bounded worker '+str(report.get('status')),source=source,
            meta={'outcome_reason':report.get('outcome_reason'),'exit':report.get('exit')})
        report['seconds'] = round(time.monotonic() - started, 2)
        publish_state(status=report.get('status','failed'), updated_at=time.time(), elapsed_seconds=report['seconds'], remaining_seconds=0, outcome_reason=report.get('outcome_reason') or report.get('termination') or report.get('error'), model_busy=False)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        publish_state(status=report['status'], run_dir=str(output), repo=str(repo), model=report['model'], opencode_version=opencode_version, updated_at=time.time(), exit=report.get('exit'), termination=report.get('termination'), outcome_reason=report.get('outcome_reason'))
        print('REPORT:', output / 'report.json', flush=True)
        print(json.dumps(report), flush=True)
    return 0 if report['status'] == 'artifact_ready_for_review' else 1


if __name__ == '__main__':
    raise SystemExit(main())
