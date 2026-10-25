const { capturarTse, capturarBrOnly, ELEICAO } = require('./tse');
const { projetarNacional } = require('./projecao');
const { capturarExteriorBu, mesclarZzComBu, temCacheExterior } = require('./exterior');

/** Cache em memória para não martelar o TSE a cada cliente. */
let cache = {
  at: 0,
  payload: null,
  error: null,
  inflight: null,
};

/** Cache curto para polling em tempo quase real (ms). Full = UFs+projeção. */
const CACHE_TTL_MS = 350;

/**
 * Placar BR ultrarrápido — poll dedicado, independente das 28 UFs.
 * O site do TSE costuma refrescar a UI em ~2–5s; aqui o JSON BR é lido ~150ms.
 */
const BR_POLL_MS = 150;
let brFast = {
  at: 0,
  fetch_ms: null,
  parcial: null,
  br: null,
  error: null,
  inflight: null,
  ticks: 0,
};

/** Marca d'água nacional — nunca devolve parcial com menos votos/seções que a anterior. */
let marcaDagua = null;
let eleicaoMarca = ELEICAO;

function resetEstadoSeEleicaoMudou() {
  if (eleicaoMarca !== ELEICAO) {
    marcaDagua = null;
    cache = { at: 0, payload: null, error: null, inflight: null };
    brFast = { at: 0, fetch_ms: null, parcial: null, br: null, error: null, inflight: null, ticks: 0 };
    eleicaoMarca = ELEICAO;
  }
}

function brParaParcial(br) {
  if (!br || !(br.votos_validos > 0)) return null;
  return {
    fonte: 'tse_br_oficial',
    pct_secoes: br.pct_secoes || 0,
    pct_falta: Math.max(0, 100 - (br.pct_secoes || 0)),
    atualizado: br.atualizado || '',
    flavio_pct: br.flavio_pct || 0,
    lula_pct: br.lula_pct || 0,
    flavio_votos: br.flavio_votos || 0,
    lula_votos: br.lula_votos || 0,
    margem: br.margem || 0,
    votos_validos: br.votos_validos || 0,
    comparecimento: br.comparecimento ?? null,
    top: (br.cands || []).slice(0, 6).map(({ nome, partido, pct, votos, numero }) => ({
      nome,
      partido,
      pct,
      votos,
      numero,
    })),
  };
}

function brMaisNovoQue(novo, antigo) {
  if (!novo) return false;
  if (!antigo) return true;
  if ((novo.votos_validos || 0) !== (antigo.votos_validos || 0)) {
    return (novo.votos_validos || 0) > (antigo.votos_validos || 0);
  }
  if ((novo.flavio_votos || 0) !== (antigo.flavio_votos || 0)) {
    return (novo.flavio_votos || 0) > (antigo.flavio_votos || 0);
  }
  if ((novo.lula_votos || 0) !== (antigo.lula_votos || 0)) {
    return (novo.lula_votos || 0) > (antigo.lula_votos || 0);
  }
  return String(novo.atualizado || '') >= String(antigo.atualizado || '');
}

async function refreshBrFast() {
  if (brFast.inflight) return brFast.inflight;
  const t0 = Date.now();
  brFast.inflight = capturarBrOnly()
    .then((br) => {
      const fetch_ms = Date.now() - t0;
      const parcial = brParaParcial(br);
      if (parcial && brMaisNovoQue(parcial, brFast.parcial)) {
        brFast.parcial = parcial;
        brFast.br = br;
      } else if (!brFast.parcial && parcial) {
        brFast.parcial = parcial;
        brFast.br = br;
      }
      brFast.at = Date.now();
      brFast.fetch_ms = fetch_ms;
      brFast.error = null;
      brFast.ticks += 1;
      // Espelha no payload completo se já existir (placar não espera UFs)
      if (cache.payload && brFast.parcial) {
        const cur = cache.payload.nacional_parcial;
        if (brMaisNovoQue(brFast.parcial, cur)) {
          cache.payload = {
            ...cache.payload,
            nacional_parcial: brFast.parcial,
            br_oficial: {
              atualizado: brFast.parcial.atualizado,
              pct_secoes: brFast.parcial.pct_secoes,
              flavio_pct: brFast.parcial.flavio_pct,
              lula_pct: brFast.parcial.lula_pct,
              flavio_votos: brFast.parcial.flavio_votos,
              lula_votos: brFast.parcial.lula_votos,
              votos_validos: brFast.parcial.votos_validos,
              usado_na_parcial: true,
            },
            capturado_em: new Date().toISOString(),
          };
          cache.at = Date.now();
          cache.payload = aplicarMarcaDagua(cache.payload);
        }
      }
      return brFast;
    })
    .catch((e) => {
      brFast.error = String(e.message || e);
      return brFast;
    })
    .finally(() => {
      brFast.inflight = null;
    });
  return brFast.inflight;
}

