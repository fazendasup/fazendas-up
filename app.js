// ─── Global State ────────────────────────────────────────────────────────────

let appState = {
  currentTab: 'dashboard',
  data: {
    pedidos: [],
    clientes: [],
    produtos: [],
  },
  today: new Date().toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '').toLowerCase(),
};

const DIAS_SEMANA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

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

async function loadData() {
  const saved = localStorage.getItem('fazendas-up-data');
  if (saved) {
    try {
      appState.data = JSON.parse(saved);
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
      await loadSampleData();
    }
  } else {
    await loadSampleData();
  }
}

async function loadSampleData() {
  try {
    const response = await fetch('dados-completos.json');
    const data = await response.json();
    
    // Transformar dados com IDs e status
    appState.data.pedidos = data.orders.map((o, idx) => ({
      id: `order_${idx}`,
      id_cliente: o.id_cliente,
      cliente: o.cliente,
      dia_semana: o.dia_semana,
      produto: o.produto,
      categoria: o.categoria || '',
      quantidade: o.quantidade || 0,
      tipo_venda: o.tipo_venda || '',
      observacoes: o.observacoes || '',
      status: 'pendente',
    }));
    
    appState.data.clientes = data.clients.map(c => ({
      id: c.id,
      nome: c.nome,
      observacoes: c.observacoes || '',
      prazoBoleto: c.prazoBoleto || '',
      acumulaPedidos: c.acumulaPedidos || false,
      diasAcumulo: c.diasAcumulo || '',
      prazoBoletoAcumulo: c.prazoBoletoAcumulo || '',
      periodoEntrega: c.periodoEntrega || '',
      horarioMaximo: c.horarioMaximo || '',
      cobraEntrega: c.cobraEntrega || false,
      precos: c.precos || [],
    }));
    
    appState.data.produtos = data.products.map(p => ({
      nome: p.nome,
      categorias: p.categorias || [],
      precoBase: p.precoBase || 0,
    }));
    
    saveData();
  } catch (e) {
    console.error('Erro ao carregar dados de exemplo:', e);
    // Fallback com dados mínimos
    appState.data = {
      pedidos: [],
      clientes: [],
      produtos: [],
    };
  }
}

function saveData() {
  localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
}

// ─── Dashboard Render ────────────────────────────────────────────────────────

