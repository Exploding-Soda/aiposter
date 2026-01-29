#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
LOG_DIR="$ROOT_DIR/deploy-logs"

mkdir -p "$LOG_DIR"

info() {
  echo "[deploy] $*"
}

die() {
  echo "[deploy] ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$env_file"
    set +a
  fi
}

kill_pid_file() {
  local pid_file="$1"
  local label="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" || true)"
    if [[ -n "${pid}" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      info "Stopping $label (pid $pid)"
      kill "$pid" >/dev/null 2>&1 || true
      local retries=10
      while kill -0 "$pid" >/dev/null 2>&1 && [[ $retries -gt 0 ]]; do
        sleep 0.5
        retries=$((retries - 1))
      done
      if kill -0 "$pid" >/dev/null 2>&1; then
        info "Force killing $label (pid $pid)"
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

kill_by_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"$port" || true)"
    if [[ -n "$pids" ]]; then
      info "Stopping processes on port $port: $pids"
      kill $pids >/dev/null 2>&1 || true
      sleep 1
      local still
      still="$(lsof -ti tcp:"$port" || true)"
      if [[ -n "$still" ]]; then
        kill -9 $still >/dev/null 2>&1 || true
      fi
    fi
  elif command -v fuser >/dev/null 2>&1; then
    info "Stopping processes on port $port (fuser)"
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
}

stop_processes() {
  local backend_port="$1"
  local frontend_port="$2"

  kill_pid_file "$LOG_DIR/backend.pid" "backend"
  kill_pid_file "$LOG_DIR/frontend.pid" "frontend"

  # Best-effort cleanup for orphaned processes.
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "uvicorn main:app" >/dev/null 2>&1 || true
    pkill -f "serve -s dist" >/dev/null 2>&1 || true
    pkill -f "python3 -m http.server ${frontend_port}" >/dev/null 2>&1 || true
    pkill -f "python -m http.server ${frontend_port}" >/dev/null 2>&1 || true
  fi

  kill_by_port "$backend_port"
  kill_by_port "$frontend_port"
}

usage() {
  cat <<EOF
Usage:
  ./deploy.sh start
  ./deploy.sh stop

Env overrides:
  BACKEND_PORT (default 8001)
  BACKEND_WORKERS (default 2)
  FRONTEND_PORT (default 3000)
EOF
}

MODE="${1:-}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
BACKEND_WORKERS="${BACKEND_WORKERS:-2}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

case "$MODE" in
  start)
    info "Loading env files (if present)"
    load_env_file "$BACKEND_DIR/.env"

    info "Building frontend"
    require_cmd node
    if command -v pnpm >/dev/null 2>&1; then
      pushd "$FRONTEND_DIR" >/dev/null
      pnpm install --frozen-lockfile
      pnpm build
      popd >/dev/null
    else
      require_cmd npm
      pushd "$FRONTEND_DIR" >/dev/null
      npm install
      npm run build
      popd >/dev/null
    fi

    info "Setting up backend virtualenv"
    require_cmd python3
    if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
      python3 -m venv "$BACKEND_DIR/.venv"
    fi

    # shellcheck disable=SC1090
    source "$BACKEND_DIR/.venv/bin/activate"
    python -m pip install --upgrade pip
    python -m pip install -r "$BACKEND_DIR/requirements.txt"
    deactivate

    BACKEND_LOG="$LOG_DIR/backend.log"
    FRONTEND_LOG="$LOG_DIR/frontend.log"

    stop_processes "$BACKEND_PORT" "$FRONTEND_PORT"

    info "Starting backend on port $BACKEND_PORT"
    # shellcheck disable=SC1090
    source "$BACKEND_DIR/.venv/bin/activate"
    nohup uvicorn main:app \
      --host 0.0.0.0 \
      --port "$BACKEND_PORT" \
      --workers "$BACKEND_WORKERS" \
      > "$BACKEND_LOG" 2>&1 &
    echo $! > "$LOG_DIR/backend.pid"
    deactivate

    info "Starting frontend on port $FRONTEND_PORT"
    if command -v npx >/dev/null 2>&1; then
      pushd "$FRONTEND_DIR" >/dev/null
      nohup npx --yes serve -s dist -l "$FRONTEND_PORT" > "$FRONTEND_LOG" 2>&1 &
      echo $! > "$LOG_DIR/frontend.pid"
      popd >/dev/null
    else
      require_cmd python3
      pushd "$FRONTEND_DIR/dist" >/dev/null
      nohup python3 -m http.server "$FRONTEND_PORT" > "$FRONTEND_LOG" 2>&1 &
      echo $! > "$LOG_DIR/frontend.pid"
      popd >/dev/null
      info "Note: python http.server does not provide SPA fallback routes."
    fi

    info "Deployment complete."
    info "Backend log: $LOG_DIR/backend.log"
    info "Frontend log: $LOG_DIR/frontend.log"
    ;;
  stop)
    stop_processes "$BACKEND_PORT" "$FRONTEND_PORT"
    info "All related processes stopped."
    ;;
  *)
    usage
    exit 1
    ;;
esac
