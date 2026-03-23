// App State
let appState = {
  currentTab: 'dashboard',
  data: {
    pedidos: [],
    clientes: [],
    produtos: [],
    precosPersonalizados: {}
  },
  selectedDay: 'quarta',
  searchQuery: '',
  editingId: null,
  modalOpen: false,
  modalType: null,
  firebaseLoaded: false,
};

// Salvar dados no localStorage e Firebase
function saveData() {
  localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
  // Sincronizar com Firebase se disponível
  if (typeof syncToFirebase !== 'undefined') {
    syncToFirebase();
  }
}

// Renderizar Dashboard
function renderDashboard() {
  const totalPedidos = appState.data.pedidos.length;
  const totalClientes = appState.data.clientes.length;
  const totalProdutos = appState.data.produtos.length;
  const totalItens = appState.data.pedidos.reduce((sum, p) => sum + p.quantidade, 0);
  
  const pendentes = appState.data.pedidos.filter(p => p.status === 'pendente').length;
  const entregues = appState.data.pedidos.filter(p => p.status === 'entregue').length;
  const cancelados = appState.data.pedidos.filter(p => p.status === 'cancelado').length;
  
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const volumePorDia = dias.map(dia => ({
    dia: dia.charAt(0).toUpperCase() + dia.slice(1),
    volume: appState.data.pedidos.filter(p => p.dia === dia).reduce((sum, p) => sum + p.quantidade, 0)
  }));
  
  const produtosHoje = {};
  appState.data.pedidos.forEach(p => {
    if (p.dia === appState.selectedDay) {
      produtosHoje[p.produto] = (produtosHoje[p.produto] || 0) + p.quantidade;
    }
  });
  
  let html = `
    <div class="content">
      <div class="card">
        <h2>📈 Resumo Semanal</h2>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-number">${totalPedidos}</div>
            <div class="stat-label">Pedidos</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${totalClientes}</div>
            <div class="stat-label">Clientes</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${totalProdutos}</div>
            <div class="stat-label">Produtos</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${totalItens}</div>
            <div class="stat-label">Itens</div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <h2>🚚 Status de Entregas</h2>
        <div class="metric">
          <span class="metric-label">Pendentes</span>
          <span class="metric-value" style="color: #f59e0b;">${pendentes}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Entregues</span>
          <span class="metric-value" style="color: #10b981;">${entregues}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Cancelados</span>
          <span class="metric-value" style="color: #ef4444;">${cancelados}</span>
        </div>
      </div>
      
      <div class="card">
        <h2>📊 Volume por Dia</h2>
        ${volumePorDia.map(d => `
          <div class="metric">
            <span class="metric-label">${d.dia}</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${Math.min(d.volume / 10 * 100, 100)}%"></div>
            </div>
            <span class="metric-value">${d.volume}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="card">
        <h2>🥬 Produtos do Dia</h2>
        ${Object.entries(produtosHoje).map(([produto, qtd]) => `
          <div class="metric">
            <span class="metric-label">${produto}</span>
            <span class="metric-value">${qtd}</span>
          </div>
        `).join('') || '<p>Sem produtos para hoje</p>'}
      </div>
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Renderizar Agenda
function renderAgenda() {
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const pedidosPorDia = {};
  
  dias.forEach(dia => {
    pedidosPorDia[dia] = appState.data.pedidos.filter(p => p.dia === dia);
  });
  
  let html = `
    <div class="content">
      <div class="card">
        <h2>📅 Agenda Semanal</h2>
        <div class="day-selector">
          ${dias.map(dia => `
            <button class="day-btn ${appState.selectedDay === dia ? 'active' : ''}" onclick="appState.selectedDay='${dia}'; renderAgenda()">
              ${dia.charAt(0).toUpperCase() + dia.slice(1)}
            </button>
          `).join('')}
        </div>
      </div>
      
      ${dias.map(dia => `
        <div class="card">
          <h3>${dia.charAt(0).toUpperCase() + dia.slice(1)}</h3>
          ${pedidosPorDia[dia].length > 0 ? pedidosPorDia[dia].map(p => `
            <div class="order-item">
              <div class="order-header">
                <strong>${p.clienteName}</strong>
                <span class="status-badge ${p.status}">${p.status}</span>
              </div>
              <div class="order-details">
                <div>${p.productName} - ${p.quantity} un. (${p.category})</div>
                ${p.observation ? `<div class="observation">📝 ${p.observation}</div>` : ''}
              </div>
              <div class="order-actions">
                <button onclick="updateOrderStatus('${p.id}', '${p.status === 'pending' ? 'delivered' : 'pending'}')">
                  ${p.status === 'pending' ? '✓ Entregar' : '↩ Pendente'}
                </button>
              </div>
            </div>
          `).join('') : '<p>Sem pedidos</p>'}
        </div>
      `).join('')}
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Renderizar Clientes
function renderClientes() {
  let html = `
    <div class="content">
      <div class="card">
        <h2>👥 Clientes</h2>
        <button class="btn-primary" onclick="openClientModal()">+ Novo Cliente</button>
        <input type="text" placeholder="Buscar cliente..." class="search-input" onkeyup="appState.searchQuery = this.value; renderClientes()">
      </div>
      
      ${appState.data.clientes
        .filter(c => c.name.toLowerCase().includes(appState.searchQuery.toLowerCase()))
        .map(c => `
          <div class="card">
            <div class="client-header">
              <h3>${c.name}</h3>
              <div class="client-actions">
                <button onclick="editClient('${c.id}')">✏️</button>
                <button onclick="deleteClient('${c.id}')">🗑️</button>
              </div>
            </div>
            <div class="client-details">
              ${c.observation ? `<div>📝 ${c.observation}</div>` : ''}
              ${c.deliveryPeriod ? `<div>🕐 ${c.deliveryPeriod}</div>` : ''}
              ${c.maxDeliveryTime ? `<div>⏰ Até ${c.maxDeliveryTime}</div>` : ''}
              ${c.boletoDeadline ? `<div>💳 Boleto: ${c.boletoDeadline} dias</div>` : ''}
              ${c.chargesDelivery ? `<div>🚚 Cobra entrega</div>` : ''}
            </div>
          </div>
        `).join('')}
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Renderizar Produtos
function renderProdutos() {
  let html = `
    <div class="content">
      <div class="card">
        <h2>🥬 Produtos</h2>
        <button class="btn-primary" onclick="openProductModal()">+ Novo Produto</button>
        <input type="text" placeholder="Buscar produto..." class="search-input" onkeyup="appState.searchQuery = this.value; renderProdutos()">
      </div>
      
      ${appState.data.produtos
        .filter(p => p.name.toLowerCase().includes(appState.searchQuery.toLowerCase()))
        .map(p => `
          <div class="card">
            <div class="product-header">
              <h3>${p.name}</h3>
              <div class="product-actions">
                <button onclick="editProduct('${p.id}')">✏️</button>
                <button onclick="deleteProduct('${p.id}')">🗑️</button>
              </div>
            </div>
            <div class="product-details">
              <div>Categoria: ${p.category}</div>
              ${p.priceBase ? `<div>Preço: R$ ${p.priceBase.toFixed(2)}</div>` : ''}
            </div>
          </div>
        `).join('')}
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Funções de ação
function updateOrderStatus(orderId, newStatus) {
  const order = appState.data.pedidos.find(o => o.id === orderId);
  if (order) {
    order.status = newStatus;
    saveData();
    renderAgenda();
  }
}

function openClientModal() {
  appState.modalType = 'client';
  appState.modalOpen = true;
  appState.editingId = null;
  showModal();
}

function openProductModal() {
  appState.modalType = 'product';
  appState.modalOpen = true;
  appState.editingId = null;
  showModal();
}

function editClient(clientId) {
  appState.modalType = 'client';
  appState.modalOpen = true;
  appState.editingId = clientId;
  showModal();
}

function editProduct(productId) {
  appState.modalType = 'product';
  appState.modalOpen = true;
  appState.editingId = productId;
  showModal();
}

function deleteClient(clientId) {
  if (confirm('Tem certeza que deseja deletar este cliente?')) {
    appState.data.clientes = appState.data.clientes.filter(c => c.id !== clientId);
    saveData();
    renderClientes();
  }
}

function deleteProduct(productId) {
  if (confirm('Tem certeza que deseja deletar este produto?')) {
    appState.data.produtos = appState.data.produtos.filter(p => p.id !== productId);
    saveData();
    renderProdutos();
  }
}

function showModal() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.style.display = 'block';
  }
}

function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.style.display = 'none';
  }
  appState.modalOpen = false;
}

// Renderizar abas
function renderTab(tab) {
  appState.currentTab = tab;
  
  // Atualizar botões de abas
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[onclick="renderTab('${tab}')"]`)?.classList.add('active');
  
  // Renderizar conteúdo
  if (tab === 'dashboard') renderDashboard();
  else if (tab === 'agenda') renderAgenda();
  else if (tab === 'clientes') renderClientes();
  else if (tab === 'produtos') renderProdutos();
}

// Inicializar
window.addEventListener('load', () => {
  // Carregar dados do localStorage primeiro
  const saved = localStorage.getItem('fazendas-up-data');
  if (saved) {
    appState.data = JSON.parse(saved);
  }
  
  // Carregar dados do Firebase se disponível
  if (typeof loadFromFirebase !== 'undefined') {
    loadFromFirebase((data) => {
      if (data) {
        appState.data = data;
        appState.firebaseLoaded = true;
        renderDashboard();
      }
    });
  } else {
    renderDashboard();
  }
});

// Atualizar a cada 5 segundos
setInterval(() => {
  if (appState.firebaseLoaded) {
    if (appState.currentTab === 'dashboard') renderDashboard();
    else if (appState.currentTab === 'agenda') renderAgenda();
  }
}, 5000);
