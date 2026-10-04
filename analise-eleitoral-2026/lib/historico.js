/**
 * Histórico Direita × Esquerda por UF — 1º turno 2022 e 2º turno 2018.
 * Direita: Bolsonaro | Esquerda: Lula (2022) / Haddad (2018)
 * Fonte: TSE (consolidados públicos).
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
};

/** 2018 2º turno: [esquerda Haddad %, direita Bolsonaro %] */
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
};

/**
 * Peso histórico por UF.
 * Média 2018 (peso 0,4) + 2022 (peso 0,6) — 2022 mais próximo do duelo atual.
 * Também devolve a força relativa da polarização (soma D+E nos dois anos).
 */
function historicoUf(uf) {
  const h22 = HIST_2022_1T[uf];
  const h18 = HIST_2018_2T[uf];
  if (!h22 || !h18) return null;

  const esquerda = 0.6 * h22[0] + 0.4 * h18[0];
  const direita = 0.6 * h22[1] + 0.4 * h18[1];
  const polarizacao = esquerda + direita; // tipicamente ~90–99

  return {
    uf,
    ...UF_META[uf],
    esquerda_2022: h22[0],
    direita_2022: h22[1],
    esquerda_2018: h18[0],
    direita_2018: h18[1],
    esquerda_peso: esquerda,
    direita_peso: direita,
    margem_hist: direita - esquerda, // + = direita
    polarizacao,
  };
}

function todosHistoricos() {
  return Object.keys(UF_META).map(historicoUf);
}

module.exports = {
  UF_META,
  HIST_2022_1T,
  HIST_2018_2T,
  historicoUf,
  todosHistoricos,
};
