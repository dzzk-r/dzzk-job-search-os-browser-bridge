#!/usr/bin/env python3
"""Fixed-screen unified observer for Browser Bridge execution."""
from __future__ import annotations

import argparse
import curses
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request


DEFAULT_ROOT = Path("/Users/dzzk/WORK/browser-bridge-runs/2026-10-03/agent-runs")
DEFAULT_REPO = Path("/Users/dzzk/WORK/_bridge-local-execution")
DEFAULT_COMMANDS = Path("/Users/dzzk/WORK/browser-bridge-runs/2026-10-03/commands.log")
DEFAULT_MCP = Path.home() / ".claude-server-commander/tool-history.jsonl"
DEFAULT_ACTORS = Path.home() / ".config/dzzk-jso-bridge/observer-actors.json"
LOCAL_AGENT_STATE = Path.home() / ".local/state/execution-delivery-harness/local-agent.json"
CURRENT_RUN_STATE = Path.home() / ".local/state/execution-delivery-harness/current-run.json"
DETACHED_RUN_STATE = Path.home() / ".local/state/execution-delivery-harness/detached-run.json"
PREPARED_DISPATCH_STATE = Path.home() / ".local/state/execution-delivery-harness/prepared-dispatch.json"
HARNESS_OBSERVER_EVENTS = Path.home() / ".local/state/execution-delivery-harness/observer-events.jsonl"
BROWSER_TURN_STATE = Path.home() / ".local/state/execution-delivery-harness/browser-turn-state.json"

BUILTIN_ACTORS = [
    {"id":"MCP","label":"MCP","enabled":True},
    {"id":"TERM","label":"TERM","enabled":True},
    {"id":"OC","label":"OC","enabled":True},
    {"id":"QWEN","label":"QWEN","enabled":True},
    {"id":"LLAMA","label":"LLAMA","enabled":True},
    {"id":"GIT","label":"GIT","enabled":True},
]

KEY_UP = getattr(curses, "KEY_UP", 258)
KEY_DOWN = getattr(curses, "KEY_DOWN", 259)
KEY_PPAGE = getattr(curses, "KEY_PPAGE", 260)
KEY_NPAGE = getattr(curses, "KEY_NPAGE", 261)
KEY_HOME = getattr(curses, "KEY_HOME", 262)
KEY_END = getattr(curses, "KEY_END", 263)


def to_epoch(value):
    if isinstance(value, (int, float)):
        return value / 1000 if value > 10_000_000_000 else value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def fmt_ts(ts):
    return datetime.fromtimestamp(ts).astimezone().strftime("%H:%M:%S") if ts else "--:--:--"


def age(ts):
    return "n/a" if ts is None else f"{max(0, int(time.time() - ts))}s"


def latest_run(root: Path):
    runs = [p for p in root.iterdir() if p.is_dir() and p.name[:1].isdigit()] if root.exists() else []
    return max(runs, key=lambda p: p.name) if runs else None


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None




def parse_eta_hours(value):
    text=str(value or '').strip().lower()
    if text in ('','0 h','0h'): return (0.0,0.0)
    unit=8.0 if 'd' in text else 1.0
    nums=[float(x) for x in re.findall(r'\d+(?:\.\d+)?',text)]
    if not nums: return (0.0,0.0)
    if text.startswith('<'): return (0.0,nums[0]*unit)
    if len(nums)==1: return (nums[0]*unit,nums[0]*unit)
    return (nums[0]*unit,nums[1]*unit)


def project_status(repo: Path, timeline):
    tasks=[]
    try:
        for line in (repo/'TODO.md').read_text(errors='replace').splitlines():
            m=re.match(r'^\|\s*([A-Z]+-\d+(?:\.\d+)?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)%\s*\|\s*([^|]+?)\s*\|',line)
            if not m: continue
            lo,hi=parse_eta_hours(m.group(6))
            tasks.append({'id':m.group(1),'title':m.group(2).strip(),'signal':m.group(3).strip(),'size':m.group(4).strip(),'percent':int(m.group(5)),'eta':m.group(6).strip(),'eta_low_hours':lo,'eta_high_hours':hi})
    except OSError:
        pass
    complete=sum(1 for t in tasks if t['percent']>=100)
    average=round(sum(t['percent'] for t in tasks)/len(tasks)) if tasks else 0
    remaining=[t for t in tasks if t['percent']<100]
    eta_low=sum(t['eta_low_hours'] for t in remaining)
    eta_high=sum(t['eta_high_hours'] for t in remaining)
    critical=[next((t for t in tasks if t['id']==tid),None) for tid in ('GW-01','GW-02')]
    critical=[t for t in critical if t]
    readiness=load_json(repo/'project/readiness.json') or {}
    next_milestone=None
    for m in readiness.get('milestones',[]):
        support=[next((t for t in tasks if t['id']==tid),None) for tid in m.get('supporting_tasks',[])]
        if any(t is None or t['percent']<100 for t in support):
            next_milestone={'id':m.get('id'),'title':m.get('title'),'supporting_incomplete':[t['id'] if t else '?' for t in support if t is None or t['percent']<100]}
            break
    now=time.time(); local_day=datetime.now().astimezone().date()
    todays=sorted(x.get('ts') for x in timeline if x.get('ts') and datetime.fromtimestamp(x['ts']).astimezone().date()==local_day)
    window=(todays[-1]-todays[0]) if len(todays)>1 else 0
    active=0.0
    for a,b in zip(todays,todays[1:]):
        gap=max(0,b-a)
        active+=min(gap,120.0)
    return {'task_count':len(tasks),'complete_count':complete,'average_percent':average,'remaining_eta_low_hours':round(eta_low,1),'remaining_eta_high_hours':round(eta_high,1),'critical_path':critical,'next_milestone':next_milestone,'observed_today_window_seconds':round(window),'observed_today_active_seconds':round(active),'observed_event_count_today':len(todays),'time_semantics':'active is heuristic: event gaps capped at 120s; window is first-to-last observed event today'}


