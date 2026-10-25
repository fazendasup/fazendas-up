/**
 * Histórico Direita × Esquerda por UF para prior do 2º turno 2026.
 *
 * Pesos do prior composto (soma = 1):
 *   - 2026 1º turno (deste pleito): 0,40  ← levemente maior
 *   - 2022 2º turno (resultado final): 0,35
 *   - 2018 2º turno (resultado final): 0,25
 *
 * Não usa 1ºs turnos de anos anteriores — só o resultado final daquelas eleições.
 * Direita: Flávio/Bolsonaro | Esquerda: Lula/Haddad
 * Fontes: TSE (2026 1T final ele 6257; 2022/2018 2T consolidados).
 */

const UF_META = {
  AC: { nome: 'Acre', regiao: 'Norte' },
  AL: { nome: 'Alagoas', regiao: 'Nordeste' },
  AP: { nome: 'Amapá', regiao: 'Norte' },
  AM: { nome: 'Amazonas', regiao: 'Norte' },
  BA: { nome: 'Bahia', regiao: 'Nordeste' },
  CE: { nome: 'Ceará', regiao: 'Nordeste' },
  DF: { nome: 'Distrito Federal', regiao: 'Centro-Oeste' },
  ES: { nome: 'Espírito Santo', regiao: 'Sudeste' },
  GO: { nome: 'Goiás', regiao: 'Centro-Oeste' },
  MA: { nome: 'Maranhão', regiao: 'Nordeste' },
  MT: { nome: 'Mato Grosso', regiao: 'Centro-Oeste' },
  MS: { nome: 'Mato Grosso do Sul', regiao: 'Centro-Oeste' },
  MG: { nome: 'Minas Gerais', regiao: 'Sudeste' },
  PA: { nome: 'Pará', regiao: 'Norte' },
  PB: { nome: 'Paraíba', regiao: 'Nordeste' },
  PR: { nome: 'Paraná', regiao: 'Sul' },
  PE: { nome: 'Pernambuco', regiao: 'Nordeste' },
  PI: { nome: 'Piauí', regiao: 'Nordeste' },
  RJ: { nome: 'Rio de Janeiro', regiao: 'Sudeste' },
  RN: { nome: 'Rio Grande do Norte', regiao: 'Nordeste' },
  RS: { nome: 'Rio Grande do Sul', regiao: 'Sul' },
  RO: { nome: 'Rondônia', regiao: 'Norte' },
  RR: { nome: 'Roraima', regiao: 'Norte' },
  SC: { nome: 'Santa Catarina', regiao: 'Sul' },
  SP: { nome: 'São Paulo', regiao: 'Sudeste' },
  SE: { nome: 'Sergipe', regiao: 'Nordeste' },
  TO: { nome: 'Tocantins', regiao: 'Norte' },
  ZZ: { nome: 'Exterior', regiao: 'Exterior' },
};

/** Pesos do prior — 1º turno 2026 levemente acima dos finais anteriores */
const PESOS_PRIOR = {
  t2026_1t: 0.4,
  t2022_2t: 0.35,
  t2018_2t: 0.25,
};

/** @deprecated use PESOS_PRIOR */
const PESOS_1T = PESOS_PRIOR;

/** 2026 1º turno FINAL (TSE ele 6257, tf=s): [esquerda Lula %, direita Flávio %] */
const HIST_2026_1T = {
  AC: [28.73, 64.56],
  AL: [54.73, 40.45],
  AP: [45.71, 45.67],
  AM: [48.23, 45.0],
  BA: [66.17, 28.53],
  CE: [63.29, 31.27],
  DF: [38.11, 51.31],
  ES: [37.76, 54.78],
  GO: [31.06, 53.6],
  MA: [63.99, 30.9],
  MT: [29.18, 65.15],
  MS: [34.68, 58.6],
  MG: [43.33, 48.24],
  PA: [49.91, 44.5],
  PB: [61.31, 33.07],
  PR: [31.2, 59.91],
  PE: [63.45, 31.03],
  PI: [70.99, 24.09],
  RJ: [39.41, 53.01],
  RN: [59.75, 34.77],
  RS: [35.73, 55.64],
  RO: [25.89, 67.45],
  RR: [22.86, 71.06],
  SC: [25.04, 66.65],
  SP: [38.2, 51.93],
  SE: [62.75, 30.63],
  TO: [43.42, 50.44],
  ZZ: [47.57, 43.49],
};

