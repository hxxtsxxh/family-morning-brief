#!/usr/bin/env bash
# start | stop | wait-whatsapp  — runs the OpenClaw gateway in the background for one job.
set -euo pipefail
LOG="${RUNNER_TEMP:-/tmp}/openclaw-gateway.log"
PIDFILE="${RUNNER_TEMP:-/tmp}/openclaw-gateway.pid"

case "${1:-}" in
  start)
    nohup openclaw gateway run > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    echo "gateway started (pid $(cat "$PIDFILE")), log: $LOG"
    ;;
  wait-whatsapp)
    # Wait until the WhatsApp account is linked and connected (max ~3 min).
    for i in $(seq 1 36); do
      out="$(openclaw channels status --channel whatsapp --probe --json 2>/dev/null || true)"
      if echo "$out" | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          try{const j=JSON.parse(s);const txt=JSON.stringify(j);
            const ok=/"connected"\s*:\s*true/.test(txt)||/"status"\s*:\s*"(connected|open|ready)"/.test(txt);
            process.exit(ok?0:1)}catch{process.exit(1)}})'; then
        echo "WhatsApp connected after ~$((i*5))s"
        exit 0
      fi
      sleep 5
    done
    echo "::error::WhatsApp did not connect. Last status:"; echo "$out" | head -c 2000; echo
    echo "--- gateway log tail ---"; tail -n 60 "$LOG" || true
    exit 1
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; sleep 3; fi
    echo "--- gateway log tail ---"; tail -n 40 "$LOG" 2>/dev/null || true
    ;;
  *) echo "usage: $0 start|wait-whatsapp|stop" >&2; exit 2 ;;
esac