def prepared_dispatch_summary():
    state=load_json(PREPARED_DISPATCH_STATE)
    if not isinstance(state,dict): return None
    result={'status':state.get('status'),'label':state.get('label'),'goal':state.get('goal'),'task_id':state.get('task_id'),'controller_id':state.get('controller_id'),'run_dir':state.get('run_dir')}
    run_dir=Path(state['run_dir']) if state.get('run_dir') else None
    if not run_dir: return result
    detached=load_json(run_dir/'detached-state.json') or {}
    worker=load_json(run_dir/'worker-report.json') or {}
    latest_report=None
    reports=sorted((run_dir/'agent-runs').glob('*/report.json')) if (run_dir/'agent-runs').exists() else []
    if reports: latest_report=load_json(reports[-1]) or {}
    report=latest_report or worker
    result.update({'run_status':detached.get('status'),'phase':detached.get('phase'),'worker_status':worker.get('status'),'correlation_id':worker.get('correlation_id') or report.get('correlation_id'),'seconds':report.get('seconds'),'model':report.get('model'),'opencode_version':report.get('opencode_version'),'changed_files':report.get('changed_files') or report.get('touched_files') or [],'outcome_reason':report.get('outcome_reason')})
    if detached.get('status')=='DONE' and report.get('outcome_reason')=='acceptance_passed': result['result']='PASS'
    elif detached.get('status') in ('ERROR','FAILED') or report.get('outcome_reason') in ('acceptance_failed','worker_failed'): result['result']='FAIL'
    else: result['result']='RUNNING' if detached.get('status') in ('STARTING','RUNNING') else 'PENDING'
    return result


def actor_registry(path: Path = DEFAULT_ACTORS):
    data = load_json(path)
    if not isinstance(data, dict) or not isinstance(data.get("actors"), list):
        return BUILTIN_ACTORS
    actors = []
    seen = set()
    for item in data["actors"]:
        if not isinstance(item, dict):
            continue
        actor_id = str(item.get("id","")).strip().upper()
        if not actor_id or actor_id in seen:
            continue
        seen.add(actor_id)
        actor = {
            "id": actor_id,
            "label": str(item.get("label") or actor_id),
            "enabled": bool(item.get("enabled", True)),
        }
        if item.get("jsonl"):
            actor["jsonl"] = str(item["jsonl"])
            actor["timestamp_field"] = str(item.get("timestamp_field") or "timestamp")
            actor["message_field"] = str(item.get("message_field") or "message")
        actors.append(actor)
    return actors or BUILTIN_ACTORS


def llama_state():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:8080/slots", timeout=0.35) as r:
            slots = json.load(r)
        if not isinstance(slots, list) or not slots:
            return "unknown"
        return " ".join(f"slot{i}:{'BUSY' if s.get('is_processing') else 'idle'}" for i, s in enumerate(slots))
    except Exception:
        return "unreachable"


def git_status(repo: Path):
    try:
        p = subprocess.run(["git", "-C", str(repo), "status", "--short"],
                           text=True, capture_output=True, timeout=0.8)
        lines = [x for x in p.stdout.splitlines() if x.strip()]
        return lines, len(lines)
    except Exception:
        return ["git status unavailable"], 1


_VERSION_CACHE = {"ts": 0.0, "data": {}}


def short_version(command, default="?"):
    try:
        p = subprocess.run(command, text=True, capture_output=True, timeout=1.5)
        text = (p.stdout or p.stderr).strip().splitlines()
        return text[0] if text else default
    except Exception:
        return default


def tool_versions():
    now = time.time()
    if now - _VERSION_CACHE["ts"] < 60 and _VERSION_CACHE["data"]:
        return _VERSION_CACHE["data"]

    installed = []
    versions_root = Path.home() / ".local/share/opencode/versions"
    if versions_root.exists():
        for binary in sorted(versions_root.glob("v*/bin/opencode")):
            if os.access(binary, os.X_OK):
                installed.append(short_version([str(binary), "--version"], binary.parents[1].name))

    mcp_version = "?"
    try:
        for pkg in (Path.home() / ".npm/_npx").glob("*/node_modules/@wonderwhy-er/desktop-commander/package.json"):
            mcp_version = json.loads(pkg.read_text()).get("version", "?")
    except Exception:
        pass

    data = {
        "opencode_default": short_version(["/opt/homebrew/bin/opencode", "--version"]),
        "opencode_parallel": ",".join(installed) if installed else "-",
        "llama": short_version(["/opt/homebrew/bin/llama-server", "--version"]),
        "mcp": mcp_version,
        "python": short_version(["python3", "--version"]),
        "zsh": short_version(["/bin/zsh", "--version"]),
    }
    _VERSION_CACHE.update(ts=now, data=data)
    return data


def ev(ts, source, message, **extra):
    value = {"ts": ts or 0.0, "source": source, "message": " ".join(str(message).split())}
    value.update({k:v for k,v in extra.items() if v is not None})
    return value


def parse_harness_observer_events(path: Path = HARNESS_OBSERVER_EVENTS, limit=800):
    timeline, spans = [], {}
    if not path.exists():
        return timeline, spans, set()
    try:
        text = path.read_text(errors="replace")
        # Legacy observer writers emitted literal "\\n" between JSON objects.
        # Normalize only object-boundary separators so old evidence remains parseable.
        text = text.replace('}\\n{','}\n{')
        lines = text.splitlines()[-limit:]
    except OSError:
        return timeline, spans, set()
    terminal = {"DONE","ERROR","CANCELED","REQUEST_DONE","REQUEST_ERROR"}
    starts = {"START","REQUEST_START"}
    for raw in lines:
        try:
            item = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(item, dict):
            continue
        actor = str(item.get("actor") or "").upper()
        event = str(item.get("event") or "")
        if not actor:
            continue
        ts = to_epoch(item.get("ts"))
        source = item.get("source") if isinstance(item.get("source"), dict) else {}
        correlation = {
            "correlation_id": item.get("correlation_id"),
            "run_id": item.get("run_id"),
            "plan_id": item.get("plan_id"),
            "task_id": item.get("task_id"),
            "span_id": item.get("span_id"),
            "parent_span_id": item.get("parent_span_id"),
            "client": source.get("client"),
            "conversation_id": source.get("conversation_id"),
            "turn_id": source.get("turn_id"),
            "message_id": source.get("message_id"),
            "action_id": source.get("action_id"),
            "action_label": source.get("action_label"),
            "source_quality": source.get("source_quality") or "unknown",
        }
        detail = item.get("message") or event
        timeline.append(ev(ts, actor, f"{event} {detail}", correlation=correlation))
        span_id = item.get("span_id")
        if span_id:
            if event in starts:
                spans[span_id] = {
                    "id": span_id, "actor": actor, "status": "RUNNING",
                    "started": ts or 0.0, "updated": ts or 0.0, "ended": None,
                    "label": detail, "detail": event,
                    "correlation": correlation
                }
            elif event in terminal and span_id in spans:
                spans[span_id].update(
                    status="DONE" if event in ("DONE","REQUEST_DONE") else "ERROR",
                    updated=ts or spans[span_id]["updated"],
                    ended=ts or spans[span_id]["updated"],
                    detail=event
                )
    active={span["actor"] for span in spans.values() if span.get("ended") is None}
    return timeline, spans, active


