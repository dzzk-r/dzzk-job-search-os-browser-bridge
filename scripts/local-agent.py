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
    args = parser.parse_args()
    repo = Path.cwd().resolve()
    try:
        task = scoped_path(repo, args.task).read_text(encoding='utf-8')
        if not task.strip() or len(task) > 3000:
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
    try:
        opencode_version = subprocess.run([str(opencode), '--version'], text=True,
            capture_output=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        opencode_version = 'unknown'
    report = {'status': 'failed', 'model': 'llamacpp/qwen3.8-27b',
        'opencode': str(opencode), 'opencode_version': opencode_version,
        'expected': str(expected), 'before_sha256': before, 'stop_file': str(stop),
        'deadline_seconds': args.seconds, 'steps': args.steps, 'tokens_per_turn': args.tokens}
    child = None
    master = None
    started = time.monotonic()
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
        env = os.environ.copy()
        env['OPENCODE_CONFIG_CONTENT'] = json.dumps(config)
        for kind in ['DATA', 'STATE', 'CACHE', 'CONFIG']:
            env['XDG_' + kind + '_HOME'] = str(output / ('xdg-' + kind.lower()))
        command = [str(opencode), 'run', '--pure', '--print-logs',
            '--agent', 'scoped-task', '--model', report['model'], '--format', 'json', task]
        (output / 'command.json').write_text(json.dumps({'cwd': str(repo), 'argv': command}, indent=2))
        print('RUN_COMMAND', shlex.join(command), flush=True)
        print('AGENT_LOG:', output / 'events.log', 'STOP:', stop, flush=True)
        with (output / 'events.log').open('w') as log:
            master, slave = pty.openpty()
            try:
                child = subprocess.Popen(command, cwd=repo, env=env, stdin=slave,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            finally:
                os.close(slave)
            while child.poll() is None:
                if stop.exists() or time.monotonic() - started >= args.seconds:
                    report['termination'] = 'STOP' if stop.exists() else 'deadline'
                    stop_child(child)
                    break
                time.sleep(0.25)
        edits = []
        fatal = False
        for line in (output / 'events.log').read_text().splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            part = event.get('part', {})
            fatal |= event.get('type') == 'error'
            state = part.get('state', {})
            if event.get('type') == 'tool_use' and part.get('tool') in ('edit', 'write') and state.get('status') == 'completed':
                filename = state.get('input', {}).get('filePath')
                if filename and scoped_path(repo, filename) == expected:
                    edits.append(part['tool'])
        after = fingerprint(expected)
        accepted = child.returncode == 0 and not fatal and not report.get('termination') and edits and after != before and expected.is_file() and expected.stat().st_size > 0
        report.update(status='artifact_ready_for_review' if accepted else 'failed',
            exit=child.returncode, after_sha256=after, confirmed_edit_tools=edits)
    except (OSError, ValueError, RuntimeError) as error:
        report.update(error_type=type(error).__name__, error=str(error))
    except KeyboardInterrupt:
        report['termination'] = 'interrupt'
    finally:
        if child is not None:
            stop_child(child)
        if master is not None:
            os.close(master)
        report['seconds'] = round(time.monotonic() - started, 2)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print('REPORT:', output / 'report.json', flush=True)
        print(json.dumps(report), flush=True)
    return 0 if report['status'] == 'artifact_ready_for_review' else 1


if __name__ == '__main__':
    raise SystemExit(main())