function renderDashboard() {
  const content = document.getElementById('content');
  const stats = calculateStats();
  const volumeByDay = calculateVolumeByDay();
  const topProdutos = getTopProdutos(5);
  const pedidosHoje = getPedidosHoje();
  const produtosHoje = getProdutosHoje();
  
  content.innerHTML = `
    <div class="dashboard">
      <h2>📊 Dashboard</h2>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.totalPedidos}</div>
          <div class="stat-label">Pedidos</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalQuantidade}</div>
          <div class="stat-label">Itens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.clientesUnicos}</div>
          <div class="stat-label">Clientes</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.produtosUnicos}</div>
          <div class="stat-label">Produtos</div>
        </div>
      </div>

      <div class="section">
        <h3>🚚 Status de Entregas</h3>
        <div class="status-grid">
          <div class="status-card pending">
            <div class="status-value">${stats.pendentes}</div>
            <div class="status-label">Pendentes</div>
          </div>
          <div class="status-card delivered">
            <div class="status-value">${stats.entregues}</div>
            <div class="status-label">Entregues</div>
          </div>
          <div class="status-card cancelled">
            <div class="status-value">${stats.cancelados}</div>
            <div class="status-label">Cancelados</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h3>📈 Volume por Dia</h3>
        <div class="volume-list">
          ${DIAS_SEMANA.map(dia => `
            <div class="volume-item">
              <span class="volume-day">${capitalizeDay(dia)}</span>
              <span class="volume-count">${volumeByDay[dia] || 0} itens</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <h3>🥬 Top 5 Produtos</h3>
        <div class="products-list">
          ${topProdutos.map((p, i) => `
            <div class="product-item">
              <span class="product-rank">#${i + 1}</span>
              <span class="product-name">${p.nome}</span>
              <span class="product-qty">${p.quantidade} un</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <h3>📅 Pedidos de Hoje</h3>
        <div class="today-orders">
          ${pedidosHoje.length > 0 ? `
            <div class="orders-count">Total: ${pedidosHoje.length} pedidos</div>
            ${pedidosHoje.slice(0, 10).map(p => `
              <div class="order-item">
                <span class="order-client">${p.cliente}</span>
                <span class="order-product">${p.produto}</span>
                <span class="order-qty">${p.quantidade}x</span>
                <span class="status-badge ${p.status}">${p.status}</span>
              </div>
            `).join('')}
            ${pedidosHoje.length > 10 ? `<div class="more-items">+${pedidosHoje.length - 10} mais</div>` : ''}
          ` : '<div class="empty-state">Nenhum pedido para hoje</div>'}
        </div>
      </div>

      <div class="section">
        <h3>🥬 Produtos de Hoje</h3>
        <div class="today-products">
          ${produtosHoje.length > 0 ? `
            <div class="products-count">Total: ${produtosHoje.length} produtos diferentes</div>
            ${produtosHoje.map(p => `
              <div class="product-item">
                <span class="product-name">${p.nome}</span>
                <span class="product-qty">${p.quantidade}x</span>
              </div>
            `).join('')}
          ` : '<div class="empty-state">Nenhum produto para hoje</div>'}
        </div>
      </div>
    </div>
  `;
}

// ─── Agenda Render ──────────────────────────────────────────────────────────

function renderAgenda() {
  const content = document.getElementById('content');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Buscar pedido...';
  searchInput.className = 'search-input';
  
  let filteredPedidos = appState.data.pedidos;
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    filteredPedidos = appState.data.pedidos.filter(p =>
      p.cliente.toLowerCase().includes(query) ||
      p.produto.toLowerCase().includes(query)
    );
    renderAgendaList(filteredPedidos);
  });
  
  content.innerHTML = `
    <div class="agenda">
      <div class="section-header">
        <h2>📅 Agenda de Pedidos</h2>
        <button class="btn-primary" onclick="openModal('pedidoModal')">+ Novo Pedido</button>
      </div>
    </div>
  `;
  
  content.querySelector('.agenda').appendChild(searchInput);
  
  const agendaDiv = document.createElement('div');
  agendaDiv.id = 'agenda-list';
  content.querySelector('.agenda').appendChild(agendaDiv);
  
  renderAgendaList(filteredPedidos);
}