function startBrFastLoop() {
  const tick = async () => {
    try {
      await refreshBrFast();
    } catch (_) {}
    setTimeout(tick, BR_POLL_MS);
  };
  setTimeout(tick, 50);
}

function getBrFastPayload() {
  if (!brFast.parcial) {
    return {
      ok: false,
      error: brFast.error || 'BR ainda não capturado',
      refresh_sugerido_ms: BR_POLL_MS,
    };
  }
  return {
    ok: true,
    modo: 'br-fast',
    capturado_em: new Date(brFast.at).toISOString(),
    fetch_ms: brFast.fetch_ms,
    age_ms: Date.now() - brFast.at,
    ticks: brFast.ticks,
    refresh_sugerido_ms: BR_POLL_MS,
    nacional_parcial: brFast.parcial,
    br_oficial: {
      atualizado: brFast.parcial.atualizado,
      pct_secoes: brFast.parcial.pct_secoes,
      flavio_pct: brFast.parcial.flavio_pct,
      lula_pct: brFast.parcial.lula_pct,
      flavio_votos: brFast.parcial.flavio_votos,
      lula_votos: brFast.parcial.lula_votos,
      votos_validos: brFast.parcial.votos_validos,
      usado_na_parcial: true,
    },
  };
}

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
      exterior: payload.exterior || cache.payload.exterior,
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
  resetEstadoSeEleicaoMudou();
  const tseP = capturarTse();
  // Exterior por BU é lento: nunca bloqueia a apuração — cache + refresh background.
  let exterior;
  try {
    if (temCacheExterior()) {
      exterior = await capturarExteriorBu(false, { wait: false });
    } else {
      capturarExteriorBu(false, { wait: true }).catch(() => {});
      exterior = {
        ok: false,
        pendente: true,
        votos_validos: 0,
        cidades: [],
        nota: 'Agregando boletins de urna do exterior em segundo plano…',
      };
    }
  } catch (e) {
    exterior = { ok: false, erro: String(e.message || e), votos_validos: 0, cidades: [] };
  }

  const { br, ufs: ufsTse, erros, capturado_em, descartados_cdn, monotonic } = await tseP;

  const zzOficial = ufsTse.find((u) => u.uf === 'ZZ');
  const { ufs, aplicado: zzBu } = mesclarZzComBu(ufsTse, exterior, zzOficial?.secoes_total);

  const analise = projetarNacional(br, ufs);
  const avisos = [...(analise.avisos || [])];
  if (descartados_cdn?.length) {
    avisos.push(
      `${descartados_cdn.length} resposta(s) antigas da CDN ignoradas (merge monotônico — evita votos “descendo”).`
    );
  }
  if (zzBu && exterior?.votos_validos) {
    avisos.push(
      `Exterior via boletins de urna: ${exterior.secoes_com_bu} seções · Flávio ${exterior.flavio_votos.toLocaleString('pt-BR')} × Lula ${exterior.lula_votos.toLocaleString('pt-BR')} (consolidado oficial ZZ ainda não totalizado).`
    );
  }
  if (exterior?.stale_error) {
    avisos.push(`Exterior (cache): ${exterior.stale_error}`);
  }

  const exteriorOut =
    exterior?.ok || exterior?.votos_validos
      ? formatarExteriorOut(exterior, zzBu)
      : exterior?.pendente
        ? { ok: false, pendente: true, nota: exterior.nota }
        : { ok: false, erro: exterior?.erro || 'indisponível' };

  const payload = {
    ok: true,
    capturado_em,
    fonte:
      'TSE resultados oficiais (EA20, 2º turno eleição 6258; prior 2026 1ºT + finais 2022/2018; exterior por BU antes das 17h)',
    refresh_sugerido_ms: 500,
    erros_ufs: erros,
    descartados_cdn: descartados_cdn || [],
    monotonic: Boolean(monotonic),
    ...analise,
    avisos,
    exterior: exteriorOut,
  };
  return aplicarMarcaDagua(payload);
}

