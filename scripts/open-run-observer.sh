#!/bin/zsh
# Reuse exactly one Terminal window for Browser Bridge Observer.
# Does not touch unrelated Terminal windows or shells.

TITLE="Browser Bridge Observer"
REPO="/Users/dzzk/WORK/_bridge-local-execution"
CMD="cd $REPO && python3 scripts/run-observer.py"

if pgrep -f "python3 scripts/run-observer.py" >/dev/null 2>&1; then
  /usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  repeat with w in windows
    set t to selected tab of w
    if custom title of t is "$TITLE" then
      set frontmost of w to true
      activate
      return
    end if
  end repeat
end tell
APPLESCRIPT
  exit 0
fi

/usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  repeat with w in windows
    set t to selected tab of w
    if custom title of t is "$TITLE" then
      close w
      exit repeat
    end if
  end repeat
  set t to do script "$CMD"
  set custom title of t to "$TITLE"
  activate
end tell
APPLESCRIPT
