/**
 * Projeção ponderada do que falta apurar.
 *
 * Para cada UF:
 * 1. Estima votos válidos totais ≈ válidos_atuais / (pct_seções/100)
 * 2. Votos restantes = estimativa − atuais
 * 3. Distribui restantes com blend:
 *    - parcela atual (Flávio/Lula/outros na parcial da UF)
 *    - peso histórico Direita/Esquerda (média 2018×0,4 + 2022×0,6)
 *
 * Peso do histórico cresce quando ainda falta muito na UF:
 *   w_hist = clamp(pct_falta/100, 0.15, 0.75)
 * (com pouca apuração, confia mais no histórico; quase fechada, confia na parcial)
 *
 * Peso nacional da UF = votos restantes estimados / soma nacional dos restantes
 * (massa eleitoral que ainda pode mover o placar).
 */

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function projetarEstado(ufRow) {
  const pctAp = ufRow.pct_secoes;
  const pctFalta = Math.max(0, 100 - pctAp);
  const hist = ufRow.hist;

  if (pctAp <= 0.01 || ufRow.votos_validos <= 0) {
    return {
      ...baseEstado(ufRow, pctFalta),
      estimativa_validos_total: null,
      votos_restantes: null,
      w_hist: null,
      proj_flavio_pct_final: null,
      proj_lula_pct_final: null,
      restantes_flavio: 0,
      restantes_lula: 0,
      restantes_outros: 0,
      peso_nacional_restante: 0,
      skip: true,
    };
  }

  const estimativaValidos = ufRow.votos_validos / (pctAp / 100);
  const votosRestantes = Math.max(0, estimativaValidos - ufRow.votos_validos);

  const atualF = ufRow.flavio_pct / 100;
  const atualL = ufRow.lula_pct / 100;
  const atualOutros = Math.max(0, 1 - atualF - atualL);

  // Histórico cobre só D×E; mantém proporção de "outros" da parcial atual
  const histD = hist ? hist.direita_peso / 100 : atualF;
  const histE = hist ? hist.esquerda_peso / 100 : atualL;
  const histPolar = Math.max(histD + histE, 0.01);
  // redistribui histórico no espaço (1 - outros)
  const espacoDL = 1 - atualOutros;
  const histF = espacoDL * (histD / histPolar);
  const histL = espacoDL * (histE / histPolar);

  const wHist = clamp(pctFalta / 100, 0.15, 0.75);
  const wAtual = 1 - wHist;

  let shareF = wAtual * atualF + wHist * histF;
  let shareL = wAtual * atualL + wHist * histL;
  let shareO = wAtual * atualOutros + wHist * atualOutros;
  const soma = shareF + shareL + shareO;
  shareF /= soma;
  shareL /= soma;
  shareO /= soma;

  const restF = votosRestantes * shareF;
  const restL = votosRestantes * shareL;
  const restO = votosRestantes * shareO;

  const finalF = ufRow.flavio_votos + restF;
  const finalL = ufRow.lula_votos + restL;
  const finalV = estimativaValidos;
  const projF = (100 * finalF) / finalV;
  const projL = (100 * finalL) / finalV;

  return {
    ...baseEstado(ufRow, pctFalta),
    estimativa_validos_total: estimativaValidos,
    votos_restantes: votosRestantes,
    w_hist: wHist,
    share_restante: { flavio: shareF * 100, lula: shareL * 100, outros: shareO * 100 },
    restantes_flavio: restF,
    restantes_lula: restL,
    restantes_outros: restO,
    proj_flavio_votos: finalF,
    proj_lula_votos: finalL,
    proj_flavio_pct_final: projF,
    proj_lula_pct_final: projL,
    proj_margem_final: projF - projL,
    delta_vs_parcial: {
      flavio: projF - ufRow.flavio_pct,
      lula: projL - ufRow.lula_pct,
    },
    hist: hist
      ? {
          direita_peso: hist.direita_peso,
          esquerda_peso: hist.esquerda_peso,
          margem_hist: hist.margem_hist,
          direita_2022: hist.direita_2022,
          esquerda_2022: hist.esquerda_2022,
          direita_2018: hist.direita_2018,
          esquerda_2018: hist.esquerda_2018,
        }
      : null,
    skip: false,
  };
}

function baseEstado(ufRow, pctFalta) {
  return {
    uf: ufRow.uf,
    nome: ufRow.hist?.nome || ufRow.uf,
    regiao: ufRow.hist?.regiao || '',
    atualizado: ufRow.atualizado,
    pct_secoes: ufRow.pct_secoes,
    pct_falta: pctFalta,
    secoes_faltam: ufRow.secoes_faltam,
    secoes_total: ufRow.secoes_total,
    flavio_pct: ufRow.flavio_pct,
    lula_pct: ufRow.lula_pct,
    flavio_votos: ufRow.flavio_votos,
    lula_votos: ufRow.lula_votos,
    votos_validos: ufRow.votos_validos,
    margem_parcial: ufRow.margem,
    lider_parcial: ufRow.lider,
    eleitorado_total: ufRow.eleitorado_total,
  };
}

