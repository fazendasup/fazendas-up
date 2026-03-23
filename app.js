// Firebase Database Reference
let db = null;

// App State
let appState = {
  currentTab: 'dashboard',
  data: {
    pedidos: [],
    clientes: [],
    produtos: [],
  },
  selectedDay: 'Segunda',
  searchQuery: '',
};

// Dias da semana
const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ─── Inicialização ───────────────────────────────────────────────────────────

function initFirebase() {
  if (typeof firebase !== 'undefined' && firebase.database) {
    db = firebase.database();
    console.log('Firebase inicializado');
    loadInitialData();
    setupFirebaseListeners();
    setupEventListeners();
  } else {
    console.error('Firebase não disponível');
  }
}

function setupEventListeners() {
  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  appState.currentTab = tab;
  
  // Update active button
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  
  // Render content
  if (tab === 'dashboard') renderDashboard();
  else if (tab === 'agenda') renderAgenda();
  else if (tab === 'clientes') renderClientes();
  else if (tab === 'produtos') renderProdutos();
}

// ─── Firebase Listeners ──────────────────────────────────────────────────────

function setupFirebaseListeners() {
  if (!db) return;
  
  // Listener para pedidos
  db.ref('pedidos').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      appState.data.pedidos = Array.isArray(data) ? data : Object.values(data);
      localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
      if (appState.currentTab === 'dashboard') renderDashboard();
      else if (appState.currentTab === 'agenda') renderAgenda();
    }
  });
  
  // Listener para clientes
  db.ref('clientes').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      appState.data.clientes = Array.isArray(data) ? data : Object.values(data);
      localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
      updateClientSelects();
      if (appState.currentTab === 'clientes') renderClientes();
    }
  });
  
  // Listener para produtos
  db.ref('produtos').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      appState.data.produtos = Array.isArray(data) ? data : Object.values(data);
      localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
      updateProductSelects();
      if (appState.currentTab === 'produtos') renderProdutos();
    }
  });
}

function loadInitialData() {
  const saved = localStorage.getItem('fazendas-up-data');
  if (saved) {
    try {
      appState.data = JSON.parse(saved);
    } catch (e) {
      console.error('Erro ao carregar dados salvos:', e);
    }
  }
}

function saveToFirebase() {
  if (!db) return;
  
  db.ref('pedidos').set(appState.data.pedidos).catch(err => console.error('Erro ao salvar pedidos:', err));
  db.ref('clientes').set(appState.data.clientes).catch(err => console.error('Erro ao salvar clientes:', err));
  db.ref('produtos').set(appState.data.produtos).catch(err => console.error('Erro ao salvar produtos:', err));
}

function saveData() {
  localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
  saveToFirebase();
}

// ─── Render Functions ────────────────────────────────────────────────────────

