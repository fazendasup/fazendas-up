const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const IS_TELEGRAM_HARNESS = process.argv.includes('--telegram-test');

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
/** Se true, permite qualquer chat mesmo com TELEGRAM_ALLOWED_CHAT_IDS vazio (só use em dev). */
const TELEGRAM_ALLOW_ALL_CHATS_EXPLICIT =
  String(process.env.TELEGRAM_ALLOW_ALL_CHATS || '').toLowerCase() === 'true';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const DEEPSEEK_API_KEY = String(process.env.DEEPSEEK_API_KEY || '').trim();
/**
 * USE_DEEPSEEK=true ou DEEPSEEK_API_KEY definida: chat (NL + QA) usa https://api.deepseek.com/v1 por padrão.
 * Ainda pode sobrescrever com OPENAI_COMPAT_BASE_URL.
 */
const USE_DEEPSEEK_CHAT =
  String(process.env.USE_DEEPSEEK || '').toLowerCase() === 'true' || !!DEEPSEEK_API_KEY;
/** Chave Bearer para /chat/completions (OpenAI, DeepSeek ou outro compatível). */
const OPENAI_COMPAT_API_KEY =
  String(process.env.OPENAI_COMPAT_API_KEY || '').trim() || DEEPSEEK_API_KEY || OPENAI_API_KEY;
/**
 * Base URL até /v1 (ex.: https://api.openai.com/v1 ou https://api.deepseek.com/v1).
 */
const OPENAI_COMPAT_CHAT_BASE = (
  process.env.OPENAI_COMPAT_BASE_URL ||
  (USE_DEEPSEEK_CHAT ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1')
).replace(/\/$/, '');
const OPENAI_COMPAT_CHAT_URL = `${OPENAI_COMPAT_CHAT_BASE}/chat/completions`;
/** Whisper: só OpenAI (ou provedor com mesma rota). Separado para usar só DeepSeek no chat. */
const OPENAI_TRANSCRIBE_BASE = (process.env.OPENAI_TRANSCRIBE_BASE_URL || 'https://api.openai.com/v1').replace(
  /\/$/,
  ''
);
const OPENAI_TRANSCRIBE_URL = `${OPENAI_TRANSCRIBE_BASE}/audio/transcriptions`;
const OPENAI_TRANSCRIBE_API_KEY = String(
  process.env.OPENAI_TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY || ''
).trim();
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const OPENAI_INTENT_MODEL =
  process.env.OPENAI_INTENT_MODEL || (USE_DEEPSEEK_CHAT ? 'deepseek-chat' : 'gpt-4o-mini');
const TELEGRAM_NL_LLM = String(process.env.TELEGRAM_NL_LLM || '').toLowerCase() === 'true';
/** Se true, repete cada comando recebido antes de processar (ruidoso; só depuração). */
const TELEGRAM_ECHO_INCOMING = String(process.env.TELEGRAM_ECHO_INCOMING || '').toLowerCase() === 'true';
/** Com OPENAI_API_KEY: responde perguntas analíticas sobre os dados quando não for comando estruturado. false = desliga. */
const TELEGRAM_DATA_QA = String(process.env.TELEGRAM_DATA_QA || 'true').toLowerCase() !== 'false';
const OPENAI_QA_MODEL =
  process.env.OPENAI_QA_MODEL || (USE_DEEPSEEK_CHAT ? 'deepseek-chat' : 'gpt-4o-mini');
const OPENAI_QA_MAX_TOKENS = Math.min(8192, Math.max(256, Number(process.env.OPENAI_QA_MAX_TOKENS || 2000)));
const ENABLE_GIT_SYNC = String(process.env.ENABLE_GIT_SYNC || '').toLowerCase() === 'true';
const GIT_SYNC_BRANCH = process.env.GIT_SYNC_BRANCH || 'main';
const GIT_REPO_ROOT = __dirname;
const GIT_IDENT = [
  '-c',
  `user.name=${process.env.GIT_SYNC_USER_NAME || 'Fazendas Telegram'}`,
  '-c',
  `user.email=${process.env.GIT_SYNC_USER_EMAIL || 'fazendas-sync@local'}`,
];

if (
  TELEGRAM_BOT_TOKEN &&
  String(process.env.TELEGRAM_DNS_IPV4_FIRST || 'true').toLowerCase() !== 'false'
) {
  try {
    const dns = require('dns');
    if (typeof dns.setDefaultResultOrder === 'function') {
      dns.setDefaultResultOrder('ipv4first');
    }
  } catch (_) {
    /* ignore */
  }
}

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
let _saveDataSuppressed = false;
function saveData() {
  if (_saveDataSuppressed) return;
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

async function runGit(args, opts = {}) {
  const { env: extraEnv, ...rest } = opts;
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: GIT_REPO_ROOT,
    maxBuffer: 20 * 1024 * 1024,
    ...rest,
    env: { ...process.env, ...(extraEnv || {}) },
  });
  return { stdout: String(stdout || ''), stderr: String(stderr || '') };
}

async function abortInterruptedGitOps() {
  const gitDir = path.join(GIT_REPO_ROOT, '.git');
  if (!fs.existsSync(gitDir)) return;
  try {
    if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
      await runGit(['rebase', '--abort']);
    }
  } catch (_) {
    /* ignore */
  }
}

function gitMergeRecordArraysByKey(baseArr, oursArr, theirsArr, getKey) {
  const safeBase = Array.isArray(baseArr) ? baseArr : [];
  const safeOurs = Array.isArray(oursArr) ? oursArr : [];
  const safeTheirs = Array.isArray(theirsArr) ? theirsArr : [];
  const bM = new Map(safeBase.map((x) => [getKey(x), x]));
  const keys = new Set([...safeOurs.map((x) => getKey(x)), ...safeTheirs.map((x) => getKey(x))]);
  const out = [];
  for (const k of keys) {
    const b = bM.get(k);
    const o = safeOurs.find((x) => getKey(x) === k);
    const t = safeTheirs.find((x) => getKey(x) === k);
    if (o && !t) {
      out.push(o);
      continue;
    }
    if (t && !o) {
      out.push(t);
      continue;
    }
    if (!o || !t) continue;
    const oCh = !b || JSON.stringify(o) !== JSON.stringify(b);
    const tCh = !b || JSON.stringify(t) !== JSON.stringify(b);
    if (oCh && !tCh) out.push(o);
    else if (tCh && !oCh) out.push(t);
    else if (oCh && tCh && JSON.stringify(o) !== JSON.stringify(t)) {
      out.push({ ...(typeof b === 'object' && b ? b : {}), ...t, ...o });
    } else out.push(o);
  }
  return out;
}

function gitMergeAppDataThreeWay(base, ours, theirs) {
  const bd = base && base.data ? base.data : {};
  const od = ours && ours.data ? ours.data : {};
  const td = theirs && theirs.data ? theirs.data : {};
  const data = {
    pedidos: gitMergeRecordArraysByKey(bd.pedidos, od.pedidos, td.pedidos, (p) => String(p.id)),
    clientes: gitMergeRecordArraysByKey(bd.clientes, od.clientes, td.clientes, (c) => String(c.id)),
    produtos: gitMergeRecordArraysByKey(bd.produtos, od.produtos, td.produtos, (p) => normalizeText(p.nome)),
    prioridades: { ...bd.prioridades, ...td.prioridades, ...od.prioridades },
    estoqueFatores: { ...bd.estoqueFatores, ...td.estoqueFatores, ...od.estoqueFatores },
    estoqueDesativados: { ...bd.estoqueDesativados, ...td.estoqueDesativados, ...od.estoqueDesativados },
    estoqueMix: { ...bd.estoqueMix, ...td.estoqueMix, ...od.estoqueMix },
    estoqueModoCompra: { ...bd.estoqueModoCompra, ...td.estoqueModoCompra, ...od.estoqueModoCompra },
    estoqueRendimentoKilo: { ...bd.estoqueRendimentoKilo, ...td.estoqueRendimentoKilo, ...od.estoqueRendimentoKilo },
    estoqueMixFolhaLeve:
      od.estoqueMixFolhaLeve !== undefined
        ? od.estoqueMixFolhaLeve
        : td.estoqueMixFolhaLeve !== undefined
          ? td.estoqueMixFolhaLeve
          : bd.estoqueMixFolhaLeve,
  };
  const dates = [base && base.lastUpdate, ours && ours.lastUpdate, theirs && theirs.lastUpdate].filter(Boolean);
  dates.sort();
  return { data, lastUpdate: dates[dates.length - 1] || new Date().toISOString() };
}

function gitErrorText(e) {
  if (!e) return 'erro desconhecido no Git';
  const stderr = e.stderr != null ? String(e.stderr) : '';
  const stdout = e.stdout != null ? String(e.stdout) : '';
  const msg = e.message ? String(e.message) : '';
  return [stderr, stdout, msg].map((s) => s.trim()).filter(Boolean).join('\n') || 'erro desconhecido no Git';
}

async function readGitJsonFromStage(stage) {
  const { stdout } = await runGit(['show', `:${stage}:dados-sync.json`]);
  return JSON.parse(stdout);
}

async function tryResolveDadosSyncMergeConflict() {
  const { stdout } = await runGit(['ls-files', '-u', '--', 'dados-sync.json']);
  if (!stdout.trim()) return false;
  let base;
  let ours;
  let theirs;
  try {
    base = await readGitJsonFromStage(1);
    ours = await readGitJsonFromStage(2);
    theirs = await readGitJsonFromStage(3);
  } catch (_) {
    return false;
  }
  const merged = gitMergeAppDataThreeWay(base, ours, theirs);
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2));
  await runGit(['add', '--', 'dados-sync.json']);
  await runGit([
    ...GIT_IDENT,
    'commit',
    '-m',
    'Merge dados-sync.json (resolução automática Telegram)',
  ]);
  return true;
}

