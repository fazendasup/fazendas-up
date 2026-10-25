/**
 * Apuração antecipada do Exterior (ZZ) via boletins de urna (arquivo-urna).
 *
 * O arquivo consolidado zz-c0001-e006258-u.json só sobe depois das 17h (horário de Brasília).
 * Antes disso, os BUs já publicados em
 *   /ele2026/arquivo-urna/{pleito}/dados/zz/{mun}/{zona}/{secao}/...
 * permitem agregar a parcial internacional.
 */

const https = require('https');
const { historicoUf } = require('./historico');

const PLEITO = '3221';
const PAD = `p${Number(PLEITO).toString().padStart(6, '0')}`; // p003221
const ELEICAO = '6258';

let cache = {
  at: 0,
  payload: null,
  inflight: null,
  cfg: null,
  cfgAt: 0,
};

/** Cache “fresco” — depois disso ainda devolvemos stale e renovamos em background. */
const CACHE_TTL_MS = 90_000;
const CFG_TTL_MS = 30 * 60 * 1000;

function fetchBuf(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'fazendas-up-apuracao/1.0',
          Accept: '*/*',
          'Cache-Control': 'no-cache',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { code: res.statusCode }));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${url}`)));
  });
}

async function fetchJson(url, timeoutMs = 15000) {
  const buf = await fetchBuf(url, timeoutMs);
  return JSON.parse(buf.toString('utf8'));
}

function readIntBE(buf, offset, len) {
  if (len <= 0 || offset + len > buf.length) return 0;
  return buf.readUIntBE(offset, len);
}

/** Heurística estável no BU ASN.1 2026: tipo nominal + qtd + código 13/22. */
function parseBuVotes(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const out = { lula: 0, flavio: 0, branco: 0, nulo: 0 };
  for (let i = 0; i < data.length - 8; i++) {
    if (data[i] !== 0x81 || data[i + 1] !== 0x01) continue;
    const tipo = data[i + 2];
    if (data[i + 3] !== 0x82) continue;
    const qLen = data[i + 4];
    if (qLen < 1 || qLen > 4) continue;
    const q = readIntBE(data, i + 5, qLen);
    const after = i + 5 + qLen;
    if (tipo === 1) {
      // nominal: procura 02 01 0d/16 nos próximos bytes
      const tail = data.subarray(after, after + 40);
      const i13 = tail.indexOf(Buffer.from([0x02, 0x01, 0x0d]));
      const i22 = tail.indexOf(Buffer.from([0x02, 0x01, 0x16]));
      if (i13 >= 0 && (i22 < 0 || i13 < i22)) out.lula = q;
      else if (i22 >= 0) out.flavio = q;
    } else if (tipo === 2) out.branco = q;
    else if (tipo === 3) out.nulo = q;
  }
  return out;
}

function sectionIds(secObj) {
  const ids = new Set();
  if (secObj.ns != null) ids.add(String(secObj.ns).padStart(4, '0'));
  if (secObj.nsp != null) ids.add(String(secObj.nsp).padStart(4, '0'));
  for (const a of secObj.nsa || []) ids.add(String(a).padStart(4, '0'));
  return [...ids];
}

async function carregarConfigSecoes() {
  const agora = Date.now();
  if (cache.cfg && agora - cache.cfgAt < CFG_TTL_MS) return cache.cfg;
  const url = `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${PLEITO}/config/zz/zz-${PAD}-cs.json`;
  const cfg = await fetchJson(url, 20000);
  const jobs = [];
  for (const abr of cfg.abr || []) {
    for (const mu of abr.mu || []) {
      for (const z of mu.zon || []) {
        for (const s of z.sec || []) {
          for (const sec of sectionIds(s)) {
            jobs.push({ mun: mu.cd, nome: mu.nm, zona: z.cd, sec });
          }
        }
      }
    }
  }
  const uniq = new Map();
  for (const j of jobs) uniq.set(`${j.mun}-${j.zona}-${j.sec}`, j);
  cache.cfg = { jobs: [...uniq.values()], raw: cfg };
  cache.cfgAt = agora;
  return cache.cfg;
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function baixarSecao(job) {
  const { mun, nome, zona, sec } = job;
  const auxUrl =
    `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${PLEITO}/dados/zz/` +
    `${mun}/${zona}/${sec}/${PAD}-zz-m${mun}-z${zona}-s${sec}-aux.json`;
  let aux;
  try {
    aux = await fetchJson(auxUrl, 12000);
  } catch {
    return null;
  }
  const h = (aux.hashes || [])[0];
  if (!h?.hash) return null;
  const buName = (h.arq || []).find((a) => a.tp === 'bu' || String(a.nm || '').endsWith('-bu.dat'))?.nm;
  if (!buName) {
    return { nome, mun, zona, sec, st: aux.st, sem_bu: true };
  }
  const buUrl =
    `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${PLEITO}/dados/zz/` +
    `${mun}/${zona}/${sec}/${h.hash}/${buName}`;
  try {
    const raw = await fetchBuf(buUrl, 15000);
    const v = parseBuVotes(raw);
    return {
      nome,
      mun,
      zona,
      sec,
      st: aux.st,
      flavio: v.flavio,
      lula: v.lula,
      branco: v.branco,
      nulo: v.nulo,
      ok: true,
    };
  } catch (e) {
    return { nome, mun, zona, sec, st: aux.st, erro_bu: String(e.message || e) };
  }
}

function agregar(rows) {
  const byCity = new Map();
  let flavio = 0;
  let lula = 0;
  let branco = 0;
  let nulo = 0;
  let secoes = 0;
  for (const r of rows) {
    if (!r?.ok) continue;
    flavio += r.flavio;
    lula += r.lula;
    branco += r.branco;
    nulo += r.nulo;
    secoes += 1;
    const g = byCity.get(r.nome) || {
      nome: r.nome,
      mun: r.mun,
      flavio_votos: 0,
      lula_votos: 0,
      branco: 0,
      nulo: 0,
      secoes: 0,
    };
    g.flavio_votos += r.flavio;
    g.lula_votos += r.lula;
    g.branco += r.branco;
    g.nulo += r.nulo;
    g.secoes += 1;
    byCity.set(r.nome, g);
  }
  const validos = flavio + lula;
  const cidades = [...byCity.values()]
    .map((g) => {
      const v = g.flavio_votos + g.lula_votos;
      return {
        ...g,
        flavio_pct: v ? (100 * g.flavio_votos) / v : 0,
        lula_pct: v ? (100 * g.lula_votos) / v : 0,
        margem: v ? (100 * (g.flavio_votos - g.lula_votos)) / v : 0,
        lider: g.flavio_votos >= g.lula_votos ? 'Flávio' : 'Lula',
      };
    })
    .sort((a, b) => b.flavio_votos + b.lula_votos - (a.flavio_votos + a.lula_votos));

  return {
    flavio_votos: flavio,
    lula_votos: lula,
    branco,
    nulo,
    votos_validos: validos,
    flavio_pct: validos ? (100 * flavio) / validos : 0,
    lula_pct: validos ? (100 * lula) / validos : 0,
    margem: validos ? (100 * (flavio - lula)) / validos : 0,
    secoes_com_bu: secoes,
    cidades,
  };
}

/**
 * Converte agregado de BUs no formato de linha UF usado pela projeção.
 */
function comoLinhaUf(agg, secoesTotalOficial = 1351) {
  const hist = historicoUf('ZZ');
  const pct = secoesTotalOficial ? (100 * agg.secoes_com_bu) / secoesTotalOficial : 0;
  return {
    uf: 'ZZ',
    atualizado: agg.capturado_em || '',
    gerado: agg.capturado_em || '',
    pct_secoes: pct,
    secoes_totalizadas: agg.secoes_com_bu,
    secoes_total: secoesTotalOficial,
    secoes_faltam: Math.max(0, secoesTotalOficial - agg.secoes_com_bu),
    pct_falta: Math.max(0, 100 - pct),
    pct_eleitorado_apurado: null,
    eleitorado_total: hist ? undefined : undefined,
    comparecimento: null,
    abstencao: null,
    votos_validos: agg.votos_validos,
    votos_total: agg.votos_validos + agg.branco + agg.nulo,
    flavio_pct: agg.flavio_pct,
    flavio_votos: agg.flavio_votos,
    lula_pct: agg.lula_pct,
    lula_votos: agg.lula_votos,
    lider: agg.flavio_votos >= agg.lula_votos ? 'Flávio' : 'Lula',
    margem: agg.margem,
    cands: [
      { numero: '22', nome: 'FLAVIO BOLSONARO', partido: 'PL', votos: agg.flavio_votos, pct: agg.flavio_pct },
      { numero: '13', nome: 'LULA', partido: 'PT', votos: agg.lula_votos, pct: agg.lula_pct },
    ],
    hist,
    fonte_parcial: 'arquivo_urna_bu',
  };
}

function iniciarRefreshExterior() {
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    const { jobs } = await carregarConfigSecoes();
    const rows = await mapPool(jobs, 40, baixarSecao);
    const agg = agregar(rows);
    const payload = {
      ok: true,
      fonte: 'TSE arquivo-urna (boletins de urna do exterior)',
      pleito: PLEITO,
      eleicao: ELEICAO,
      capturado_em: new Date().toISOString(),
      secoes_config: jobs.length,
      ...agg,
      nota:
        'Parcial por BU. O consolidado oficial ZZ do TSE só entra na totalização nacional após as 17h (horário de Brasília).',
    };
    cache = { ...cache, at: Date.now(), payload, inflight: null };
    return payload;
  })().catch((err) => {
    cache.inflight = null;
    if (cache.payload) {
      return {
        ...cache.payload,
        stale: true,
        stale_error: String(err.message || err),
      };
    }
    throw err;
  });
  return cache.inflight;
}

/**
 * @param {boolean} force — só o endpoint /exterior?refresh=1 deve forçar espera
 * @param {{ wait?: boolean }} opts — wait:false (padrão) nunca bloqueia se já há cache
 */
async function capturarExteriorBu(force = false, opts = {}) {
  const wait = opts.wait === true || force;
  const agora = Date.now();

  if (!force && cache.payload && agora - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cache: { hit: true, age_ms: agora - cache.at } };
  }

  // Cache expirado, mas ainda útil: devolve na hora e renova em background
  if (!force && cache.payload?.votos_validos && !wait) {
    iniciarRefreshExterior().catch(() => {});
    return {
      ...cache.payload,
      stale: agora - cache.at >= CACHE_TTL_MS,
      cache: { hit: true, age_ms: agora - cache.at, refreshing: true },
    };
  }

  if (cache.inflight && !wait && cache.payload?.votos_validos) {
    return {
      ...cache.payload,
      stale: true,
      cache: { hit: true, age_ms: agora - cache.at, coalesced: true, refreshing: true },
    };
  }

  const payload = await iniciarRefreshExterior();
  return { ...payload, cache: { hit: false, age_ms: 0 } };
}

/**
 * Se o ZZ consolidado ainda está vazio e há BUs, substitui a linha ZZ.
 */
function mesclarZzComBu(ufs, exterior, secoesTotalHint) {
  if (!exterior?.votos_validos) return { ufs, aplicado: false };
  const idx = ufs.findIndex((u) => u.uf === 'ZZ');
  const atual = idx >= 0 ? ufs[idx] : null;
  const oficialTemVotos = (atual?.votos_validos || 0) > 0 && (atual?.pct_secoes || 0) > 0.5;
  if (oficialTemVotos) return { ufs, aplicado: false, motivo: 'zz_oficial_ok' };

  const linha = comoLinhaUf(
    exterior,
    atual?.secoes_total || secoesTotalHint || 1351
  );
  if (atual?.eleitorado_total) linha.eleitorado_total = atual.eleitorado_total;

  const next = ufs.slice();
  if (idx >= 0) next[idx] = { ...atual, ...linha, hist: atual.hist || linha.hist };
  else next.push(linha);
  return { ufs: next, aplicado: true };
}

function temCacheExterior() {
  return Boolean(cache.payload?.votos_validos);
}

module.exports = {
  PLEITO,
  capturarExteriorBu,
  mesclarZzComBu,
  comoLinhaUf,
  parseBuVotes,
  temCacheExterior,
};