/** 2022 2º turno FINAL: [esquerda Lula %, direita Bolsonaro %] */
const HIST_2022_2T = {
  AC: [29.7, 70.3],
  AL: [58.68, 41.32],
  AP: [48.64, 51.36],
  AM: [51.1, 48.9],
  BA: [72.12, 27.88],
  CE: [69.97, 30.03],
  DF: [41.19, 58.81],
  ES: [41.96, 58.04],
  GO: [41.29, 58.71],
  MA: [71.14, 28.86],
  MT: [34.92, 65.08],
  MS: [40.51, 59.49],
  MG: [50.2, 49.8],
  PA: [54.75, 45.25],
  PB: [66.62, 33.38],
  PR: [37.6, 62.4],
  PE: [66.93, 33.07],
  PI: [76.86, 23.14],
  RJ: [43.47, 56.53],
  RN: [65.1, 34.9],
  RS: [43.65, 56.35],
  RO: [29.34, 70.66],
  RR: [23.92, 76.08],
  SC: [30.73, 69.27],
  SP: [44.76, 55.24],
  SE: [67.21, 32.79],
  TO: [51.36, 48.64],
  ZZ: [51.28, 48.72],
};

/** 2018 2º turno FINAL: [esquerda Haddad %, direita Bolsonaro %] */
const HIST_2018_2T = {
  AC: [22.78, 77.22],
  AL: [59.92, 40.08],
  AP: [49.79, 50.21],
  AM: [49.73, 50.27],
  BA: [72.69, 27.31],
  CE: [71.11, 28.89],
  DF: [30.01, 69.99],
  ES: [36.94, 63.06],
  GO: [34.48, 65.52],
  MA: [73.26, 26.74],
  MT: [33.58, 66.42],
  MS: [34.78, 65.22],
  MG: [41.81, 58.19],
  PA: [54.81, 45.19],
  PB: [64.96, 35.04],
  PR: [31.57, 68.43],
  PE: [66.5, 33.5],
  PI: [77.05, 22.95],
  RJ: [32.05, 67.95],
  RN: [63.41, 36.59],
  RS: [36.76, 63.24],
  RO: [27.82, 72.18],
  RR: [28.45, 71.55],
  SC: [24.08, 75.92],
  SP: [32.03, 67.97],
  SE: [67.54, 32.46],
  TO: [51.02, 48.98],
  ZZ: [28.98, 71.02],
};

/**
 * Prior composto: 1º turno 2026 (leve vantagem) + finais 2022/2018.
 */
function historicoUf(uf) {
  const h26 = HIST_2026_1T[uf];
  const h22 = HIST_2022_2T[uf];
  const h18 = HIST_2018_2T[uf];
  if (!h26 || !h22 || !h18) return null;

  const { t2026_1t, t2022_2t, t2018_2t } = PESOS_PRIOR;
  const esquerda = t2026_1t * h26[0] + t2022_2t * h22[0] + t2018_2t * h18[0];
  const direita = t2026_1t * h26[1] + t2022_2t * h22[1] + t2018_2t * h18[1];

  return {
    uf,
    ...UF_META[uf],
    pesos: { ...PESOS_PRIOR },
    esquerda_2026_1t: h26[0],
    direita_2026_1t: h26[1],
    esquerda_2022_2t: h22[0],
    direita_2022_2t: h22[1],
    esquerda_2018_2t: h18[0],
    direita_2018_2t: h18[1],
    // aliases usados pela projeção/UI (finais das eleições anteriores)
    esquerda_2022: h22[0],
    direita_2022: h22[1],
    esquerda_2018: h18[0],
    direita_2018: h18[1],
    esquerda_peso: esquerda,
    direita_peso: direita,
    margem_hist: direita - esquerda,
    margem_2026_1t: h26[1] - h26[0],
    polarizacao: esquerda + direita,
  };
}

function todosHistoricos() {
  return Object.keys(UF_META).map(historicoUf).filter(Boolean);
}

module.exports = {
  UF_META,
  PESOS_PRIOR,
  PESOS_1T,
  HIST_2026_1T,
  HIST_2022_2T,
  HIST_2018_2T,
  historicoUf,
  todosHistoricos,
};