def browser_turn_windows(events_path: Path = HARNESS_OBSERVER_EVENTS, state_path: Path = BROWSER_TURN_STATE, limit=4000):
    windows = {}
    now = time.time()
    if events_path.exists():
        try:
            text = events_path.read_text(errors="replace").replace('}\n{','}\n{')
            lines = text.splitlines()[-limit:]
        except OSError:
            lines = []
        for raw in lines:
            try:
                item = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(item, dict) or str(item.get("actor") or "").upper() != "CHAT":
                continue
            event = str(item.get("event") or "").upper()
            if event not in {"TURN_START","TURN_ACTIVE","TURN_DONE"}:
                continue
            source = item.get("source") if isinstance(item.get("source"), dict) else {}
            if source.get("source_quality") != "browser_observed":
                continue
            cid, tid = source.get("conversation_id"), source.get("turn_id")
            ts = to_epoch(item.get("ts"))
            if not cid or not tid or not ts:
                continue
            w = windows.setdefault(tid, {
                "conversation_id": cid, "turn_id": tid, "start": ts,
                "last_seen": ts, "end": None, "source_quality": "browser_observed"
            })
            w["conversation_id"] = cid
            w["start"] = min(w.get("start") or ts, ts)
            w["last_seen"] = max(w.get("last_seen") or ts, ts)
            if event == "TURN_DONE":
                w["end"] = ts

    state = load_json(state_path) or {}
    for active in state.get("active") or []:
        if not isinstance(active, dict):
            continue
        cid, tid = active.get("conversation_id"), active.get("turn_id")
        start = to_epoch(active.get("started_at"))
        seen = to_epoch(active.get("last_seen_at"))
        lease = to_epoch(active.get("lease_until"))
        if not cid or not tid or not start or not lease or lease < now:
            continue
        w = windows.setdefault(tid, {
            "conversation_id": cid, "turn_id": tid, "start": start,
            "last_seen": seen or start, "end": lease, "source_quality": "browser_observed"
        })
        w.update(
            conversation_id=cid,
            start=min(w.get("start") or start, start),
            last_seen=max(w.get("last_seen") or start, seen or start),
            end=max(w.get("end") or 0, lease),
            source_quality="browser_observed"
        )

    out = []
    for w in windows.values():
        end = w.get("end")
        if end is None:
            end = min(now, (w.get("last_seen") or w["start"]) + 15)
        if end >= w["start"]:
            out.append({**w, "end": end})
    return out


def infer_browser_turn_scope(events, windows):
    for item in events:
        if item.get("source") not in {"MCP","RDC","TERM"}:
            continue
        ts = item.get("ts") or 0
        if not ts:
            continue
        correlation = item.get("correlation") if isinstance(item.get("correlation"), dict) else {}
        if correlation.get("conversation_id"):
            continue
        matches = [w for w in windows if w["start"] <= ts <= w["end"]]
        if len(matches) != 1:
            continue
        w = matches[0]
        item["correlation"] = {
            **correlation,
            "conversation_id": w["conversation_id"],
            "turn_id": w["turn_id"],
            "source_quality": "browser_inferred",
        }
        item["attribution"] = "single_active_browser_turn"
    return events


def propagate_process_scope(events):
    scoped = {}
    for item in sorted(events, key=lambda x: x.get("ts") or 0):
        key = item.get("process_key")
        correlation = item.get("correlation") if isinstance(item.get("correlation"), dict) else {}
        if key and correlation.get("conversation_id") and key not in scoped:
            scoped[key] = {
                "conversation_id": correlation.get("conversation_id"),
                "turn_id": correlation.get("turn_id"),
                "source_quality": correlation.get("source_quality") or "unknown",
            }
    for item in events:
        key = item.get("process_key")
        if not key or key not in scoped:
            continue
        correlation = item.get("correlation") if isinstance(item.get("correlation"), dict) else {}
        if correlation.get("conversation_id"):
            continue
        root = scoped[key]
        item["correlation"] = {
            **correlation,
            "conversation_id": root["conversation_id"],
            "turn_id": root.get("turn_id"),
            "source_quality": root.get("source_quality") or "browser_inferred",
        }
        item["attribution"] = "process_inherited_from_pid"
    return events


def parse_opencode(path: Path):
    out, last_ts, count = [], None, 0
    if not path.exists():
        return out, last_ts, count
    context = load_json(path.parent / "event-context.json") or {}
    source = context.get("source") if isinstance(context.get("source"), dict) else {}
    base_correlation = {
        "correlation_id": context.get("correlation_id"),
        "run_id": context.get("run_id"),
        "plan_id": context.get("plan_id"),
        "task_id": context.get("task_id"),
        "span_id": context.get("oc_span_id"),
        "parent_span_id": context.get("parent_span_id"),
        "client": source.get("client"),
        "conversation_id": source.get("conversation_id"),
        "turn_id": source.get("turn_id"),
        "message_id": source.get("message_id"),
        "action_id": source.get("action_id"),
        "action_label": source.get("action_label"),
        "source_quality": source.get("source_quality") or ("declared" if source else "unknown"),
    }
    try:
        for raw in path.read_text(errors="replace").splitlines():
            if not raw.startswith("{"):
                continue
            try:
                e = json.loads(raw)
            except ValueError:
                continue
            count += 1
            ts = to_epoch(e.get("timestamp"))
            if ts:
                last_ts = ts
            typ, part = e.get("type"), e.get("part") or {}
            if typ == "tool_use":
                state = part.get("state") or {}
                inp = state.get("input") or {}
                if not isinstance(inp, dict):
                    inp = {}
                target = inp.get("filePath") or inp.get("path") or ""
                tool = str(part.get("tool") or "?")
                status = str(state.get("status") or "?")
                corr = dict(base_correlation)
                corr["span_id"] = f"{context.get('oc_span_id') or 'oc'}:tool:{tool}"
                corr["parent_span_id"] = context.get("oc_span_id")
                out.append(ev(ts, "OC", f"{tool} {status} {target}", correlation=corr))
            elif typ == "step_finish":
                tok = (part.get("tokens") or {}).get("output")
                corr = dict(base_correlation)
                corr["span_id"] = f"{context.get('oc_span_id') or 'oc'}:step"
                corr["parent_span_id"] = context.get("oc_span_id")
                out.append(ev(ts, "OC", f"step finish={part.get('reason','?')} out={tok}", correlation=corr))
            elif typ == "text":
                txt = (part.get("text") or "").strip()
                if txt:
                    corr = dict(base_correlation)
                    corr["span_id"] = f"{context.get('oc_span_id') or 'oc'}:model-detail"
                    corr["parent_span_id"] = context.get("oc_span_id")
                    out.append(ev(ts, "QWEN", txt[:180], correlation=corr))
    except OSError:
        pass
    return out, last_ts, count


