const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
// Evita servir HTML/JSON antigos: sem ETag/Last-Modified o navegador não faz 304 com cópia velha.
app.use(express.static(__dirname, {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath);
    const base = path.basename(filePath);
    const noCache =
      ext === '.html' ||
      ext === '.json' ||
      base === 'index.html';
    if (noCache) {
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Arquivo de dados
const DATA_FILE = path.join(__dirname, 'dados-sync.json');
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_ALLOWED_CHAT_IDS = new Set(
  String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

// Dados em memória (mesmo formato que dados-sync.json)
let appData = {
  data: {
    pedidos: [],
    clientes: [],
    produtos: [],
    prioridades: {},
    estoqueFatores: {},
    estoqueDesativados: {},
    estoqueMix: {},
    estoqueModoCompra: {},
    estoqueRendimentoKilo: {},
    estoqueMixFolhaLeve: null,
  },
  lastUpdate: new Date().toISOString(),
};

// Carregar dados do arquivo ao iniciar
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      appData = JSON.parse(data);
      console.log('Dados carregados do arquivo');
    }
  } catch (e) {
    console.error('Erro ao carregar dados:', e);
  }
}

// Salvar dados no arquivo
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(appData, null, 2));
    console.log('Dados salvos no arquivo');
  } catch (e) {
    console.error('Erro ao salvar dados:', e);
  }
}

function stripDiacritics(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(text) {
  return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function parsePtNumber(value) {
  const n = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseQtyPt(value) {
  const raw = normalizeText(value);
  const direct = parsePtNumber(raw);
  if (direct != null) return direct;
  const words = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    três: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
  };
  if (Object.prototype.hasOwnProperty.call(words, raw)) return words[raw];
  return null;
}

function normalizeForMatch(text) {
  const stopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'um', 'uma']);
  const tokens = normalizeText(text)
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !stopwords.has(t))
    .map((t) => {
      if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
      return t;
    });
  return tokens.join(' ').trim();
}

function findBestByName(items, getName, wanted) {
  const targetNorm = normalizeForMatch(wanted);
  if (!targetNorm) return null;
  const exact = items.find((item) => normalizeForMatch(getName(item)) === targetNorm);
  if (exact) return exact;
  return items.find((item) => normalizeForMatch(getName(item)).includes(targetNorm));
}

function parseCommandIntent(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const norm = normalizeText(text);

  if (norm === '/menu' || norm === 'menu' || norm === 'abrir menu') return { kind: 'menu', rawText: text };
  if (norm === '/ajuda' || norm === 'ajuda') return { kind: 'help', rawText: text };
  if (norm === '/estado' || norm === 'estado') return { kind: 'state', rawText: text };
  if (norm === '/pendente' || norm === 'pendente') return { kind: 'pending', rawText: text };
  if (norm === 'pedido criar') return { kind: 'shortcut', target: 'pedido_criar', rawText: text };
  if (norm === 'pedido editar') return { kind: 'shortcut', target: 'pedido_editar', rawText: text };
  if (norm === 'pedido excluir') return { kind: 'shortcut', target: 'pedido_excluir', rawText: text };
  if (norm === 'cliente criar') return { kind: 'shortcut', target: 'cliente_criar', rawText: text };
  if (norm === 'cliente editar') return { kind: 'shortcut', target: 'cliente_editar', rawText: text };
  if (norm === 'cliente excluir') return { kind: 'shortcut', target: 'cliente_excluir', rawText: text };
  if (norm === 'produto criar') return { kind: 'shortcut', target: 'produto_criar', rawText: text };
  if (norm === 'produto editar') return { kind: 'shortcut', target: 'produto_editar', rawText: text };
  if (norm === 'produto excluir') return { kind: 'shortcut', target: 'produto_excluir', rawText: text };

  const slashMatch = text.match(/^\/?(pedido|cliente|produto)\s+([a-z_]+)\s*(.*)$/i);
  if (slashMatch) {
    return {
      kind: 'structured',
      entity: normalizeText(slashMatch[1]),
      action: normalizeText(slashMatch[2]),
      args: parseNamedArgs(slashMatch[3] || ''),
      rawText: text,
    };
  }

  // Ex: "acrescentar 3 ruculas ao pedido do felicori"
  const reAdd = /\b(?:acrescentar|adicionar|somar|incluir)\s+([a-z0-9.,]+)\s+(.+?)\s+(?:ao|no)\s+pedido\s+(?:do|da)\s+(.+)$/i;
  const addMatch = norm.match(reAdd);
  if (addMatch) {
    return {
      kind: 'increment_order_item',
      quantityDelta: parseQtyPt(addMatch[1]),
      productName: addMatch[2].trim(),
      clientName: addMatch[3].trim(),
      rawText: text,
    };
  }

  // Ex: "editar o status do pedido da casa de tereza para pronto"
  const reStatus = /\b(?:editar|alterar|mudar|atualizar)\s+(?:o\s+)?status\s+(?:do\s+)?pedido\s+(?:do|da)\s+(.+?)\s+(?:para|pra)\s+(pendente|pronto|entregue|cancelado)(?:\s+do\s+dia\s+(.+))?$/i;
  const statusMatch = norm.match(reStatus);
  if (statusMatch) {
    return {
      kind: 'update_order_status_client',
      clientName: statusMatch[1].trim(),
      status: statusMatch[2].trim(),
      day: normalizeDay(statusMatch[3] || ''),
      rawText: text,
    };
  }
  return null;
}

function parseNamedArgs(argsText) {
  const out = {};
  const src = String(argsText || '');
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let m;
  while ((m = re.exec(src))) {
    const key = normalizeText(m[1]);
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[key] = String(value).trim();
  }
  return out;
}

