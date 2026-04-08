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

// Dados em memória (mesmo formato que dados-sync.json)
let appData = {
  data: {
    pedidos: [],
    clientes: [],
    produtos: [],
    prioridades: {},
    estoqueFatores: {},
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
});