def command_label(command):
    match = re.search(r'echo\s+["\']===\s+\$\(date[^\n]*?\)\s+(.+?)\s+===["\']', command or "")
    if match:
        return match.group(1)
    text = " ".join((command or "").split())
    for prefix in ("zsh -lc ", "bash -lc "):
        if text.startswith(prefix):
            text = text[len(prefix):]
    return text[:130]


def summarize_mcp(rec):
    tool = rec.get("toolName", "?")
    args = rec.get("arguments") or {}
    if tool == "start_process":
        return f"start_process: {command_label(args.get('command',''))}"
    if tool in ("read_file", "write_file", "edit_block"):
        path = args.get("path") or args.get("file_path") or "?"
        return f"{tool}: {path}"
    if tool in ("read_process_output", "interact_with_process", "kill_process", "force_terminate"):
        return f"{tool}: pid={args.get('pid','?')}"
    if tool == "list_directory":
        return f"list_directory: {args.get('path','?')}"
    if tool == "read_multiple_files":
        paths = args.get("paths") or []
        return f"read_multiple_files: {len(paths)} file(s)"
    return tool


def parse_mcp_history(path: Path, limit=300):
    out, last_ts = [], None
    latest_process = {}
    if not path.exists():
        return out, last_ts
    try:
        lines = path.read_text(errors="replace").splitlines()[-limit:]
        for raw in lines:
            try:
                rec = json.loads(raw)
            except ValueError:
                continue
            ts = to_epoch(rec.get("timestamp"))
            if ts:
                last_ts = max(last_ts or ts, ts)
            tool = rec.get("toolName")
            args = rec.get("arguments") or {}
            pid = None
            process_key = None
            if tool == "start_process":
                match = re.search(r"Process started with PID (\d+)", _history_text(rec))
                if match and ts:
                    pid = int(match.group(1))
                    process_key = f"pid:{pid}@{int(ts * 1000)}"
                    latest_process[pid] = process_key
            elif tool in ("read_process_output","interact_with_process","kill_process","force_terminate"):
                value = args.get("pid")
                if isinstance(value, int):
                    pid = value
                    process_key = latest_process.get(pid)
            out.append(ev(ts, "RDC", summarize_mcp(rec),
                          tool=tool, process_id=pid, process_key=process_key,
                          transport="mcp", provider="remote_desktop_commander"))
    except OSError:
        pass
    return out, last_ts


def _history_text(rec):
    try:
        content = (rec.get("output") or {}).get("content") or []
        return "\n".join(str(x.get("text","")) for x in content if isinstance(x, dict))
    except Exception:
        return ""



def mcp_activity(path: Path, limit=80):
    if not path.exists():
        return None
    try:
        lines = path.read_text(errors="replace").splitlines()[-limit:]
    except OSError:
        return None
    for raw in reversed(lines):
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(rec, dict) or not rec.get("toolName"):
            continue
        ts = to_epoch(rec.get("timestamp"))
        return {
            "tool": str(rec.get("toolName")),
            "summary": summarize_mcp(rec),
            "timestamp": ts,
            "duration_ms": rec.get("duration"),
        }
    return None

def process_spans(path: Path, limit=800):
    spans = {}
    if not path.exists():
        return []
    try:
        lines = path.read_text(errors="replace").splitlines()[-limit:]
    except OSError:
        return []
    for raw in lines:
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        tool = rec.get("toolName")
        args = rec.get("arguments") or {}
        ts = to_epoch(rec.get("timestamp")) or 0.0
        text = _history_text(rec)

        if tool == "start_process":
            match = re.search(r"Process started with PID (\d+)", text)
            if not match:
                continue
            pid = int(match.group(1))
            process_key = f"pid:{pid}@{int(ts * 1000)}"
            spans[pid] = {
                "id": f"pid:{pid}",
                "pid": pid,
                "process_key": process_key,
                "actor": "TERM",
                "label": command_label(args.get("command","")),
                "status": "RUNNING",
                "started": ts,
                "updated": ts,
                "ended": None,
                "detail": "waiting for process end",
            }
            done = re.search(r"Process completed with exit code (-?\d+)", text)
            if done:
                code = int(done.group(1))
                spans[pid].update(status="DONE" if code == 0 else "ERROR",
                                  ended=ts, detail=f"exit={code}")

        elif tool == "read_process_output":
            pid = args.get("pid")
            if not isinstance(pid, int) or pid not in spans:
                continue
            span = spans[pid]
            span["updated"] = ts
            done = re.search(r"Process completed with exit code (-?\d+)", text)
            if done:
                code = int(done.group(1))
                span.update(status="DONE" if code == 0 else "ERROR",
                            ended=ts, detail=f"exit={code}")
            elif "No output in requested range" in text:
                span.update(status="WAITING", detail="alive; waiting for output/end")
            else:
                span.update(status="RUNNING", detail="output received; process still open")

        elif tool in ("kill_process", "force_terminate"):
            pid = args.get("pid")
            if isinstance(pid, int) and pid in spans:
                spans[pid].update(status="CANCELED", ended=ts, updated=ts,
                                  detail=tool)

    now = time.time()
    for span in spans.values():
        if span["ended"] is None:
            try:
                os.kill(span["pid"], 0)
            except OSError:
                span.update(status="EXITED", ended=span["updated"],
                            detail="process exited; exit code not captured")
            else:
                # Desktop Commander can keep an interactive shell/session alive
                # long after the command that produced the last observation.
                # Alive is not the same thing as actively executing.
                silence = max(0, now - (span["updated"] or span["started"]))
                if silence > 4:
                    span.update(status="WAITING",
                                detail=f"session alive; no activity for {int(silence)}s")
        span["age_seconds"] = max(0, int((span["ended"] or now) - span["started"]))
    return sorted(spans.values(), key=lambda s: s["started"])