function normalizeDay(value) {
  const v = normalizeText(value);
  if (!v) return '';
  const map = {
    segunda: 'segunda-feira',
    'segunda-feira': 'segunda-feira',
    terca: 'terça-feira',
    'terca-feira': 'terça-feira',
    'terça-feira': 'terça-feira',
    quarta: 'quarta-feira',
    'quarta-feira': 'quarta-feira',
    quinta: 'quinta-feira',
    'quinta-feira': 'quinta-feira',
    sexta: 'sexta-feira',
    'sexta-feira': 'sexta-feira',
    sabado: 'sábado',
    sábado: 'sábado',
    domingo: 'domingo',
    hoje: '',
  };
  return map[v] || v;
}

function parseBoolPt(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  const v = normalizeText(value);
  if (['1', 'sim', 'true', 'verdadeiro', 'on'].includes(v)) return true;
  if (['0', 'nao', 'não', 'false', 'falso', 'off'].includes(v)) return false;
  return defaultValue;
}

function findMatchesByName(items, getName, wanted) {
  const targetNorm = normalizeForMatch(wanted);
  if (!targetNorm) return [];
  const exact = items.filter((item) => normalizeForMatch(getName(item)) === targetNorm);
  if (exact.length) return exact;
  const includesTarget = items.filter((item) => normalizeForMatch(getName(item)).includes(targetNorm));
  if (includesTarget.length) return includesTarget;
  return items.filter((item) => {
    const itemNorm = normalizeForMatch(getName(item));
    return targetNorm.includes(itemNorm);
  });
}

function findUniqueByName(items, getName, wanted, label) {
  const matches = findMatchesByName(items, getName, wanted);
  if (!matches.length) return { ok: false, reason: `${label} não encontrado: "${wanted}".` };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `${label} ambíguo: "${wanted}". Opções: ${matches.slice(0, 5).map((m) => getName(m)).join(', ')}`,
    };
  }
  return { ok: true, item: matches[0] };
}