function renderDashboard() {
  const content = document.getElementById('content');
  
  const stats = calculateStats();
  const volumePorDia = calculateVolumeByDay();
  const topProdutos = getTopProdutos(5);
  
  content.innerHTML = `
    <div class="card">
      <h2>📊 Resumo Semanal</h2>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-number">${stats.totalPedidos}</div>
          <div class="stat-label">Pedidos</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">${stats.totalQuantidade}</div>
          <div class="stat-label">Itens</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">${stats.clientesUnicos}</div>
          <div class="stat-label">Clientes</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">${stats.produtosUnicos}</div>
          <div class="stat-label">Produtos</div>
        </div>
      </div>
    </div>
    
    <div class="card">
      <h2>📦 Status de Entregas</h2>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-number" style="color: #f59e0b">${stats.pendentes}</div>
          <div class="stat-label">Pendentes</div>
        </div>
        <div class="stat-box">
          <div class="stat-number" style="color: #22c55e">${stats.entregues}</div>
          <div class="stat-label">Entregues</div>
        </div>
        <div class="stat-box">
          <div class="stat-number" style="color: #ef4444">${stats.cancelados}</div>
          <div class="stat-label">Cancelados</div>
        </div>
      </div>
    </div>
    
    <div class="card">
      <h2>📈 Volume por Dia</h2>
      ${Object.entries(volumePorDia).map(([dia, qtd]) => `
        <div class="metric">
          <span class="metric-label">${dia}</span>
          <span class="metric-value">${qtd} itens</span>
        </div>
      `).join('')}
    </div>
    
    <div class="card">
      <h2>🥬 Top 5 Produtos</h2>
      ${topProdutos.map(p => `
        <div class="metric">
          <span class="metric-label">${p.nome}</span>
          <span class="metric-value">${p.quantidade} un</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAgenda() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <div class="card">
      <h2>📅 Agenda de Pedidos</h2>
      <div class="search-box">
        <input type="text" id="agendaSearch" placeholder="Buscar por cliente..." onkeyup="filterAgenda()">
      </div>
      <button class="button" onclick="openModal('pedidoModal')">+ Novo Pedido</button>
      
      <div id="agendaContent"></div>
    </div>
  `;
  
  renderAgendaContent();
}

function renderAgendaContent() {
  const container = document.getElementById('agendaContent');
  if (!container) return;
  
  const query = document.getElementById('agendaSearch')?.value.toLowerCase() || '';
  
  let html = '';
  for (const dia of DIAS_SEMANA) {
    const pedidosDia = appState.data.pedidos.filter(p => p.dia_semana === dia);
    const filtered = pedidosDia.filter(p => 
      !query || p.cliente.toLowerCase().includes(query)
    );
    
    if (filtered.length === 0) continue;
    
    html += `<div style="margin-bottom: 16px;">
      <h3 style="color: #2d7a3a; font-size: 16px; margin-bottom: 8px;">${dia}</h3>`;
    
    const grouped = {};
    filtered.forEach(p => {
      if (!grouped[p.cliente]) grouped[p.cliente] = [];
      grouped[p.cliente].push(p);
    });
    
    for (const [cliente, pedidos] of Object.entries(grouped)) {
      html += `<div style="margin-left: 8px; margin-bottom: 8px;">
        <div style="font-weight: 600; margin-bottom: 4px;">${cliente}</div>`;
      
      pedidos.forEach((p) => {
        html += `
          <div class="list-item">
            <div class="list-item-content">
              <div class="list-item-title">${p.produto}</div>
              <div class="list-item-subtitle">${p.quantidade} un - ${p.categoria}</div>
            </div>
            <div class="list-item-actions">
              <button class="btn-icon" onclick="deletePedido('${p.id}')">🗑️</button>
            </div>
          </div>
        `;
      });
      
      html += `</div>`;
    }
    
    html += `</div>`;
  }
  
  container.innerHTML = html || '<p style="color: #999;">Nenhum pedido encontrado</p>';
}

function renderClientes() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <div class="card">
      <h2>👥 Clientes</h2>
      <div class="search-box">
        <input type="text" id="clientesSearch" placeholder="Buscar cliente..." onkeyup="filterClientes()">
      </div>
      <button class="button" onclick="openModal('clienteModal')">+ Novo Cliente</button>
      
      <div id="clientesContent"></div>
    </div>
  `;
  
  renderClientesContent();
}

function renderClientesContent() {
  const container = document.getElementById('clientesContent');
  if (!container) return;
  
  const query = document.getElementById('clientesSearch')?.value.toLowerCase() || '';
  const filtered = appState.data.clientes.filter(c => 
    !query || c.nome.toLowerCase().includes(query)
  );
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color: #999;">Nenhum cliente encontrado</p>';
    return;
  }
  
  container.innerHTML = filtered.map(c => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${c.nome}</div>
        <div class="list-item-subtitle">
          ${c.periodoEntrega ? `${c.periodoEntrega}` : ''} ${c.cobraEntrega ? '• Cobra entrega' : ''}
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-icon" onclick="deleteCliente('${c.id}')" style="color: #ef4444;">🗑️</button>
      </div>
    </div>
  `).join('');
}

function renderProdutos() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <div class="card">
      <h2>🥬 Produtos</h2>
      <div class="search-box">
        <input type="text" id="produtosSearch" placeholder="Buscar produto..." onkeyup="filterProdutos()">
      </div>
      <button class="button" onclick="openModal('produtoModal')">+ Novo Produto</button>
      
      <div id="produtosContent"></div>
    </div>
  `;
  
  renderProdutosContent();
}

