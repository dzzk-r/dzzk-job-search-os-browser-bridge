#!/bin/zsh
# Project-local OpenCode version selector. Does not relink Homebrew or modify PATH.

BASE="$HOME/.local/share/opencode/versions"
SYSTEM="/opt/homebrew/bin/opencode"

usage() {
  cat <<'EOF'
Usage:
  scripts/opencode-vm.sh list
  scripts/opencode-vm.sh default
  scripts/opencode-vm.sh path VERSION
  scripts/opencode-vm.sh run VERSION [ARGS...]

Examples:
  scripts/opencode-vm.sh default
  scripts/opencode-vm.sh path 1.18.34
  scripts/opencode-vm.sh run 1.18.34 --version
EOF
}

normalize() {
  case "$1" in
    v*) print -r -- "$1" ;;
    *)  print -r -- "v$1" ;;
  esac
}

case "$1" in
  list)
    print "system -> $SYSTEM ($("$SYSTEM" --version 2>/dev/null))"
    if [ -d "$BASE" ]; then
      for d in "$BASE"/v*(N/); do
        b="$d/bin/opencode"
        if [ -x "$b" ]; then
          name=$(basename "$d")
          print "$name -> $b ($("$b" --version 2>/dev/null))"
        fi
      done
    fi
    ;;
  default)
    print -r -- "$SYSTEM"
    "$SYSTEM" --version
    ;;
  path)
    [ -n "$2" ] || { usage; exit 2; }
    v=$(normalize "$2")
    b="$BASE/$v/bin/opencode"
    [ -x "$b" ] || { print -u2 "not installed: $v"; exit 3; }
    print -r -- "$b"
    ;;
  run)
    [ -n "$2" ] || { usage; exit 2; }
    v=$(normalize "$2")
    b="$BASE/$v/bin/opencode"
    [ -x "$b" ] || { print -u2 "not installed: $v"; exit 3; }
    shift 2
    "$b" "$@"
    ;;
  *)
    usage
    exit 2
    ;;
esac