function parseCategories(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildActionFromIntent(intent) {
  if (!intent) return { ok: false, reason: 'Comando vazio.' };
  if (intent.kind === 'help' || intent.kind === 'state' || intent.kind === 'pending' || intent.kind === 'menu' || intent.kind === 'shortcut') {
    return { ok: true, kind: intent.kind, payload: {} };
  }

  if (intent.kind === 'increment_order_item') {
    if (!(intent.quantityDelta > 0)) return { ok: false, reason: 'A quantidade deve ser maior que zero.' };
    const cRes = findUniqueByName(appData.data.clientes || [], (c) => c.nome, intent.clientName, 'Cliente');
    if (!cRes.ok) return cRes;
    const client = cRes.item;
    const pedidosDoCliente = (appData.data.pedidos || []).filter((p) => String(p.id_cliente) === String(client.id));
    if (!pedidosDoCliente.length) return { ok: false, reason: `Não há pedidos para o cliente "${client.nome}".` };
    const pRes = findUniqueByName(pedidosDoCliente, (p) => p.produto, intent.productName, 'Produto do pedido');
    if (!pRes.ok) return pRes;
    const pedidoProduto = pRes.item;
    const currentQty = Number(pedidoProduto.quantidade) || 0;
    const nextQty = currentQty + intent.quantityDelta;
    if (!(nextQty >= 0)) return { ok: false, reason: 'Quantidade final inválida.' };
    return {
      ok: true,
      kind: intent.kind,
      payload: {
        pedidoId: pedidoProduto.id,
        clientId: client.id,
        clientName: client.nome,
        productName: pedidoProduto.produto,
        beforeQty: currentQty,
        deltaQty: intent.quantityDelta,
        afterQty: nextQty,
        day: pedidoProduto.dia_semana || '',
      },
    };
  }

  if (intent.kind === 'update_order_status_client') {
    const allowed = new Set(['pendente', 'pronto', 'entregue', 'cancelado']);
    if (!allowed.has(intent.status)) {
      return { ok: false, reason: `Status inválido: "${intent.status}". Use pendente, pronto, entregue ou cancelado.` };
    }
    const cRes = findUniqueByName(appData.data.clientes || [], (c) => c.nome, intent.clientName, 'Cliente');
    if (!cRes.ok) return cRes;
    const client = cRes.item;
    const pedidosDoCliente = (appData.data.pedidos || []).filter((p) => String(p.id_cliente) === String(client.id));
    if (!pedidosDoCliente.length) return { ok: false, reason: `Não há pedidos para o cliente "${client.nome}".` };
    const pedidosAlvo = intent.day
      ? pedidosDoCliente.filter((p) => normalizeText(p.dia_semana) === normalizeText(intent.day))
      : pedidosDoCliente;
    if (!pedidosAlvo.length) {
      return { ok: false, reason: `Não encontrei pedidos de "${client.nome}" para o dia "${intent.day}".` };
    }
    return {
      ok: true,
      kind: 'pedido_status_update',
      payload: {
        clientId: client.id,
        clientName: client.nome,
        status: intent.status,
        day: intent.day || '',
        affectedCount: pedidosAlvo.length,
      },
    };
  }

  if (intent.kind !== 'structured') return { ok: false, reason: 'Comando não suportado.' };
  const { entity, action, args } = intent;

  if (entity === 'pedido') {
    if (action === 'criar') {
      const clienteNome = args.cliente || args.nome_cliente || '';
      const produtoNome = args.produto || '';
      const qtd = parsePtNumber(args.quantidade);
      const dia = normalizeDay(args.dia || '');
      if (!clienteNome || !produtoNome || !(qtd > 0)) {
        return { ok: false, reason: 'Use: /pedido criar cliente=\"Nome\" produto=\"Produto\" quantidade=3 [dia=\"segunda-feira\"]' };
      }
      const cRes = findUniqueByName(appData.data.clientes || [], (c) => c.nome, clienteNome, 'Cliente');
      if (!cRes.ok) return cRes;
      const pRes = findUniqueByName(appData.data.produtos || [], (p) => p.nome, produtoNome, 'Produto');
      if (!pRes.ok) return pRes;
      const client = cRes.item;
      const product = pRes.item;
      return {
        ok: true,
        kind: 'pedido_create',
        payload: {
          clientId: client.id,
          clientName: client.nome,
          productName: product.nome,
          quantidade: qtd,
          categoria: args.categoria || '',
          dia: dia || args.dia_semana || '',
          tipoVenda: args.tipo || args.tipo_venda || '',
          observacoes: args.observacoes || args.obs || '',
          status: args.status || 'pendente',
        },
      };
    }

    const clienteNome = args.cliente || '';
    const produtoNome = args.produto || '';
    const diaFiltro = normalizeDay(args.dia || '');
    if (!clienteNome || !produtoNome) {
      return { ok: false, reason: 'Informe cliente e produto. Ex.: /pedido editar cliente=\"X\" produto=\"Y\" quantidade=5' };
    }
    const cRes = findUniqueByName(appData.data.clientes || [], (c) => c.nome, clienteNome, 'Cliente');
    if (!cRes.ok) return cRes;
    const client = cRes.item;
    const pedidosDoCliente = (appData.data.pedidos || []).filter((p) => String(p.id_cliente) === String(client.id));
    const byProduto = findMatchesByName(pedidosDoCliente, (p) => p.produto, produtoNome);
    const candidatos = diaFiltro ? byProduto.filter((p) => normalizeText(p.dia_semana) === normalizeText(diaFiltro)) : byProduto;
    if (!candidatos.length) return { ok: false, reason: 'Pedido não encontrado com os critérios informados.' };
    if (candidatos.length > 1) {
      return { ok: false, reason: `Mais de um pedido encontrado para "${client.nome}/${produtoNome}". Informe o campo dia.` };
    }
    const pedido = candidatos[0];

    if (action === 'editar') {
      const updates = {};
      if (args.quantidade != null) {
        const qtd = parsePtNumber(args.quantidade);
        if (!(qtd >= 0)) return { ok: false, reason: 'Quantidade inválida.' };
        updates.quantidade = qtd;
      }
      if (args.dia != null) updates.dia_semana = normalizeDay(args.dia);
      if (args.tipo != null || args.tipo_venda != null) updates.tipo_venda = args.tipo ?? args.tipo_venda;
      if (args.observacoes != null || args.obs != null) updates.observacoes = args.observacoes ?? args.obs;
      if (args.categoria != null) updates.categoria = args.categoria;
      if (args.status != null) updates.status = args.status;
      return {
        ok: true,
        kind: 'pedido_edit',
        payload: { pedidoId: pedido.id, clientName: client.nome, productName: pedido.produto, before: pedido, updates },
      };
    }

    if (action === 'remover_item' || action === 'excluir') {
      return {
        ok: true,
        kind: 'pedido_delete',
        payload: { pedidoId: pedido.id, clientName: client.nome, productName: pedido.produto, quantidade: pedido.quantidade, dia: pedido.dia_semana },
      };
    }
  }

  if (entity === 'cliente') {
    if (action === 'criar') {
      const nome = args.nome || args.cliente || '';
      if (!nome) return { ok: false, reason: 'Use: /cliente criar nome=\"Nome\" [campo=valor...]' };
      const exists = findMatchesByName(appData.data.clientes || [], (c) => c.nome, nome);
      if (exists.length) return { ok: false, reason: `Já existe cliente com nome parecido: ${exists[0].nome}` };
      return {
        ok: true,
        kind: 'cliente_create',
        payload: {
          nome,
          observacoes: args.observacoes || args.obs || '',
          prazoBoleto: args.prazoboleto || '',
          acumulaPedidos: parseBoolPt(args.acumulapedidos, false),
          diasAcumulo: args.diasacumulo || '',
          prazoBoletoAcumulo: args.prazoboletoacumulo || '',
          periodoEntrega: args.periodoentrega || '',
          horarioMaximo: args.horariomaximo || '',
          cobraEntrega: parseBoolPt(args.cobraentrega, false),
          precos: [],
        },
      };
    }

    const nome = args.nome || args.cliente || '';
    if (!nome) return { ok: false, reason: 'Informe o cliente: /cliente editar nome=\"Nome\" ...' };
    const cRes = findUniqueByName(appData.data.clientes || [], (c) => c.nome, nome, 'Cliente');
    if (!cRes.ok) return cRes;
    const cliente = cRes.item;

    if (action === 'editar') {
      const updates = {};
      if (args.novo_nome != null) updates.nome = args.novo_nome;
      if (args.observacoes != null || args.obs != null) updates.observacoes = args.observacoes ?? args.obs;
      if (args.prazoboleto != null) updates.prazoBoleto = args.prazoboleto;
      if (args.acumulapedidos != null) updates.acumulaPedidos = parseBoolPt(args.acumulapedidos, cliente.acumulaPedidos);
      if (args.diasacumulo != null) updates.diasAcumulo = args.diasacumulo;
      if (args.prazoboletoacumulo != null) updates.prazoBoletoAcumulo = args.prazoboletoacumulo;
      if (args.periodoentrega != null) updates.periodoEntrega = args.periodoentrega;
      if (args.horariomaximo != null) updates.horarioMaximo = args.horariomaximo;
      if (args.cobraentrega != null) updates.cobraEntrega = parseBoolPt(args.cobraentrega, cliente.cobraEntrega);
      return { ok: true, kind: 'cliente_edit', payload: { clientId: cliente.id, beforeName: cliente.nome, updates } };
    }

    if (action === 'excluir') {
      const pedidosAfetados = (appData.data.pedidos || []).filter((p) => String(p.id_cliente) === String(cliente.id)).length;
      return { ok: true, kind: 'cliente_delete', payload: { clientId: cliente.id, clientName: cliente.nome, pedidosAfetados } };
    }

    if (action === 'preco_add') {
      const produto = args.produto || '';
      const preco = parsePtNumber(args.preco);
      if (!produto || !(preco > 0)) return { ok: false, reason: 'Use: /cliente preco_add nome=\"Cliente\" produto=\"Produto\" preco=12.5' };
      const pRes = findUniqueByName(appData.data.produtos || [], (p) => p.nome, produto, 'Produto');
      if (!pRes.ok) return pRes;
      return { ok: true, kind: 'cliente_preco_add', payload: { clientId: cliente.id, clientName: cliente.nome, productName: pRes.item.nome, preco } };
    }

    if (action === 'preco_remove') {
      const produto = args.produto || '';
      if (!produto) return { ok: false, reason: 'Use: /cliente preco_remove nome=\"Cliente\" produto=\"Produto\"' };
      const pRes = findUniqueByName(appData.data.produtos || [], (p) => p.nome, produto, 'Produto');
      if (!pRes.ok) return pRes;
      return { ok: true, kind: 'cliente_preco_remove', payload: { clientId: cliente.id, clientName: cliente.nome, productName: pRes.item.nome } };
    }
  }

  if (entity === 'produto') {
    if (action === 'criar') {
      const nome = args.nome || args.produto || '';
      if (!nome) return { ok: false, reason: 'Use: /produto criar nome=\"Produto\" [precobase=0] [categorias=\"A,B\"]' };
      const exists = findMatchesByName(appData.data.produtos || [], (p) => p.nome, nome);
      if (exists.length) return { ok: false, reason: `Já existe produto com nome parecido: ${exists[0].nome}` };
      return {
        ok: true,
        kind: 'produto_create',
        payload: {
          nome,
          precoBase: parsePtNumber(args.precobase) || 0,
          categorias: parseCategories(args.categorias),
        },
      };
    }

    const nome = args.nome || args.produto || '';
    if (!nome) return { ok: false, reason: 'Informe o produto: /produto editar nome=\"Produto\" ...' };
    const pRes = findUniqueByName(appData.data.produtos || [], (p) => p.nome, nome, 'Produto');
    if (!pRes.ok) return pRes;
    const product = pRes.item;

    if (action === 'editar') {
      const updates = {};
      if (args.novo_nome != null) updates.nome = args.novo_nome;
      if (args.precobase != null) updates.precoBase = parsePtNumber(args.precobase) || 0;
      if (args.categorias != null) updates.categorias = parseCategories(args.categorias);
      const pedidosAfetados = (appData.data.pedidos || []).filter((p) => normalizeText(p.produto) === normalizeText(product.nome)).length;
      return { ok: true, kind: 'produto_edit', payload: { beforeName: product.nome, updates, pedidosAfetados } };
    }

    if (action === 'excluir') {
      const pedidosAfetados = (appData.data.pedidos || []).filter((p) => normalizeText(p.produto) === normalizeText(product.nome)).length;
      return { ok: true, kind: 'produto_delete', payload: { productName: product.nome, pedidosAfetados } };
    }
  }

  return { ok: false, reason: 'Comando não suportado. Use /ajuda para ver exemplos.' };
}

function applyAction(action) {
  if (!action || !action.ok) return { ok: false, reason: 'Ação inválida.' };
  const payload = action.payload || {};
  if (action.kind === 'increment_order_item') {
    const idx = (appData.data.pedidos || []).findIndex((p) => String(p.id) === String(payload.pedidoId));
    if (idx < 0) return { ok: false, reason: 'Pedido não encontrado para aplicar a alteração.' };
    const current = Number(appData.data.pedidos[idx].quantidade) || 0;
    const next = current + Number(payload.deltaQty || 0);
    if (!(next >= 0)) return { ok: false, reason: 'Quantidade final inválida.' };
    appData.data.pedidos[idx].quantidade = next;
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return {
      ok: true,
      message: `Atualizado: ${payload.clientName} / ${payload.productName} de ${current} para ${next}.`,
    };
  }
  if (action.kind === 'pedido_create') {
    const id = `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    appData.data.pedidos.push({
      id,
      id_cliente: payload.clientId,
      cliente: payload.clientName,
      dia_semana: payload.dia || '',
      produto: payload.productName,
      categoria: payload.categoria || '',
      quantidade: payload.quantidade,
      tipo_venda: payload.tipoVenda || '',
      observacoes: payload.observacoes || '',
      status: payload.status || 'pendente',
    });
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Pedido criado para ${payload.clientName}: ${payload.productName} (${payload.quantidade}).` };
  }
  if (action.kind === 'pedido_edit') {
    const idx = (appData.data.pedidos || []).findIndex((p) => String(p.id) === String(payload.pedidoId));
    if (idx < 0) return { ok: false, reason: 'Pedido não encontrado para edição.' };
    appData.data.pedidos[idx] = { ...appData.data.pedidos[idx], ...payload.updates };
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Pedido atualizado: ${payload.clientName} / ${payload.productName}.` };
  }
  if (action.kind === 'pedido_status_update') {
    let changed = 0;
    (appData.data.pedidos || []).forEach((p) => {
      if (String(p.id_cliente) !== String(payload.clientId)) return;
      if (payload.day && normalizeText(p.dia_semana) !== normalizeText(payload.day)) return;
      p.status = payload.status;
      changed += 1;
    });
    if (!changed) return { ok: false, reason: 'Nenhum pedido foi atualizado com os critérios informados.' };
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return {
      ok: true,
      message: `Status atualizado para "${payload.status}" em ${changed} pedido(s) de ${payload.clientName}${payload.day ? ` (${payload.day})` : ''}.`,
    };
  }
  if (action.kind === 'pedido_delete') {
    const before = appData.data.pedidos.length;
    appData.data.pedidos = appData.data.pedidos.filter((p) => String(p.id) !== String(payload.pedidoId));
    if (appData.data.pedidos.length === before) return { ok: false, reason: 'Pedido não encontrado para exclusão.' };
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Pedido removido: ${payload.clientName} / ${payload.productName}.` };
  }
  if (action.kind === 'pedido_status_update') {
    return `Confirma atualizar status dos pedidos?\n\nCliente: ${p.clientName}\nNovo status: ${p.status}\nDia: ${p.day || 'todos'}\nPedidos afetados: ${p.affectedCount}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'cliente_create') {
    appData.data.clientes.push({
      id: `client_${Date.now()}`,
      ...payload,
    });
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Cliente criado: ${payload.nome}.` };
  }
  if (action.kind === 'cliente_edit') {
    const idx = appData.data.clientes.findIndex((c) => String(c.id) === String(payload.clientId));
    if (idx < 0) return { ok: false, reason: 'Cliente não encontrado para edição.' };
    appData.data.clientes[idx] = { ...appData.data.clientes[idx], ...payload.updates };
    if (payload.updates.nome && payload.updates.nome !== payload.beforeName) {
      appData.data.pedidos.forEach((p) => {
        if (String(p.id_cliente) === String(payload.clientId)) p.cliente = payload.updates.nome;
      });
    }
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Cliente atualizado: ${payload.beforeName}.` };
  }
  if (action.kind === 'cliente_delete') {
    appData.data.clientes = appData.data.clientes.filter((c) => String(c.id) !== String(payload.clientId));
    appData.data.pedidos = appData.data.pedidos.filter((p) => String(p.id_cliente) !== String(payload.clientId));
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Cliente removido: ${payload.clientName}. Pedidos removidos: ${payload.pedidosAfetados}.` };
  }
  if (action.kind === 'cliente_preco_add') {
    const idx = appData.data.clientes.findIndex((c) => String(c.id) === String(payload.clientId));
    if (idx < 0) return { ok: false, reason: 'Cliente não encontrado.' };
    if (!Array.isArray(appData.data.clientes[idx].precos)) appData.data.clientes[idx].precos = [];
    const list = appData.data.clientes[idx].precos;
    const pidx = list.findIndex((p) => normalizeText(p.produto) === normalizeText(payload.productName));
    if (pidx >= 0) list[pidx].preco = payload.preco;
    else list.push({ produto: payload.productName, preco: payload.preco });
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Preço especial salvo para ${payload.clientName} / ${payload.productName}: ${payload.preco}.` };
  }
  if (action.kind === 'cliente_preco_remove') {
    const idx = appData.data.clientes.findIndex((c) => String(c.id) === String(payload.clientId));
    if (idx < 0) return { ok: false, reason: 'Cliente não encontrado.' };
    const before = Array.isArray(appData.data.clientes[idx].precos) ? appData.data.clientes[idx].precos.length : 0;
    appData.data.clientes[idx].precos = (appData.data.clientes[idx].precos || []).filter(
      (p) => normalizeText(p.produto) !== normalizeText(payload.productName)
    );
    if (before === appData.data.clientes[idx].precos.length) return { ok: false, reason: 'Preço especial não encontrado.' };
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Preço especial removido para ${payload.clientName} / ${payload.productName}.` };
  }
  if (action.kind === 'produto_create') {
    appData.data.produtos.push({
      nome: payload.nome,
      precoBase: payload.precoBase,
      categorias: Array.isArray(payload.categorias) ? payload.categorias : [],
    });
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Produto criado: ${payload.nome}.` };
  }
  if (action.kind === 'produto_edit') {
    const idx = appData.data.produtos.findIndex((p) => normalizeText(p.nome) === normalizeText(payload.beforeName));
    if (idx < 0) return { ok: false, reason: 'Produto não encontrado para edição.' };
    appData.data.produtos[idx] = { ...appData.data.produtos[idx], ...payload.updates };
    if (payload.updates.nome && payload.updates.nome !== payload.beforeName) {
      appData.data.pedidos.forEach((p) => {
        if (normalizeText(p.produto) === normalizeText(payload.beforeName)) p.produto = payload.updates.nome;
      });
    }
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Produto atualizado: ${payload.beforeName}.` };
  }
  if (action.kind === 'produto_delete') {
    appData.data.produtos = appData.data.produtos.filter((p) => normalizeText(p.nome) !== normalizeText(payload.productName));
    appData.data.pedidos = appData.data.pedidos.filter((p) => normalizeText(p.produto) !== normalizeText(payload.productName));
    appData.lastUpdate = new Date().toISOString();
    saveData();
    return { ok: true, message: `Produto removido: ${payload.productName}. Pedidos removidos: ${payload.pedidosAfetados}.` };
  }
  return { ok: false, reason: 'Tipo de ação não suportado.' };
}