def parse_commands(path: Path, limit=500):
    out = []
    if not path.exists():
        return out
    rx = re.compile(r"^===\s+(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\s+(.+?)\s+===$")
    try:
        for line in path.read_text(errors="replace").splitlines()[-limit:]:
            m = rx.match(line)
            if m:
                out.append(ev(to_epoch(m.group(1)), "TERM", m.group(2)))
    except OSError:
        pass
    return out


def parse_custom_actor_events(actors, limit=300):
    out = []
    for actor in actors:
        source = actor.get("id")
        path_value = actor.get("jsonl")
        if not actor.get("enabled", True) or not source or not path_value:
            continue
        path = Path(path_value).expanduser()
        if not path.exists():
            continue
        ts_field = actor.get("timestamp_field", "timestamp")
        msg_field = actor.get("message_field", "message")
        try:
            for raw in path.read_text(errors="replace").splitlines()[-limit:]:
                try:
                    item = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(item, dict):
                    continue
                out.append(ev(to_epoch(item.get(ts_field)), source, item.get(msg_field, "")))
        except OSError:
            pass
    return out


def run_started(run: Path):
    try:
        return datetime.strptime(run.name[:22], "%Y%m%dT%H%M%S%fZ").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return None


def local_agent_run(fallback):
    state = load_json(LOCAL_AGENT_STATE)
    if isinstance(state, dict):
        candidate = Path(str(state.get("run_dir") or "")).expanduser()
        if candidate.is_dir():
            return candidate, state
    return fallback, None


def current_task_lifecycle():
    pointer = load_json(CURRENT_RUN_STATE)
    if not isinstance(pointer, dict):
        return None
    run_dir = Path(str(pointer.get("run_dir") or "")).expanduser()
    checkpoint = load_json(run_dir / "checkpoint.json") if run_dir.is_dir() else None
    if not isinstance(checkpoint, dict):
        return pointer
    checkpoint["run_dir"] = str(run_dir)
    return checkpoint


def detect_failure_reason(run: Path, report):
    if not run:
        return None
    if report:
        if report.get("outcome_reason"):
            return str(report["outcome_reason"])
        if report.get("termination"):
            return str(report["termination"])
        if report.get("error"):
            return str(report["error"])
    path = run / "events.log"
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return None
    if "MAXIMUM STEPS REACHED" in text:
        return "max_steps_reached"
    return None


def run_inspection(run: Path, report, local_agent):
    if not run:
        return None
    task = ""
    try:
        task = (run / "task.txt").read_text(encoding="utf-8").strip()
    except OSError:
        pass
    config = load_json(run / "config.json") or {}
    command = load_json(run / "command.json") or {}
    agent = ((config.get("agent") or {}).get("scoped-task") or {})
    model = (report or {}).get("model") or (local_agent or {}).get("model") or config.get("model") or "-"
    opencode_version = (report or {}).get("opencode_version") or (local_agent or {}).get("opencode_version") or "-"
    reason = detect_failure_reason(run, report)
    status = (report or {}).get("status") or (local_agent or {}).get("status") or "running"
    changed = (report or {}).get("changed_files") or []
    if not changed and report and report.get("expected") and report.get("before_sha256") != report.get("after_sha256"):
        try:
            changed = [str(Path(report["expected"]).resolve().relative_to(DEFAULT_REPO.resolve()))]
        except Exception:
            changed = [str(report["expected"])]
    artifacts = {}
    for name in ("task.txt", "config.json", "command.json", "events.log", "report.json"):
        path = run / name
        if path.exists():
            artifacts[name] = str(path)
    return {
        "id": run.name,
        "status": status,
        "reason": reason,
        "task": task,
        "model": model,
        "opencode_version": opencode_version,
        "opencode": (report or {}).get("opencode") or ((command.get("argv") or ["-"])[0]),
        "steps": (report or {}).get("steps") or agent.get("steps"),
        "tokens_per_turn": (report or {}).get("tokens_per_turn") or (((config.get("provider") or {}).get("llamacpp") or {}).get("models") or {}).get("qwen3.8-27b", {}).get("limit", {}).get("output"),
        "deadline_seconds": (report or {}).get("deadline_seconds"),
        "elapsed_seconds": (report or {}).get("seconds"),
        "process_exit": (report or {}).get("exit"),
        "reads": (report or {}).get("reads") or [],
        "writes": (report or {}).get("writes") or [],
        "expected": (report or {}).get("expected_relative") or (report or {}).get("expected"),
        "changed_files": changed,
        "confirmed_edit_tools": (report or {}).get("confirmed_edit_tools") or [],
        "artifacts": artifacts,
        "run_dir": str(run),
    }


