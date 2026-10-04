const { capturarTse } = require('./tse');
const { projetarNacional } = require('./projecao');

/** Cache em memória para não martelar o TSE a cada cliente. */
let cache = {
  at: 0,
  payload: null,
  error: null,
  inflight: null,
};

/** Cache curto para polling em tempo quase real (ms). */
const CACHE_TTL_MS = 350;

/** Marca d'água nacional — nunca devolve parcial com menos votos/seções que a anterior. */
let marcaDagua = null;

function aplicarMarcaDagua(payload) {
  const p = payload.nacional_parcial;
  if (!p) return payload;
  if (!marcaDagua) {
    marcaDagua = {
      secoes: p.pct_secoes,
      validos: p.votos_validos,
      flavio: p.flavio_votos,
      lula: p.lula_votos,
    };
    return payload;
  }
  const regrediu =
    p.votos_validos < marcaDagua.validos ||
    p.flavio_votos < marcaDagua.flavio ||
    p.lula_votos < marcaDagua.lula;

  if (regrediu && cache.payload?.nacional_parcial) {
    // Mantém números da última parcial boa; atualiza só metadados/projeção se fizer sentido
    const avisos = [...(payload.avisos || [])];
    avisos.push('Parcial nacional protegida contra regressão (CDN inconsistente neste ciclo).');
    return {
      ...cache.payload,
      capturado_em: payload.capturado_em,
      avisos,
      descartados_cdn: payload.descartados_cdn,
      monotonic: true,
      protegido_regressao: true,
    };
  }

  marcaDagua = {
    secoes: Math.max(marcaDagua.secoes, p.pct_secoes),
    validos: Math.max(marcaDagua.validos, p.votos_validos),
    flavio: Math.max(marcaDagua.flavio, p.flavio_votos),
    lula: Math.max(marcaDagua.lula, p.lula_votos),
  };
  return payload;
}

async function buildPayload() {
  const { br, ufs, erros, capturado_em, descartados_cdn, monotonic } = await capturarTse();
  const analise = projetarNacional(br, ufs);
  const avisos = [...(analise.avisos || [])];
  if (descartados_cdn?.length) {
    avisos.push(
      `${descartados_cdn.length} resposta(s) antigas da CDN ignoradas (merge monotônico — evita votos “descendo”).`
    );
  }
  const payload = {
    ok: true,
    capturado_em,
    fonte: 'TSE resultados oficiais (EA20, eleição 6257)',
    refresh_sugerido_ms: 500,
    erros_ufs: erros,
    descartados_cdn: descartados_cdn || [],
    monotonic: Boolean(monotonic),
    ...analise,
    avisos,
  };
  return aplicarMarcaDagua(payload);
}

async function getAnalise(force = false) {
  const agora = Date.now();
  if (!force && cache.payload && agora - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cache: { hit: true, age_ms: agora - cache.at } };
  }
  if (cache.inflight) {
    const payload = await cache.inflight;
    return { ...payload, cache: { hit: true, age_ms: 0, coalesced: true } };
  }

  cache.inflight = buildPayload()
    .then((payload) => {
      cache = { at: Date.now(), payload, error: null, inflight: null };
      return payload;
    })
    .catch((err) => {
      cache.inflight = null;
      cache.error = String(err.message || err);
      // se houver snapshot anterior, devolve stale
      if (cache.payload) {
        return {
          ...cache.payload,
          stale: true,
          stale_error: cache.error,
          cache: { hit: true, age_ms: Date.now() - cache.at },
        };
      }
      throw err;
    });

  const payload = await cache.inflight;
  return { ...payload, cache: { hit: false, age_ms: 0 } };
}

function mountEleicoesApi(app) {
  app.get('/api/eleicoes/2026/apuracao', async (req, res) => {
    try {
      const force = req.query.refresh === '1' || req.query.force === '1';
      const data = await getAnalise(force);
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    } catch (e) {
      res.status(502).json({
        ok: false,
        error: String(e.message || e),
        detalhe: 'Falha ao capturar dados do TSE',
      });
    }
  });

  app.get('/api/eleicoes/2026/health', async (_req, res) => {
    res.json({
      ok: true,
      cache_age_ms: cache.payload ? Date.now() - cache.at : null,
      last_error: cache.error,
      has_payload: Boolean(cache.payload),
    });
  });
}

module.exports = { mountEleicoesApi, getAnalise };
