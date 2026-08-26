#!/bin/bash
# Launch Chrome with remote debugging enabled.
# Usage: chrome-launcher.sh [start|stop|status] [--port PORT] [--headless]
#
# Manages a Chrome instance for CDP-based verification.

set -euo pipefail

PORT="${CDP_PORT:-9222}"
HEADLESS=false
ACTION="start"
CHROME_PID_FILE="/tmp/chrome-cdp-verify.pid"
CHROME_USER_DATA="/tmp/chrome-cdp-profile"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    start|stop|status) ACTION="$1"; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --headless) HEADLESS=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Find Chrome binary
find_chrome() {
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  # Try PATH
  for name in google-chrome chromium-browser chromium chrome; do
    if command -v "$name" &>/dev/null; then
      command -v "$name"
      return 0
    fi
  done
  echo "ERROR: Chrome not found" >&2
  return 1
}

do_start() {
  # Check if already running
  if [[ -f "$CHROME_PID_FILE" ]]; then
    local pid
    pid=$(cat "$CHROME_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "{\"status\":\"already_running\",\"pid\":$pid,\"port\":$PORT}"
      return 0
    fi
    rm -f "$CHROME_PID_FILE"
  fi

  local chrome
  chrome=$(find_chrome)

  local args=(
    "--remote-debugging-port=$PORT"
    "--user-data-dir=$CHROME_USER_DATA"
    "--no-first-run"
    "--no-default-browser-check"
    "--disable-background-networking"
    "--disable-sync"
    "--disable-extensions"
    "--disable-translate"
  )

  if $HEADLESS; then
    args+=("--headless=new")
  fi

  "$chrome" "${args[@]}" &>/dev/null &
  local pid=$!
  echo "$pid" > "$CHROME_PID_FILE"

  # Wait for CDP to become available
  local retries=0
  while ! curl -s "http://127.0.0.1:$PORT/json/version" &>/dev/null; do
    retries=$((retries + 1))
    if [[ $retries -ge 30 ]]; then
      echo "{\"status\":\"error\",\"message\":\"Chrome failed to start within 15s\"}" >&2
      return 1
    fi
    sleep 0.5
  done

  local ws_url
  ws_url=$(curl -s "http://127.0.0.1:$PORT/json/version" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try { console.log(JSON.parse(d).webSocketDebuggerUrl); }
      catch(e) { console.log('unknown'); }
    });
  ")

  echo "{\"status\":\"started\",\"pid\":$pid,\"port\":$PORT,\"headless\":$HEADLESS,\"wsUrl\":\"$ws_url\"}"
}

do_stop() {
  if [[ -f "$CHROME_PID_FILE" ]]; then
    local pid
    pid=$(cat "$CHROME_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
      rm -f "$CHROME_PID_FILE"
      echo "{\"status\":\"stopped\",\"pid\":$pid}"
      return 0
    fi
    rm -f "$CHROME_PID_FILE"
  fi
  echo "{\"status\":\"not_running\"}"
}

do_status() {
  if [[ -f "$CHROME_PID_FILE" ]]; then
    local pid
    pid=$(cat "$CHROME_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "{\"status\":\"running\",\"pid\":$pid,\"port\":$PORT}"
      return 0
    fi
    rm -f "$CHROME_PID_FILE"
  fi
  echo "{\"status\":\"not_running\"}"
}

case "$ACTION" in
  start) do_start ;;
  stop) do_stop ;;
  status) do_status ;;
esac