function isChatAllowed(chatId) {
  if (!TELEGRAM_ALLOWED_CHAT_IDS.size) return true;
  return TELEGRAM_ALLOWED_CHAT_IDS.has(String(chatId));
}

async function tgApi(method, body) {
  if (!TELEGRAM_BOT_TOKEN) return null;
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Telegram ${method} falhou: ${res.status} ${txt}`);
  }
  return res.json();
}

async function tgGetFilePath(fileId) {
  const res = await tgApi('getFile', { file_id: fileId });
  if (!res || !res.ok || !res.result || !res.result.file_path) {
    throw new Error('Não foi possível obter arquivo de voz no Telegram.');
  }
  return res.result.file_path;
}

async function transcribeAudioFromTelegram(filePath) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada para transcrição de áudio.');
  }
  const url = `${TELEGRAM_API_BASE}/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(url);
  if (!fileRes.ok) throw new Error('Falha ao baixar áudio do Telegram.');
  const audioBuffer = Buffer.from(await fileRes.arrayBuffer());

  const form = new FormData();
  form.append('model', OPENAI_TRANSCRIBE_MODEL);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');

  const transRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });
  if (!transRes.ok) {
    const txt = await transRes.text();
    throw new Error(`Falha na transcrição: ${transRes.status} ${txt}`);
  }
  const data = await transRes.json();
  return String(data.text || '').trim();
}

