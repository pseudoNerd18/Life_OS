#!/usr/bin/env bash
# Stop local dev servers.
#
#   npm run kill              # default ports + known dev-server process patterns
#   npm run kill -- 3010      # only what is listening on the given port(s)
#   npm run kill -- --dry-run # show what would be killed, kill nothing
#
# Never touches anything with "claude" in its command line, or this script itself.

set -uo pipefail

SELF=$$
DEFAULT_PORTS="3000 3001 3010 4000 5173 8000 8848"
PATTERNS='next-server|next dev|npm run dev|nodemon|vite|uvicorn|prisma studio|tsx watch'

DRY=0
PORTS=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *[!0-9]*) echo "kill-servers: ignoring unrecognized argument '$arg'" >&2 ;;
    *) PORTS="$PORTS $arg" ;;
  esac
done

# Explicit ports mean "only these ports"; otherwise scan defaults AND match patterns.
BY_PATTERN=1
if [ -n "$PORTS" ]; then BY_PATTERN=0; else PORTS="$DEFAULT_PORTS"; fi

PIDS=""

collect() {
  local pid="$1" cmd
  case "$pid" in ''|*[!0-9]*) return ;; esac
  [ "$pid" = "$SELF" ] && return
  [ "$pid" = "$PPID" ] && return
  cmd=$(ps -o command= -p "$pid" 2>/dev/null)
  [ -z "$cmd" ] && return
  case "$cmd" in *claude*) return ;; esac
  case " $PIDS " in *" $pid "*) return ;; esac
  PIDS="$PIDS $pid"
}

for port in $PORTS; do
  while read -r pid; do collect "$pid"; done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)
done

if [ "$BY_PATTERN" = 1 ]; then
  while read -r pid; do collect "$pid"; done < <(pgrep -f "$PATTERNS" 2>/dev/null)
fi

# A port's listener is usually a child of a supervisor ("npm run dev", "next dev").
# Walk up and take any ancestor that is itself a dev-server process.
for pid in $PIDS; do
  cur="$pid"
  for _ in 1 2 3; do
    parent=$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')
    case "$parent" in ''|0|1) break ;; esac
    ps -o command= -p "$parent" 2>/dev/null | grep -Eq "$PATTERNS" || break
    collect "$parent"
    cur="$parent"
  done
done

if [ -z "${PIDS// /}" ]; then
  echo "No dev servers running."
  exit 0
fi

for pid in $PIDS; do
  printf '%s  %s\n' "$pid" "$(ps -o command= -p "$pid" 2>/dev/null | cut -c1-100)"
done

if [ "$DRY" = 1 ]; then
  echo "(dry run — nothing killed)"
  exit 0
fi

kill $PIDS 2>/dev/null

# Give them a moment to exit, then force whatever is left.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  LEFT=""
  for pid in $PIDS; do
    kill -0 "$pid" 2>/dev/null && LEFT="$LEFT $pid"
  done
  [ -z "${LEFT// /}" ] && break
  sleep 0.3
done

if [ -n "${LEFT// /}" ]; then
  echo "Force-killing:$LEFT"
  kill -9 $LEFT 2>/dev/null
fi

echo "Stopped."