def snapshot(root: Path, repo: Path, commands: Path, mcp: Path):
    run, local_agent = local_agent_run(latest_run(root))
    llama = llama_state()
    git, git_total = git_status(repo)
    actors = actor_registry()
    spans = process_spans(mcp)
    activity = mcp_activity(mcp)
    data = {
        "now": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z"),
        "run": run.name if run else None,
        "state": "IDLE",
        "detail": "waiting for an agent run",
        "llama": llama,
        "git": git,
        "git_total": git_total,
        "stop": (root / "STOP").exists(),
        "timeline": [],
        "last_event": None,
        "oc_count": 0,
        "versions": tool_versions(),
        "run_opencode": "-",
        "actors": actors,
        "spans": spans,
        "local_agent": local_agent,
        "run_inspection": None,
        "task_lifecycle": current_task_lifecycle(),
        "detached_run": load_json(DETACHED_RUN_STATE),
        "rdc": None,
    }

    timeline = parse_commands(commands)
    timeline += parse_custom_actor_events(actors)
    harness_events, harness_spans, harness_active = parse_harness_observer_events()
    timeline += harness_events
    mcp_events, mcp_last = parse_mcp_history(mcp)
    timeline += mcp_events

    # Process spans are state, but their lifecycle must also be visible in the
    # timeline. Otherwise TERM can truthfully be active in the header while the
    # operator has no TERM evidence below.
    for span in spans:
        timeline.append(ev(span.get("started"), "TERM",
            f"START pid={span.get('pid')} {span.get('label','')}",
            process_id=span.get("pid"), process_key=span.get("process_key")))
        if span.get("ended"):
            timeline.append(ev(span.get("ended"), "TERM",
                f"{span.get('status')} pid={span.get('pid')} {span.get('detail','')}",
                process_id=span.get("pid"), process_key=span.get("process_key")))

    if run:
        report = load_json(run / "report.json")
        data["run_inspection"] = run_inspection(run, report, local_agent)
        oc_events, oc_last, oc_count = parse_opencode(run / "events.log")
        timeline += oc_events
        data["oc_count"] = oc_count
        data["last_event"] = max(x for x in (oc_last, mcp_last) if x is not None) if any(x is not None for x in (oc_last, mcp_last)) else None
        if report:
            status = report.get("status", "unknown")
            data["run_opencode"] = report.get("opencode_version") or "legacy/unknown"
            data["state"] = "DONE" if status == "artifact_ready_for_review" else "FAILED"
            reason = (data["run_inspection"] or {}).get("reason") or status
            data["detail"] = f"{reason} process_exit={report.get('exit')} elapsed={report.get('seconds')}s edits={report.get('confirmed_edit_tools', [])}"
        else:
            silence = time.time() - oc_last if oc_last else None
            if silence is not None and silence > 45:
                data["state"] = "STALLED?"
                data["detail"] = f"no final report; OpenCode quiet {int(silence)}s"
            else:
                data["state"] = "RUNNING"
                data["detail"] = f"run age={age(run_started(run))}; no final report"
    else:
        data["last_event"] = mcp_last

    # A local-agent run is a first-class observed execution source. Its
    # OpenCode/Qwen events come from events.log; these lifecycle observations
    # make the run and live llama slot state visible even before the first model
    # text/tool event is emitted.
    if local_agent:
        started = local_agent.get("started_at")
        updated = local_agent.get("updated_at") or started
        timeline.append(ev(started, "OC",
            f"local-agent {local_agent.get('status','unknown')} {local_agent.get('model','')}"))
        if local_agent.get("status") == "running" and "BUSY" in llama:
            timeline.append(ev(updated, "LLAMA", llama))

    turn_windows = browser_turn_windows()
    timeline = infer_browser_turn_scope(timeline, turn_windows)
    timeline = propagate_process_scope(timeline)
    data["browser_turn_windows"] = turn_windows
    data["timeline"] = sorted(timeline, key=lambda x: x["ts"])
    now = time.time()
    open_term = any(
        s.get("status") == "RUNNING"
        and now - (s.get("updated") or s.get("started") or 0) <= 4
        for s in spans
    )
    local_running = bool(local_agent and local_agent.get("status") == "running")
    recent = {}
    for item in data["timeline"]:
        if item.get("ts"):
            recent[item.get("source")] = item["ts"]
    # Actor truth is correlation-driven. Runtime BUSY is diagnostic state only;
    # it does not prove that the work belongs to this Harness run.
    open_background = [
        {
            "pid": s.get("pid"),
            "status": s.get("status"),
            "label": s.get("label"),
            "started": s.get("started"),
            "updated": s.get("updated"),
            "age_seconds": s.get("age_seconds"),
            "detail": s.get("detail"),
        }
        for s in spans
        if s.get("ended") is None and s.get("status") in ("RUNNING","WAITING")
    ]
    activity_age = None
    if activity and activity.get("timestamp"):
        activity_age = max(0, int(now - activity["timestamp"]))
    data["rdc"] = {
        "last_tool": activity.get("tool") if activity else None,
        "last_summary": activity.get("summary") if activity else None,
        "last_activity_seconds": activity_age,
        "last_duration_ms": activity.get("duration_ms") if activity else None,
        "open_processes": open_background,
        "open_count": len(open_background),
    }
    # UI actor activity is a short observation lease, not CPU-level execution truth.
    # Actor/provider and transport are separate dimensions. Remote Desktop Commander
    # history is provider evidence with transport=mcp; any future MCP provider can
    # therefore light MCP without falsely lighting RDC.
    rdc_recent = bool(activity_age is not None and activity_age <= 30)
    mcp_recent = any(
        item.get("ts") and now - item["ts"] <= 30 and item.get("transport") == "mcp"
        for item in data["timeline"]
    )
    data["actor_activity"] = {
        "MCP": mcp_recent,
        "RDC": rdc_recent,
        "TERM": open_term,
        "OC": "OC" in harness_active or local_running or process_actor() == "OC",
        "QWEN": "QWEN" in harness_active,
        "LLAMA": "LLAMA" in harness_active,
        "GIT": bool(recent.get("GIT") and now - recent["GIT"] <= 30),
    }
    data["harness_spans"] = sorted(harness_spans.values(), key=lambda x:x.get("started") or 0)
    return data


def safe_add(stdscr, y, x, text, attr=0):
    h, w = stdscr.getmaxyx()
    if 0 <= y < h and x < w:
        try:
            stdscr.addnstr(y, x, str(text), max(0, w - x - 1), attr)
        except curses.error:
            pass


def timeline_capacity(height):
    return max(1, height - 8)


def init_colors():
    if not curses.has_colors():
        return
    try:
        curses.start_color()
        curses.use_default_colors()
        palette = {
            1: curses.COLOR_CYAN,     # MCP
            2: curses.COLOR_YELLOW,   # TERM
            3: curses.COLOR_MAGENTA,  # OC
            4: curses.COLOR_BLUE,     # QWEN
            5: curses.COLOR_WHITE,    # LLAMA
            6: curses.COLOR_RED,      # GIT
            7: curses.COLOR_GREEN,    # active
        }
        for pair, fg in palette.items():
            curses.init_pair(pair, fg, -1)
    except curses.error:
        pass


SOURCE_PAIRS = {"MCP": 1, "TERM": 2, "OC": 3, "QWEN": 4, "LLAMA": 5, "GIT": 6}


def source_attr(source, active=False):
    if not curses.has_colors():
        return curses.A_BOLD if active else 0
    pair = 7 if active else SOURCE_PAIRS.get(source, 0)
    return curses.color_pair(pair) | (curses.A_BOLD if active else 0)


_ACTOR_CACHE = {"ts": 0.0, "value": None}


def process_actor():
    now = time.time()
    if now - _ACTOR_CACHE["ts"] < 0.75:
        return _ACTOR_CACHE["value"]
    value = None
    try:
        p = subprocess.run(["ps", "-axo", "command="], text=True, capture_output=True, timeout=0.8)
        commands = p.stdout.splitlines()
        if any("opencode run" in line for line in commands):
            value = "OC"
        elif any("scripts/local-agent.py" in line for line in commands):
            value = "TERM"
    except Exception:
        pass
    _ACTOR_CACHE.update(ts=now, value=value)
    return value


