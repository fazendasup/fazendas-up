// App State
let appState = {
  currentTab: 'dashboard',
  data: {
    pedidos: [],
    clientes: [],
    produtos: [],
  },
};

const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ─── Inicialização ───────────────────────────────────────────────────────────

function init() {
  loadData();
  setupEventListeners();
  renderDashboard();
}

function setupEventListeners() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  appState.currentTab = tab;
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  
  if (tab === 'dashboard') renderDashboard();
  else if (tab === 'agenda') renderAgenda();
  else if (tab === 'clientes') renderClientes();
  else if (tab === 'produtos') renderProdutos();
}

// ─── Data Management ─────────────────────────────────────────────────────────

function loadData() {
  const saved = localStorage.getItem('fazendas-up-data');
  if (saved) {
    try {
      appState.data = JSON.parse(saved);
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
      loadSampleData();
    }
  } else {
    loadSampleData();
  }
}

function loadSampleData() {
  appState.data = {
    clientes: [
      { id: 'client_1', nome: 'Grand Amazon', periodoEntrega: 'Manha', observacoes: '' },
      { id: 'client_2', nome: 'Rodrigues Jacira Reis', periodoEntrega: 'Tarde', observacoes: 'Boleto para 21 dias' },
      { id: 'client_3', nome: 'Rodrigues Ponta Negra', periodoEntrega: 'Manha', observacoes: '' },
      { id: 'client_4', nome: 'Supermercado Central', periodoEntrega: 'Tarde', observacoes: 'Entrega ate 18h' },
      { id: 'client_5', nome: 'Restaurante da Cidade', periodoEntrega: 'Manha', observacoes: 'Diariamente' },
    ],
    produtos: [
      { nome: 'Alface Crespa Verde', precoBase: 3.50 },
      { nome: 'Alface Americana', precoBase: 4.00 },
      { nome: 'Alface MIX', precoBase: 3.75 },
      { nome: 'Rucula', precoBase: 5.00 },
      { nome: 'Espinafre', precoBase: 4.50 },
      { nome: 'Tomate Caqui', precoBase: 6.00 },
      { nome: 'Tomate Cereja', precoBase: 7.00 },
      { nome: 'Cenoura', precoBase: 2.50 },
      { nome: 'Beterraba', precoBase: 3.00 },
      { nome: 'Abobora', precoBase: 4.00 },
      { nome: 'Brocolis', precoBase: 5.50 },
      { nome: 'Couve-flor', precoBase: 6.00 },
      { nome: 'Pimentao Vermelho', precoBase: 5.50 },
      { nome: 'Pimentao Verde', precoBase: 4.50 },
      { nome: 'Cebola', precoBase: 2.00 },
      { nome: 'Alho', precoBase: 8.00 },
      { nome: 'Batata Doce', precoBase: 3.50 },
      { nome: 'Batata Comum', precoBase: 2.50 },
      { nome: 'Micro Mostarda', precoBase: 6.50 },
      { nome: 'Micro Brocolis', precoBase: 7.00 },
    ],
    pedidos: [
      { id: 'order_1', id_cliente: 'client_1', cliente: 'Grand Amazon', dia_semana: 'Segunda', produto: 'Micro Mostarda', quantidade: 1, status: 'pendente' },
      { id: 'order_2', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Segunda', produto: 'Alface Americana', quantidade: 5, status: 'pendente' },
      { id: 'order_3', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Segunda', produto: 'Alface MIX', quantidade: 3, status: 'pendente' },
      { id: 'order_4', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Segunda', produto: 'Alface Crespa Verde', quantidade: 10, status: 'pendente' },
      { id: 'order_5', id_cliente: 'client_3', cliente: 'Rodrigues Ponta Negra', dia_semana: 'Segunda', produto: 'Alface Americana', quantidade: 8, status: 'pendente' },
      { id: 'order_6', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Terca', produto: 'Tomate Caqui', quantidade: 20, status: 'pendente' },
      { id: 'order_7', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Terca', produto: 'Cenoura', quantidade: 15, status: 'pendente' },
      { id: 'order_8', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Terca', produto: 'Rucula', quantidade: 5, status: 'pendente' },
      { id: 'order_9', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Terca', produto: 'Espinafre', quantidade: 4, status: 'pendente' },
      { id: 'order_10', id_cliente: 'client_1', cliente: 'Grand Amazon', dia_semana: 'Quarta', produto: 'Brocolis', quantidade: 12, status: 'pendente' },
      { id: 'order_11', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Quarta', produto: 'Pimentao Vermelho', quantidade: 6, status: 'pendente' },
      { id: 'order_12', id_cliente: 'client_3', cliente: 'Rodrigues Ponta Negra', dia_semana: 'Quarta', produto: 'Tomate Cereja', quantidade: 8, status: 'pendente' },
      { id: 'order_13', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Quinta', produto: 'Couve-flor', quantidade: 10, status: 'pendente' },
      { id: 'order_14', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Quinta', produto: 'Alface Crespa Verde', quantidade: 7, status: 'pendente' },
      { id: 'order_15', id_cliente: 'client_1', cliente: 'Grand Amazon', dia_semana: 'Sexta', produto: 'Beterraba', quantidade: 5, status: 'pendente' },
      { id: 'order_16', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Sexta', produto: 'Abobora', quantidade: 3, status: 'pendente' },
      { id: 'order_17', id_cliente: 'client_3', cliente: 'Rodrigues Ponta Negra', dia_semana: 'Sexta', produto: 'Cebola', quantidade: 10, status: 'pendente' },
      { id: 'order_18', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Sabado', produto: 'Alho', quantidade: 2, status: 'pendente' },
      { id: 'order_19', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Sabado', produto: 'Batata Doce', quantidade: 8, status: 'pendente' },
    ]
  };
  saveData();
}

function saveData() {
  localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
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
      ${topProdutos.length > 0 ? topProdutos.map(p => `
        <div class="metric">
          <span class="metric-label">${p.nome}</span>
          <span class="metric-value">${p.quantidade} un</span>
        </div>
      `).join('') : '<p style="color: #999;">Nenhum produto ainda</p>'}
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
    const filtered = pedidosDia.filter(p => !query || p.cliente.toLowerCase().includes(query));
    
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
              <div class="list-item-subtitle">${p.quantidade} un</div>
            </div>
            <div class="list-item-actions">
              <button class="btn-icon" onclick="deletePedido('${p.id}')" style="color: #ef4444;">🗑️</button>
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
  const filtered = appState.data.clientes.filter(c => !query || c.nome.toLowerCase().includes(query));
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color: #999;">Nenhum cliente encontrado</p>';
    return;
  }
  
  container.innerHTML = filtered.map(c => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${c.nome}</div>
        <div class="list-item-subtitle">${c.periodoEntrega ? c.periodoEntrega : 'Sem período'}</div>
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
  const filtered = appState.data.produtos.filter(p => !query || p.nome.toLowerCase().includes(query));
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color: #999;">Nenhum produto encontrado</p>';
    return;
  }
  
  container.innerHTML = filtered.map(p => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${p.nome}</div>
        <div class="list-item-subtitle">R$ ${p.precoBase?.toFixed(2) || '0,00'}</div>
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
    document.getElementById('clienteObservacoes').value = '';
  } else if (modalId === 'produtoModal') {
    document.getElementById('produtoNome').value = '';
    document.getElementById('produtoPrecoBase').value = '';
  } else if (modalId === 'pedidoModal') {
    document.getElementById('pedidoCliente').value = '';
    document.getElementById('pedidoDia').value = '';
    document.getElementById('pedidoProduto').value = '';
    document.getElementById('pedidoQuantidade').value = '';
    updateClientSelects();
    updateProductSelects();
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
  
  const produto = {
    nome,
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
    quantidade,
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
  
  select.innerHTML = '<option value="">Selecionar cliente...</option>' +
    appState.data.clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
}

function updateProductSelects() {
  const select = document.getElementById('pedidoProduto');
  if (!select) return;
  
  select.innerHTML = '<option value="">Selecionar produto...</option>' +
    appState.data.produtos.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('');
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

document.addEventListener('DOMContentLoaded', init);

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
  }
});
