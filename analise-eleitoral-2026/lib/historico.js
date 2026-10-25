/**
 * Histórico Direita × Esquerda por UF — focando em PRIMEIROS TURNOS.
 *
 * Pesos do prior composto (soma = 1):
 *   - 2026 1º turno: 0,45  ← resultado deste pleito (peso maior)
 *   - 2022 1º turno: 0,30
 *   - 2018 1º turno: 0,25
 *
 * Direita: Flávio/Bolsonaro | Esquerda: Lula/Haddad
 * Fontes: TSE (2026 1T final; 2022/2018 consolidados públicos).
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

/** Pesos do prior — 1º turno 2026 um pouco acima das eleições anteriores */
const PESOS_1T = {
  t2026: 0.45,
  t2022: 0.3,
  t2018: 0.25,
};

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

/** 2022 1º turno: [esquerda Lula %, direita Bolsonaro %] */
const HIST_2022_1T = {
  AC: [29.26, 62.5],
  AL: [56.5, 36.05],
  AP: [45.67, 43.41],
  AM: [49.58, 42.8],
  BA: [69.73, 24.31],
  CE: [65.91, 25.38],
  DF: [36.85, 51.65],
  ES: [40.4, 52.23],
  GO: [39.51, 52.16],
  MA: [68.84, 26.02],
  MT: [34.39, 59.84],
  MS: [39.04, 52.7],
  MG: [48.29, 43.6],
  PA: [52.22, 40.27],
  PB: [64.21, 29.62],
  PR: [35.99, 55.26],
  PE: [65.27, 29.91],
  PI: [74.25, 19.9],
  RJ: [40.68, 51.09],
  RN: [62.98, 31.02],
  RS: [42.28, 48.89],
  RO: [28.98, 64.36],
  RR: [23.05, 69.57],
  SC: [29.54, 62.21],
  SP: [40.89, 47.71],
  SE: [63.82, 29.16],
  TO: [50.4, 44.0],
  ZZ: [47.17, 41.61],
};

/** 2018 1º turno: [esquerda Haddad %, direita Bolsonaro %] — TSE/Wikipedia */
const HIST_2018_1T = {
  AC: [18.53, 62.24],
  AL: [44.75, 34.4],
  AP: [32.77, 40.74],
  AM: [40.3, 43.48],
  BA: [60.28, 23.41],
  CE: [33.12, 21.74], // Ciro venceu o CE; Haddad/Bolsonaro para eixo D×E
  DF: [11.87, 58.37],
  ES: [24.2, 54.76],
  GO: [21.86, 57.24],
  MA: [61.26, 24.28],
  MT: [24.76, 60.04],
  MS: [23.87, 55.06],
  MG: [27.65, 48.31],
  PA: [41.39, 36.19],
  PB: [45.46, 31.3],
  PR: [19.7, 56.89],
  PE: [48.87, 30.57],
  PI: [63.4, 18.76],
  RJ: [14.69, 59.79],
  RN: [41.19, 30.21],
  RS: [22.81, 52.63],
  RO: [20.36, 62.24],
  RR: [17.85, 62.97],
  SC: [15.13, 65.82],
  SP: [16.42, 53.0],
  SE: [50.09, 27.21],
  TO: [41.12, 44.64],
  ZZ: [10.1, 58.79],
};

/** 2018 2º turno (referência auxiliar, não entra no prior principal) */
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
 * Prior composto por UF com peso maior no 1º turno de 2026.
 */
function historicoUf(uf) {
  const h26 = HIST_2026_1T[uf];
  const h22 = HIST_2022_1T[uf];
  const h18 = HIST_2018_1T[uf];
  if (!h26 || !h22 || !h18) return null;

  const { t2026, t2022, t2018 } = PESOS_1T;
  const esquerda = t2026 * h26[0] + t2022 * h22[0] + t2018 * h18[0];
  const direita = t2026 * h26[1] + t2022 * h22[1] + t2018 * h18[1];

  return {
    uf,
    ...UF_META[uf],
    pesos: { ...PESOS_1T },
    esquerda_2026_1t: h26[0],
    direita_2026_1t: h26[1],
    esquerda_2022_1t: h22[0],
    direita_2022_1t: h22[1],
    esquerda_2018_1t: h18[0],
    direita_2018_1t: h18[1],
    // aliases usados pela projeção/UI
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
  PESOS_1T,
  HIST_2026_1T,
  HIST_2022_1T,
  HIST_2018_1T,
  HIST_2018_2T,
  historicoUf,
  todosHistoricos,
};