def active_source(data, merged):
    activity = data.get("actor_activity") or {}
    for actor in ("QWEN", "OC", "LLAMA", "TERM", "MCP", "GIT"):
        if activity.get(actor):
            return actor
    actor = process_actor()
    if actor:
        return actor
    if not merged:
        return None
    latest = merged[-1]
    if latest["ts"] and time.time() - latest["ts"] <= 4:
        return latest["source"]
    return None


def latest_message(events, *sources):
    wanted = set(sources)
    for item in reversed(events):
        if item["source"] in wanted:
            return item["message"]
    return "-"


def draw_source_legend(stdscr, y, mode, position, active):
    x = 0
    prefix = f"UNIFIED TIMELINE  [{mode} {position}]  "
    safe_add(stdscr, y, x, prefix, curses.A_BOLD)
    x += len(prefix)
    labels = ["MCP", "TERM", "OC", "QWEN", "LLAMA", "GIT"]
    blink_on = int(time.time() * 2) % 2 == 0
    for idx, label in enumerate(labels):
        if label == active:
            dot = "●" if blink_on else " "
            safe_add(stdscr, y, x, dot, curses.color_pair(7) | curses.A_BOLD if curses.has_colors() else curses.A_BOLD)
            x += 2
            safe_add(stdscr, y, x, label, curses.A_BOLD)
        else:
            safe_add(stdscr, y, x, "  " + label)
        x += len(label)
        if idx < len(labels) - 1:
            safe_add(stdscr, y, x, " | ")
            x += 3


def draw_timeline(stdscr, data, runtime_events, view_end):
    stdscr.erase()
    h, w = stdscr.getmaxyx()
    if h < 12 or w < 65:
        safe_add(stdscr, 0, 0, "Resize terminal to at least 65x12. q quits.")
        stdscr.refresh()
        return

    timeline_rows = timeline_capacity(h)
    merged = sorted(data["timeline"] + runtime_events, key=lambda x: x["ts"])
    total = len(merged)
    end = total if view_end is None else max(0, min(view_end, total))
    start = max(0, end - timeline_rows)
    visible = merged[start:end]
    mode = "LIVE" if view_end is None else "HISTORY"
    position = f"{end}/{total}" if total else "0/0"
    active = active_source(data, merged)

    header = f" Browser Bridge Observer | {data['state']} | {mode} {position} | {data['now']} "
    safe_add(stdscr, 0, 0, header.ljust(w - 1), curses.A_REVERSE)
    safe_add(stdscr, 1, 0, f"run    {data['run'] or '-'}   OpenCode(run)={data['run_opencode']}")
    safe_add(stdscr, 2, 0, f"agent  {data['detail']}")
    safe_add(stdscr, 3, 0, f"llama  {data['llama']}   last activity: {age(data['last_event'])} ago")
    safe_add(stdscr, 4, 0, f"STOP   {'ACTIVE' if data['stop'] else 'available'}   git:{data['git_total']}   OC events:{data['oc_count']}")
    safe_add(stdscr, 5, 0, "-" * (w - 1))
    draw_source_legend(stdscr, 6, mode, position, active)

    for i, item in enumerate(visible):
        source = item["source"]
        safe_add(stdscr, 7 + i, 0, fmt_ts(item["ts"]))
        safe_add(stdscr, 7 + i, 9, f"{source:<5}", source_attr(source, source == active))
        safe_add(stdscr, 7 + i, 15, item["message"])

    footer = " ↑/↓ 1 | PgUp/PgDn page | Home oldest | End LIVE | ? help | q quit "
    safe_add(stdscr, h - 1, 0, footer.ljust(w - 1), curses.A_REVERSE)
    stdscr.refresh()


def draw_help(stdscr):
    stdscr.erase()
    h, w = stdscr.getmaxyx()
    safe_add(stdscr, 0, 0, " Browser Bridge Observer — HELP ".ljust(w - 1), curses.A_REVERSE)
    lines = [
        "Timeline:",
        "  ↑ / ↓       move one event backward / forward",
        "  PgUp/PgDn   move one visible page",
        "  Home        jump to oldest available history",
        "  End         return to LIVE follow mode",
        "",
        "Screens:",
        "  T           Tools / Actors — versions, state, last activity",
        "  ? or Esc    return to timeline",
        "",
        "Other:",
        "  q           quit observer only",
        "",
        "The source names stay neutral. A blinking green dot marks the active actor.",
        "Mouse wheel scrolls timeline history; End returns to LIVE.",
    ]
    for i, line in enumerate(lines[:max(0, h - 2)]):
        safe_add(stdscr, 2 + i, 2, line)
    safe_add(stdscr, h - 1, 0, " T tools | ?/Esc timeline | q quit ".ljust(w - 1), curses.A_REVERSE)
    stdscr.refresh()


def draw_tools(stdscr, data, runtime_events):
    stdscr.erase()
    h, w = stdscr.getmaxyx()
    merged = sorted(data["timeline"] + runtime_events, key=lambda x: x["ts"])
    versions = data["versions"]
    active = active_source(data, merged)
    safe_add(stdscr, 0, 0, " Browser Bridge Observer — TOOLS / ACTORS ".ljust(w - 1), curses.A_REVERSE)
    rows = [
        ("MCP", f"Desktop Commander {versions['mcp']} | {latest_message(merged, 'MCP')}"),
        ("TERM", f"{versions['zsh']} | {latest_message(merged, 'TERM')}"),
        ("OC", f"run={data['run_opencode']} default={versions['opencode_default']} installed={versions['opencode_parallel']} | {latest_message(merged, 'OC')}"),
        ("QWEN", f"qwen3.8-27b | {latest_message(merged, 'QWEN')}"),
        ("LLAMA", f"{versions['llama']} | {data['llama']}"),
        ("GIT", f"{data['git_total']} changed/untracked | {' ; '.join(data['git'][:5]) if data['git'] else 'clean'}"),
        ("PY", versions["python"]),
    ]
    for i, (name, detail) in enumerate(rows[:max(0, h - 4)]):
        safe_add(stdscr, 2 + i, 2, f"{name:<6}", source_attr(name if name != "PY" else "", name == active))
        safe_add(stdscr, 2 + i, 10, detail)
    safe_add(stdscr, h - 1, 0, " ?/Esc timeline | H help | q quit ".ljust(w - 1), curses.A_REVERSE)
    stdscr.refresh()


