// ─── Global State ────────────────────────────────────────────────────────────

let appState = {
  currentTab: 'dashboard',
  data: {
    pedidos: [],
    clientes: [],
    produtos: [],
  },
  editingPedido: null,
  editingCliente: null,
  agendaDiaFiltro: null,
};

const DIAS_SEMANA = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const DIAS_CURTOS = {
  'segunda-feira': 'Seg',
  'terça-feira': 'Ter',
  'quarta-feira': 'Qua',
  'quinta-feira': 'Qui',
  'sexta-feira': 'Sex',
  'sábado': 'Sáb',
};
const CATEGORIAS = ['Buque', 'Desfolhado', 'Pote'];

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
  const clientesHoje = getClientesHoje();
  
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
          ${DIAS_SEMANA.map(dia => {
            const volume = volumeByDay[dia] || 0;
            const maxVol = Math.max(...DIAS_SEMANA.map(d => volumeByDay[d] || 0)) || 1;
            const percentage = (volume / maxVol) * 100;
            return `
              <div class="volume-item">
                <span class="volume-day">${DIAS_CURTOS[dia]}</span>
                <div class="volume-bar">
                  <div class="volume-fill" style="width: ${percentage}%"></div>
                </div>
                <span class="volume-count">${volume}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="section">
        <h3>👥 Entregas de Hoje</h3>
        <div class="today-deliveries">
          ${clientesHoje.length > 0 ? clientesHoje.map(grupo => {
            const cliente = appState.data.clientes.find(c => c.id === grupo.clientId);
            const totalQtd = grupo.pedidos.reduce((s, p) => s + p.quantidade, 0);
            const entregues = grupo.pedidos.filter(p => p.status === 'entregue').length;
            const todoEntregue = entregues === grupo.pedidos.length;
            
            // Listar produtos do cliente
            const produtos = grupo.pedidos.map(p => `${p.produto} (${p.categoria || 'sem cat.'}) x${p.quantidade}`).join(', ');
            
            return `
              <div class="client-delivery-card ${todoEntregue ? 'completed' : ''}">
                <div class="client-header">
                  <div class="client-info">
                    <h4>${grupo.clientName}</h4>
                    <span class="client-meta">${grupo.pedidos.length} produto(s) | ${totalQtd} itens | ${entregues}/${grupo.pedidos.length} entregues</span>
                  </div>
                  <select class="status-select-client" value="${grupo.pedidos[0].status}" onchange="updateClientStatus('${grupo.clientId}', this.value)">
                    <option value="pendente">Pendente</option>
                    <option value="entregue">Entregue</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
                
                <div class="client-produtos">
                  <strong>Produtos:</strong> ${produtos}
                </div>
                
                ${cliente ? `
                  <div class="client-tags">
                    ${cliente.periodoEntrega ? `<span class="tag">${cliente.periodoEntrega}</span>` : ''}
                    ${cliente.horarioMaximo ? `<span class="tag">até ${cliente.horarioMaximo}</span>` : ''}
                    ${cliente.prazoBoleto ? `<span class="tag">Boleto ${cliente.prazoBoleto}</span>` : ''}
                    ${cliente.acumulaPedidos ? `<span class="tag">Acumula ${cliente.diasAcumulo || 'pedidos'}</span>` : ''}
                    ${cliente.cobraEntrega ? `<span class="tag">Cobra entrega</span>` : ''}
                  </div>
                ` : ''}
                
                ${cliente && cliente.observacoes ? `
                  <div class="client-obs">${cliente.observacoes}</div>
                ` : ''}
                
                ${cliente && cliente.precos && cliente.precos.length > 0 ? `
                  <div class="custom-prices">
                    <span class="prices-label">Preços Personalizados:</span>
                    ${cliente.precos.map(p => `
                      <div class="price-row">
                        <span>${p.produto}</span>
                        <span>R$ ${p.preco.toFixed(2)}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('') : '<div class="empty-state">Nenhuma entrega para hoje</div>'}
        </div>
      </div>
    </div>
  `;
}

// ─── Agenda Render ──────────────────────────────────────────────────────────

function renderAgenda() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <div class="agenda">
      <div class="section-header">
        <h2>📅 Agenda de Pedidos</h2>
        <button class="btn-primary" onclick="openModal('pedidoModal')">+ Novo Pedido</button>
      </div>
      
      <div class="agenda-filters">
        <label>Filtrar por dia:</label>
        <select id="agendaDiaSelect" onchange="filterAgendaByDay(this.value)">
          <option value="">Todos os dias</option>
          ${DIAS_SEMANA.map(dia => `<option value="${dia}">${dia}</option>`).join('')}
        </select>
      </div>
      
      <div id="agenda-list"></div>
    </div>
  `;
  
  renderAgendaList();
}

function filterAgendaByDay(dia) {
  appState.agendaDiaFiltro = dia || null;
  renderAgendaList();
}

function renderAgendaList() {
  const agendaList = document.getElementById('agenda-list');
  if (!agendaList) return;
  
  let diasParaMostrar = appState.agendaDiaFiltro ? [appState.agendaDiaFiltro] : DIAS_SEMANA;
  
  const groupedByDay = {};
  diasParaMostrar.forEach(dia => {
    groupedByDay[dia] = appState.data.pedidos.filter(p => p.dia_semana === dia);
  });
  
  agendaList.innerHTML = diasParaMostrar.map(dia => {
    const pedidosDia = groupedByDay[dia];
    
    // Agrupar por cliente
    const porCliente = {};
    pedidosDia.forEach(p => {
      if (!porCliente[p.id_cliente]) {
        porCliente[p.id_cliente] = { cliente: p.cliente, pedidos: [] };
      }
      porCliente[p.id_cliente].pedidos.push(p);
    });
    
    return `
      <div class="day-section">
        <h3>${DIAS_CURTOS[dia]} - ${dia} (${pedidosDia.length})</h3>
        <div class="clientes-list">
          ${Object.values(porCliente).length > 0 ? Object.values(porCliente).map(grupo => `
            <div class="cliente-group">
              <div class="cliente-name">${grupo.cliente}</div>
              <div class="pedidos-group">
                ${grupo.pedidos.map(p => `
                  <div class="pedido-item">
                    <div class="pedido-top">
                      <span class="pedido-produto">${p.produto}</span>
                      <span class="pedido-qty">x${p.quantidade}</span>
                    </div>
                    ${p.categoria ? `<div class="pedido-categoria">${p.categoria}</div>` : ''}
                    ${p.observacoes ? `<div class="pedido-obs">${p.observacoes}</div>` : ''}
                    <div class="pedido-actions">
                      <button class="btn-edit" onclick="editPedido('${p.id}')">✏️</button>
                      <button class="btn-delete" onclick="deletePedido('${p.id}')">🗑️</button>
                    </div>
                  </div>
                `).join('')}
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
  
  content.innerHTML = `
    <div class="clientes">
      <div class="section-header">
        <h2>👥 Clientes</h2>
        <button class="btn-primary" onclick="openModal('clienteModal')">+ Novo Cliente</button>
      </div>
      <div id="clientes-list"></div>
    </div>
  `;
  
  renderClientesList();
}

function renderClientesList() {
  const clientesList = document.getElementById('clientes-list');
  if (!clientesList) return;
  
  clientesList.innerHTML = `
    <div class="clientes-grid">
      ${appState.data.clientes.map(c => `
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
          
          ${c.precos && c.precos.length > 0 ? `
            <div class="cliente-section">
              <h4>💵 Preços Especiais</h4>
              <div class="precos-list">
                ${c.precos.map(p => `
                  <div class="preco-item">
                    <span>${p.produto}</span>
                    <span>R$ ${p.preco.toFixed(2)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
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
  
  content.innerHTML = `
    <div class="produtos">
      <div class="section-header">
        <h2>🥬 Produtos</h2>
        <button class="btn-primary" onclick="openModal('produtoModal')">+ Novo Produto</button>
      </div>
      <div id="produtos-list"></div>
    </div>
  `;
  
  renderProdutosList();
}

function renderProdutosList() {
  const produtosList = document.getElementById('produtos-list');
  if (!produtosList) return;
  
  produtosList.innerHTML = `
    <div class="produtos-grid">
      ${appState.data.produtos.map(p => {
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
    appState.editingPedido = null;
    document.getElementById('pedidoForm').reset();
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  appState.editingPedido = null;
  appState.editingCliente = null;
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
  
  if (appState.editingPedido) {
    const idx = appState.data.pedidos.findIndex(p => p.id === appState.editingPedido);
    if (idx >= 0) {
      appState.data.pedidos[idx] = {
        ...appState.data.pedidos[idx],
        id_cliente: clienteId,
        cliente: cliente.nome,
        dia_semana: document.getElementById('pedidoDia').value,
        produto: produtoNome,
        categoria: document.getElementById('pedidoCategoria').value || '',
        quantidade,
        tipo_venda: document.getElementById('pedidoTipoVenda').value || '',
        observacoes: document.getElementById('pedidoObservacoes').value || '',
      };
    }
  } else {
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
  }
  
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
  
  // Coletar preços especiais
  const precos = [];
  document.querySelectorAll('.preco-input-row').forEach(row => {
    const produto = row.querySelector('.preco-produto-select').value;
    const preco = parseFloat(row.querySelector('.preco-valor-input').value.replace(',', '.')) || 0;
    if (produto && preco > 0) {
      precos.push({ produto, preco });
    }
  });
  
  const clienteData = {
    nome,
    observacoes: document.getElementById('clienteObservacoes').value || '',
    prazoBoleto: document.getElementById('clientePrazoBoleto').value || '',
    acumulaPedidos: document.getElementById('clienteAcumula').checked,
    diasAcumulo: document.getElementById('clienteDiasAcumulo').value || '',
    prazoBoletoAcumulo: document.getElementById('clientePrazoBoletoAcumulo').value || '',
    periodoEntrega: document.getElementById('clientePeriodo').value || '',
    horarioMaximo: document.getElementById('clienteHorario').value || '',
    cobraEntrega: document.getElementById('clienteCobraEntrega').checked,
    precos,
  };
  
  if (appState.editingCliente) {
    // Editar cliente existente
    const idx = appState.data.clientes.findIndex(c => c.id === appState.editingCliente);
    if (idx >= 0) {
      appState.data.clientes[idx] = {
        ...appState.data.clientes[idx],
        ...clienteData,
      };
    }
  } else {
    // Novo cliente
    appState.data.clientes.push({
      id: `client_${Date.now()}`,
      ...clienteData,
    });
  }
  
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
    categorias: Array.from(document.getElementById('produtoCategorias').selectedOptions).map(o => o.value),
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

function editPedido(id) {
  const pedido = appState.data.pedidos.find(p => p.id === id);
  if (!pedido) return;
  
  appState.editingPedido = id;
  
  document.getElementById('pedidoCliente').value = pedido.id_cliente;
  document.getElementById('pedidoDia').value = pedido.dia_semana;
  document.getElementById('pedidoProduto').value = pedido.produto;
  document.getElementById('pedidoQuantidade').value = pedido.quantidade;
  document.getElementById('pedidoCategoria').value = pedido.categoria;
  document.getElementById('pedidoTipoVenda').value = pedido.tipo_venda;
  document.getElementById('pedidoObservacoes').value = pedido.observacoes;
  
  openModal('pedidoModal');
}

function editCliente(id) {
  const cliente = appState.data.clientes.find(c => c.id === id);
  if (!cliente) return;
  
  appState.editingCliente = id;
  
  document.getElementById('clienteNome').value = cliente.nome;
  document.getElementById('clienteObservacoes').value = cliente.observacoes;
  document.getElementById('clientePrazoBoleto').value = cliente.prazoBoleto;
  document.getElementById('clienteAcumula').checked = cliente.acumulaPedidos;
  document.getElementById('clienteDiasAcumulo').value = cliente.diasAcumulo;
  document.getElementById('clientePrazoBoletoAcumulo').value = cliente.prazoBoletoAcumulo;
  document.getElementById('clientePeriodo').value = cliente.periodoEntrega;
  document.getElementById('clienteHorario').value = cliente.horarioMaximo;
  document.getElementById('clienteCobraEntrega').checked = cliente.cobraEntrega;
  
  // Carregar preços especiais
  const precosContainer = document.getElementById('precosContainer');
  precosContainer.innerHTML = '';
  if (cliente.precos && cliente.precos.length > 0) {
    cliente.precos.forEach(p => {
      adicionarPrecoEspecial(p.produto, p.preco);
    });
  }
  
  openModal('clienteModal');
}

function editProduto(nome) {
  const produto = appState.data.produtos.find(p => p.nome === nome);
  if (!produto) return;
  
  document.getElementById('produtoNome').value = produto.nome;
  document.getElementById('produtoPrecoBase').value = produto.precoBase;
  
  Array.from(document.getElementById('produtoCategorias').options).forEach(opt => {
    opt.selected = produto.categorias.includes(opt.value);
  });
  
  openModal('produtoModal');
}

// ─── Update Status ─────────────────────────────────────────────────────────

function updateClientStatus(clientId, status) {
  // Mudar status de TODOS os pedidos do cliente
  appState.data.pedidos.forEach(p => {
    if (p.id_cliente === clientId) {
      p.status = status;
    }
  });
  saveData();
  renderDashboard();
}

// ─── Preço Especial Functions ──────────────────────────────────────────────

function adicionarPrecoEspecial(produtoNome = '', preco = '') {
  const container = document.getElementById('precosContainer');
  const row = document.createElement('div');
  row.className = 'preco-input-row';
  row.innerHTML = `
    <select class="preco-produto-select">
      <option value="">Selecionar produto...</option>
      ${appState.data.produtos.map(p => `<option value="${p.nome}" ${p.nome === produtoNome ? 'selected' : ''}>${p.nome}</option>`).join('')}
    </select>
    <input type="number" class="preco-valor-input" placeholder="Preço" value="${preco}" step="0.01" min="0">
    <button type="button" class="btn-delete" onclick="this.parentElement.remove()">🗑️</button>
  `;
  container.appendChild(row);
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

function getClientesHoje() {
  const hoje = getCurrentDay();
  const pedidosHoje = appState.data.pedidos.filter(p => p.dia_semana === hoje);
  
  const grouped = {};
  pedidosHoje.forEach(p => {
    if (!grouped[p.id_cliente]) {
      grouped[p.id_cliente] = { clientId: p.id_cliente, clientName: p.cliente, pedidos: [] };
    }
    grouped[p.id_cliente].pedidos.push(p);
  });
  
  return Object.values(grouped).sort((a, b) => a.clientName.localeCompare(b.clientName));
}

function getCurrentDay() {
  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  return days[new Date().getDay()];
}

// ─── Initialize ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
  }
});
