#!/usr/bin/env bash
# Mantém túnel público com URL ESTÁVEL (subdomínio fixo no localtunnel)
# e só republica api-base.json quando a URL saudável muda.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FIXED_LT="https://fazendas-apuracao-2026.loca.lt"
API_FILE="$ROOT/api-base.json"
WATCH=/tmp/public-tunnel-watch.log
LT_LOG=/tmp/localtunnel-fixed.log
LHR_LOG=/tmp/lhr-backup.log
LHR_URL_FILE=/tmp/lhr-current.url
LAST_PUB=/tmp/api-base.last-published
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
prev = {}
try:
    prev = json.load(open(path))
except Exception:
    pass
# não reescreve se api_base/fallbacks iguais (evita spam de commit)
if prev.get("api_base") == primary and prev.get("fallbacks") == fb:
    print("unchanged")
    raise SystemExit(0)
doc = {
  "api_base": primary,
  "fallbacks": fb,
  "updated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
  "note": "Atualizado automaticamente pelo watchdog do túnel. O HTML em GitHub Pages lê este arquivo.",
}
open(path, "w").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("changed")
PY
}

publish_api_base_if_changed() {
  # Publica api-base sem depender do branch de trabalho (evita non-fast-forward).
  # 1) live-snapshot (fresco no raw)  2) main (Pages, com atraso de CDN)
  local tmp=/tmp/api-base-publish
  local url
  url=$(git -C "$ROOT" remote get-url origin)
  rm -rf "$tmp"
  mkdir -p "$tmp"
  (
    cd "$tmp" || exit 1
    git init -q
    git checkout -q -b live-snapshot
    # pega dados atuais do tip se existirem
    git fetch -q --depth 1 "$url" live-snapshot 2>/dev/null || true
    git checkout -q FETCH_HEAD -- . 2>/dev/null || true
    cp "$API_FILE" api-base.json
    # garante arquivos mínimos
    [ -f apuracao-live.json ] || echo '{}' > apuracao-live.json
    [ -f br-oficial.json ] || echo '{}' > br-oficial.json
    [ -f README.md ] || echo 'live' > README.md
    git add api-base.json apuracao-live.json br-oficial.json README.md
    git -c user.email="tunnel-watchdog@localhost" -c user.name="tunnel-watchdog" \
      commit -q -m "live: api-base" 2>/dev/null || true
    datasha=$(git rev-parse HEAD)
    printf '%s\n' "$datasha" > rev
    git add rev
    git -c user.email="tunnel-watchdog@localhost" -c user.name="tunnel-watchdog" \
      commit -q -m "live: rev $datasha" 2>/dev/null || true
    timeout 40 git push -q -f "$url" "HEAD:refs/heads/live-snapshot" || {
      log "warn: push live-snapshot api-base falhou"
      exit 1
    }
  ) || return 0

  # main: commit só do arquivo via clone raso
  rm -rf "$tmp-main"
  if git clone -q --depth 1 --branch main "$url" "$tmp-main" 2>/dev/null; then
    cp "$API_FILE" "$tmp-main/api-base.json"
    (
      cd "$tmp-main" || exit 0
      git add api-base.json
      if git diff --cached --quiet; then exit 0; fi
      git -c user.email="tunnel-watchdog@localhost" -c user.name="tunnel-watchdog" \
        commit -q -m "chore: atualizar api-base do túnel público"
      timeout 40 git push -q origin main || log "warn: push main api-base falhou"
    )
  fi
  log "published api-base.json -> live-snapshot + main"
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
  rm -f "$LHR_URL_FILE"
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

log "watchdog start fixed=$FIXED_LT"
LT_FAIL=0
while true; do
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
  # Prefere LHR quando saudável (mais rápido/estável); loca.lt sempre nos fallbacks.
  if [ "$LHR_CODE" = "200" ] && [ -n "$LHR" ]; then
    PRIMARY="$LHR"
    FB+=("$FIXED_LT")
    LT_FAIL=0
  elif [ "$LT_CODE" = "200" ]; then
    PRIMARY="$FIXED_LT"
    [ -n "$LHR" ] && FB+=("$LHR")
    LT_FAIL=0
  else
    LT_FAIL=$((LT_FAIL+1))
    log "no healthy tunnel lt=$LT_CODE lhr=$LHR_CODE — restart both"
    pkill -f 'localtunnel --port 3001 --subdomain fazendas-apuracao-2026' 2>/dev/null || true
    pkill -f 'nokey@localhost.run' 2>/dev/null || true
    rm -f "$LHR_URL_FILE"
    sleep 3
    continue
  fi
  if [ "$LT_CODE" != "200" ]; then
    log "loca.lt unhealthy ($LT_CODE) — primary=$PRIMARY"
    pkill -f 'localtunnel --port 3001 --subdomain fazendas-apuracao-2026' 2>/dev/null || true
  fi

  out=$(write_api_base "$PRIMARY" "${FB[@]:-}" || true)
  if echo "$out" | rg -q '^changed$'; then
    publish_api_base_if_changed
  fi
  cp "$API_FILE" /tmp/api-base.json 2>/dev/null || true
  log "ok primary=$PRIMARY lt=$LT_CODE lhr=$LHR_CODE"
  sleep 15
done