def tui(stdscr, root, repo, commands, mcp, interval):
    try:
        curses.curs_set(0)
    except curses.error:
        pass
    init_colors()
    try:
        curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)
        curses.mouseinterval(0)
    except curses.error:
        pass
    stdscr.nodelay(True)
    stdscr.timeout(50)
    runtime_events = []
    prev_llama, prev_git = None, None
    view_end = None
    screen = "timeline"
    data = snapshot(root, repo, commands, mcp)
    next_poll = time.monotonic() + max(0.25, interval)

    while True:
        now_mono = time.monotonic()
        if now_mono >= next_poll:
            fresh = snapshot(root, repo, commands, mcp)
            now = time.time()
            if prev_llama is not None and fresh["llama"] != prev_llama:
                runtime_events.append(ev(now, "LLAMA", f"{prev_llama} -> {fresh['llama']}"))
            signature = tuple(fresh["git"])
            if prev_git is not None and signature != prev_git:
                runtime_events.append(ev(now, "GIT", f"working tree changed: {fresh['git_total']} path(s)"))
            prev_llama, prev_git = fresh["llama"], signature
            runtime_events = runtime_events[-100:]
            data = fresh
            next_poll = now_mono + max(0.25, interval)

        merged = sorted(data["timeline"] + runtime_events, key=lambda x: x["ts"])
        total = len(merged)
        rows = timeline_capacity(stdscr.getmaxyx()[0])
        if view_end is not None:
            view_end = max(0, min(view_end, total))

        if screen == "help":
            draw_help(stdscr)
        elif screen == "tools":
            draw_tools(stdscr, data, runtime_events)
        else:
            draw_timeline(stdscr, data, runtime_events, view_end)

        key = stdscr.getch()
        if key in (ord("q"), ord("Q")):
            return

        if screen == "help":
            if key in (ord("t"), ord("T")):
                screen = "tools"
            elif key in (ord("?"), 27):
                screen = "timeline"
            continue

        if screen == "tools":
            if key in (ord("h"), ord("H")):
                screen = "help"
            elif key in (ord("?"), 27):
                screen = "timeline"
            continue

        if key == ord("?"):
            screen = "help"
        elif key == curses.KEY_MOUSE and screen == "timeline":
            try:
                _id, _x, _y, _z, bstate = curses.getmouse()
                wheel_up = bool(bstate & getattr(curses, "BUTTON4_PRESSED", 0))
                wheel_down = bool(bstate & getattr(curses, "BUTTON5_PRESSED", 0))
                if wheel_up and total:
                    current = total if view_end is None else view_end
                    view_end = max(min(total, rows), current - 5)
                elif wheel_down and view_end is not None:
                    view_end += 5
                    if view_end >= total:
                        view_end = None
            except curses.error:
                pass
        elif key == KEY_END:
            view_end = None
        elif key == KEY_HOME:
            view_end = min(total, rows)
        elif key == KEY_UP and total:
            current = total if view_end is None else view_end
            view_end = max(min(total, rows), current - 1)
        elif key == KEY_DOWN and view_end is not None:
            view_end += 1
            if view_end >= total:
                view_end = None
        elif key == KEY_PPAGE and total:
            current = total if view_end is None else view_end
            view_end = max(min(total, rows), current - rows)
        elif key == KEY_NPAGE and view_end is not None:
            view_end += rows
            if view_end >= total:
                view_end = None


def print_once(root, repo, commands, mcp):
    d = snapshot(root, repo, commands, mcp)
    print(f"Browser Bridge Observer {d['state']} {d['now']}")
    print(f"run:   {d['run'] or '-'}")
    print(f"agent: {d['detail']}")
    print(f"llama: {d['llama']}  last activity: {age(d['last_event'])} ago")
    print(f"git:   {d['git_total']} changed/untracked; STOP={'ACTIVE' if d['stop'] else 'available'}")
    print("timeline:")
    for item in d["timeline"][-14:]:
        print(f"  {fmt_ts(item['ts'])} {item['source']:<5} {item['message']}")


def print_json(root, repo, commands, mcp):
    d = snapshot(root, repo, commands, mcp)
    full_timeline = d["timeline"]
    merged = full_timeline[-300:]
    scope_events = {"all": merged}
    scope_totals = {"all": len(full_timeline)}
    unscoped = [item for item in full_timeline if not ((item.get("correlation") or {}).get("conversation_id"))]
    scope_events["unscoped"] = unscoped[-300:]
    scope_totals["unscoped"] = len(unscoped)
    by_conversation = {}
    for item in full_timeline:
        cid = (item.get("correlation") or {}).get("conversation_id")
        if cid:
            by_conversation.setdefault(cid, []).append(item)
    for cid, items in by_conversation.items():
        key = f"chat:{cid}"
        scope_events[key] = items[-300:]
        scope_totals[key] = len(items)
    active = active_source(d, merged)
    status = project_status(repo, d["timeline"])
    prepared = prepared_dispatch_summary()
    payload = {
        "now": d["now"],
        "run": d["run"],
        "state": d["state"],
        "detail": d["detail"],
        "llama": d["llama"],
        "stop": d["stop"],
        "git": d["git"][:20],
        "git_total": d["git_total"],
        "oc_count": d["oc_count"],
        "last_activity_seconds": None if d["last_event"] is None else max(0, int(time.time() - d["last_event"])),
        "versions": d["versions"],
        "run_opencode": d["run_opencode"],
        "active_source": active,
        "actor_activity": d.get("actor_activity", {}),
        "actors": d.get("actors", BUILTIN_ACTORS),
        "run_inspection": d.get("run_inspection"),
        "task_lifecycle": d.get("task_lifecycle"),
        "detached_run": d.get("detached_run"),
        "rdc": d.get("rdc"),
        "prepared_dispatch": prepared,
        "project_status": status,
        "spans": (d.get("spans", []) + d.get("harness_spans", []))[-60:],
        "timeline": merged,
        "timeline_scopes": scope_events,
        "timeline_scope_totals": scope_totals,
    }
    print(json.dumps(payload, separators=(",", ":")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    ap.add_argument("--repo", type=Path, default=DEFAULT_REPO)
    ap.add_argument("--commands", type=Path, default=DEFAULT_COMMANDS)
    ap.add_argument("--mcp-history", type=Path, default=DEFAULT_MCP)
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    if args.json:
        print_json(args.root, args.repo, args.commands, args.mcp_history)
        return
    if args.once:
        print_once(args.root, args.repo, args.commands, args.mcp_history)
        return
    try:
        curses.wrapper(tui, args.root, args.repo, args.commands, args.mcp_history, max(0.25, args.interval))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