const PENDING_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const pendingConfirmations = new Map(); // chatId -> { action, createdAt, sourceText }

function cleanupExpiredPendingConfirmations() {
  const now = Date.now();
  for (const [chatId, pending] of pendingConfirmations.entries()) {
    if (now - Number(pending.createdAt || 0) > PENDING_CONFIRMATION_TTL_MS) {
      pendingConfirmations.delete(chatId);
    }
  }
}

function getStateSummaryText() {
  const pedidos = Array.isArray(appData.data.pedidos) ? appData.data.pedidos.length : 0;
  const clientes = Array.isArray(appData.data.clientes) ? appData.data.clientes.length : 0;
  const produtos = Array.isArray(appData.data.produtos) ? appData.data.produtos.length : 0;
  return `Resumo atual:\n- Pedidos: ${pedidos}\n- Clientes: ${clientes}\n- Produtos: ${produtos}\n- Última atualização: ${appData.lastUpdate}`;
}

function getHelpText() {
  return (
    'Comandos disponíveis (sempre com confirmação antes de salvar):\n\n' +
    '1) Pedidos\n' +
    '- /pedido criar cliente="Felicori" produto="Rúcula" quantidade=3 dia="segunda-feira"\n' +
    '- /pedido editar cliente="Felicori" produto="Rúcula" quantidade=5\n' +
    '- /pedido excluir cliente="Felicori" produto="Rúcula" dia="segunda-feira"\n' +
    '- Texto natural: "acrescentar 3 rúculas ao pedido do Felicori"\n\n' +
    '2) Clientes\n' +
    '- /cliente criar nome="Felicori" observacoes="..." periodoEntrega="manha"\n' +
    '- /cliente editar nome="Felicori" novo_nome="Felicori Loja" cobraEntrega=sim\n' +
    '- /cliente preco_add nome="Felicori" produto="Rúcula" preco=7.9\n' +
    '- /cliente preco_remove nome="Felicori" produto="Rúcula"\n' +
    '- /cliente excluir nome="Felicori"\n\n' +
    '3) Produtos\n' +
    '- /produto criar nome="Rúcula" precoBase=4.5 categorias="Buque,Desfolhado"\n' +
    '- /produto editar nome="Rúcula" novo_nome="Rúcula Hidro" precoBase=5.2\n' +
    '- /produto excluir nome="Rúcula"\n\n' +
    'Utilitários:\n' +
    '- /estado\n' +
    '- /pendente\n' +
    '- /ajuda\n\n' +
    'Confirmação:\n' +
    '- confirmar | sim | ok | pode\n' +
    '- cancelar | não | nao'
  );
}

