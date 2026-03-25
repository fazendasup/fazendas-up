const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Arquivo de dados
const DATA_FILE = path.join(__dirname, 'dados-sync.json');

// Dados em memória
let appData = {
  pedidos: [],
  clientes: [],
  produtos: [],
  lastUpdate: new Date().toISOString()
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
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

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
        });
        
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
    });
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Carregar dados ao iniciar
loadData();

// Iniciar servidor
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