async function tryPublishGitAfterTelegramSync() {
  if (!ENABLE_GIT_SYNC) return { ok: true, skipped: true };
  if (!fs.existsSync(path.join(GIT_REPO_ROOT, '.git'))) {
    return { ok: false, reason: 'Diretório .git não encontrado.' };
  }
  let stashed = false;
  try {
    await abortInterruptedGitOps();
    await runGit(['add', '--', 'dados-sync.json']);
    let hasStaged = false;
    try {
      await runGit(['diff', '--cached', '--quiet', '--', 'dados-sync.json']);
    } catch (_) {
      hasStaged = true;
    }
    if (hasStaged) {
      const msg = `Sincronizar dados Telegram - ${new Date().toLocaleString('pt-BR')} (comando-telegram)`;
      await runGit([...GIT_IDENT, 'commit', '-m', msg, '--', 'dados-sync.json']);
    }
    const { stdout: porcel } = await runGit(['status', '--porcelain']);
    const otherDirty = porcel
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .some((line) => !line.endsWith('dados-sync.json'));
    if (otherDirty) {
      await runGit(['stash', 'push', '-u', '-m', 'fazendas-up: pre-pull (Telegram sync)']);
      stashed = true;
    }
    await runGit(['fetch', 'origin', GIT_SYNC_BRANCH]);
    try {
      await runGit(['pull', '--no-rebase', 'origin', GIT_SYNC_BRANCH], {
        env: { GIT_MERGE_AUTOEDIT: 'no' },
      });
    } catch (pullErr) {
      const { stdout: unmerged } = await runGit(['diff', '--name-only', '--diff-filter=U']);
      const files = unmerged
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const onlyData = files.length === 1 && files[0] === 'dados-sync.json';
      const dataAmong = files.length > 0 && files.includes('dados-sync.json');
      if (onlyData) {
        const resolved = await tryResolveDadosSyncMergeConflict();
        if (!resolved) {
          return {
            ok: false,
            reason:
              'Conflito em dados-sync.json sem merge automático possível. Resolva com git add/commit ou merge --abort.',
          };
        }
      } else if (dataAmong && files.length > 1) {
        const detail = gitErrorText(pullErr);
        return {
          ok: false,
          reason: `Conflito de merge em: ${files.join(', ')}. Resolva manualmente (git add/commit), depois push. ${detail}`,
        };
      } else {
        throw pullErr;
      }
    }
    await runGit(['push', 'origin', `HEAD:${GIT_SYNC_BRANCH}`]);
    loadData();
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, reason: gitErrorText(e) };
  } finally {
    if (stashed) {
      try {
        await runGit(['stash', 'pop']);
      } catch (e2) {
        console.error('Git stash pop falhou (resolva manualmente):', e2.message || e2);
      }
    }
  }
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
  const estoqueQ = parseEstoqueConsultaIntent(text);
  if (estoqueQ) return estoqueQ;
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

  // Verbos em infinitivo/imperativo (texto já sem acento — normalizeText)
  const nlStVerb =
    '(?:editar|edite|alterar|altere|mudar|mude|mudem|atualizar|atualize|atualizem)';

  // Atualizar status (várias formas naturais em PT-BR)
  const statusPatterns = [
    // "atualize o status do pedido de hoje da casa de tereza para pronto" [+ opcional do dia X]
    {
      re: new RegExp(
        `\\b${nlStVerb}\\s+(?:o\\s+)?status\\s+(?:do\\s+)?pedido(?:\\s+de\\s+hoje)?\\s+(?:do|da)\\s+(.+?)\\s+(?:para|pra)\\s+(pendente|pronto|entregue|cancelado)(?:\\s+do\\s+dia\\s+(.+))?$`,
        'i'
      ),
      dayFrom: (m) => normalizeDay(m[3] || ''),
    },
    // "mude o status do pedido de casa de tereza para entregue" ("de" = do cliente, não "de hoje")
    {
      re: new RegExp(
        `\\b${nlStVerb}\\s+(?:o\\s+)?status\\s+(?:do\\s+)?pedido\\s+de\\s+(?!hoje\\b)(.+?)\\s+(?:para|pra)\\s+(pendente|pronto|entregue|cancelado)(?:\\s+do\\s+dia\\s+(.+))?$`,
        'i'
      ),
      dayFrom: (m) => normalizeDay(m[3] || ''),
    },
    // "atualize o status de hoje do casa de teresa para entregue" (sem palavra "pedido")
    {
      re: new RegExp(
        `\\b${nlStVerb}\\s+(?:o\\s+)?status\\s+de\\s+hoje\\s+(?:do|da)\\s+(.+?)\\s+(?:para|pra)\\s+(pendente|pronto|entregue|cancelado)$`,
        'i'
      ),
      dayFrom: () => normalizeDay(weekdayTodayPtBr()),
    },
    // "atualize o pedido da padoca de hoje para entregue" (de hoje após o nome — deve vir ANTES do pedido da X para Y genérico)
    {
      re: new RegExp(
        `\\b${nlStVerb}\\s+(?:o\\s+)?pedido\\s+(?:do|da)\\s+(.+?)\\s+de\\s+hoje\\s+(?:para|pra)\\s+(pendente|pronto|entregue|cancelado)(?:\\s+do\\s+dia\\s+(.+))?$`,
        'i'
      ),
      dayFrom: (m) => (m[3] ? normalizeDay(m[3]) : normalizeDay(weekdayTodayPtBr())),
    },
    // "atualize o pedido de padoca de hoje para entregue" (mesmo caso com "de" em vez de da/do)
    {
      re: new RegExp(
        `\\b${nlStVerb}\\s+(?:o\\s+)?pedido\\s+de\\s+(?!hoje\\b)(.+?)\\s+de\\s+hoje\\s+(?:para|pra)\\s+(pendente|pronto|entregue|cancelado)(?:\\s+do\\s+dia\\s+(.+))?$`,
        'i'
      ),
      dayFrom: (m) => (m[3] ? normalizeDay(m[3]) : normalizeDay(weekdayTodayPtBr())),
    },
    // "atualize o pedido do/de pátio gourmet para entregue" (sem palavra "status")
    {
      re: new RegExp(
        `\\b${nlStVerb}\\s+(?:o\\s+)?pedido\\s+(?:(?:do|da)\\s+|de\\s+(?!hoje\\b))(.+?)\\s+(?:para|pra)\\s+(pendente|pronto|entregue|cancelado)(?:\\s+do\\s+dia\\s+(.+))?$`,
        'i'
      ),
      dayFrom: (m) => normalizeDay(m[3] || ''),
    },
  ];
  for (const { re, dayFrom } of statusPatterns) {
    const m = norm.match(re);
    if (m) {
      return {
        kind: 'update_order_status_client',
        clientName: m[1].trim(),
        status: m[2].trim(),
        day: dayFrom(m),
        rawText: text,
      };
    }
  }

  // "pedido casa de tereza pronto" | "pedido do patio gourmet para entregue"
  const rePedidoStatusNl = /^pedido\s+(?:(?:do|da)\s+)?(.+?)\s+(?:para\s+)?(pendente|pronto|entregue|cancelado)$/i;
  const pedSt = norm.match(rePedidoStatusNl);
  if (pedSt) {
    return {
      kind: 'update_order_status_client',
      clientName: pedSt[1].trim(),
      status: pedSt[2].trim(),
      day: '',
      rawText: text,
    };
  }

  const STRUCTURED_ACTIONS = {
    pedido: new Set(['criar', 'editar', 'excluir', 'remover_item']),
    cliente: new Set(['criar', 'editar', 'excluir', 'preco_add', 'preco_remove']),
    produto: new Set(['criar', 'editar', 'excluir']),
  };
  const slashMatch = text.match(/^\/?(pedido|cliente|produto)\s+([a-z_]+)\s*(.*)$/i);
  if (slashMatch) {
    const entity = normalizeText(slashMatch[1]);
    const action = normalizeText(slashMatch[2]);
    const allowed = STRUCTURED_ACTIONS[entity];
    if (allowed && allowed.has(action)) {
      return {
        kind: 'structured',
        entity,
        action,
        args: parseNamedArgs(slashMatch[3] || ''),
        rawText: text,
      };
    }
  }

  return null;
}

function normalizeFlexibleStatusToken(tok) {
  const v = normalizeText(tok || '');
  const map = {
    pronta: 'pronto',
    prontos: 'pronto',
    entregues: 'entregue',
    entregar: 'entregue',
    pendentes: 'pendente',
    cancelada: 'cancelado',
    canceladas: 'cancelado',
    cancelados: 'cancelado',
  };
  const t = map[v] || v;
  if (['pendente', 'pronto', 'entregue', 'cancelado'].includes(t)) return t;
  return '';
}

/** Aproxima o nome do cliente citado ao cadastro (tokens + substring). */
function guessClientNameFromUtterance(fragment) {
  let f = String(fragment || '')
    .replace(/\s+do\s+dia\s+.+$/i, '')
    .replace(/\b(hoje|amanha|amanhã|agora|ja|já|por\s+favor|pfv|pf)\b/gi, ' ')
    .replace(/\b(status|pedidos|encomendas|todos|todas)\b/gi, ' ')
    .trim();
  f = f.replace(/^((?:do|da|de)\s+)/i, '').trim();
  f = f.replace(/^(?:o|a|os|as)\s+pedido\s+(?:do|da|de)\s+/i, '').trim();
  f = f.replace(/^(?:a|o)\s+encomenda\s+(?:do|da|de)\s+/i, '').trim();
  if (f.length < 2) return '';
  const clientes = appData.data.clientes || [];
  const fn = normalizeForMatch(f);
  if (!fn) return f;
  let best = '';
  let score = 0;
  for (const c of clientes) {
    const cn = normalizeForMatch(c.nome);
    if (!cn) continue;
    if (cn === fn) return c.nome;
    if (cn.includes(fn) || fn.includes(cn)) {
      const s = Math.min(cn.length, fn.length);
      if (s > score) {
        score = s;
        best = c.nome;
      }
    }
  }
  if (best) return best;
  const ftokens = fn.split(' ').filter((t) => t.length > 2);
  const need = Math.min(2, ftokens.length || 1);
  for (const c of clientes) {
    const cn = normalizeForMatch(c.nome);
    let hit = 0;
    for (const t of ftokens) {
      if (cn.split(' ').some((p) => p === t || (t.length > 3 && (p.includes(t) || t.includes(p))))) hit += 1;
    }
    if (ftokens.length && hit >= need) return c.nome;
  }
  return f.trim();
}

function parseCommandIntentExpandedIncrement(norm, rawText) {
  const re =
    /\b(?:acrescent\w*|adicion\w*|som\w*|inclu\w*|mais)\s+([a-z0-9.,]+|um|uma|duas?|tres|três)\s+(.+?)\s+(?:no|no\s+|ao|ao\s+|pra\s+|para\s+)(?:o\s+)?pedido\s+(?:do|da)\s+(.+)$/i;
  const m = norm.match(re);
  if (!m) return null;
  return {
    kind: 'increment_order_item',
    quantityDelta: parseQtyPt(m[1]),
    productName: m[2].trim(),
    clientName: m[3].trim(),
    rawText,
  };
}

/**
 * Interpretação flexível quando os regex principais falham: pistas + cadastro de clientes.
 */
function parseCommandIntentExpanded(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const norm = normalizeText(text);

  const stMatch = norm.match(
    /\b(pendente|pendentes|pronto|pronta|prontos|entregue|entregues|entregar|cancelad[oa]s?|cancelado|cancelada)\b/i
  );
  if (!stMatch) return parseCommandIntentExpandedIncrement(norm, text);

  const canonical = normalizeFlexibleStatusToken(stMatch[1]);
  if (!canonical) return parseCommandIntentExpandedIncrement(norm, text);

  let score = 0;
  if (/\b(atualiz|alter|mud|marc|coloc|deix|fic|pass|bota|ponh|defin|registr|set|tirar|vir)\w*/.test(norm)) score += 2;
  if (/\b(status|situacao)\b/.test(norm)) score += 2;
  if (/\b(pedido|encomenda)\b/.test(norm)) score += 2;
  if (/\bhoje\b/.test(norm)) score += 1;
  if (/\bamanha\b|\bamanhã\b/.test(norm)) score += 1;
  if (/\b(?:do|da|de)\s+[a-zà-ú]/i.test(norm)) score += 1;

  let day = '';
  if (/\bhoje\b/.test(norm)) day = normalizeDay(weekdayTodayPtBr());
  if (/\bamanha\b|\bamanhã\b/.test(norm)) day = normalizeDay(weekdayTomorrowPtBr());

  let clientName = '';
  const p1 = norm.match(
    /(?:do|da|de)\s+(.+?)\s+(?:ta|tá|esta|está|fica|ficou|virou)\s+(?:como\s+)?(?:pendente|pronto|pronta|entregue|cancelad)/i
  );
  const p2 = norm.match(
    /(?:do|da|de)\s+(.+?)\s+(?:para|pra)\s+(?:pendente|pronto|pronta|entregue|cancelad)/i
  );
  const p3 = norm.match(
    /(?:pedido|encomenda)\s+(?:do|da|de)?\s*(.+?)\s+(?:para|pra)\s+(?:pendente|pronto|pronta|entregue|cancelad)/i
  );
  const p4 = norm.match(/^(.+?)\s+(?:para|pra)\s+(?:pendente|pronto|pronta|entregue|cancelad)/i);
  if (p1) clientName = p1[1].trim();
  else if (p2) clientName = p2[1].trim();
  else if (p3) clientName = p3[1].trim();
  else if (p4) clientName = p4[1].trim();

  if (!clientName) {
    const tail = norm.match(
      /^(.+?)\s+(?:esta\s+|está\s+|ta\s+|tá\s+)?(?:como\s+|em\s+)?(?:pendente|pronto|pronta|entregue|cancelad)/i
    );
    if (tail && tail[1]) clientName = tail[1].trim();
  }

  if (!clientName && score >= 3) {
    let rest = norm
      .replace(/\b(pendente|pendentes|pronto|pronta|prontos|entregue|entregues|cancelad[oa]s?)\b.*$/i, '')
      .trim();
    rest = rest
      .replace(
        /^(atualiz\w*|mud\w*|alter\w*|marc\w*|coloc\w*|deix\w*|defin\w*|registr\w*|bota\w*|ponh\w*)\s+(o\s+|a\s+|os\s+|as\s+)?(status\s+|os\s+status\s+|o\s+status\s+)?(de\s+hoje\s+|d[eoa]\s+hoje\s+)?(do\s+|da\s+|de\s+)?/i,
        ''
      )
      .trim();
    if (rest.length > 2) clientName = rest;
  }

  if (!clientName) return parseCommandIntentExpandedIncrement(norm, text);

  const cleaned = guessClientNameFromUtterance(clientName);
  if (cleaned.length < 2) return parseCommandIntentExpandedIncrement(norm, text);

  if (score < 2 && !/\b(pedido|encomenda|status|do\s+|da\s+|de\s+)\b/.test(norm) && norm.split(/\s+/).length > 8) {
    return parseCommandIntentExpandedIncrement(norm, text);
  }

  return {
    kind: 'update_order_status_client',
    clientName: cleaned,
    status: canonical,
    day,
    rawText: text,
    interpretacao: 'expandido',
  };
}