function getShortcutTemplateText(target) {
  const map = {
    pedido_criar: 'Modelo:\npedido criar cliente="Nome do cliente" produto="Nome do produto" quantidade=3 dia="segunda-feira"',
    pedido_editar: 'Modelo:\npedido editar cliente="Nome do cliente" produto="Nome do produto" quantidade=5',
    pedido_excluir: 'Modelo:\npedido excluir cliente="Nome do cliente" produto="Nome do produto" dia="segunda-feira"',
    cliente_criar: 'Modelo:\ncliente criar nome="Nome do cliente" observacoes="..." cobraEntrega=sim',
    cliente_editar: 'Modelo:\ncliente editar nome="Cliente atual" novo_nome="Novo nome"',
    cliente_excluir: 'Modelo:\ncliente excluir nome="Nome do cliente"',
    produto_criar: 'Modelo:\nproduto criar nome="Rucula" precoBase=4.5 categorias="Buque,Desfolhado"',
    produto_editar: 'Modelo:\nproduto editar nome="Rucula" novo_nome="Rucula Hidro" precoBase=5.2',
    produto_excluir: 'Modelo:\nproduto excluir nome="Rucula"',
  };
  return map[target] || 'Modelo não encontrado.';
}

function getMainMenuMarkup() {
  return {
    keyboard: [
      ['Menu', '/ajuda', '/estado', '/pendente'],
      ['Pedido criar', 'Pedido editar', 'Pedido excluir'],
      ['Cliente criar', 'Cliente editar', 'Cliente excluir'],
      ['Produto criar', 'Produto editar', 'Produto excluir'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function tgSendMessage(chatId, text, options = {}) {
  const payload = { chat_id: chatId, text };
  if (options.withMenu) payload.reply_markup = getMainMenuMarkup();
  await tgApi('sendMessage', payload);
}

function requiresConfirmation(action) {
  if (!action || !action.kind) return false;
  return !['help', 'state', 'pending', 'menu', 'shortcut'].includes(action.kind);
}

function formatActionPreview(action) {
  const p = action.payload || {};
  if (action.kind === 'pedido_create') {
    return `Confirma criar pedido?\n\nCliente: ${p.clientName}\nProduto: ${p.productName}\nQuantidade: ${p.quantidade}\nDia: ${p.dia || '(vazio)'}\nTipo: ${p.tipoVenda || '(vazio)'}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'pedido_edit') {
    return `Confirma editar pedido?\n\nCliente: ${p.clientName}\nProduto: ${p.productName}\nCampos alterados: ${Object.keys(p.updates || {}).join(', ') || '(nenhum)'}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'pedido_delete') {
    return `Confirma excluir pedido?\n\nCliente: ${p.clientName}\nProduto: ${p.productName}\nQuantidade: ${p.quantidade}\nDia: ${p.dia || '(vazio)'}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'cliente_create') {
    return `Confirma criar cliente?\n\nNome: ${p.nome}\nPeríodo: ${p.periodoEntrega || '(vazio)'}\nHorário máximo: ${p.horarioMaximo || '(vazio)'}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'cliente_edit') {
    return `Confirma editar cliente?\n\nCliente: ${p.beforeName}\nCampos alterados: ${Object.keys(p.updates || {}).join(', ') || '(nenhum)'}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'cliente_delete') {
    return `Confirma excluir cliente?\n\nCliente: ${p.clientName}\nPedidos que também serão excluídos: ${p.pedidosAfetados}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'cliente_preco_add') {
    return `Confirma salvar preço especial?\n\nCliente: ${p.clientName}\nProduto: ${p.productName}\nPreço: ${p.preco}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'cliente_preco_remove') {
    return `Confirma remover preço especial?\n\nCliente: ${p.clientName}\nProduto: ${p.productName}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'produto_create') {
    return `Confirma criar produto?\n\nNome: ${p.nome}\nPreço base: ${p.precoBase}\nCategorias: ${(p.categorias || []).join(', ') || '(vazio)'}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'produto_edit') {
    return `Confirma editar produto?\n\nProduto: ${p.beforeName}\nCampos alterados: ${Object.keys(p.updates || {}).join(', ') || '(nenhum)'}\nPedidos que podem ser impactados: ${p.pedidosAfetados}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'produto_delete') {
    return `Confirma excluir produto?\n\nProduto: ${p.productName}\nPedidos que também serão excluídos: ${p.pedidosAfetados}\n\nResponda com: confirmar ou cancelar`;
  }
  if (action.kind === 'increment_order_item') {
    return (
      `Confirma esta alteração?\n\n` +
      `Cliente: ${p.clientName}\n` +
      `Produto: ${p.productName}\n` +
      `Quantidade: ${p.beforeQty} + ${p.deltaQty} = ${p.afterQty}\n` +
      `${p.day ? `Dia: ${p.day}\n` : ''}` +
      `\nResponda com: confirmar ou cancelar`
    );
  }
  return 'Confirma executar a ação? Responda com confirmar ou cancelar.';
}

async function handleTelegramText(chatId, text) {
  cleanupExpiredPendingConfirmations();
  const incoming = String(text || '').trim();
  if (!incoming) return;
  const normalized = normalizeText(incoming);
  const confirma = new Set(['confirmar', 'confirmo', 'sim', 'ok', 'pode']);
  const cancela = new Set(['cancelar', 'cancela', 'nao', 'não']);

  const pending = pendingConfirmations.get(String(chatId));
  if (pending && (confirma.has(normalized) || cancela.has(normalized))) {
    if (cancela.has(normalized)) {
      pendingConfirmations.delete(String(chatId));
      await tgSendMessage(chatId, 'Cancelamento confirmado. Ação cancelada sem alterações.', { withMenu: true });
      return;
    }
    await tgSendMessage(chatId, 'Confirmação recebida. Executando a ação...', { withMenu: true });
    const result = applyAction(pending.action);
    pendingConfirmations.delete(String(chatId));
    if (!result.ok) {
      await tgSendMessage(chatId, `Erro na execução: ${result.reason}`, { withMenu: true });
      return;
    }
    // Broadcast via WebSocket após atualização
    broadcast({ type: 'update', data: appData }, wss);
    await tgSendMessage(chatId, `Concluído com sucesso. ${result.message}`, { withMenu: true });
    return;
  }

  if (pending && !(confirma.has(normalized) || cancela.has(normalized))) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        'Há uma ação pendente aguardando resposta.\n' +
        'Responda com "confirmar" para executar ou "cancelar" para desistir.\n\n' +
        `${formatActionPreview(pending.action)}`,
    });
    return;
  }

  await tgSendMessage(chatId, `Comando recebido: "${incoming}"`, { withMenu: true });

  const intent = parseCommandIntent(incoming);
  if (!intent) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        'Não entendi o comando.\n' +
        'Exemplo: "acrescentar 3 rúculas ao pedido do Felicori".\n' +
        'Também aceito áudio com esse mesmo formato.',
    });
    return;
  }

  const action = buildActionFromIntent(intent);
  if (!action.ok) {
    await tgSendMessage(chatId, `Erro ao preparar a ação: ${action.reason}`, { withMenu: true });
    return;
  }

  if (action.kind === 'menu') {
    await tgSendMessage(chatId, 'Menu aberto. Toque em um atalho ou envie sua mensagem livre.', { withMenu: true });
    return;
  }
  if (action.kind === 'help') {
    await tgSendMessage(chatId, `Solicitação processada com sucesso.\n\n${getHelpText()}`, { withMenu: true });
    return;
  }
  if (action.kind === 'state') {
    await tgSendMessage(chatId, `Solicitação processada com sucesso.\n\n${getStateSummaryText()}`, { withMenu: true });
    return;
  }
  if (action.kind === 'shortcut') {
    await tgSendMessage(chatId, `Atalho selecionado.\n\n${getShortcutTemplateText(intent.target)}`, { withMenu: true });
    return;
  }
  if (action.kind === 'pending') {
    const currentPending = pendingConfirmations.get(String(chatId));
    if (!currentPending) {
      await tgSendMessage(chatId, 'Não há ação pendente de confirmação.', { withMenu: true });
      return;
    }
    const ageSec = Math.max(0, Math.floor((Date.now() - Number(currentPending.createdAt || 0)) / 1000));
    await tgSendMessage(
      chatId,
      'Há uma ação pendente.\n' + `${formatActionPreview(currentPending.action)}\n` + `\nTempo em espera: ${ageSec}s`,
      { withMenu: true }
    );
    return;
  }

  if (requiresConfirmation(action)) {
    await tgApi('sendMessage', { chat_id: chatId, text: 'Pré-confirmação: revise os dados abaixo antes da execução.' });
  }
  pendingConfirmations.set(String(chatId), {
    action,
    createdAt: Date.now(),
    sourceText: incoming,
  });
  await tgApi('sendMessage', { chat_id: chatId, text: formatActionPreview(action) });
}

