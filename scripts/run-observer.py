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


def ev(ts, source, message):
    return {"ts": ts or 0.0, "source": source, "message": " ".join(str(message).split())}


def parse_opencode(path: Path):
    out, last_ts, count = [], None, 0
    if not path.exists():
        return out, last_ts, count
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
                target = inp.get("filePath") or inp.get("path") or ""
                out.append(ev(ts, "OC", f"{part.get('tool','?')} {state.get('status','?')} {target}"))
            elif typ == "step_finish":
                tok = (part.get("tokens") or {}).get("output")
                out.append(ev(ts, "OC", f"step finish={part.get('reason','?')} out={tok}"))
            elif typ == "text":
                txt = (part.get("text") or "").strip()
                if txt:
                    out.append(ev(ts, "QWEN", txt[:180]))
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
            out.append(ev(ts, "MCP", summarize_mcp(rec)))
    except OSError:
        pass
    return out, last_ts


def _history_text(rec):
    try:
        content = (rec.get("output") or {}).get("content") or []
        return "\n".join(str(x.get("text","")) for x in content if isinstance(x, dict))
    except Exception:
        return ""


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
            spans[pid] = {
                "id": f"pid:{pid}",
                "pid": pid,
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
                span.update(status="ENDED?", ended=span["updated"],
                            detail="process no longer exists; final exit not observed")
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


def snapshot(root: Path, repo: Path, commands: Path, mcp: Path):
    run = latest_run(root)
    llama = llama_state()
    git, git_total = git_status(repo)
    actors = actor_registry()
    spans = process_spans(mcp)
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
    }

    timeline = parse_commands(commands)
    timeline += parse_custom_actor_events(actors)
    mcp_events, mcp_last = parse_mcp_history(mcp)
    timeline += mcp_events

    if run:
        report = load_json(run / "report.json")
        oc_events, oc_last, oc_count = parse_opencode(run / "events.log")
        timeline += oc_events
        data["oc_count"] = oc_count
        data["last_event"] = max(x for x in (oc_last, mcp_last) if x is not None) if any(x is not None for x in (oc_last, mcp_last)) else None
        if report:
            status = report.get("status", "unknown")
            data["run_opencode"] = report.get("opencode_version") or "legacy/unknown"
            data["state"] = "DONE" if status == "artifact_ready_for_review" else "FAILED"
            data["detail"] = f"{status} exit={report.get('exit')} elapsed={report.get('seconds')}s edits={report.get('confirmed_edit_tools', [])}"
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

    data["timeline"] = sorted(timeline, key=lambda x: x["ts"])
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
    if "BUSY" in data["llama"]:
        return "LLAMA"
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
    merged = d["timeline"][-300:]
    active = active_source(d, merged)
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
        "actors": d.get("actors", BUILTIN_ACTORS),
        "spans": d.get("spans", [])[-40:],
        "timeline": merged,
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
