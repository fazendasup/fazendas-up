#!/usr/bin/env bash
# Mantém um túnel público com URL ESTÁVEL (subdomínio fixo no localtunnel)
# e publica api-base.json no branch do agente quando a URL saudável muda.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FIXED_LT="https://fazendas-apuracao-2026.loca.lt"
API_FILE="$ROOT/api-base.json"
WATCH=/tmp/public-tunnel-watch.log
LT_LOG=/tmp/localtunnel-fixed.log
LHR_LOG=/tmp/lhr-backup.log
LHR_URL_FILE=/tmp/lhr-current.url
BRANCH="${TUNNEL_PUBLISH_BRANCH:-cursor/analise-apuracao-flavio-lula-d913}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$WATCH"; }

write_api_base() {
  local primary="$1"
  shift
  local fb_json="[]"
  if [ "$#" -gt 0 ]; then
    fb_json=$(printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
  fi
  python3 - "$API_FILE" "$primary" "$fb_json" <<'PY'
import json, sys, datetime
path, primary, fb = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
doc = {
  "api_base": primary,
  "fallbacks": fb,
  "updated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
  "note": "Atualizado automaticamente pelo watchdog do túnel. O HTML em GitHub Pages lê este arquivo.",
}
open(path, "w").write(json.dumps(doc, indent=2) + "\n")
print(path, primary, fb)
PY
}

publish_api_base_if_changed() {
  git -C "$ROOT" add api-base.json
  if git -C "$ROOT" diff --cached --quiet; then
    return 0
  fi
  git -C "$ROOT" -c user.email="tunnel-watchdog@localhost" -c user.name="tunnel-watchdog" \
    commit -m "chore: atualizar api-base do túnel público" >/dev/null 2>&1 || true
  git -C "$ROOT" push origin "HEAD:$BRANCH" >/dev/null 2>&1 || log "warn: push api-base falhou"
  # espelha no main para GitHub Pages servir ./api-base.json também
  git -C "$ROOT" push origin "HEAD:main" >/dev/null 2>&1 || log "warn: push main api-base falhou"
  log "published api-base.json"
}

health() {
  local base="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 12 \
    -H 'Bypass-Tunnel-Reminder: 1' \
    "$base/api/eleicoes/2026/health" 2>/dev/null || echo 000
}

ensure_localtunnel() {
  if pgrep -f 'localtunnel --port 3001 --subdomain fazendas-apuracao-2026' >/dev/null 2>&1; then
    return 0
  fi
  log "starting fixed localtunnel"
  : > "$LT_LOG"
  npx --yes localtunnel --port 3001 --subdomain fazendas-apuracao-2026 --print-requests \
    >"$LT_LOG" 2>&1 &
  sleep 4
}

ensure_lhr_backup() {
  if pgrep -f 'nokey@localhost.run' >/dev/null 2>&1; then
    return 0
  fi
  log "starting lhr backup"
  : > "$LHR_LOG"
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -R 80:localhost:3001 nokey@localhost.run >"$LHR_LOG" 2>&1 &
  for i in $(seq 1 40); do
    u=$(rg -o 'https://[a-z0-9]+\.lhr\.life' "$LHR_LOG" 2>/dev/null | tail -1 || true)
    if [ -n "$u" ]; then
      echo "$u" > "$LHR_URL_FILE"
      log "lhr_up $u"
      return 0
    fi
    sleep 1
  done
  log "lhr_fail"
}

# loop principal
log "watchdog start fixed=$FIXED_LT"
while true; do
  # servidor local precisa estar no ar
  if ! curl -sS -o /dev/null --max-time 3 http://127.0.0.1:3001/api/eleicoes/2026/health; then
    log "local server down — waiting"
    sleep 5
    continue
  fi

  ensure_localtunnel
  ensure_lhr_backup

  LT_CODE=$(health "$FIXED_LT")
  LHR=""
  [ -f "$LHR_URL_FILE" ] && LHR=$(cat "$LHR_URL_FILE")
  LHR_CODE="000"
  [ -n "$LHR" ] && LHR_CODE=$(health "$LHR")

  PRIMARY=""
  FB=()
  if [ "$LT_CODE" = "200" ]; then
    PRIMARY="$FIXED_LT"
    [ "$LHR_CODE" = "200" ] && FB+=("$LHR")
  elif [ "$LHR_CODE" = "200" ]; then
    PRIMARY="$LHR"
    FB+=("$FIXED_LT")
    log "loca.lt unhealthy ($LT_CODE) — using lhr backup"
    # reinicia loca.lt se doente
    pkill -f 'localtunnel --port 3001 --subdomain fazendas-apuracao-2026' 2>/dev/null || true
  else
    log "no healthy tunnel lt=$LT_CODE lhr=$LHR_CODE — restart both"
    pkill -f 'localtunnel --port 3001 --subdomain fazendas-apuracao-2026' 2>/dev/null || true
    pkill -f 'nokey@localhost.run' 2>/dev/null || true
    rm -f "$LHR_URL_FILE"
    sleep 3
    continue
  fi

  write_api_base "$PRIMARY" "${FB[@]:-}"
  publish_api_base_if_changed
  log "ok primary=$PRIMARY lt=$LT_CODE lhr=$LHR_CODE"
  sleep 25
done
