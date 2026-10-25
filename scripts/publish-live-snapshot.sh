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
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys, datetime
src, dst, br_dst = sys.argv[1], sys.argv[2], sys.argv[3]
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
np = d.get('nacional_parcial') or {}
br = d.get('br_oficial') or {}
# Garante placar = BR oficial (nunca soma UFs no snapshot público)
if br.get('votos_validos') and (np.get('fonte') != 'tse_br_oficial' or (np.get('votos_validos') or 0) < (br.get('votos_validos') or 0)):
  np = {
    'fonte': 'tse_br_oficial',
    'pct_secoes': br.get('pct_secoes') or 0,
    'pct_falta': max(0, 100 - (br.get('pct_secoes') or 0)),
    'atualizado': br.get('atualizado') or '',
    'flavio_pct': br.get('flavio_pct') or 0,
    'lula_pct': br.get('lula_pct') or 0,
    'flavio_votos': br.get('flavio_votos') or 0,
    'lula_votos': br.get('lula_votos') or 0,
    'margem': (br.get('flavio_pct') or 0) - (br.get('lula_pct') or 0),
    'votos_validos': br.get('votos_validos') or 0,
  }
elif np.get('fonte') == 'agregacao_ufs_zz' or np.get('fonte') == 'agregacao_ufs':
  np = {
    'fonte': 'indisponivel',
    'pct_secoes': 0, 'pct_falta': 100, 'atualizado': '',
    'flavio_pct': 0, 'lula_pct': 0, 'flavio_votos': 0, 'lula_votos': 0,
    'margem': 0, 'votos_validos': 0,
  }
out = {
  'ok': d.get('ok'),
  'capturado_em': d.get('capturado_em'),
  'publicado_em': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]+'Z',
  'fonte': d.get('fonte'),
  'refresh_sugerido_ms': 5000,
  'avisos': d.get('avisos') or [],
  'nacional_parcial': np,
  'nacional_projetado': d.get('nacional_projetado'),
  'br_oficial': br or None,
  'regioes': d.get('regioes'),
  'estados': [{k: e.get(k) for k in keys_e} for e in (d.get('estados') or [])],
  'exterior': exterior,
  'modo': 'snapshot-github',
}
open(dst,'w').write(json.dumps(out, ensure_ascii=False, separators=(',',':')))
# Espelho mínimo do BR — o HTML no Pages usa isto como fonte do placar
br_out = {
  'fonte': 'tse_br_oficial',
  'atualizado': np.get('atualizado') or br.get('atualizado') or '',
  'pct_secoes': np.get('pct_secoes') or br.get('pct_secoes') or 0,
  'pct_falta': np.get('pct_falta') if np.get('pct_falta') is not None else max(0, 100 - (br.get('pct_secoes') or 0)),
  'flavio_pct': np.get('flavio_pct') or br.get('flavio_pct') or 0,
  'lula_pct': np.get('lula_pct') or br.get('lula_pct') or 0,
  'flavio_votos': np.get('flavio_votos') or br.get('flavio_votos') or 0,
  'lula_votos': np.get('lula_votos') or br.get('lula_votos') or 0,
  'margem': (np.get('flavio_pct') or br.get('flavio_pct') or 0) - (np.get('lula_pct') or br.get('lula_pct') or 0),
  'votos_validos': np.get('votos_validos') or br.get('votos_validos') or 0,
  'publicado_em': out['publicado_em'],
}
open(br_dst,'w').write(json.dumps(br_out, ensure_ascii=False, separators=(',',':')))
# Só republica quando o PLACAR (votos/seções) ou exterior muda.
# Projeção oscila a cada ciclo e gerava force-push inútil → atom/CDN intercalavam SHAs velhos.
sig = {
  'p': (out.get('nacional_parcial') or {}).get('votos_validos'),
  'nf': (out.get('nacional_parcial') or {}).get('flavio_votos'),
  'nl': (out.get('nacional_parcial') or {}).get('lula_votos'),
  'ps': round(((out.get('nacional_parcial') or {}).get('pct_secoes') or 0), 3),
  'ht': (out.get('nacional_parcial') or {}).get('atualizado') or '',
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
  local brjson=/tmp/br-oficial.json
  if ! curl -sS --max-time 20 "$API?refresh=1" -o "$raw"; then
    log "api_fail"
    return 1
  fi
  local sig now pct
  sig=$(slim_payload "$raw" "$slim" "$brjson") || return 1
  now=$(date +%s)
  pct=$(python3 -c "import json;print(json.load(open('$raw')).get('nacional_parcial',{}).get('pct_secoes') or 0)")
  # NÃO republicar se o placar (sig) é idêntico — force-push a cada 15s criava
  # SHAs novos com os mesmos votos e o celular intercalava versão velha/nova.
  if [ -f "$LAST_SIG" ] && [ "$(cat "$LAST_SIG")" = "$sig" ]; then
    log "unchanged pct=$pct"
    return 0
  fi
  # Heartbeat raro (10 min) só se nunca publicou nesta sessão
  if [ "$LAST_PUB_AT" -gt 0 ] && [ $((now - LAST_PUB_AT)) -lt 8 ]; then
    # rate-limit mínimo entre pushes distintos
    log "rate_limit pct=$pct"
    return 0
  fi

  rm -rf "$WORK"
  mkdir -p "$WORK"
  cp "$slim" "$WORK/apuracao-live.json"
  cp "$brjson" "$WORK/br-oficial.json"
  printf '%s\n' 'Live apuração snapshot (SHA pointer in /rev). br-oficial.json = placar BR TSE.' > "$WORK/README.md"

  (
    cd "$WORK"
    git init -q
    git checkout -q -b "$BRANCH"
    git -c user.email="live-snapshot@localhost" -c user.name="live-snapshot" add apuracao-live.json br-oficial.json README.md
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
    curl -sS --max-time 8 "https://purge.jsdelivr.net/gh/fazendasup/fazendas-up@live-snapshot/apuracao-live.json" >/dev/null 2>&1 || true
    curl -sS --max-time 8 "https://purge.jsdelivr.net/gh/fazendasup/fazendas-up@live-snapshot/br-oficial.json" >/dev/null 2>&1 || true ) &

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