function formatarExteriorOut(exterior, aplicadoNoZz = false) {
  return {
    ok: true,
    fonte: exterior.fonte,
    capturado_em: exterior.capturado_em,
    secoes_com_bu: exterior.secoes_com_bu,
    secoes_config: exterior.secoes_config,
    flavio_votos: exterior.flavio_votos,
    lula_votos: exterior.lula_votos,
    flavio_pct: exterior.flavio_pct,
    lula_pct: exterior.lula_pct,
    margem: exterior.margem,
    votos_validos: exterior.votos_validos,
    branco: exterior.branco,
    nulo: exterior.nulo,
    aplicado_no_zz: Boolean(aplicadoNoZz),
    nota: exterior.nota,
    cidades: (exterior.cidades || []).slice(0, 40),
    cache: exterior.cache,
  };
}

async function anexarExteriorSePronto(payload) {
  if (!payload) return payload;
  const jaTem = payload.exterior?.votos_validos || payload.exterior?.ok;
  if (jaTem || !temCacheExterior()) return payload;
  try {
    const exterior = await capturarExteriorBu(false, { wait: false });
    if (!(exterior?.ok || exterior?.votos_validos)) return payload;
    const zz = (payload.estados || []).find((u) => u.uf === 'ZZ');
    const aplicado = zz?.fonte_parcial === 'arquivo_urna_bu' || !(zz?.votos_validos > 0);
    const next = { ...payload, exterior: formatarExteriorOut(exterior, aplicado) };
    if (cache.payload?.capturado_em === payload.capturado_em) cache.payload = next;
    return next;
  } catch {
    return payload;
  }
}

async function getAnalise(force = false) {
  const agora = Date.now();
  if (!force && cache.payload && agora - cache.at < CACHE_TTL_MS) {
    const payload = await anexarExteriorSePronto(cache.payload);
    return { ...payload, cache: { hit: true, age_ms: agora - cache.at } };
  }
  if (cache.inflight) {
    const payload = await anexarExteriorSePronto(await cache.inflight);
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

  const payload = await anexarExteriorSePronto(await cache.inflight);
  return { ...payload, cache: { hit: false, age_ms: 0 } };
}

function mountEleicoesApi(app) {
  // Placar BR em loop dedicado (mais rápido que a UI do TSE)
  startBrFastLoop();

  // pré-aquece agregação do exterior (BUs) em background
  setTimeout(() => {
    capturarExteriorBu(false, { wait: true })
      .then(() => {
        if (cache.payload) return anexarExteriorSePronto(cache.payload);
      })
      .catch(() => {});
  }, 200);

  app.get('/api/eleicoes/2026/br', async (req, res) => {
    try {
      if (req.query.refresh === '1' || !brFast.parcial) await refreshBrFast();
      const data = getBrFastPayload();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (!data.ok) {
        res.status(503).json(data);
        return;
      }
      res.json(data);
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get('/api/eleicoes/2026/apuracao', async (req, res) => {
    try {
      const force = req.query.refresh === '1' || req.query.force === '1';
      // Garante BR fresco antes de montar (não espera UFs no loop rápido)
      if (!brFast.parcial) await refreshBrFast();
      let data = await getAnalise(force);
      if (brFast.parcial && brMaisNovoQue(brFast.parcial, data.nacional_parcial)) {
        data = {
          ...data,
          nacional_parcial: brFast.parcial,
          br_oficial: getBrFastPayload().br_oficial,
        };
        data = aplicarMarcaDagua(data);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(data);
    } catch (e) {
      res.status(502).json({
        ok: false,
        error: String(e.message || e),
        detalhe: 'Falha ao capturar dados do TSE',
      });
    }
  });

  app.get('/api/eleicoes/2026/exterior', async (req, res) => {
    try {
      const force = req.query.refresh === '1' || req.query.force === '1';
      // wait só quando force; senão responde cache na hora
      const data = await capturarExteriorBu(force, { wait: force });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(data);
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get('/api/eleicoes/2026/health', async (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      ok: true,
      cache_age_ms: cache.payload ? Date.now() - cache.at : null,
      br_age_ms: brFast.parcial ? Date.now() - brFast.at : null,
      br_fetch_ms: brFast.fetch_ms,
      br_ticks: brFast.ticks,
      br_atualizado: brFast.parcial?.atualizado || null,
      last_error: cache.error || brFast.error,
      has_payload: Boolean(cache.payload),
      has_br: Boolean(brFast.parcial),
      exterior_cache: temCacheExterior(),
    });
  });
}

module.exports = { mountEleicoesApi, getAnalise, getBrFastPayload, refreshBrFast };