async function resolveIntentWithOpenAI(rawText) {
  if (!TELEGRAM_NL_LLM || !OPENAI_COMPAT_API_KEY) return null;
  const msg = String(rawText || '').trim();
  if (msg.length > 500 || msg.length < 3) return null;
  const list = (appData.data.clientes || []).map((c) => c.nome).slice(0, 140);
  const sys = `Classificador para hortifruti (Brasil). Responde só JSON válido.
Formatos:
{"type":"update_status","clientName":"","status":"pendente|pronto|entregue|cancelado","day":""}
{"type":"increment","clientName":"","productName":"","quantity":1}
{"type":"none"}

clientName: o mais próximo possível de um nome da lista (usa nome exato da lista se bater).
day: "" = todos os dias; string "hoje" se for só pedidos de hoje; ou "segunda-feira" etc.
Se não for comando de operação, {"type":"none"}.`;

  const user = `CLIENTES: ${JSON.stringify(list)}
MENSAGEM: ${msg}`;

  const opts = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_COMPAT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_INTENT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  };
  const sig = fetchTimeoutSignal(45000);
  if (sig) opts.signal = sig;
  let res;
  try {
    res = await outboundFetch(OPENAI_COMPAT_CHAT_URL, opts);
  } catch (_) {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  const txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!txt) return null;
  let j;
  try {
    j = JSON.parse(txt);
  } catch (_) {
    return null;
  }
  if (!j || j.type === 'none') return null;
  if (j.type === 'update_status') {
    const st = normalizeFlexibleStatusToken(j.status || '');
    if (!st) return null;
    let day = '';
    const dj = normalizeText(String(j.day || ''));
    if (dj === 'hoje') day = normalizeDay(weekdayTodayPtBr());
    else if (dj === 'amanha' || dj === 'amanhã') day = normalizeDay(weekdayTomorrowPtBr());
    else day = normalizeDay(j.day || '');
    const cn = String(j.clientName || '').trim();
    if (!cn) return null;
    return {
      kind: 'update_order_status_client',
      clientName: guessClientNameFromUtterance(cn) || cn,
      status: st,
      day,
      rawText,
      interpretacao: 'llm',
    };
  }
  if (j.type === 'increment') {
    const q = parseQtyPt(j.quantity != null ? String(j.quantity) : '1');
    if (!(q > 0)) return null;
    const cn = String(j.clientName || '').trim();
    const pn = String(j.productName || '').trim();
    if (!cn || !pn) return null;
    return {
      kind: 'increment_order_item',
      quantityDelta: q,
      productName: pn,
      clientName: guessClientNameFromUtterance(cn) || cn,
      rawText,
      interpretacao: 'llm',
    };
  }
  return null;
}

const TELEGRAM_QA_CONTEXT_MAX_CHARS = Math.min(120000, Math.max(20000, Number(process.env.TELEGRAM_QA_CONTEXT_MAX_CHARS || 90000)));

function buildTelegramDataContextForQA() {
  const d = appData.data || {};
  const clientesById = new Map((d.clientes || []).map((c) => [String(c.id), c]));
  const pedidos = (d.pedidos || []).map((p) => {
    const c = clientesById.get(String(p.id_cliente));
    return {
      id: p.id,
      cliente: c ? c.nome : `(id ${p.id_cliente})`,
      produto: p.produto,
      quantidade: p.quantidade,
      dia_semana: p.dia_semana,
      status: p.status,
      tipo_venda: p.tipo_venda,
    };
  });
  const snapshot = {
    ultimaAtualizacao: appData.lastUpdate,
    resumo: {
      totalPedidos: pedidos.length,
      totalClientes: (d.clientes || []).length,
      totalProdutos: (d.produtos || []).length,
    },
    clientes: (d.clientes || []).map((c) => ({
      id: c.id,
      nome: c.nome,
      observacoes: c.observacoes,
      cobraEntrega: c.cobraEntrega,
      periodoEntrega: c.periodoEntrega,
      prazoBoleto: c.prazoBoleto,
    })),
    produtos: (d.produtos || []).map((p) => ({
      nome: p.nome,
      precoBase: p.precoBase,
      categorias: p.categorias,
    })),
    pedidos,
    estoque: {
      mixFolhaLeve: d.estoqueMixFolhaLeve || null,
      fatores: d.estoqueFatores || {},
      desativados: d.estoqueDesativados || {},
      mix: d.estoqueMix || {},
      modoCompra: d.estoqueModoCompra || {},
      rendimentoKilo: d.estoqueRendimentoKilo || {},
    },
    prioridades: d.prioridades || {},
  };

  let json = JSON.stringify(snapshot);
  if (json.length <= TELEGRAM_QA_CONTEXT_MAX_CHARS) return json;

  const pedidosResumoPorDia = {};
  const pedidosResumoPorCliente = {};
  const pedidosResumoPorProduto = {};
  for (const p of pedidos) {
    const day = p.dia_semana || '(sem dia)';
    pedidosResumoPorDia[day] = (pedidosResumoPorDia[day] || 0) + (Number(p.quantidade) || 0);
    const cli = p.cliente || '?';
    pedidosResumoPorCliente[cli] = (pedidosResumoPorCliente[cli] || 0) + (Number(p.quantidade) || 0);
    const pr = nomeChaveEstoque(p.produto);
    pedidosResumoPorProduto[pr] = (pedidosResumoPorProduto[pr] || 0) + (Number(p.quantidade) || 0);
  }

  const shrink = {
    ...snapshot,
    pedidos: pedidos.slice(-500),
    pedidosResumoPorDia,
    pedidosResumoPorCliente,
    pedidosResumoPorProduto,
    _nota:
      'Base grande: incluídos últimos 500 pedidos + resumos por dia/cliente/produto. Totais nos resumos referem-se a todos os pedidos carregados no servidor.',
  };
  json = JSON.stringify(shrink);
  if (json.length <= TELEGRAM_QA_CONTEXT_MAX_CHARS) return json;

  shrink.pedidos = pedidos.slice(-200);
  json = JSON.stringify(shrink);
  if (json.length <= TELEGRAM_QA_CONTEXT_MAX_CHARS) return json;

  delete shrink.clientes;
  shrink.clientesNomes = (d.clientes || []).map((c) => c.nome);
  json = JSON.stringify(shrink);
  if (json.length <= TELEGRAM_QA_CONTEXT_MAX_CHARS) return json;

  return JSON.stringify({
    aviso:
      'Conjunto muito grande: abaixo só resumos e amostra de pedidos. Totais por dia/cliente/produto refletem todos os pedidos no servidor.',
    ultimaAtualizacao: appData.lastUpdate,
    resumo: snapshot.resumo,
    pedidosResumoPorDia,
    pedidosResumoPorCliente,
    pedidosResumoPorProduto,
    amostraPedidos: pedidos.slice(-25),
    estoque: snapshot.estoque,
  });
}

function formatOpenAIChatError(status, bodyText) {
  const raw = String(bodyText || '');
  let apiMsg = '';
  try {
    const j = JSON.parse(raw);
    const err = j && j.error ? j.error : j;
    if (err && typeof err === 'object') apiMsg = String(err.message || '');
  } catch (_) {
    /* ignore */
  }
  const blob = `${raw} ${apiMsg}`.toLowerCase();
  if (
    /insufficient balance|insufficient_balance|insufficient_quota|no balance|out of balance|payment required|billing|credits?\s*(exhausted|insufficient)|\b402\b/.test(
      blob
    )
  ) {
    return (
      'Saldo ou créditos da conta do provedor de IA acabou (ex.: "Insufficient balance"). ' +
      'DeepSeek: https://platform.deepseek.com — recarregue saldo ou veja promoções/créditos. ' +
      'OpenAI: painel de billing. Depois teste de novo.'
    );
  }
  if (status === 401) {
    return 'Chave da API inválida ou sem permissão (OPENAI_API_KEY, DEEPSEEK_API_KEY ou OPENAI_COMPAT_API_KEY).';
  }
  if (status === 429) return 'Limite de taxa ou uso da API. Tente em instantes.';
  if (apiMsg && apiMsg.length < 280) return `API LLM: ${apiMsg}`;
  return `API LLM retornou erro HTTP ${status}.`;
}

async function answerTelegramDataQuestionWithOpenAI(userMessage) {
  const msg = String(userMessage || '').trim();
  if (msg.length < 2) return { ok: false, reason: 'Mensagem vazia.' };
  if (msg.length > 2400) return { ok: false, reason: 'Mensagem muito longa (máx. 2400 caracteres).' };
  if (!OPENAI_COMPAT_API_KEY) return { ok: false, reason: 'Configure OPENAI_API_KEY ou OPENAI_COMPAT_API_KEY.' };

  let context;
  try {
    context = buildTelegramDataContextForQA();
  } catch (e) {
    return { ok: false, reason: `Erro ao montar dados: ${e && e.message ? e.message : e}` };
  }

  const sys = `Você é assistente analítico do sistema Fazendas (hortifruti: pedidos por cliente, dia da semana e produto).
Você recebe um JSON com dados reais do negócio.

Regras:
- Responda em português do Brasil, com clareza.
- Baseie-se APENAS no JSON. Não invente pedidos, clientes, quantidades ou preços.
- Para totais, rankings, comparações entre dias ou clientes, derive dos pedidos e dos resumos (se existirem).
- Se a informação não existir nos dados, diga que não consta ou o que estaria faltando.
- Seja objetivo (Telegram); use listas e números quando fizer sentido.
- Pode fazer leitura analítica (destaques, comparações) desde que sustentada pelos dados.`;

  const user = `DADOS (JSON):\n${context}\n\n---\nPERGUNTA DO USUÁRIO:\n${msg}`;

  const opts = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_COMPAT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_QA_MODEL,
      temperature: 0.25,
      max_tokens: OPENAI_QA_MAX_TOKENS,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  };
  const sig = fetchTimeoutSignal(90000);
  if (sig) opts.signal = sig;
  let res;
  try {
    res = await outboundFetch(OPENAI_COMPAT_CHAT_URL, opts);
  } catch (e) {
    return { ok: false, reason: `Rede: ${explainFetchError(e)}` };
  }
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, reason: formatOpenAIChatError(res.status, raw) };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return { ok: false, reason: 'Resposta inválida da OpenAI.' };
  }
  const out =
    data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out || !String(out).trim()) return { ok: false, reason: 'Resposta vazia da IA.' };
  return { ok: true, text: `Análise (com base nos dados do sistema)\n\n${String(out).trim()}` };
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

/** Dia da semana (pt-BR) para filtrar "pedido de hoje" no mesmo fuso do servidor. */
function weekdayTodayPtBr() {
  const names = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
  ];
  return names[new Date().getDay()];
}

function weekdayTomorrowPtBr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const names = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
  ];
  return names[d.getDay()];
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

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const row = new Array(m + 1);
  for (let j = 0; j <= m; j++) row[j] = j;
  for (let i = 1; i <= n; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = row[j];
      const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[m];
}

