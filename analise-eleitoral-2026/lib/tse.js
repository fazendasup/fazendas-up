const https = require('https');
const { historicoUf } = require('./historico');

const ELEICAO = '6257';
const CARGO = '0001';
const UFS = [
  'ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt',
  'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to',
];

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
  return `https://resultados.tse.jus.br/oficial/ele2026/${ELEICAO}/dados/${u}/${u}-c${CARGO}-e00${ELEICAO}-u.json`;
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
 * Busca BR + 27 UFs em paralelo (com limite de concorrência simples).
 */
async function capturarTse() {
  const alvos = ['br', ...UFS];
  const resultados = [];
  const erros = [];

  // lotes maiores — captura completa mais rápida para polling em ms
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

  const br = resultados.find((r) => r.uf === 'BR');
  const ufs = resultados.filter((r) => r.uf !== 'BR');
  if (!br) throw new Error('Falha ao obter totalização nacional do TSE');

  return { br, ufs, erros, capturado_em: new Date().toISOString() };
}

module.exports = {
  ELEICAO,
  capturarTse,
  parseAbrangencia,
  extractCands,
  ufUrl,
};