function renderProdutosContent() {
  const container = document.getElementById('produtosContent');
  if (!container) return;
  
  const query = document.getElementById('produtosSearch')?.value.toLowerCase() || '';
  const filtered = appState.data.produtos.filter(p => 
    !query || p.nome.toLowerCase().includes(query)
  );
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color: #999;">Nenhum produto encontrado</p>';
    return;
  }
  
  container.innerHTML = filtered.map(p => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${p.nome}</div>
        <div class="list-item-subtitle">
          ${p.categorias ? p.categorias.join(', ') : 'Sem categoria'} • R$ ${p.precoBase?.toFixed(2) || '0,00'}
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-icon" onclick="deleteProduto('${p.nome}')" style="color: #ef4444;">🗑️</button>
      </div>
    </div>
  `).join('');
}

// ─── Filter Functions ────────────────────────────────────────────────────────

function filterAgenda() {
  renderAgendaContent();
}

function filterClientes() {
  renderClientesContent();
}

function filterProdutos() {
  renderProdutosContent();
}

// ─── Modal Functions ─────────────────────────────────────────────────────────

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
  
  if (modalId === 'clienteModal') {
    document.getElementById('clienteNome').value = '';
    document.getElementById('clientePeriodo').value = '';
    document.getElementById('clienteHorarioMax').value = '';
    document.getElementById('clientePrazoBoleto').value = '';
    document.getElementById('clienteCobraEntrega').value = 'false';
    document.getElementById('clienteObservacoes').value = '';
  } else if (modalId === 'produtoModal') {
    document.getElementById('produtoNome').value = '';
    document.getElementById('produtoCategoria').value = '';
    document.getElementById('produtoPrecoBase').value = '';
  } else if (modalId === 'pedidoModal') {
    document.getElementById('pedidoCliente').value = '';
    document.getElementById('pedidoDia').value = '';
    document.getElementById('pedidoProduto').value = '';
    document.getElementById('pedidoCategoria').value = '';
    document.getElementById('pedidoQuantidade').value = '';
    document.getElementById('pedidoTipoVenda').value = '';
    document.getElementById('pedidoObservacoes').value = '';
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// ─── Save Functions ──────────────────────────────────────────────────────────

function saveCliente() {
  const nome = document.getElementById('clienteNome').value.trim();
  if (!nome) {
    alert('Nome do cliente é obrigatório');
    return;
  }
  
  const cliente = {
    id: `client_${Date.now()}`,
    nome,
    periodoEntrega: document.getElementById('clientePeriodo').value,
    horarioMaximo: document.getElementById('clienteHorarioMax').value,
    prazoBoleto: document.getElementById('clientePrazoBoleto').value,
    cobraEntrega: document.getElementById('clienteCobraEntrega').value === 'true',
    observacoes: document.getElementById('clienteObservacoes').value,
  };
  
  appState.data.clientes.push(cliente);
  saveData();
  closeModal('clienteModal');
  renderClientes();
}

function saveProduto() {
  const nome = document.getElementById('produtoNome').value.trim();
  if (!nome) {
    alert('Nome do produto é obrigatório');
    return;
  }
  
  const categorias = document.getElementById('produtoCategoria').value
    .split(',')
    .map(c => c.trim())
    .filter(c => c);
  
  const produto = {
    nome,
    categorias,
    precoBase: parseFloat(document.getElementById('produtoPrecoBase').value) || 0,
  };
  
  appState.data.produtos.push(produto);
  saveData();
  closeModal('produtoModal');
  renderProdutos();
}

function savePedido() {
  const clienteId = document.getElementById('pedidoCliente').value;
  const cliente = appState.data.clientes.find(c => c.id === clienteId);
  
  if (!cliente) {
    alert('Selecione um cliente');
    return;
  }
  
  const produtoNome = document.getElementById('pedidoProduto').value;
  if (!produtoNome) {
    alert('Selecione um produto');
    return;
  }
  
  const quantidade = parseInt(document.getElementById('pedidoQuantidade').value);
  if (!quantidade || quantidade <= 0) {
    alert('Quantidade deve ser maior que 0');
    return;
  }
  
  const pedido = {
    id: `order_${Date.now()}`,
    id_cliente: clienteId,
    cliente: cliente.nome,
    dia_semana: document.getElementById('pedidoDia').value,
    produto: produtoNome,
    categoria: document.getElementById('pedidoCategoria').value,
    quantidade,
    tipo_venda: document.getElementById('pedidoTipoVenda').value,
    observacoes: document.getElementById('pedidoObservacoes').value,
    status: 'pendente',
  };
  
  appState.data.pedidos.push(pedido);
  saveData();
  closeModal('pedidoModal');
  renderAgenda();
}

// ─── Delete Functions ────────────────────────────────────────────────────────

function deletePedido(id) {
  if (!confirm('Tem certeza que deseja deletar este pedido?')) return;
  appState.data.pedidos = appState.data.pedidos.filter(p => p.id !== id);
  saveData();
  renderAgenda();
}

function deleteCliente(id) {
  if (!confirm('Tem certeza que deseja deletar este cliente?')) return;
  appState.data.clientes = appState.data.clientes.filter(c => c.id !== id);
  appState.data.pedidos = appState.data.pedidos.filter(p => p.id_cliente !== id);
  saveData();
  renderClientes();
}

function deleteProduto(nome) {
  if (!confirm('Tem certeza que deseja deletar este produto?')) return;
  appState.data.produtos = appState.data.produtos.filter(p => p.nome !== nome);
  appState.data.pedidos = appState.data.pedidos.filter(p => p.produto !== nome);
  saveData();
  renderProdutos();
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function updateClientSelects() {
  const select = document.getElementById('pedidoCliente');
  if (!select) return;
  
  const currentValue = select.value;
  select.innerHTML = '<option value="">Selecionar cliente...</option>' +
    appState.data.clientes.map(c => 
      `<option value="${c.id}">${c.nome}</option>`
    ).join('');
  select.value = currentValue;
}

function updateProductSelects() {
  const select = document.getElementById('pedidoProduto');
  if (!select) return;
  
  const currentValue = select.value;
  select.innerHTML = '<option value="">Selecionar produto...</option>' +
    appState.data.produtos.map(p => 
      `<option value="${p.nome}">${p.nome}</option>`
    ).join('');
  select.value = currentValue;
}

function calculateStats() {
  return {
    totalPedidos: appState.data.pedidos.length,
    totalQuantidade: appState.data.pedidos.reduce((sum, p) => sum + (p.quantidade || 0), 0),
    clientesUnicos: new Set(appState.data.pedidos.map(p => p.id_cliente)).size,
    produtosUnicos: new Set(appState.data.pedidos.map(p => p.produto)).size,
    pendentes: appState.data.pedidos.filter(p => p.status === 'pendente').length,
    entregues: appState.data.pedidos.filter(p => p.status === 'entregue').length,
    cancelados: appState.data.pedidos.filter(p => p.status === 'cancelado').length,
  };
}

function calculateVolumeByDay() {
  const volume = {};
  DIAS_SEMANA.forEach(dia => {
    volume[dia] = appState.data.pedidos
      .filter(p => p.dia_semana === dia)
      .reduce((sum, p) => sum + (p.quantidade || 0), 0);
  });
  return volume;
}

function getTopProdutos(limit = 5) {
  const produtoMap = {};
  appState.data.pedidos.forEach(p => {
    if (!produtoMap[p.produto]) produtoMap[p.produto] = 0;
    produtoMap[p.produto] += p.quantidade || 0;
  });
  
  return Object.entries(produtoMap)
    .map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, limit);
}

// ─── Initialize ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  renderDashboard();
});

// Close modals on outside click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
  }
});