function renderAgendaList(pedidos) {
  const agendaList = document.getElementById('agenda-list');
  
  const groupedByDay = {};
  DIAS_SEMANA.forEach(dia => {
    groupedByDay[dia] = pedidos.filter(p => p.dia_semana === dia);
  });
  
  agendaList.innerHTML = DIAS_SEMANA.map(dia => {
    const pedidosDia = groupedByDay[dia];
    return `
      <div class="day-section">
        <h3>${capitalizeDay(dia)} (${pedidosDia.length})</h3>
        <div class="pedidos-list">
          ${pedidosDia.length > 0 ? pedidosDia.map(p => `
            <div class="pedido-card">
              <div class="pedido-header">
                <span class="pedido-cliente">${p.cliente}</span>
                <span class="status-badge ${p.status}">${p.status}</span>
              </div>
              <div class="pedido-details">
                <span class="pedido-produto">${p.produto}</span>
                <span class="pedido-qty">${p.quantidade}x</span>
              </div>
              <div class="pedido-categoria">${p.categoria}</div>
              ${p.observacoes ? `<div class="pedido-obs">${p.observacoes}</div>` : ''}
              <div class="pedido-actions">
                <select class="status-select" value="${p.status}" onchange="updatePedidoStatus('${p.id}', this.value)">
                  <option value="pendente">Pendente</option>
                  <option value="entregue">Entregue</option>
                  <option value="cancelado">Cancelado</option>
                </select>
                <button class="btn-delete" onclick="deletePedido('${p.id}')">🗑️</button>
              </div>
            </div>
          `).join('') : '<div class="empty-state">Nenhum pedido</div>'}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Clientes Render ────────────────────────────────────────────────────────

function renderClientes() {
  const content = document.getElementById('content');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Buscar cliente...';
  searchInput.className = 'search-input';
  
  let filteredClientes = appState.data.clientes;
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    filteredClientes = appState.data.clientes.filter(c =>
      c.nome.toLowerCase().includes(query)
    );
    renderClientesList(filteredClientes);
  });
  
  content.innerHTML = `
    <div class="clientes">
      <div class="section-header">
        <h2>👥 Clientes</h2>
        <button class="btn-primary" onclick="openModal('clienteModal')">+ Novo Cliente</button>
      </div>
    </div>
  `;
  
  content.querySelector('.clientes').appendChild(searchInput);
  
  const clientesDiv = document.createElement('div');
  clientesDiv.id = 'clientes-list';
  content.querySelector('.clientes').appendChild(clientesDiv);
  
  renderClientesList(filteredClientes);
}

function renderClientesList(clientes) {
  const clientesList = document.getElementById('clientes-list');
  
  clientesList.innerHTML = `
    <div class="clientes-grid">
      ${clientes.map(c => `
        <div class="cliente-card">
          <div class="cliente-header">
            <h3>${c.nome}</h3>
            <button class="btn-delete" onclick="deleteCliente('${c.id}')">🗑️</button>
          </div>
          
          <div class="cliente-section">
            <h4>📍 Entrega</h4>
            <div class="cliente-info">
              <span>Período: ${c.periodoEntrega || 'Não definido'}</span>
              <span>Horário: ${c.horarioMaximo || 'Não definido'}</span>
              <span>Taxa: ${c.cobraEntrega ? 'Sim' : 'Não'}</span>
            </div>
          </div>
          
          <div class="cliente-section">
            <h4>💰 Faturamento</h4>
            <div class="cliente-info">
              <span>Boleto: ${c.prazoBoleto || 'Não definido'}</span>
              <span>Acumula: ${c.acumulaPedidos ? 'Sim' : 'Não'}</span>
              ${c.acumulaPedidos ? `<span>Dias: ${c.diasAcumulo}</span>` : ''}
              ${c.prazoBoletoAcumulo ? `<span>Prazo Acúmulo: ${c.prazoBoletoAcumulo}</span>` : ''}
            </div>
          </div>
          
          ${c.observacoes ? `
            <div class="cliente-section">
              <h4>📝 Observações</h4>
              <div class="cliente-obs">${c.observacoes}</div>
            </div>
          ` : ''}
          
          <button class="btn-secondary" onclick="editCliente('${c.id}')">Editar</button>
        </div>
      `).join('')}
    </div>
  `;
}

// ─── Produtos Render ────────────────────────────────────────────────────────

function renderProdutos() {
  const content = document.getElementById('content');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Buscar produto...';
  searchInput.className = 'search-input';
  
  let filteredProdutos = appState.data.produtos;
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    filteredProdutos = appState.data.produtos.filter(p =>
      p.nome.toLowerCase().includes(query)
    );
    renderProdutosList(filteredProdutos);
  });
  
  content.innerHTML = `
    <div class="produtos">
      <div class="section-header">
        <h2>🥬 Produtos</h2>
        <button class="btn-primary" onclick="openModal('produtoModal')">+ Novo Produto</button>
      </div>
    </div>
  `;
  
  content.querySelector('.produtos').appendChild(searchInput);
  
  const produtosDiv = document.createElement('div');
  produtosDiv.id = 'produtos-list';
  content.querySelector('.produtos').appendChild(produtosDiv);
  
  renderProdutosList(filteredProdutos);
}

function renderProdutosList(produtos) {
  const produtosList = document.getElementById('produtos-list');
  
  produtosList.innerHTML = `
    <div class="produtos-grid">
      ${produtos.map(p => {
        const totalPedidos = appState.data.pedidos.filter(pd => pd.produto === p.nome).length;
        const totalQuantidade = appState.data.pedidos
          .filter(pd => pd.produto === p.nome)
          .reduce((sum, pd) => sum + (pd.quantidade || 0), 0);
        
        return `
          <div class="produto-card">
            <div class="produto-header">
              <h3>${p.nome}</h3>
              <button class="btn-delete" onclick="deleteProduto('${p.nome}')">🗑️</button>
            </div>
            
            <div class="produto-info">
              <span>Preço Base: R$ ${p.precoBase.toFixed(2)}</span>
              <span>Categorias: ${p.categorias.join(', ') || 'Nenhuma'}</span>
            </div>
            
            <div class="produto-stats">
              <span>Pedidos: ${totalPedidos}</span>
              <span>Quantidade Total: ${totalQuantidade}x</span>
            </div>
            
            <button class="btn-secondary" onclick="editProduto('${p.nome}')">Editar</button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ─── Modal Functions ────────────────────────────────────────────────────────

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
  
  if (modalId === 'clienteModal') {
    updateClientSelects();
  } else if (modalId === 'pedidoModal') {
    updateClientSelects();
    updateProductSelects();
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// ─── Save Functions ────────────────────────────────────────────────────────

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
    categoria: document.getElementById('pedidoCategoria').value || '',
    quantidade,
    tipo_venda: document.getElementById('pedidoTipoVenda').value || '',
    observacoes: document.getElementById('pedidoObservacoes').value || '',
    status: 'pendente',
  };
  
  appState.data.pedidos.push(pedido);
  saveData();
  closeModal('pedidoModal');
  renderAgenda();
}

function saveCliente() {
  const nome = document.getElementById('clienteNome').value.trim();
  if (!nome) {
    alert('Nome do cliente é obrigatório');
    return;
  }
  
  const cliente = {
    id: `client_${Date.now()}`,
    nome,
    observacoes: document.getElementById('clienteObservacoes').value || '',
    prazoBoleto: document.getElementById('clientePrazoBoleto').value || '',
    acumulaPedidos: document.getElementById('clienteAcumula').checked,
    diasAcumulo: document.getElementById('clienteDiasAcumulo').value || '',
    prazoBoletoAcumulo: document.getElementById('clientePrazoBoletoAcumulo').value || '',
    periodoEntrega: document.getElementById('clientePeriodo').value || '',
    horarioMaximo: document.getElementById('clienteHorario').value || '',
    cobraEntrega: document.getElementById('clienteCobraEntrega').checked,
    precos: [],
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
    categorias: (document.getElementById('produtoCategorias').value || '').split(',').map(c => c.trim()).filter(c => c),
  };
  
  appState.data.produtos.push(produto);
  saveData();
  closeModal('produtoModal');
  renderProdutos();
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

// ─── Edit Functions ────────────────────────────────────────────────────────

function editCliente(id) {
  const cliente = appState.data.clientes.find(c => c.id === id);
  if (!cliente) return;
  
  // Preencher modal com dados
  document.getElementById('clienteNome').value = cliente.nome;
  document.getElementById('clienteObservacoes').value = cliente.observacoes;
  document.getElementById('clientePrazoBoleto').value = cliente.prazoBoleto;
  document.getElementById('clienteAcumula').checked = cliente.acumulaPedidos;
  document.getElementById('clienteDiasAcumulo').value = cliente.diasAcumulo;
  document.getElementById('clientePrazoBoletoAcumulo').value = cliente.prazoBoletoAcumulo;
  document.getElementById('clientePeriodo').value = cliente.periodoEntrega;
  document.getElementById('clienteHorario').value = cliente.horarioMaximo;
  document.getElementById('clienteCobraEntrega').checked = cliente.cobraEntrega;
  
  openModal('clienteModal');
}

function editProduto(nome) {
  const produto = appState.data.produtos.find(p => p.nome === nome);
  if (!produto) return;
  
  document.getElementById('produtoNome').value = produto.nome;
  document.getElementById('produtoPrecoBase').value = produto.precoBase;
  document.getElementById('produtoCategorias').value = produto.categorias.join(', ');
  
  openModal('produtoModal');
}

// ─── Update Status ─────────────────────────────────────────────────────────

function updatePedidoStatus(id, status) {
  const pedido = appState.data.pedidos.find(p => p.id === id);
  if (pedido) {
    pedido.status = status;
    saveData();
    renderAgenda();
  }
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

function getPedidosHoje() {
  return appState.data.pedidos.filter(p => 
    p.dia_semana.toLowerCase().includes(appState.today)
  );
}

function getProdutosHoje() {
  const pedidosHoje = getPedidosHoje();
  const produtosMap = {};
  
  pedidosHoje.forEach(p => {
    if (!produtosMap[p.produto]) {
      produtosMap[p.produto] = 0;
    }
    produtosMap[p.produto] += p.quantidade || 0;
  });
  
  return Object.entries(produtosMap)
    .map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

function capitalizeDay(dia) {
  return dia.charAt(0).toUpperCase() + dia.slice(1);
}

// ─── Initialize ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
  }
});