async function processTelegramUpdate(update) {
  const msg = update && (update.message || update.edited_message);
  if (!msg || !msg.chat || !msg.chat.id) return;
  const chatId = msg.chat.id;
  if (!isChatAllowed(chatId)) {
    await tgApi('sendMessage', { chat_id: chatId, text: 'Este chat não está autorizado para comandos.' });
    return;
  }

  try {
    if (msg.text) {
      await handleTelegramText(chatId, msg.text);
      return;
    }

    if ((msg.voice && msg.voice.file_id) || (msg.audio && msg.audio.file_id)) {
      await tgApi('sendMessage', { chat_id: chatId, text: 'Áudio recebido. Transcrevendo...' });
      const filePath = await tgGetFilePath((msg.voice && msg.voice.file_id) || msg.audio.file_id);
      const text = await transcribeAudioFromTelegram(filePath);
      if (!text) {
        await tgApi('sendMessage', { chat_id: chatId, text: 'Não consegui transcrever o áudio. Tente novamente.' });
        return;
      }
      await tgApi('sendMessage', { chat_id: chatId, text: `Transcrição concluída com sucesso: "${text}"` });
      await handleTelegramText(chatId, text);
      return;
    }

    await tgApi('sendMessage', { chat_id: chatId, text: 'Envie texto ou áudio com comando.' });
  } catch (e) {
    console.error('Erro no processamento de update Telegram:', e);
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `Erro ao processar comando: ${e.message || 'erro desconhecido'}`,
    });
  }
}

