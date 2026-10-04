const https = require('https');
const { historicoUf } = require('./historico');

const ELEICAO = '6257';
const CARGO = '0001';
const UFS = [
  'ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt',
  'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to',
];

/** Melhor snapshot conhecido por UF (evita “votos descendo” por CDN inconsistente). */
const melhorPorUf = new Map();

function pct(s) {
  if (s == null) return 0;
  let t = String(s).trim();
  if (!t) return 0;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '');
  return Number(t.replace(',', '.')) || 0;
}

function num(s) {
  if (s == null) return 0;
  return Number(String(s).replace(/[.\s]/g, '').replace(',', '')) || 0;
}

function fetchJson(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'fazendas-up-apuracao/1.0',
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout ${url}`));
    });
  });
}

function ufUrl(uf) {
  const u = uf.toLowerCase();
  // bust de cache da CDN Akamai (evita misturar versões velhas/novas entre UFs)
  const bust = Date.now().toString(36);
  return `https://resultados.tse.jus.br/oficial/ele2026/${ELEICAO}/dados/${u}/${u}-c${CARGO}-e00${ELEICAO}-u.json?_=${bust}`;
}

function extractCands(d) {
  const cands = [];
  for (const cargo of d.carg || []) {
    const pools = [...(cargo.agr || []), ...(cargo.fed || [])];
    for (const agr of pools) {
      for (const par of agr.par || []) {
        for (const c of par.cand || []) {
          cands.push({
            numero: c.n,
            nome: c.nmu || c.nm,
            partido: par.sg || agr.com || agr.sg,
            votos: num(c.vap),
            pct: pct(c.pvap),
          });
        }
      }
    }
  }
  const by = {};
  for (const c of cands) by[c.numero] = c;
  return Object.values(by).sort((a, b) => b.votos - a.votos);
}

function parseAbrangencia(d) {
  const cands = extractCands(d);
  const flavio = cands.find((c) => c.numero === '22') || null;
  const lula = cands.find((c) => c.numero === '13') || null;
  const uf = String(d.cdabr || '').toUpperCase();

  return {
    uf,
    atualizado: `${d.dt || ''} ${d.ht || ''}`.trim(),
    gerado: `${d.dg || ''} ${d.hg || ''}`.trim(),
    pct_secoes: pct(d.s?.pst),
    secoes_totalizadas: num(d.s?.st),
    secoes_total: num(d.s?.ts),
    secoes_faltam: num(d.s?.snt),
    pct_falta: pct(d.s?.psnt),
    pct_eleitorado_apurado: pct(d.e?.pest),
    eleitorado_total: num(d.e?.te),
    eleitorado_apurado: num(d.e?.est),
    comparecimento: pct(d.e?.pc),
    abstencao: pct(d.e?.pa),
    votos_validos: num(d.v?.vv),
    votos_total: num(d.v?.tv),
    flavio_pct: flavio ? flavio.pct : 0,
    flavio_votos: flavio ? flavio.votos : 0,
    lula_pct: lula ? lula.pct : 0,
    lula_votos: lula ? lula.votos : 0,
    lider: flavio && lula && flavio.votos >= lula.votos ? 'Flávio' : 'Lula',
    margem: flavio && lula ? flavio.pct - lula.pct : 0,
    cands,
    hist: uf !== 'BR' ? historicoUf(uf) : null,
  };
}

/**
 * Aceita novo snapshot só se for mais avançado (seções/votos não regridem).
 * A CDN do TSE às vezes devolve UF “antiga” no meio de um lote paralelo.
 */
function ehMaisAvancado(novo, antigo) {
  if (!antigo) return true;
  if (novo.secoes_totalizadas > antigo.secoes_totalizadas) return true;
  if (novo.secoes_totalizadas < antigo.secoes_totalizadas) return false;

  if (novo.votos_validos > antigo.votos_validos) return true;
  if (novo.votos_validos < antigo.votos_validos) return false;

  // mesmo estágio: exige que nenhum candidato principal tenha caído
  if (novo.flavio_votos < antigo.flavio_votos) return false;
  if (novo.lula_votos < antigo.lula_votos) return false;
  if (novo.flavio_votos > antigo.flavio_votos || novo.lula_votos > antigo.lula_votos) {
    return true;
  }

  // empate total — usa horário do TSE
  return String(novo.atualizado || '') >= String(antigo.atualizado || '');
}

function mesclarMonotonico(parsedList) {
  const descartados = [];
  for (const row of parsedList) {
    const prev = melhorPorUf.get(row.uf);
    if (ehMaisAvancado(row, prev)) {
      melhorPorUf.set(row.uf, row);
    } else {
      descartados.push({
        uf: row.uf,
        recebido: {
          secoes: row.secoes_totalizadas,
          validos: row.votos_validos,
          atualizado: row.atualizado,
        },
        mantido: {
          secoes: prev.secoes_totalizadas,
          validos: prev.votos_validos,
          atualizado: prev.atualizado,
        },
      });
    }
  }
  return descartados;
}

/**
 * Busca BR + 27 UFs em paralelo e aplica merge monotônico.
 */
async function capturarTse() {
  const alvos = ['br', ...UFS];
  const resultados = [];
  const erros = [];

  for (let i = 0; i < alvos.length; i += 14) {
    const lote = alvos.slice(i, i + 14);
    const settled = await Promise.allSettled(
      lote.map(async (uf) => {
        const raw = await fetchJson(ufUrl(uf));
        return parseAbrangencia(raw);
      })
    );
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === 'fulfilled') resultados.push(r.value);
      else erros.push({ uf: lote[j].toUpperCase(), erro: String(r.reason?.message || r.reason) });
    }
  }

  const descartados = mesclarMonotonico(resultados);

  // Monta saída a partir do melhor conhecido (não do lote cru)
  const br = melhorPorUf.get('BR');
  const ufs = UFS.map((u) => melhorPorUf.get(u.toUpperCase())).filter(Boolean);

  if (!br && ufs.length < 20) {
    throw new Error('Falha ao obter totalização do TSE');
  }

  // Se BR falhou neste ciclo mas UFs ok, sintetiza BR mínimo a partir do store
  const brOut =
    br ||
    ({
      uf: 'BR',
      atualizado: ufs[0]?.atualizado || '',
      pct_secoes: 0,
      secoes_totalizadas: 0,
      secoes_total: 0,
      votos_validos: 0,
      flavio_pct: 0,
      flavio_votos: 0,
      lula_pct: 0,
      lula_votos: 0,
      margem: 0,
      comparecimento: null,
      cands: [],
      hist: null,
    });

  return {
    br: brOut,
    ufs,
    erros,
    descartados_cdn: descartados,
    capturado_em: new Date().toISOString(),
    monotonic: true,
  };
}

function resetMonotonicStore() {
  melhorPorUf.clear();
}

module.exports = {
  ELEICAO,
  capturarTse,
  parseAbrangencia,
  extractCands,
  ufUrl,
  ehMaisAvancado,
  resetMonotonicStore,
};
