#!/usr/bin/env bash
# Publica apuracao-live.json na branch órfã live-snapshot (force-push).
# /rev = SHA do commit dos dados. HTML descobre o tip via atom feed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WATCH=/tmp/live-snapshot-watch.log
WORK=/tmp/live-snapshot-work
BRANCH=live-snapshot
API=http://127.0.0.1:3001/api/eleicoes/2026/apuracao
LAST_SIG=/tmp/live-snapshot.sig
LAST_PUB_AT=0

log(){ echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$WATCH"; }

slim_payload() {
  python3 - "$1" "$2" <<'PY'
import json, sys, datetime
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
keys_e = [
  'uf','nome','regiao','pct_secoes','pct_falta','peso_nacional_restante',
  'flavio_pct','lula_pct','flavio_votos','lula_votos','votos_validos',
  'proj_flavio_pct_final','proj_lula_pct_final','impacto_margem_nacional_pp',
  'w_hist','hist','lider','margem','fonte_parcial','secoes_totalizadas','secoes_total'
]
ex_keys = [
  'ok','pendente','erro','fonte','capturado_em','secoes_com_bu','secoes_config',
  'flavio_votos','lula_votos','flavio_pct','lula_pct','margem','votos_validos',
  'branco','nulo','aplicado_no_zz','nota','cidades'
]
ex = d.get('exterior') or {}
exterior = None
if ex:
  exterior = {k: ex.get(k) for k in ex_keys}
  if exterior.get('cidades'):
    exterior['cidades'] = exterior['cidades'][:40]
out = {
  'ok': d.get('ok'),
  'capturado_em': d.get('capturado_em'),
  'publicado_em': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]+'Z',
  'fonte': d.get('fonte'),
  'refresh_sugerido_ms': 5000,
  'avisos': d.get('avisos') or [],
  'nacional_parcial': d.get('nacional_parcial'),
  'nacional_projetado': d.get('nacional_projetado'),
  'br_oficial': d.get('br_oficial'),
  'regioes': d.get('regioes'),
  'estados': [{k: e.get(k) for k in keys_e} for e in (d.get('estados') or [])],
  'exterior': exterior,
  'modo': 'snapshot-github',
}
open(dst,'w').write(json.dumps(out, ensure_ascii=False, separators=(',',':')))
sig = {
  'p': (out.get('nacional_parcial') or {}).get('votos_validos'),
  'pf': round(((out.get('nacional_projetado') or {}).get('flavio_pct') or 0), 3),
  'pl': round(((out.get('nacional_projetado') or {}).get('lula_pct') or 0), 3),
  'nf': (out.get('nacional_parcial') or {}).get('flavio_votos'),
  'nl': (out.get('nacional_parcial') or {}).get('lula_votos'),
  'ps': round(((out.get('nacional_parcial') or {}).get('pct_secoes') or 0), 3),
  'ex': (out.get('exterior') or {}).get('secoes_com_bu'),
  'ef': (out.get('exterior') or {}).get('flavio_votos'),
  'el': (out.get('exterior') or {}).get('lula_votos'),
}
print(json.dumps(sig, sort_keys=True))
PY
}

publish_once() {
  local raw=/tmp/apuracao-raw.json
  local slim=/tmp/apuracao-live.json
  if ! curl -sS --max-time 20 "$API?refresh=1" -o "$raw"; then
    log "api_fail"
    return 1
  fi
  local sig now pct
  sig=$(slim_payload "$raw" "$slim") || return 1
  now=$(date +%s)
  pct=$(python3 -c "import json;print(json.load(open('$raw')).get('nacional_parcial',{}).get('pct_secoes') or 0)")
  # Em apuração (>0%), republica no máx. a cada 15s mesmo se “igual”
  local max_skip=15
  if python3 -c "import sys; sys.exit(0 if float('$pct')>0 else 1)"; then
    max_skip=15
  else
    max_skip=45
  fi
  if [ -f "$LAST_SIG" ] && [ "$(cat "$LAST_SIG")" = "$sig" ] && [ $((now - LAST_PUB_AT)) -lt "$max_skip" ]; then
    log "unchanged pct=$pct"
    return 0
  fi

  rm -rf "$WORK"
  mkdir -p "$WORK"
  cp "$slim" "$WORK/apuracao-live.json"
  printf '%s\n' 'Live apuração snapshot (SHA pointer in /rev).' > "$WORK/README.md"

  (
    cd "$WORK"
    git init -q
    git checkout -q -b "$BRANCH"
    git -c user.email="live-snapshot@localhost" -c user.name="live-snapshot" add apuracao-live.json README.md
    git -c user.email="live-snapshot@localhost" -c user.name="live-snapshot" commit -q -m "live: data"
    datasha=$(git rev-parse HEAD)
    printf '%s\n' "$datasha" > rev
    git -c user.email="live-snapshot@localhost" -c user.name="live-snapshot" add rev
    git -c user.email="live-snapshot@localhost" -c user.name="live-snapshot" commit -q -m "live: rev $datasha"
    # timeout evita hang de horas no push
    if ! timeout 45 git push -q -f "$(git -C "$ROOT" remote get-url origin)" "HEAD:refs/heads/$BRANCH"; then
      log "push_timeout_or_fail"
      exit 1
    fi
    echo "$datasha" > /tmp/live-snapshot.last-sha
  ) || { log "push_fail"; return 1; }

  # purge em background — não bloqueia o loop
  ( curl -sS --max-time 8 "https://purge.jsdelivr.net/gh/fazendasup/fazendas-up@live-snapshot/rev" >/dev/null 2>&1 || true
    curl -sS --max-time 8 "https://purge.jsdelivr.net/gh/fazendasup/fazendas-up@live-snapshot/apuracao-live.json" >/dev/null 2>&1 || true ) &

  echo "$sig" > "$LAST_SIG"
  LAST_PUB_AT=$now
  log "published sha=$(cat /tmp/live-snapshot.last-sha 2>/dev/null) pct=$pct $sig"
}

log "snapshot publisher start"
while true; do
  if curl -sS -o /dev/null --max-time 3 http://127.0.0.1:3001/api/eleicoes/2026/health; then
    publish_once || true
  else
    log "server_down"
  fi
  sleep 8
done