async function startTelegramLongPolling() {
  if (!TELEGRAM_BOT_TOKEN) return;
  let offset = 0;
  console.log('Telegram bot ativo (long polling).');
  while (true) {
    try {
      const res = await fetch(
        `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=30&offset=${offset}`,
        { method: 'GET' }
      );
      if (!res.ok) throw new Error(`Falha getUpdates: ${res.status}`);
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.description || 'Falha no Telegram');
      for (const update of payload.result || []) {
        offset = Number(update.update_id) + 1;
        // eslint-disable-next-line no-await-in-loop
        await processTelegramUpdate(update);
      }
    } catch (e) {
      console.error('Loop Telegram com erro, retomando em 5s:', e.message || e);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Broadcast para todos os clientes
function broadcast(data, wss) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Criar servidor (HTTP ou HTTPS)
let server;
const PORT = process.env.PORT || 3001;
const USE_HTTPS = process.env.USE_HTTPS === 'true';

if (USE_HTTPS && fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
  const options = {
    cert: fs.readFileSync('cert.pem'),
    key: fs.readFileSync('key.pem')
  };
  server = https.createServer(options, app);
  console.log('Usando HTTPS');
} else {
  server = http.createServer(app);
  console.log('Usando HTTP');
}

const wss = new WebSocket.Server({ server });

// WebSocket
wss.on('connection', (ws) => {
  console.log('Cliente conectado');
  
  // Enviar dados atuais
  ws.send(JSON.stringify({
    type: 'init',
    data: appData
  }));
  
  // Receber mensagens
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      if (msg.type === 'update') {
        // Atualizar dados
        appData = msg.data;
        appData.lastUpdate = new Date().toISOString();
        
        // Salvar no arquivo
        saveData();
        
        // Broadcast para todos
        broadcast({
          type: 'update',
          data: appData
        }, wss);
        
        console.log('Dados atualizados e sincronizados');
      }
    } catch (e) {
      console.error('Erro ao processar mensagem:', e);
    }
  });
  
  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});

// API REST para compatibilidade
app.get('/api/data', (req, res) => {
  res.json(appData);
});

app.post('/api/data', (req, res) => {
  try {
    appData = req.body;
    appData.lastUpdate = new Date().toISOString();
    saveData();
    
    // Broadcast via WebSocket
    broadcast({
      type: 'update',
      data: appData
    }, wss);
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Carregar dados ao iniciar
loadData();

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
  const protocol = USE_HTTPS ? 'https' : 'http';
  console.log(`Servidor rodando em ${protocol}://localhost:${PORT}`);
  if (TELEGRAM_BOT_TOKEN) {
    startTelegramLongPolling().catch((e) => {
      console.error('Falha ao iniciar integração Telegram:', e);
    });
  } else {
    console.log('Telegram desativado (defina TELEGRAM_BOT_TOKEN para habilitar).');
  }
});