function projetarNacional(br, ufs) {
  const estados = ufs.map(projetarEstado);
  const ativos = estados.filter((e) => !e.skip);

  const somaRest = ativos.reduce((s, e) => s + e.votos_restantes, 0) || 1;
  for (const e of estados) {
    e.peso_nacional_restante = e.skip ? 0 : (100 * e.votos_restantes) / somaRest;
  }

  // Nacional projetado = soma das projeções estaduais (mais fiel que escalar o BR)
  const totF = ativos.reduce((s, e) => s + e.proj_flavio_votos, 0);
  const totL = ativos.reduce((s, e) => s + e.proj_lula_votos, 0);
  const totV = ativos.reduce((s, e) => s + e.estimativa_validos_total, 0);
  const restF = ativos.reduce((s, e) => s + e.restantes_flavio, 0);
  const restL = ativos.reduce((s, e) => s + e.restantes_lula, 0);

  const projF = totV ? (100 * totF) / totV : 0;
  const projL = totV ? (100 * totL) / totV : 0;

  // Contribuição de cada UF ao movimento esperado da margem nacional
  // (quanto os restantes da UF puxam Flávio − Lula no total nacional projetado)
  for (const e of ativos) {
    const pull = e.restantes_flavio - e.restantes_lula;
    e.impacto_margem_nacional_pp = totV ? (100 * pull) / totV : 0;
  }

  // Agregado regional
  const regioesMap = {};
  for (const e of ativos) {
    const r = e.regiao || 'Outros';
    if (!regioesMap[r]) {
      regioesMap[r] = {
        regiao: r,
        pct_secoes_pond: 0,
        peso_secoes: 0,
        flavio_votos: 0,
        lula_votos: 0,
        validos: 0,
        restantes: 0,
        rest_f: 0,
        rest_l: 0,
        proj_f: 0,
        proj_l: 0,
        proj_v: 0,
      };
    }
    const g = regioesMap[r];
    g.pct_secoes_pond += e.pct_secoes * e.secoes_total;
    g.peso_secoes += e.secoes_total;
    g.flavio_votos += e.flavio_votos;
    g.lula_votos += e.lula_votos;
    g.validos += e.votos_validos;
    g.restantes += e.votos_restantes;
    g.rest_f += e.restantes_flavio;
    g.rest_l += e.restantes_lula;
    g.proj_f += e.proj_flavio_votos;
    g.proj_l += e.proj_lula_votos;
    g.proj_v += e.estimativa_validos_total;
  }

  const regioes = Object.values(regioesMap).map((g) => ({
    regiao: g.regiao,
    pct_secoes: g.peso_secoes ? g.pct_secoes_pond / g.peso_secoes : 0,
    pct_falta: g.peso_secoes ? 100 - g.pct_secoes_pond / g.peso_secoes : 0,
    flavio_pct_parcial: g.validos ? (100 * g.flavio_votos) / g.validos : 0,
    lula_pct_parcial: g.validos ? (100 * g.lula_votos) / g.validos : 0,
    votos_restantes: g.restantes,
    peso_nacional_restante: (100 * g.restantes) / somaRest,
    proj_flavio_pct: g.proj_v ? (100 * g.proj_f) / g.proj_v : 0,
    proj_lula_pct: g.proj_v ? (100 * g.proj_l) / g.proj_v : 0,
  }));

  estados.sort((a, b) => b.peso_nacional_restante - a.peso_nacional_restante);

  // Agregação UFs+ZZ (diagnóstico / fallback)
  const secTot = ufs.reduce((s, u) => s + (u.secoes_total || 0), 0);
  const secAp = ufs.reduce((s, u) => s + (u.secoes_totalizadas || 0), 0);
  const votosF = ufs.reduce((s, u) => s + (u.flavio_votos || 0), 0);
  const votosL = ufs.reduce((s, u) => s + (u.lula_votos || 0), 0);
  const votosV = ufs.reduce((s, u) => s + (u.votos_validos || 0), 0);
  const pctSecoesUf = secTot ? (100 * secAp) / secTot : 0;
  const flavioPctUf = votosV ? (100 * votosF) / votosV : 0;
  const lulaPctUf = votosV ? (100 * votosL) / votosV : 0;

  const ufMaisRecente = [...ufs].sort((a, b) =>
    String(b.atualizado || '').localeCompare(String(a.atualizado || ''))
  )[0];

  // Parcial nacional: preferir arquivo BR oficial do TSE (bate com o site do TSE).
  // Só cai para soma UFs+ZZ se o BR estiver claramente travado/atrás.
  const brOk =
    Boolean(br) &&
    (br.votos_validos || 0) > 0 &&
    (br.flavio_votos || 0) > 0 &&
    // BR atrás demais das UFs (>= 2 pp de seções) → provavelmente travado
    !(br.pct_secoes + 2 < pctSecoesUf);

  const avisos = [];
  if (!brOk) {
    avisos.push(
      `Usando soma UFs+ZZ (${pctSecoesUf.toFixed(2).replace('.', ',')}% seções): arquivo BR indisponível ou atrasado.`
    );
  }

  const nacionalParcial = brOk
    ? {
        fonte: 'tse_br_oficial',
        pct_secoes: br.pct_secoes,
        pct_falta: Math.max(0, 100 - br.pct_secoes),
        atualizado: br.atualizado,
        flavio_pct: br.flavio_pct,
        lula_pct: br.lula_pct,
        flavio_votos: br.flavio_votos,
        lula_votos: br.lula_votos,
        margem: br.margem,
        votos_validos: br.votos_validos,
        comparecimento: br.comparecimento ?? null,
        top: (br.cands || []).slice(0, 6).map(({ nome, partido, pct, votos, numero }) => ({
          nome,
          partido,
          pct,
          votos,
          numero,
        })),
      }
    : {
        fonte: 'agregacao_ufs_zz',
        pct_secoes: pctSecoesUf,
        pct_falta: Math.max(0, 100 - pctSecoesUf),
        atualizado: ufMaisRecente?.atualizado || br?.atualizado || '',
        flavio_pct: flavioPctUf,
        lula_pct: lulaPctUf,
        flavio_votos: votosF,
        lula_votos: votosL,
        margem: flavioPctUf - lulaPctUf,
        votos_validos: votosV,
        comparecimento: br?.comparecimento ?? null,
        top: (br?.cands || []).slice(0, 6).map(({ nome, partido, pct, votos, numero }) => ({
          nome,
          partido,
          pct,
          votos,
          numero,
        })),
      };

  // Projeção: ancora nos votos oficiais do BR (quando disponível) + restantes estimados por UF/ZZ
  let projFlavioVotos = totF;
  let projLulaVotos = totL;
  let projValidos = totV;
  if (brOk) {
    // Troca a base já apurada pela oficial BR; mantém só o "restante" modelado por UF
    projFlavioVotos = br.flavio_votos + restF;
    projLulaVotos = br.lula_votos + restL;
    projValidos = br.votos_validos + somaRest;
  }
  const projFFinal = projValidos ? (100 * projFlavioVotos) / projValidos : projF;
  const projLFinal = projValidos ? (100 * projLulaVotos) / projValidos : projL;

  return {
    metodo: {
      descricao:
        'Parcial nacional = arquivo BR oficial do TSE. Projeção = BR + restantes por UF/ZZ com blend histórico Direita/Esquerda (2018×0,4 + 2022×0,6).',
      candidatos: { direita: 'Flávio Bolsonaro (22)', esquerda: 'Lula (13)' },
    },
    avisos,
    br_oficial: br
      ? {
          atualizado: br.atualizado,
          pct_secoes: br.pct_secoes,
          flavio_pct: br.flavio_pct,
          lula_pct: br.lula_pct,
          flavio_votos: br.flavio_votos,
          lula_votos: br.lula_votos,
          votos_validos: br.votos_validos,
          usado_na_parcial: brOk,
        }
      : null,
    agregacao_ufs_zz: {
      pct_secoes: pctSecoesUf,
      flavio_pct: flavioPctUf,
      lula_pct: lulaPctUf,
      flavio_votos: votosF,
      lula_votos: votosL,
      votos_validos: votosV,
    },
    nacional_parcial: nacionalParcial,
    nacional_projetado: {
      flavio_pct: projFFinal,
      lula_pct: projLFinal,
      margem: projFFinal - projLFinal,
      flavio_votos: projFlavioVotos,
      lula_votos: projLulaVotos,
      votos_validos: projValidos,
      votos_restantes: somaRest,
      restantes_flavio: restF,
      restantes_lula: restL,
      ajuste_margem_pp: projFFinal - projLFinal - nacionalParcial.margem,
      chance_primeiro_turno: projFFinal > 50 ? 'matematicamente possível' : 'tendência de 2º turno',
    },
    estados,
    regioes: regioes.sort((a, b) => b.peso_nacional_restante - a.peso_nacional_restante),
  };
}

module.exports = { projetarNacional, projetarEstado };