/** Cliente por nome com tolerância a 1–2 erros de digitação (ex.: Teresa / Tereza). */
function findUniqueClienteByNameOrTypo(clientes, wanted) {
  const label = 'Cliente';
  const getName = (c) => c.nome;
  const base = findUniqueByName(clientes, getName, wanted, label);
  if (base.ok) return base;
  const raw = stripDiacritics(String(wanted || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (raw.length < 4) return base;
  let best = null;
  let bestD = Infinity;
  for (const c of clientes) {
    const cn = stripDiacritics(String(getName(c) || ''))
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const d = levenshtein(raw, cn);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const maxDist = raw.length <= 12 ? 2 : 3;
  if (best && bestD <= maxDist && bestD < Math.ceil(raw.length / 3)) {
    return { ok: true, item: best };
  }
  return base;
}

function parseCategories(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Mesma normalização de nome que o Estoque vivo no front (trim + NFC). */
function nomeChaveEstoque(raw) {
  const base = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '(sem nome)';
  try {
    return base.normalize('NFC');
  } catch (_) {
    return base;
  }
}

const ESTOQUE_MIX_MULT = 1.34;
const ESTOQUE_MIX_FOLHA_PADRAO = {
  referenciaProduto: 'Alface MIX',
  variedades: ['Alface Crespa Verde', 'Alface Crespa Roxa', 'Alface Americana'],
};

function normalizeEstoqueMixFolhaLeveData(raw) {
  const refPad = ESTOQUE_MIX_FOLHA_PADRAO.referenciaProduto;
  const varPad = [...ESTOQUE_MIX_FOLHA_PADRAO.variedades];
  if (!raw || typeof raw !== 'object') {
    return {
      referenciaProduto: nomeChaveEstoque(refPad),
      variedades: varPad.map(nomeChaveEstoque),
    };
  }
  const refIn =
    raw.referenciaProduto != null && String(raw.referenciaProduto).trim() !== ''
      ? String(raw.referenciaProduto).trim()
      : refPad;
  let vars = varPad;
  if (Array.isArray(raw.variedades) && raw.variedades.length > 0) {
    vars = raw.variedades.map((x) => String(x).trim()).filter(Boolean);
  }
  const seen = new Set();
  const variedades = [];
  for (const x of vars) {
    const kn = nomeChaveEstoque(x);
    if (seen.has(kn)) continue;
    seen.add(kn);
    variedades.push(kn);
  }
  if (!variedades.length) {
    for (const x of varPad) {
      const kn = nomeChaveEstoque(x);
      if (!seen.has(kn)) {
        seen.add(kn);
        variedades.push(kn);
      }
    }
  }
  return { referenciaProduto: nomeChaveEstoque(refIn), variedades };
}

function getEstoqueMixFolhaLeveCfgFromData(data) {
  return normalizeEstoqueMixFolhaLeveData(data && data.estoqueMixFolhaLeve);
}

function getProdutosAgregadosDia(data, diaFiltro) {
  const pedidosDia = (data.pedidos || []).filter((p) => p.dia_semana === diaFiltro);
  const prodMap = {};
  for (const p of pedidosDia) {
    const nome = nomeChaveEstoque(p.produto);
    if (!prodMap[nome]) prodMap[nome] = { nome, quantidade: 0 };
    prodMap[nome].quantidade += Number(p.quantidade) || 0;
  }
  return Object.values(prodMap).sort((a, b) => b.quantidade - a.quantidade);
}

function quantidadeReferenciaMixFolhaNoDia(data, diaFiltro, cfg) {
  const refKey = nomeChaveEstoque(cfg.referenciaProduto);
  let s = 0;
  for (const p of data.pedidos || []) {
    if (p.dia_semana !== diaFiltro) continue;
    if (nomeChaveEstoque(p.produto) === refKey) s += Number(p.quantidade) || 0;
  }
  return s;
}

function isVariedadeMixFolhaLeveNome(nomeProduto, cfg) {
  const k = nomeChaveEstoque(nomeProduto);
  return cfg.variedades.includes(k);
}

function parteIgualMixFolhaLeve(data, diaFiltro, cfg) {
  const n = cfg.variedades.length;
  if (n <= 0) return 0;
  return quantidadeReferenciaMixFolhaNoDia(data, diaFiltro, cfg) / n;
}

function unidadesAjustadasMixEstoqueSrv(nomeProduto, unidadesPedido, mixMarcado, data, diaFiltro, cfg) {
  const up = Number(unidadesPedido) || 0;
  if (isVariedadeMixFolhaLeveNome(nomeProduto, cfg) && mixMarcado) {
    return up + parteIgualMixFolhaLeve(data, diaFiltro, cfg);
  }
  if (!isVariedadeMixFolhaLeveNome(nomeProduto, cfg) && mixMarcado) {
    return up * ESTOQUE_MIX_MULT;
  }
  return up;
}

function estoqueInjetarLinhasMixFolhaSrv(lista, data, diaFiltro, cfg) {
  if (quantidadeReferenciaMixFolhaNoDia(data, diaFiltro, cfg) <= 0) return lista;
  const keys = new Set(lista.map((p) => nomeChaveEstoque(p.nome)));
  const extra = [];
  for (const v of cfg.variedades) {
    const k = nomeChaveEstoque(v);
    if (!keys.has(k)) {
      extra.push({ nome: k, quantidade: 0 });
      keys.add(k);
    }
  }
  if (!extra.length) return lista;
  return lista.concat(extra).sort((a, b) => b.quantidade - a.quantidade);
}

function isEstoqueDesativado(data, nomeProduto) {
  const k = nomeChaveEstoque(nomeProduto);
  const m = data.estoqueDesativados || {};
  return !!m[k];
}

function isEstoqueMixAtivoData(data, nomeProduto) {
  const k = nomeChaveEstoque(nomeProduto);
  return !!(data.estoqueMix && data.estoqueMix[k]);
}

function getEstoqueModoCompraData(data, nomeProduto) {
  const k = nomeChaveEstoque(nomeProduto);
  const m = data.estoqueModoCompra && data.estoqueModoCompra[k];
  return m === 'kilo' ? 'kilo' : 'unidade';
}

function getFatorEstoqueData(data, nomeProduto) {
  const k = nomeChaveEstoque(nomeProduto);
  const m = data.estoqueFatores && data.estoqueFatores[k];
  if (m === undefined || m === null || m === '') return null;
  const n = typeof m === 'number' ? m : parseFloat(String(m).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function getRendimentoKiloData(data, nomeProduto) {
  const k = nomeChaveEstoque(nomeProduto);
  const m = data.estoqueRendimentoKilo && data.estoqueRendimentoKilo[k];
  const n = typeof m === 'number' ? m : parseFloat(String(m).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function kgComprarPorRendimentoSrv(unidadesNecessarias, produtosPorKg) {
  const u = Number(unidadesNecessarias) || 0;
  const r = Number(produtosPorKg) || 0;
  if (r <= 0 || u <= 0) return 0;
  const raw = u / r;
  return Math.ceil(raw * 1000) / 1000;
}

function formatKgPtSrv(kg) {
  if (!Number.isFinite(kg) || kg <= 0) return '0';
  return kg.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function resolveEstoqueDiaFiltro(daySpec) {
  const t = normalizeText(String(daySpec || 'hoje'));
  if (t === 'hoje' || t === 'hj' || t === '') return weekdayTodayPtBr();
  if (t === 'amanha') return weekdayTomorrowPtBr();
  const nd = normalizeDay(t);
  if (nd) return nd;
  return weekdayTodayPtBr();
}

function diaLegivelPt(diaFiltro) {
  const map = {
    'segunda-feira': 'segunda-feira',
    'terça-feira': 'terça-feira',
    'quarta-feira': 'quarta-feira',
    'quinta-feira': 'quinta-feira',
    'sexta-feira': 'sexta-feira',
    sábado: 'sábado',
    domingo: 'domingo',
  };
  return map[diaFiltro] || diaFiltro;
}

function buildListaEstoqueDia(data, diaFiltro) {
  const cfg = getEstoqueMixFolhaLeveCfgFromData(data);
  let lista = getProdutosAgregadosDia(data, diaFiltro);
  lista = estoqueInjetarLinhasMixFolhaSrv(lista, data, diaFiltro, cfg);
  return lista.filter((row) => !isEstoqueDesativado(data, row.nome));
}

function computeLinhaCompraText(data, row, diaFiltro, cfg) {
  const nome = row.nome;
  const mix = isEstoqueMixAtivoData(data, nome);
  const unidadesPedido = Number(row.quantidade) || 0;
  const unidadesParaCompra = unidadesAjustadasMixEstoqueSrv(nome, unidadesPedido, mix, data, diaFiltro, cfg);
  const modo = getEstoqueModoCompraData(data, nome);
  const fator = getFatorEstoqueData(data, nome);
  const rend = getRendimentoKiloData(data, nome);
  const inMixFolha = isVariedadeMixFolhaLeveNome(nome, cfg);
  let mixTxt = mix ? 'sim' : 'não';
  if (inMixFolha && mix) {
    mixTxt += ` (mix folha: +${parteIgualMixFolhaLeve(data, diaFiltro, cfg).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} un. da parte do mix)`;
  } else if (!inMixFolha && mix) {
    mixTxt += ` (×${ESTOQUE_MIX_MULT} nas unidades do pedido)`;
  }
  if (modo === 'kilo') {
    if (rend <= 0) {
      return `Base pós-mix: ${unidadesParaCompra.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} un. — Configure rendimento (prod/kg) na tela Estoque vivo para ver kg.`;
    }
    const kg = kgComprarPorRendimentoSrv(unidadesParaCompra, rend);
    return `Base pós-mix: ${unidadesParaCompra.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} un. ÷ ${rend} prod/kg → ${formatKgPtSrv(kg)} kg a comprar.`;
  }
  if (fator == null) {
    return `Base pós-mix: ${unidadesParaCompra.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} un. — Informe o fator (insumo/unidade) na tela Estoque vivo para fechar unidades de compra.`;
  }
  const un = Math.ceil(unidadesParaCompra * fator);
  return `Base pós-mix: ${unidadesParaCompra.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} un. × fator ${fator} → ${un} un. de insumo a comprar.`;
}

function formatEstoqueCompraReply(data, productQuery, daySpec) {
  const diaFiltro = resolveEstoqueDiaFiltro(daySpec);
  const cfg = getEstoqueMixFolhaLeveCfgFromData(data);
  const lista = buildListaEstoqueDia(data, diaFiltro);
  const matches = findMatchesByName(lista, (x) => x.nome, productQuery);
  if (!matches.length) {
    const nomes = lista.map((x) => x.nome).slice(0, 12);
    const hint = nomes.length ? ` Ex.: ${nomes.join(', ')}` : '';
    return `Não encontrei "${productQuery}" no estoque do dia ${diaLegivelPt(diaFiltro)} (pedidos agregados + mix folha).${hint}`;
  }
  if (matches.length > 1) {
    return `Várias opções para "${productQuery}": ${matches.map((m) => m.nome).join(', ')}. Seja mais específico.`;
  }
  const row = matches[0];
  const nec = Number(row.quantidade) || 0;
  const bloco = computeLinhaCompraText(data, row, diaFiltro, cfg);
  return (
    `Estoque — ${diaLegivelPt(diaFiltro)}\n` +
    `Produto: ${row.nome}\n` +
    `Pedidos do dia (soma): ${nec} un.\n` +
    `${bloco}`
  );
}

function formatEstoqueResumoReply(data, daySpec) {
  const diaFiltro = resolveEstoqueDiaFiltro(daySpec);
  const cfg = getEstoqueMixFolhaLeveCfgFromData(data);
  const lista = buildListaEstoqueDia(data, diaFiltro);
  if (!lista.length) {
    return `Nenhum item no estoque para ${diaLegivelPt(diaFiltro)} (sem pedidos ou tudo desativado).`;
  }
  const lines = [`Compras — ${diaLegivelPt(diaFiltro)} (indicativo, igual à tela Estoque vivo):\n`];
  let n = 0;
  for (const row of lista) {
    if (n >= 35) {
      lines.push(`… e mais ${lista.length - 35} linha(s). Abra Estoque vivo no sistema.`);
      break;
    }
    const nec = Number(row.quantidade) || 0;
    const mix = isEstoqueMixAtivoData(data, row.nome) ? 'mix' : '—';
    const modo = getEstoqueModoCompraData(data, row.nome) === 'kilo' ? 'kg' : 'un';
    const one = computeLinhaCompraText(data, row, diaFiltro, cfg);
    const short = one.replace(/^Base pós-mix:\s*/i, '').trim();
    lines.push(`• ${row.nome}: pedidos ${nec} un. | ${mix} | ${modo} → ${short}`);
    n += 1;
  }
  return lines.join('\n');
}

/**
 * Consultas somente leitura ao estoque (compras do dia), espelhando a lógica do front.
 */
function parseEstoqueConsultaIntent(rawText) {
  const text = String(rawText || '').trim();
  const norm = normalizeText(text);
  if (!norm) return null;

  if (
    /^(?:\/|)(?:resumo\s+estoque|estoque\s+resumo|lista\s+compras|lista\s+de\s+compras|o\s+que\s+comprar|compras\s+do\s+dia)\b/.test(
      norm
    )
  ) {
    const dm = norm.match(
      /\b(hoje|amanha|hj|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/
    );
    return { kind: 'estoque_resumo', daySpec: dm ? dm[1] : 'hoje', rawText: text };
  }

  const hasDay = /\b(?:para|no\s+dia)\s+(hoje|amanha|hj|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/.test(
    norm
  );
  /** "quantas X preciso comprar" sem "para hoje" — assume hoje (igual à tela Estoque vivo). */
  const quantPrecisoComprar =
    /\b(?:quantos?|quantas?|quanto|quanta)\b/.test(norm) &&
    /\b(?:preciso|tenho\s+que|vou)\b/.test(norm) &&
    /\b(?:comprar|trazer|pedir)\b/.test(norm);
  const looksLikeBuy =
    (/\b(?:quantos?|quantas?|quanto|quanta|comprar|preciso\s+comprar|preciso\s+para|trazer|pedir)\b/.test(norm) &&
      (hasDay || /\bpara\s+hoje\b/.test(norm) || /\bcomprar\s+para\s+hoje\b/.test(norm))) ||
    quantPrecisoComprar;

  if (!looksLikeBuy) return null;

  let daySpec = 'hoje';
  const dm = norm.match(
    /\b(?:para|no\s+dia)\s+(hoje|amanha|hj|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/
  );
  if (dm) daySpec = dm[1];

  let normProd = norm.replace(
    /\b(?:para|no\s+dia)\s+(?:hoje|amanha|hj|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b.*$/,
    ''
  );
  normProd = normProd.replace(/\s+/g, ' ').trim();

  const qWord = '(?:quantos?|quantas?|quanto|quanta)';
  let productQuery = null;
  let m = normProd.match(new RegExp(`^${qWord}\\s+(.+)\\s+(?:eu\\s+)?preciso\\s+comprar\\s*$`));
  if (m) productQuery = m[1].trim();
  if (!productQuery) {
    m = normProd.match(new RegExp(`^${qWord}\\s+(?:de\\s+)?(.+)\\s+(?:eu\\s+)?preciso\\s*$`));
    if (m) productQuery = m[1].trim();
  }
  if (!productQuery) {
    m = normProd.match(new RegExp(`^preciso\\s+comprar\\s+${qWord}\\s+(?:de\\s+)?(.+)$`));
    if (m) productQuery = m[1].trim();
  }
  if (!productQuery) {
    m = normProd.match(
      new RegExp(`^${qWord}\\s+(.+?)\\s+(?:eu\\s+)?(?:vou\\s+)?(?:preciso|tenho\\s+que)\\s+(?:comprar|trazer)\\s*$`)
    );
    if (m) productQuery = m[1].trim();
  }
  if (!productQuery) return null;
  productQuery = productQuery.replace(/^(de|da|do)\s+/i, '').trim();
  if (productQuery.length < 2) return null;

  return { kind: 'estoque_compra_query', productQuery, daySpec, rawText: text };
}

function buildActionFromIntent(intent) {
  if (!intent) return { ok: false, reason: 'Comando vazio.' };
  if (intent.kind === 'help' || intent.kind === 'state' || intent.kind === 'pending' || intent.kind === 'menu' || intent.kind === 'shortcut') {
    return { ok: true, kind: intent.kind, payload: {} };
  }
  if (intent.kind === 'estoque_compra_query') {
    return {
      ok: true,
      kind: 'estoque_compra_query',
      payload: { productQuery: intent.productQuery, daySpec: intent.daySpec },
    };
  }
  if (intent.kind === 'estoque_resumo') {
    return { ok: true, kind: 'estoque_resumo', payload: { daySpec: intent.daySpec } };
  }

  if (intent.kind === 'increment_order_item') {
    if (!(intent.quantityDelta > 0)) return { ok: false, reason: 'A quantidade deve ser maior que zero.' };
    const cRes = findUniqueClienteByNameOrTypo(appData.data.clientes || [], intent.clientName);
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
    const cRes = findUniqueClienteByNameOrTypo(appData.data.clientes || [], intent.clientName);
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
      const cRes = findUniqueClienteByNameOrTypo(appData.data.clientes || [], clienteNome);
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
    const cRes = findUniqueClienteByNameOrTypo(appData.data.clientes || [], clienteNome);
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
    const cRes = findUniqueClienteByNameOrTypo(appData.data.clientes || [], nome);
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

/**
 * Lista vazia: só aceita chats se TELEGRAM_ALLOW_ALL_CHATS=true (dev).
 * Com IDs definidos: apenas esses chats (produção recomendada).
 */
function isChatAllowed(chatId) {
  if (TELEGRAM_ALLOWED_CHAT_IDS.size > 0) {
    return TELEGRAM_ALLOWED_CHAT_IDS.has(String(chatId));
  }
  return TELEGRAM_ALLOW_ALL_CHATS_EXPLICIT;
}

/** Token definido e política de chat permite ao menos um interlocutor válido. */
function shouldRunTelegramLongPolling() {
  if (!TELEGRAM_BOT_TOKEN) return false;
  if (TELEGRAM_ALLOWED_CHAT_IDS.size > 0) return true;
  return TELEGRAM_ALLOW_ALL_CHATS_EXPLICIT;
}

function fetchTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function explainFetchError(err) {
  if (!err || typeof err !== 'object') return String(err);
  const parts = [];
  const msg = err.message || String(err);
  parts.push(msg);
  let c = err.cause;
  let depth = 0;
  while (c && depth < 4) {
    if (c.code) parts.push(`código ${c.code}`);
    if (c.message && c.message !== msg) parts.push(c.message);
    if (typeof c.errno === 'number') parts.push(`errno ${c.errno}`);
    c = c.cause;
    depth += 1;
  }
  if (/fetch failed|UND_ERR_CONNECT_TIMEOUT|Connect Timeout Error/i.test(msg)) {
    parts.push(
      'Dica: firewall/proxy (HTTPS_PROXY); teste https://api.telegram.org. Ajuste TELEGRAM_FETCH_CONNECT_TIMEOUT_MS ou TELEGRAM_DNS_IPV4_FIRST.'
    );
  }
  return parts.filter(Boolean).join(' | ');
}

let _outboundUndici = null;
function getOutboundUndici() {
  if (_outboundUndici) return _outboundUndici;
  const undici = require('undici');
  const connectTimeout = Math.max(1000, Number(process.env.TELEGRAM_FETCH_CONNECT_TIMEOUT_MS || 90000));
  const agent = new undici.Agent({
    connectTimeout,
    headersTimeout: Math.max(connectTimeout, 180000),
    bodyTimeout: Math.max(connectTimeout, 180000),
  });
  _outboundUndici = { fetch: undici.fetch, agent };
  return _outboundUndici;
}

async function outboundFetch(url, init) {
  const { fetch: ufetch, agent } = getOutboundUndici();
  return ufetch(url, { ...init, dispatcher: agent });
}

async function tgApi(method, body) {
  if (!TELEGRAM_BOT_TOKEN) return null;
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  };
  const sig = fetchTimeoutSignal(90000);
  if (sig) opts.signal = sig;
  let res;
  try {
    res = await outboundFetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/${method}`, opts);
  } catch (e) {
    throw new Error(explainFetchError(e));
  }
  const rawText = await res.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch (e) {
    throw new Error(
      `Telegram ${method}: HTTP ${res.status}, resposta não é JSON: ${String(rawText).slice(0, 500)}`
    );
  }
  if (json.ok !== true) {
    const desc = json.description != null ? String(json.description) : JSON.stringify(json);
    throw new Error(`Telegram ${method}: ${desc}`);
  }
  return json;
}

async function tgGetFilePath(fileId) {
  const res = await tgApi('getFile', { file_id: fileId });
  if (!res || !res.result || !res.result.file_path) {
    throw new Error('Não foi possível obter arquivo de voz no Telegram.');
  }
  return res.result.file_path;
}

/** Mensagem curta em PT para o Telegram (evita colar JSON bruto da OpenAI). */
function formatOpenAITranscriptionError(status, bodyText) {
  let code = '';
  let apiMsg = '';
  try {
    const j = JSON.parse(String(bodyText || ''));
    const err = j && j.error ? j.error : j;
    if (err && typeof err === 'object') {
      code = String(err.code || err.type || '');
      apiMsg = String(err.message || '');
    }
  } catch (_) {
    /* ignore */
  }
  if (status === 401) {
    return 'Não consegui transcrever: a chave OpenAI (OPENAI_API_KEY) está inválida ou expirada no servidor.';
  }
  if (status === 429) {
    if (code === 'insufficient_quota' || /quota|billing|credits/i.test(apiMsg)) {
      return (
        'Não consegui transcrever: a cota ou o saldo da conta OpenAI acabou. ' +
        'Ajuste faturamento em https://platform.openai.com/account/billing — ou envie o comando em texto.'
      );
    }
    return 'Não consegui transcrever agora (limite de uso da OpenAI). Tente de novo em instantes ou envie em texto.';
  }
  if (status === 503 || status === 502) {
    return 'Serviço de transcrição indisponível no momento. Tente novamente em alguns minutos.';
  }
  if (apiMsg && apiMsg.length > 0 && apiMsg.length < 200 && !/^\s*\{/.test(apiMsg)) {
    return `Não consegui transcrever: ${apiMsg}`;
  }
  return `Não consegui transcrever (erro ${status}). Envie o pedido em texto ou tente mais tarde.`;
}

async function transcribeAudioFromTelegram(filePath) {
  if (!OPENAI_TRANSCRIBE_API_KEY) {
    throw new Error(
      'Chave não configurada para transcrição (Whisper). Defina OPENAI_API_KEY ou OPENAI_TRANSCRIBE_API_KEY (OpenAI).'
    );
  }
  const url = `${TELEGRAM_API_BASE}/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const dlOpts = {};
  const dlSig = fetchTimeoutSignal(120000);
  if (dlSig) dlOpts.signal = dlSig;
  let fileRes;
  try {
    fileRes = await outboundFetch(url, dlOpts);
  } catch (e) {
    throw new Error(explainFetchError(e));
  }
  if (!fileRes.ok) throw new Error('Falha ao baixar áudio do Telegram.');
  const audioBuffer = Buffer.from(await fileRes.arrayBuffer());

  const form = new FormData();
  form.append('model', OPENAI_TRANSCRIBE_MODEL);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');

  const trOpts = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_TRANSCRIBE_API_KEY}`,
    },
    body: form,
  };
  const trSig = fetchTimeoutSignal(120000);
  if (trSig) trOpts.signal = trSig;
  let transRes;
  try {
    transRes = await outboundFetch(OPENAI_TRANSCRIBE_URL, trOpts);
  } catch (e) {
    throw new Error(explainFetchError(e));
  }
  if (!transRes.ok) {
    const txt = await transRes.text();
    throw new Error(formatOpenAITranscriptionError(transRes.status, txt));
  }
  const data = await transRes.json();
  return String(data.text || '').trim();
}

const PENDING_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
/** @typedef {{ action?: object, createdAt: number, sourceText: string, phase?: string, intent?: object, clientId?: string }} PendingTelegram */
/** @type {Map<string, PendingTelegram>} */
const pendingConfirmations = new Map();

function getDistinctNormalizedOrderDaysForClient(clientId) {
  const counts = new Map();
  for (const p of appData.data.pedidos || []) {
    if (String(p.id_cliente) !== String(clientId)) continue;
    const raw = String(p.dia_semana || '').trim();
    const key = raw ? normalizeDay(raw) || normalizeText(raw) : '(sem dia)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** Interpreta a resposta à pergunta "qual dia?" antes de confirmar status. */
function resolveTelegramStatusDayChoice(normalized, clientId) {
  const counts = getDistinctNormalizedOrderDaysForClient(clientId);
  const allowedDays = [...counts.keys()].filter((d) => d !== '(sem dia)');

  if (['hoje', 'hj', 'so hoje'].includes(normalized)) {
    return { ok: true, day: normalizeDay(weekdayTodayPtBr()) };
  }
  if (normalized === 'amanha') {
    return { ok: true, day: normalizeDay(weekdayTomorrowPtBr()) };
  }
  if (
    ['todos', 'tudo', 'todas', 'geral', 'qualquer', 'qualquer dia'].includes(normalized) ||
    normalized === 'todos os dias' ||
    normalized.startsWith('todos os ')
  ) {
    return { ok: true, day: '' };
  }

  const direct = normalizeDay(normalized);
  if (direct && counts.has(direct)) return { ok: true, day: direct };

  for (const d of allowedDays) {
    const nd = normalizeText(d);
    if (normalized === nd) return { ok: true, day: d };
    const compact = nd.replace(/-feira$/, '');
    if (normalized === compact) return { ok: true, day: d };
  }

  const hint = allowedDays.length ? allowedDays.join(', ') : 'apenas "todos" se houver pedidos sem dia definido';
  return {
    ok: false,
    reason: `Não entendi o dia. Envie: hoje, amanhã, todos ou um destes: ${hint}.`,
  };
}

function buildStatusDayScopePrompt(clientName, status, clientId) {
  const counts = getDistinctNormalizedOrderDaysForClient(clientId);
  let total = 0;
  for (const n of counts.values()) total += n;
  const lines = [...counts.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt'))
    .map(([d, n]) => `• ${d}: ${n} pedido(s)`)
    .join('\n');
  const today = weekdayTodayPtBr();
  const tom = weekdayTomorrowPtBr();
  return (
    `O comando não indicou o dia do pedido (dia de entrega na semana).\n\n` +
    `Cliente: ${clientName}\n` +
    `Status desejado: ${status}\n\n` +
    `Pedidos deste cliente por dia:\n${lines || '• (nenhum)'}\n` +
    `Total: ${total}\n\n` +
    `Responda com:\n` +
    `• hoje — só pedidos com dia de entrega ${today} (hoje no calendário)\n` +
    `• amanhã — só pedidos com dia ${tom}\n` +
    `• todos — todos os ${total} pedido(s), em qualquer dia\n` +
    `• ou o nome do dia como está na lista (ex.: segunda-feira)\n\n` +
    `Envie cancelar para desistir.`
  );
}

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
    '- Texto natural: "acrescentar 3 rúculas ao pedido do Felicori"\n' +
    '- Status (várias formas): "atualize o status do pedido da Casa de Tereza para pronto"\n' +
    '  ou "atualize o status de hoje da Casa de Tereza para entregue"\n' +
    '  ou "atualize o pedido do Pátio Gourmet para entregue"\n' +
    '  ou "atualize o pedido da Padoca de hoje para entregue"\n' +
    '  ou atalho: "pedido Casa de Tereza pronto"\n' +
    '  Se não disser o dia, o bot pergunta: hoje, amanhã, todos ou o nome do dia.\n\n' +
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
    'Consulta estoque (só leitura, mesmo cálculo da tela Estoque vivo):\n' +
    '- "Quantos alface crespa eu preciso comprar para hoje"\n' +
    '- "Quanto de rúcula preciso para amanhã"\n' +
    '- "resumo estoque hoje" ou "lista compras para segunda-feira"\n\n' +
    'Perguntas livres sobre os dados (totais, comparações, análises): linguagem natural.\n' +
    'DeepSeek (recomendado): USE_DEEPSEEK=true e OPENAI_API_KEY=chave DeepSeek — ou DEEPSEEK_API_KEY=… (base api.deepseek.com automática).\n' +
    'Modelos: OPENAI_QA_MODEL=deepseek-chat ou deepseek-reasoner; TELEGRAM_NL_LLM=true usa o mesmo provedor.\n' +
    'Áudio: Whisper é só OpenAI — defina OPENAI_TRANSCRIBE_API_KEY se usar só DeepSeek no chat.\n' +
    'Desative perguntas livres: TELEGRAM_DATA_QA=false.\n\n' +
    'Interpretação NL (opcional): TELEGRAM_NL_LLM=true — modelo em OPENAI_INTENT_MODEL (padrão deepseek-chat se DeepSeek).\n\n' +
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

/** Limite seguro abaixo de 4096 (Telegram). */
const TELEGRAM_TEXT_MAX = 3900;

async function tgSendMessageChunked(chatId, text, options = {}) {
  const t = String(text || '');
  if (t.length <= TELEGRAM_TEXT_MAX) {
    await tgSendMessage(chatId, t, options);
    return;
  }
  let rest = t;
  while (rest.length > 0) {
    const part = rest.slice(0, TELEGRAM_TEXT_MAX);
    rest = rest.slice(TELEGRAM_TEXT_MAX);
    const last = rest.length === 0;
    await tgSendMessage(chatId, part, last ? options : { ...options, withMenu: false });
  }
}

function requiresConfirmation(action) {
  if (!action || !action.kind) return false;
  return !['help', 'state', 'pending', 'menu', 'shortcut', 'estoque_compra_query', 'estoque_resumo'].includes(action.kind);
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
  if (action.kind === 'pedido_status_update') {
    const dayLabel = p.day ? p.day : 'todos os dias (todos os pedidos deste cliente)';
    return (
      `Confirma atualizar status dos pedidos?\n\n` +
      `Cliente: ${p.clientName}\n` +
      `Novo status: ${p.status}\n` +
      `Dia: ${dayLabel}\n` +
      `Pedidos afetados: ${p.affectedCount}\n\n` +
      `Responda com: confirmar ou cancelar`
    );
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
  if (pending && pending.phase === 'status_day_scope') {
    if (cancela.has(normalized)) {
      pendingConfirmations.delete(String(chatId));
      await tgSendMessage(chatId, 'Cancelamento confirmado. Ação cancelada sem alterações.', { withMenu: true });
      return;
    }
    if (confirma.has(normalized)) {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          'Antes de confirmar, escolha o dia do pedido: hoje, amanhã, todos ou o nome do dia da lista anterior. Ou cancelar.',
      });
      return;
    }
    const pick = resolveTelegramStatusDayChoice(normalized, pending.clientId);
    if (!pick.ok) {
      await tgApi('sendMessage', { chat_id: chatId, text: pick.reason });
      return;
    }
    const intentScoped = { ...pending.intent, day: pick.day };
    const actionScoped = buildActionFromIntent(intentScoped);
    if (!actionScoped.ok) {
      await tgSendMessage(
        chatId,
        `Não foi possível usar essa opção: ${actionScoped.reason}\n\nEscolha outro dia ou envie cancelar.`,
        { withMenu: true }
      );
      return;
    }
    pendingConfirmations.set(String(chatId), {
      action: actionScoped,
      createdAt: Date.now(),
      sourceText: pending.sourceText,
    });
    await tgApi('sendMessage', { chat_id: chatId, text: 'Pré-confirmação: revise os dados abaixo antes da execução.' });
    await tgApi('sendMessage', { chat_id: chatId, text: formatActionPreview(actionScoped) });
    return;
  }

  if (pending && pending.action && (confirma.has(normalized) || cancela.has(normalized))) {
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
    broadcast({ type: 'update', data: appData }, wss);
    let successBody = `Concluído com sucesso. ${result.message}`;
    if (ENABLE_GIT_SYNC) {
      const gitResult = await tryPublishGitAfterTelegramSync();
      if (gitResult.ok && !gitResult.skipped) {
        broadcast({ type: 'update', data: appData }, wss);
        successBody += `\n\nGit: publicado em origin/${GIT_SYNC_BRANCH}.`;
      } else if (!gitResult.ok) {
        const detail =
          gitResult.reason.length > 2800 ? `${gitResult.reason.slice(0, 2800)}…` : gitResult.reason;
        successBody += `\n\nGit: Falha ao publicar no Git: ${detail}`;
      }
    }
    await tgSendMessageChunked(chatId, successBody, { withMenu: true });
    return;
  }

  if (pending && !(confirma.has(normalized) || cancela.has(normalized))) {
    if (pending.phase === 'status_day_scope' && pending.clientId && pending.intent) {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          'Ainda falta escolher o dia (hoje, amanhã, todos ou nome do dia).\n\n' +
          buildStatusDayScopePrompt(pending.intent.clientName, pending.intent.status, pending.clientId),
      });
      return;
    }
    await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        'Há uma ação pendente aguardando resposta.\n' +
        'Responda com "confirmar" para executar ou "cancelar" para desistir.\n\n' +
        `${formatActionPreview(pending.action)}`,
    });
    return;
  }

  if ((confirma.has(normalized) || cancela.has(normalized)) && !pendingConfirmations.get(String(chatId))) {
    await tgSendMessage(
      chatId,
      'Não há confirmação pendente. Use /ajuda para comandos ou faça uma pergunta sobre pedidos e clientes.',
      { withMenu: true }
    );
    return;
  }

  if (TELEGRAM_ECHO_INCOMING) {
    await tgSendMessage(chatId, `Comando recebido: "${incoming}"`, { withMenu: true });
  }

  let intent = parseCommandIntent(incoming);
  if (!intent) intent = parseCommandIntentExpanded(incoming);
  if (!intent) intent = await resolveIntentWithOpenAI(incoming);
  if (!intent) {
    if (TELEGRAM_DATA_QA && OPENAI_COMPAT_API_KEY) {
      const qa = await answerTelegramDataQuestionWithOpenAI(incoming);
      if (qa.ok) {
        await tgSendMessageChunked(chatId, qa.text, { withMenu: true });
        return;
      }
      await tgSendMessage(
        chatId,
        qa.reason ||
          'Não consegui gerar a análise agora. Verifique OPENAI_API_KEY / OPENAI_COMPAT_API_KEY ou tente de novo em instantes. Comandos: /ajuda',
        { withMenu: true }
      );
      return;
    }
    await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        'Não reconheci um comando. Para perguntas em linguagem natural sobre pedidos, clientes e totais, configure OPENAI_API_KEY (ou OPENAI_COMPAT_API_KEY) no servidor.\n\n' +
        'Exemplos de comando: "acrescentar 3 rúculas ao pedido do Felicori" ou "o pedido da Maria tá pronto". Também aceito áudio.',
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
    await tgSendMessageChunked(chatId, `Solicitação processada com sucesso.\n\n${getHelpText()}`, { withMenu: true });
    return;
  }
  if (action.kind === 'state') {
    await tgSendMessage(chatId, `Solicitação processada com sucesso.\n\n${getStateSummaryText()}`, { withMenu: true });
    return;
  }
  if (action.kind === 'estoque_compra_query') {
    const msg = formatEstoqueCompraReply(appData.data, action.payload.productQuery, action.payload.daySpec);
    await tgSendMessage(chatId, msg, { withMenu: true });
    return;
  }
  if (action.kind === 'estoque_resumo') {
    const msg = formatEstoqueResumoReply(appData.data, action.payload.daySpec);
    await tgSendMessageChunked(chatId, msg, { withMenu: true });
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
    if (currentPending.phase === 'status_day_scope' && currentPending.clientId && currentPending.intent) {
      await tgSendMessage(
        chatId,
        `Escolha de dia pendente (${ageSec}s).\n\n` +
          buildStatusDayScopePrompt(currentPending.intent.clientName, currentPending.intent.status, currentPending.clientId),
        { withMenu: true }
      );
      return;
    }
    await tgSendMessage(
      chatId,
      'Há uma ação pendente.\n' + `${formatActionPreview(currentPending.action)}\n` + `\nTempo em espera: ${ageSec}s`,
      { withMenu: true }
    );
    return;
  }

  if (action.kind === 'pedido_status_update' && !String(action.payload.day || '').trim()) {
    pendingConfirmations.set(String(chatId), {
      phase: 'status_day_scope',
      intent: {
        kind: 'update_order_status_client',
        clientName: action.payload.clientName,
        status: action.payload.status,
        day: '',
        rawText: incoming,
      },
      clientId: String(action.payload.clientId),
      createdAt: Date.now(),
      sourceText: incoming,
    });
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: buildStatusDayScopePrompt(action.payload.clientName, action.payload.status, action.payload.clientId),
    });
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
    const textBody = msg.text || msg.caption;
    if (textBody) {
      await handleTelegramText(chatId, textBody);
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
    const explained = e && e.message ? e.message : explainFetchError(e);
    console.error('Erro no processamento de update Telegram:', explained, e);
    try {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: `Erro ao processar comando: ${explained}`,
      });
    } catch (e2) {
      console.error('Não foi possível enviar erro ao Telegram:', explainFetchError(e2));
    }
  }
}

async function startTelegramLongPolling() {
  if (!shouldRunTelegramLongPolling()) return;
  let offset = 0;
  const allowedUpdates = encodeURIComponent(JSON.stringify(['message', 'edited_message']));
  console.log('Telegram bot ativo (long polling; só message/edited_message).');
  while (true) {
    try {
      const pollOpts = { method: 'GET' };
      const pollSig = fetchTimeoutSignal(95000);
      if (pollSig) pollOpts.signal = pollSig;
      let res;
      try {
        res = await outboundFetch(
          `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=30&offset=${offset}&allowed_updates=${allowedUpdates}`,
          pollOpts
        );
      } catch (e) {
        throw new Error(explainFetchError(e));
      }
      if (res.status === 429) {
        const ra = res.headers.get('retry-after');
        const sec = Math.min(120, Math.max(1, Number(ra) || 5));
        console.warn(`Telegram getUpdates: limite de taxa (429), aguardando ${sec}s`);
        await res.text().catch(() => {});
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, sec * 1000));
        continue;
      }
      const raw = await res.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        throw new Error(`getUpdates: resposta não-JSON (${res.status}): ${raw.slice(0, 400)}`);
      }
      if (payload.ok !== true) {
        const d = payload.description != null ? String(payload.description) : JSON.stringify(payload);
        if (/conflict|terminated|other getupdates/i.test(d)) {
          console.error(
            'Telegram: outro processo está usando getUpdates com o mesmo token. Pare a outra instância ou o bot ficará em erro.'
          );
        }
        throw new Error(d);
      }
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
  if (!wss || !wss.clients) return;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function deepCloneData() {
  return JSON.parse(JSON.stringify(appData));
}

function runTelegramHarness() {
  const failures = [];
  let total = 0;
  const ok = (name, cond, detail) => {
    total += 1;
    if (cond) {
      console.log(`[telegram-test] OK  ${name}`);
    } else {
      console.error(`[telegram-test] FAIL ${name}${detail ? ` — ${detail}` : ''}`);
      failures.push(name);
    }
  };

  const withRollback = (fn) => {
    const snap = deepCloneData();
    _saveDataSuppressed = true;
    try {
      fn();
    } finally {
      _saveDataSuppressed = false;
      appData = snap;
    }
  };

  const emptyBundle = (lu) => ({
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
    lastUpdate: lu || '2020-01-01T00:00:00.000Z',
  });

  // ─── Intents básicos & atalhos ───
  ok('intent /ajuda', parseCommandIntent('/ajuda')?.kind === 'help');
  ok('intent ajuda', parseCommandIntent('ajuda')?.kind === 'help');
  ok('intent /menu', parseCommandIntent('/menu')?.kind === 'menu');
  ok('intent estado', parseCommandIntent('estado')?.kind === 'state');
  ok('intent /estado', parseCommandIntent('/estado')?.kind === 'state');
  ok('intent /pendente', parseCommandIntent('/pendente')?.kind === 'pending');
  ok('intent pendente', parseCommandIntent('pendente')?.kind === 'pending');
  ok(
    'intent estoque compra para hoje',
    parseCommandIntent('quantos alface crespa eu preciso comprar para hoje')?.kind === 'estoque_compra_query'
  );
  ok(
    'intent estoque quantas sem para hoje',
    parseCommandIntent('quantas alfaces crespas verde preciso comprar')?.kind === 'estoque_compra_query' &&
      parseCommandIntent('quantas alfaces crespas verde preciso comprar')?.productQuery.includes('alfaces')
  );
  ok('intent estoque resumo', parseCommandIntent('resumo estoque hoje')?.kind === 'estoque_resumo');
  ok(
    'build estoque_compra_query',
    buildActionFromIntent(parseCommandIntent('quanto de rucula preciso para amanha')).ok === true &&
      buildActionFromIntent(parseCommandIntent('quanto de rucula preciso para amanha')).kind === 'estoque_compra_query'
  );
  ok(
    'contexto QA (snapshot)',
    (() => {
      try {
        const j = buildTelegramDataContextForQA();
        return typeof j === 'string' && j.length > 20 && JSON.parse(j).resumo;
      } catch (e) {
        return false;
      }
    })()
  );

  const shortcuts = [
    ['pedido criar', 'pedido_criar'],
    ['pedido editar', 'pedido_editar'],
    ['pedido excluir', 'pedido_excluir'],
    ['cliente criar', 'cliente_criar'],
    ['cliente editar', 'cliente_editar'],
    ['cliente excluir', 'cliente_excluir'],
    ['produto criar', 'produto_criar'],
    ['produto editar', 'produto_editar'],
    ['produto excluir', 'produto_excluir'],
  ];
  for (const [text, target] of shortcuts) {
    const sh = parseCommandIntent(text);
    ok(`atalho "${text}"`, sh?.kind === 'shortcut' && sh.target === target);
  }

  // ─── Linguagem natural: incremento ───
  const incUm = parseCommandIntent('acrescentar um alface mix ao pedido da Fernanda');
  ok(
    'NL incremento "um"',
    incUm?.kind === 'increment_order_item' && incUm.quantityDelta === 1 && /alface/i.test(incUm.productName || '')
  );
  ok('NL incremento número', parseCommandIntent('acrescentar 1 alface mix ao pedido da Fernanda')?.quantityDelta === 1);
  ok('NL adicionar', parseCommandIntent('adicionar 2 alface mix ao pedido da Fernanda')?.quantityDelta === 2);
  ok('NL somar', parseCommandIntent('somar 1 alface mix ao pedido da Fernanda')?.quantityDelta === 1);
  ok('NL incluir', parseCommandIntent('incluir 1 alface mix ao pedido da Fernanda')?.quantityDelta === 1);
  ok('NL incremento qty zero → build falha', (() => {
    const a = buildActionFromIntent(parseCommandIntent('acrescentar 0 alface mix ao pedido da Fernanda'));
    return a.ok === false;
  })());

  // ─── Linguagem natural: status ───
  const stToday = parseCommandIntent('atualize o status do pedido de hoje da casa de tereza para pronto');
  ok(
    'NL status + hoje + atualize',
    stToday?.kind === 'update_order_status_client' &&
      /tereza/i.test(stToday.clientName || '') &&
      stToday.status === 'pronto'
  );
  const stDay = parseCommandIntent(
    'atualizar status do pedido da casa de tereza para pronto do dia quinta-feira'
  );
  ok(
    'NL status + dia explícito',
    stDay?.kind === 'update_order_status_client' &&
      normalizeText(stDay.day || '') === 'quinta-feira' &&
      stDay.status === 'pronto'
  );
  ok(
    'NL mudar status',
    parseCommandIntent('mudar status do pedido da casa de tereza para entregue')?.status === 'entregue'
  );
  ok(
    'NL mude + pedido de CLIENTE (de em vez de da/do)',
    (() => {
      const i = parseCommandIntent('mude o status do pedido de casa de tereza para entregue');
      return (
        i?.kind === 'update_order_status_client' &&
        i.status === 'entregue' &&
        /tereza/i.test(i.clientName || '')
      );
    })()
  );
  ok(
    'NL mude pedido de CLIENTE sem palavra status',
    (() => {
      const i = parseCommandIntent('mude o pedido de casa de tereza para entregue');
      return i?.kind === 'update_order_status_client' && i.status === 'entregue';
    })()
  );
  const intSemPedido = parseCommandIntent('atualize o status de hoje da casa de tereza para entregue');
  ok(
    'NL status de hoje sem palavra "pedido"',
    intSemPedido?.kind === 'update_order_status_client' &&
      intSemPedido.status === 'entregue' &&
      normalizeText(intSemPedido.day || '') === normalizeText(weekdayTodayPtBr())
  );
  const intPedidoStatus = parseCommandIntent('atualize o pedido do patio gourmet para entregue');
  ok(
    'NL atualize o pedido do X para status',
    intPedidoStatus?.kind === 'update_order_status_client' && /gourmet/i.test(intPedidoStatus.clientName || '')
  );
  ok(
    'NL pedido da X de hoje para status (sem palavra status)',
    (() => {
      const i = parseCommandIntent('atualize o pedido da padoca de hoje para entregue');
      return (
        i?.kind === 'update_order_status_client' &&
        i.status === 'entregue' &&
        normalizeText(i.day || '') === normalizeText(weekdayTodayPtBr()) &&
        /^padoca$/i.test(String(i.clientName || '').trim())
      );
    })()
  );
  ok(
    'NL atalho pedido CLIENTE pronto',
    parseCommandIntent('pedido casa de tereza pronto')?.kind === 'update_order_status_client' &&
      parseCommandIntent('pedido casa de tereza pronto')?.status === 'pronto'
  );
  const typoAct = buildActionFromIntent(
    parseCommandIntent('atualize o status de hoje da casa de teresa para pronto')
  );
  ok(
    'NL typo Teresa/Tereza + status',
    typoAct.ok === true ||
      (Boolean(typoAct.reason) && !/cliente n[aã]o encontrado/i.test(typoAct.reason))
  );

  ok(
    'NL expandido: NOME ta pronta',
    (() => {
      const t = 'fernanda ta pronta';
      const i = parseCommandIntent(t) || parseCommandIntentExpanded(t);
      return i?.kind === 'update_order_status_client' && i.status === 'pronto' && /fernanda/i.test(i.clientName || '');
    })()
  );
  ok(
    'NL expandido: encomenda do X ta pronto',
    (() => {
      const t = 'a encomenda do fernanda ta pronto';
      const i = parseCommandIntent(t) || parseCommandIntentExpanded(t);
      return i?.kind === 'update_order_status_client' && i.status === 'pronto';
    })()
  );
  ok(
    'NL expandido incremento: mais ... no pedido',
    (() => {
      const t = 'coloca mais 1 alface mix no pedido da fernanda';
      const i = parseCommandIntent(t) || parseCommandIntentExpanded(t);
      return i?.kind === 'increment_order_item' && i.quantityDelta === 1 && /alface/i.test(i.productName || '');
    })()
  );

  ok(
    'NL status inválido → build falha',
    buildActionFromIntent({
      kind: 'update_order_status_client',
      clientName: 'Fernanda',
      status: 'xyz',
      day: '',
      rawText: '',
    }).ok === false
  );

  // ─── Estruturado /pedido ───
  const structCriar = buildActionFromIntent(
    parseCommandIntent('/pedido criar cliente="Fernanda" produto="Alface MIX" quantidade=1 dia="segunda-feira"')
  );
  ok('struct pedido criar', structCriar.ok === true && structCriar.kind === 'pedido_create');

  const structEdit = buildActionFromIntent(
    parseCommandIntent(
      '/pedido editar cliente="Fernanda" produto="Alface MIX" dia="segunda-feira" quantidade=99'
    )
  );
  ok('struct pedido editar', structEdit.ok === true && structEdit.kind === 'pedido_edit');

  const structDel = buildActionFromIntent(
    parseCommandIntent('/pedido excluir cliente="Fernanda" produto="Alface MIX" dia="segunda-feira"')
  );
  ok('struct pedido excluir', structDel.ok === true && structDel.kind === 'pedido_delete');

  ok(
    'struct pedido ação desconhecida',
    buildActionFromIntent(parseCommandIntent('/pedido foo cliente="Fernanda"')).ok === false
  );

  // ─── Estruturado /cliente ───
  const harnessCliName = `__HarnessCli_${Date.now()}__`;
  const cliCriar = buildActionFromIntent(
    parseCommandIntent(
      `/cliente criar nome="${harnessCliName}" periodoEntrega="manha" horarioMaximo="10:00" cobraEntrega=sim`
    )
  );
  ok('struct cliente criar', cliCriar.ok === true && cliCriar.kind === 'cliente_create');

  const cliEdit = buildActionFromIntent(
    parseCommandIntent('/cliente editar nome="Fernanda" observacoes="teste harness"')
  );
  ok('struct cliente editar', cliEdit.ok === true && cliEdit.kind === 'cliente_edit');

  const cliPreco = buildActionFromIntent(
    parseCommandIntent('/cliente preco_add nome="Fernanda" produto="Alface MIX" preco=9.99')
  );
  ok('struct cliente preco_add', cliPreco.ok === true && cliPreco.kind === 'cliente_preco_add');

  const cliPrecoRm = buildActionFromIntent(
    parseCommandIntent('/cliente preco_remove nome="Fernanda" produto="Alface MIX"')
  );
  ok('struct cliente preco_remove', cliPrecoRm.ok === true && cliPrecoRm.kind === 'cliente_preco_remove');

  const fernanda = (appData.data.clientes || []).find((c) => normalizeText(c.nome) === 'fernanda');
  ok('fixture cliente Fernanda', !!fernanda);
  if (fernanda) {
    const cliDel = buildActionFromIntent(parseCommandIntent(`/cliente excluir nome="${fernanda.nome}"`));
    ok('struct cliente excluir (build)', cliDel.ok === true && cliDel.kind === 'cliente_delete');
  }

  // ─── Estruturado /produto ───
  const prodCriar = buildActionFromIntent(
    parseCommandIntent('/produto criar nome="__HarnessProduto__" precoBase=1.5 categorias="Teste"')
  );
  ok('struct produto criar', prodCriar.ok === true && prodCriar.kind === 'produto_create');

  const prodEdit = buildActionFromIntent(
    parseCommandIntent('/produto editar nome="Alface MIX" precoBase=99.99')
  );
  ok('struct produto editar', prodEdit.ok === true && prodEdit.kind === 'produto_edit');

  const prodDel = buildActionFromIntent(parseCommandIntent('/produto excluir nome="Alface MIX"'));
  ok('struct produto excluir (build)', prodDel.ok === true && prodDel.kind === 'produto_delete');

  // ─── Erros de preparação ───
  ok(
    'erro cliente inexistente (status)',
    buildActionFromIntent(parseCommandIntent('atualizar status do pedido da cliente inexistente xyz123 para pronto')).ok === false
  );
  ok('intent lixo → null', parseCommandIntent('asdf qwer zxcv totalmente sem sentido') === null);

  // ─── requiresConfirmation ───
  ok('requiresConfirmation: help false', requiresConfirmation({ kind: 'help', ok: true, payload: {} }) === false);
  ok('requiresConfirmation: pedido_create true', requiresConfirmation({ kind: 'pedido_create', ok: true, payload: {} }) === true);

  ok(
    'OpenAI erro quota (429) mensagem PT',
    formatOpenAITranscriptionError(
      429,
      JSON.stringify({
        error: {
          code: 'insufficient_quota',
          message: 'You exceeded your current quota',
          type: 'insufficient_quota',
        },
      })
    ).includes('cota')
  );
  ok(
    'OpenAI erro 401 mensagem PT',
    formatOpenAITranscriptionError(401, '{}').includes('chave')
  );
  ok(
    'LLM chat erro saldo (Insufficient balance)',
    formatOpenAIChatError(402, JSON.stringify({ error: { message: 'Insufficient Balance' } })).includes('Saldo')
  );

  // ─── formatActionPreview (todas as ações mutáveis) ───
  const previewCases = [
    ['pedido_create', { kind: 'pedido_create', ok: true, payload: { clientName: 'A', productName: 'P', quantidade: 1, dia: '', tipoVenda: '' } }, 'criar pedido'],
    ['pedido_edit', { kind: 'pedido_edit', ok: true, payload: { clientName: 'A', productName: 'P', updates: { quantidade: 2 } } }, 'editar pedido'],
    ['pedido_delete', { kind: 'pedido_delete', ok: true, payload: { clientName: 'A', productName: 'P', quantidade: 1, dia: 'segunda-feira' } }, 'excluir pedido'],
    [
      'pedido_status_update',
      {
        kind: 'pedido_status_update',
        ok: true,
        payload: { clientName: 'A', status: 'pronto', day: '', affectedCount: 3 },
      },
      'atualizar status',
    ],
    ['cliente_create', { kind: 'cliente_create', ok: true, payload: { nome: 'N', periodoEntrega: '', horarioMaximo: '' } }, 'criar cliente'],
    ['cliente_edit', { kind: 'cliente_edit', ok: true, payload: { beforeName: 'N', updates: { observacoes: 'x' } } }, 'editar cliente'],
    ['cliente_delete', { kind: 'cliente_delete', ok: true, payload: { clientName: 'N', pedidosAfetados: 0 } }, 'excluir cliente'],
    ['cliente_preco_add', { kind: 'cliente_preco_add', ok: true, payload: { clientName: 'N', productName: 'P', preco: 1 } }, 'preço especial'],
    ['cliente_preco_remove', { kind: 'cliente_preco_remove', ok: true, payload: { clientName: 'N', productName: 'P' } }, 'remover preço'],
    ['produto_create', { kind: 'produto_create', ok: true, payload: { nome: 'P', precoBase: 1, categorias: [] } }, 'criar produto'],
    ['produto_edit', { kind: 'produto_edit', ok: true, payload: { beforeName: 'P', updates: {}, pedidosAfetados: 0 } }, 'editar produto'],
    ['produto_delete', { kind: 'produto_delete', ok: true, payload: { productName: 'P', pedidosAfetados: 0 } }, 'excluir produto'],
    [
      'increment_order_item',
      {
        kind: 'increment_order_item',
        ok: true,
        payload: { clientName: 'A', productName: 'P', beforeQty: 1, deltaQty: 1, afterQty: 2, day: 'segunda-feira' },
      },
      'Confirma esta alteração',
    ],
  ];
  for (const [label, action, needle] of previewCases) {
    const prev = formatActionPreview(action);
    ok(`preview ${label}`, prev.includes('confirmar') && prev.toLowerCase().includes(String(needle).toLowerCase()));
  }

  // ─── merge JSON (Git / conflitos) ───
  const gb = emptyBundle('2020-01-01T00:00:00.000Z');
  gb.data.pedidos = [{ id: 'x', id_cliente: '1', cliente: 'A', produto: 'P', dia_semana: 'segunda-feira', quantidade: 1, status: 'pendente' }];
  const go = JSON.parse(JSON.stringify(gb));
  go.data.pedidos[0].quantidade = 5;
  go.lastUpdate = '2020-01-02T00:00:00.000Z';
  const gt = JSON.parse(JSON.stringify(gb));
  gt.data.pedidos[0].status = 'pronto';
  gt.lastUpdate = '2020-01-03T00:00:00.000Z';
  const merged = gitMergeAppDataThreeWay(gb, go, gt);
  ok(
    'gitMergeAppDataThreeWay pedido',
    merged.data.pedidos.length === 1 &&
      Number(merged.data.pedidos[0].quantidade) === 5 &&
      merged.data.pedidos[0].status === 'pendente'
  );

  // ─── applyAction (memória + rollback, sem gravar arquivo) ───
  /** Pedido único no arquivo (mesmo cliente+produto+dia não se repete) — evita ambíguo em editar/excluir. */
  let soloPedido = null;
  let soloCliente = null;
  for (const p of appData.data.pedidos || []) {
    const c = (appData.data.clientes || []).find((cc) => String(cc.id) === String(p.id_cliente));
    if (!c) continue;
    const same = (appData.data.pedidos || []).filter(
      (x) =>
        String(x.id_cliente) === String(p.id_cliente) &&
        normalizeText(x.produto) === normalizeText(p.produto) &&
        normalizeText(x.dia_semana || '') === normalizeText(p.dia_semana || '')
    );
    if (same.length === 1) {
      soloPedido = p;
      soloCliente = c;
      break;
    }
  }
  ok('fixture pedido único (incremento/editar/excluir)', !!soloPedido && !!soloCliente);

  if (soloCliente) {
    const rTodos = resolveTelegramStatusDayChoice('todos', soloCliente.id);
    ok('escopo dia Telegram: todos', rTodos.ok === true && rTodos.day === '');
    const rHoje = resolveTelegramStatusDayChoice('hoje', soloCliente.id);
    ok(
      'escopo dia Telegram: hoje',
      rHoje.ok === true && rHoje.day === normalizeDay(weekdayTodayPtBr())
    );
    const rBad = resolveTelegramStatusDayChoice('xyzfoobar', soloCliente.id);
    ok('escopo dia Telegram: lixo falha', rBad.ok === false);
  }

  withRollback(() => {
    if (soloPedido && soloCliente) {
      const before = Number(soloPedido.quantidade);
      const inc = buildActionFromIntent(
        parseCommandIntent(`acrescentar 1 ${soloPedido.produto} ao pedido da ${soloCliente.nome}`)
      );
      const r1 = applyAction(inc);
      ok('apply increment_order_item', r1.ok === true && Number(soloPedido.quantidade) === before + 1);

      const ed = buildActionFromIntent(
        parseCommandIntent(
          `/pedido editar cliente="${soloCliente.nome}" produto="${soloPedido.produto}" dia="${soloPedido.dia_semana}" quantidade=77`
        )
      );
      ok('apply pedido_edit (build)', ed.ok === true);
      const r2 = ed.ok ? applyAction(ed) : { ok: false };
      const afterEdit = (appData.data.pedidos || []).find((p) => String(p.id) === String(soloPedido.id));
      ok('apply pedido_edit', r2.ok === true && Number(afterEdit?.quantidade) === 77);

      const delActRb = buildActionFromIntent(
        parseCommandIntent(
          `/pedido excluir cliente="${soloCliente.nome}" produto="${soloPedido.produto}" dia="${soloPedido.dia_semana}"`
        )
      );
      ok('apply pedido_delete (build)', delActRb.ok === true);
      const countById = (appData.data.pedidos || []).filter((p) => String(p.id) === String(soloPedido.id)).length;
      const rDelP = delActRb.ok ? applyAction(delActRb) : { ok: false };
      const countAfterDel = (appData.data.pedidos || []).filter((p) => String(p.id) === String(soloPedido.id)).length;
      ok('apply pedido_delete', rDelP.ok === true && countById === 1 && countAfterDel === 0);
    }

    const terezaC = (appData.data.clientes || []).find((c) => /tereza/i.test(c.nome || ''));
    const pedTereza = terezaC
      ? (appData.data.pedidos || []).find((p) => String(p.id_cliente) === String(terezaC.id))
      : null;
    if (terezaC && pedTereza && pedTereza.dia_semana) {
      const st = buildActionFromIntent(
        parseCommandIntent(
          `atualizar status do pedido da ${terezaC.nome} para pronto do dia ${pedTereza.dia_semana}`
        )
      );
      const r3 = applyAction(st);
      ok('apply pedido_status_update', r3.ok === true);
    } else {
      ok('apply pedido_status_update', false, 'sem cliente/pedido Tereza nos dados');
    }

    const ts = Date.now();
    const createCliente = buildActionFromIntent(
      parseCommandIntent(`/cliente criar nome="__HCli_${ts}__" observacoes="harness"`)
    );
    ok('apply cliente_create (build)', createCliente.ok === true);
    if (createCliente.ok) {
      const rc = applyAction(createCliente);
      ok('apply cliente_create', rc.ok === true);
      const newId = (appData.data.clientes || []).find((c) => String(c.nome).includes(`__HCli_${ts}__`))?.id;
      if (newId) {
        const rPre = applyAction(
          buildActionFromIntent(
            parseCommandIntent(`/cliente preco_add nome="__HCli_${ts}__" produto="Alface MIX" preco=8.5`)
          )
        );
        ok('apply cliente_preco_add', rPre.ok === true);
        const rPrm = applyAction(
          buildActionFromIntent(
            parseCommandIntent(`/cliente preco_remove nome="__HCli_${ts}__" produto="Alface MIX"`)
          )
        );
        ok('apply cliente_preco_remove', rPrm.ok === true);
        const rEd = applyAction(
          buildActionFromIntent(parseCommandIntent(`/cliente editar nome="__HCli_${ts}__" observacoes="e2"`))
        );
        ok('apply cliente_edit', rEd.ok === true);
        const rDel = applyAction(
          buildActionFromIntent(parseCommandIntent(`/cliente excluir nome="__HCli_${ts}__"`))
        );
        ok('apply cliente_delete', rDel.ok === true);
      }
    }

    const createProd = buildActionFromIntent(
      parseCommandIntent(`/produto criar nome="__HPr_${ts}__" precoBase=3 categorias="H"`)
    );
    if (createProd.ok) {
      ok('apply produto_create', applyAction(createProd).ok === true);
      const rPe = applyAction(
        buildActionFromIntent(parseCommandIntent(`/produto editar nome="__HPr_${ts}__" precoBase=4`))
      );
      ok('apply produto_edit', rPe.ok === true);
      const rPd = applyAction(buildActionFromIntent(parseCommandIntent(`/produto excluir nome="__HPr_${ts}__"`)));
      ok('apply produto_delete', rPd.ok === true);
    } else {
      ok('apply produto_create', false);
    }

    const createP = buildActionFromIntent(
      parseCommandIntent(`/pedido criar cliente="Fernanda" produto="Alface MIX" quantidade=1 dia="segunda-feira"`)
    );
    if (createP.ok) {
      ok('apply pedido_create', applyAction(createP).ok === true);
    } else {
      ok('apply pedido_create', false);
    }
  });

  console.log(
    `[telegram-test] ${total - failures.length}/${total} passaram.` +
      (failures.length ? ` Falhas: ${failures.join(', ')}` : '')
  );
  return failures.length ? 1 : 0;
}

if (IS_TELEGRAM_HARNESS) {
  loadData();
  process.exit(runTelegramHarness());
}

// Criar servidor (HTTP ou HTTPS)
let server;
let wss;
const PORT = process.env.PORT || 3001;
const USE_HTTPS = process.env.USE_HTTPS === 'true';

if (!IS_TELEGRAM_HARNESS) {
  if (USE_HTTPS && fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
    const options = {
      cert: fs.readFileSync('cert.pem'),
      key: fs.readFileSync('key.pem'),
    };
    server = https.createServer(options, app);
    console.log('Usando HTTPS');
  } else {
    server = http.createServer(app);
    console.log('Usando HTTP');
  }

  wss = new WebSocket.Server({ server });

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
        const incoming = msg.data;
        if (!incoming || typeof incoming !== 'object') return;

        const expected = incoming.expectedLastUpdate;
        const serverIso = appData && appData.lastUpdate;
        if (
          expected != null &&
          String(expected) !== '' &&
          serverIso != null &&
          String(expected) !== String(serverIso)
        ) {
          console.warn('[ws] Conflito: cliente esperava', expected, 'servidor tem', serverIso);
          try {
            ws.send(
              JSON.stringify({
                type: 'sync_conflict',
                message:
                  'Os dados no servidor mudaram (Telegram, outra aba ou outro dispositivo). A página foi alinhada à versão do servidor.',
                data: appData,
              })
            );
          } catch (sendErr) {
            console.warn('[ws] Falha ao enviar sync_conflict:', sendErr.message || sendErr);
          }
          return;
        }

        const next = { ...incoming };
        delete next.expectedLastUpdate;
        appData = next;
        if (!appData.lastUpdate || !Number.isFinite(new Date(appData.lastUpdate).getTime())) {
          appData.lastUpdate = new Date().toISOString();
        }

        saveData();

        broadcast(
          {
            type: 'update',
            data: appData,
          },
          wss
        );

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
    const body = req.body;
    const expected = body && body.expectedLastUpdate;
    const serverIso = appData && appData.lastUpdate;
    if (
      expected != null &&
      String(expected) !== '' &&
      serverIso != null &&
      String(expected) !== String(serverIso)
    ) {
      return res.status(409).json({
        error: 'sync_conflict',
        message:
          'Os dados no servidor mudaram (Telegram, outra aba ou outro dispositivo). Recarregue ou aceite a versão do servidor.',
        data: appData,
      });
    }

    const next = { ...(body || {}) };
    delete next.expectedLastUpdate;
    appData = next;
    if (!appData.lastUpdate || !Number.isFinite(new Date(appData.lastUpdate).getTime())) {
      appData.lastUpdate = new Date().toISOString();
    }
    saveData();

    broadcast(
      {
        type: 'update',
        data: appData,
      },
      wss
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
}

loadData();

if (!IS_TELEGRAM_HARNESS) {
  server.listen(PORT, '0.0.0.0', () => {
    const protocol = USE_HTTPS ? 'https' : 'http';
    console.log(`Servidor rodando em ${protocol}://localhost:${PORT}`);
    if (shouldRunTelegramLongPolling()) {
      startTelegramLongPolling().catch((e) => {
        console.error('Falha ao iniciar integração Telegram:', e);
      });
    } else if (TELEGRAM_BOT_TOKEN) {
      console.warn(
        'Telegram: token definido mas integração não iniciada. Defina TELEGRAM_ALLOWED_CHAT_IDS (recomendado) ou TELEGRAM_ALLOW_ALL_CHATS=true (apenas dev).'
      );
    } else {
      console.log('Telegram desativado (defina TELEGRAM_BOT_TOKEN para habilitar).');
    }
    if (OPENAI_COMPAT_API_KEY) {
      const prov = USE_DEEPSEEK_CHAT ? 'DeepSeek' : 'OpenAI (compat)';
      const qaOn = TELEGRAM_DATA_QA ? 'perguntas livres ligadas' : 'perguntas livres desligadas (TELEGRAM_DATA_QA=false)';
      console.log(
        `LLM (${prov}): ${OPENAI_COMPAT_CHAT_BASE} | NL: ${OPENAI_INTENT_MODEL} | QA: ${OPENAI_QA_MODEL} | ${qaOn}`
      );
    }
  });
}
