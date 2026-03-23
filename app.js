// Dados iniciais do app
const initialData = {
  pedidos: [
    { id: '1', cliente: 'João Silva', produto: 'Alface Crespa Verde', categoria: 'Folhosas', quantidade: 10, dia: 'quarta', status: 'pendente', preco: 3.50 },
    { id: '2', cliente: 'Maria Santos', produto: 'Baby Manjericão', categoria: 'Ervas', quantidade: 5, dia: 'quarta', status: 'pendente', preco: 5.00 },
    { id: '3', cliente: 'João Silva', produto: 'Alface MIX', categoria: 'Folhosas', quantidade: 8, dia: 'quarta', status: 'pendente', preco: 4.00 },
  ],
  clientes: [
    { id: '1', nome: 'João Silva', telefone: '(11) 99999-0001', periodo: 'manha', horarioMax: '10:00', prazoBoleto: 3, cobraEntrega: false, observacoes: 'Boleto para 3 dias', acumulaPedidos: 0 },
    { id: '2', nome: 'Maria Santos', telefone: '(11) 99999-0002', periodo: 'tarde', horarioMax: '15:00', prazoBoleto: 5, cobraEntrega: true, observacoes: '', acumulaPedidos: 15 },
  ],
  produtos: [
    { id: '1', nome: 'Alface Crespa Verde', categoria: 'Folhosas', precoBase: 3.50 },
    { id: '2', nome: 'Baby Manjericão', categoria: 'Ervas', precoBase: 5.00 },
    { id: '3', nome: 'Alface MIX', categoria: 'Folhosas', precoBase: 4.00 },
  ],
  precosPersonalizados: {
    '1-1': 3.20, // cliente 1, produto 1
  }
};

// App State
let appState = {
  currentTab: 'dashboard',
  data: JSON.parse(localStorage.getItem('fazendas-up-data')) || initialData,
  selectedDay: 'quarta',
  searchQuery: '',
  editingId: null,
  modalOpen: false,
  modalType: null,
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
        <h2>📦 Volume por Dia</h2>
        ${volumePorDia.map(v => `
          <div class="metric">
            <span class="metric-label">${v.dia}</span>
            <span class="metric-value">${v.volume}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="card">
        <h2>🥬 Produtos do Dia</h2>
        ${Object.entries(produtosHoje).map(([produto, qty]) => `
          <div class="list-item">
            <div>
              <div class="list-item-title">${produto}</div>
              <div class="list-item-subtitle">${qty} unidades</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Renderizar Agenda
function renderAgenda() {
  const pedidosDia = appState.data.pedidos.filter(p => p.dia === appState.selectedDay);
  const agrupados = {};
  
  pedidosDia.forEach(p => {
    if (!agrupados[p.cliente]) agrupados[p.cliente] = [];
    agrupados[p.cliente].push(p);
  });
  
  let html = `
    <div class="content" style="grid-column: 1 / -1;">
      <div class="card">
        <h2>📅 Pedidos por Dia</h2>
        <div style="margin-bottom: 20px;">
          <label style="margin-right: 10px;">Selecione o dia:</label>
          <select id="daySelect" style="padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" onchange="changeDayAndRender()">
            <option value="segunda" ${appState.selectedDay === 'segunda' ? 'selected' : ''}>Segunda-feira</option>
            <option value="terca" ${appState.selectedDay === 'terca' ? 'selected' : ''}>Terça-feira</option>
            <option value="quarta" ${appState.selectedDay === 'quarta' ? 'selected' : ''}>Quarta-feira</option>
            <option value="quinta" ${appState.selectedDay === 'quinta' ? 'selected' : ''}>Quinta-feira</option>
            <option value="sexta" ${appState.selectedDay === 'sexta' ? 'selected' : ''}>Sexta-feira</option>
            <option value="sabado" ${appState.selectedDay === 'sabado' ? 'selected' : ''}>Sábado</option>
          </select>
        </div>
        <button class="button" onclick="openPedidoModal()">+ Novo Pedido</button>
        <div style="margin-top: 20px;">
          ${Object.entries(agrupados).map(([cliente, pedidos]) => `
            <div style="background: #f8faf8; padding: 15px; border-radius: 6px; margin-bottom: 15px;">
              <h3 style="color: #2d7a3a; margin-bottom: 10px;">${cliente}</h3>
              ${pedidos.map(p => `
                <div class="list-item" style="margin-bottom: 8px;">
                  <div>
                    <div class="list-item-title">${p.produto}</div>
                    <div class="list-item-subtitle">${p.quantidade} un. - ${p.categoria}</div>
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <select onchange="updatePedidoStatus('${p.id}', this.value)" style="padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px;">
                      <option value="pendente" ${p.status === 'pendente' ? 'selected' : ''}>Pendente</option>
                      <option value="entregue" ${p.status === 'entregue' ? 'selected' : ''}>Entregue</option>
                      <option value="cancelado" ${p.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
                    </select>
                    <button onclick="deletePedido('${p.id}')" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Remover</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Renderizar Clientes
function renderClientes() {
  const clientes = appState.data.clientes.filter(c => 
    c.nome.toLowerCase().includes(appState.searchQuery.toLowerCase())
  );
  
  let html = `
    <div class="content" style="grid-column: 1 / -1;">
      <div class="card">
        <h2>👥 Clientes</h2>
        <button class="button" onclick="openClienteModal()">+ Novo Cliente</button>
        <div class="search-box">
          <input type="text" id="clientSearch" placeholder="Buscar cliente..." onkeyup="updateSearch('cliente')" value="${appState.searchQuery}">
        </div>
        <div>
          ${clientes.map(c => `
            <div class="list-item" style="margin-bottom: 10px;">
              <div style="flex: 1;">
                <div class="list-item-title">${c.nome}</div>
                <div class="list-item-subtitle">${c.telefone} | ${c.periodo} | Máx: ${c.horarioMax}</div>
                <div class="list-item-subtitle">Prazo boleto: ${c.prazoBoleto} dias | Cobra entrega: ${c.cobraEntrega ? 'Sim' : 'Não'}</div>
                ${c.observacoes ? `<div class="list-item-subtitle" style="color: #2d7a3a; font-weight: 500;">📝 ${c.observacoes}</div>` : ''}
              </div>
              <div style="display: flex; gap: 8px;">
                <button onclick="editCliente('${c.id}')" style="background: #2d7a3a; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Editar</button>
                <button onclick="deleteCliente('${c.id}')" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Remover</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Renderizar Produtos
function renderProdutos() {
  const produtos = appState.data.produtos.filter(p => 
    p.nome.toLowerCase().includes(appState.searchQuery.toLowerCase())
  );
  
  let html = `
    <div class="content" style="grid-column: 1 / -1;">
      <div class="card">
        <h2>🥬 Produtos</h2>
        <button class="button" onclick="openProdutoModal()">+ Novo Produto</button>
        <div class="search-box">
          <input type="text" id="productSearch" placeholder="Buscar produto..." onkeyup="updateSearch('produto')" value="${appState.searchQuery}">
        </div>
        <div>
          ${produtos.map(p => `
            <div class="list-item" style="margin-bottom: 10px;">
              <div style="flex: 1;">
                <div class="list-item-title">${p.nome}</div>
                <div class="list-item-subtitle">${p.categoria} | R$ ${p.precoBase.toFixed(2)}</div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button onclick="editProduto('${p.id}')" style="background: #2d7a3a; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Editar</button>
                <button onclick="deleteProduto('${p.id}')" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Remover</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('content').innerHTML = html;
}

// Funções de ação
function changeDayAndRender() {
  appState.selectedDay = document.getElementById('daySelect').value;
  renderAgenda();
}

function updateSearch(type) {
  const input = type === 'cliente' ? document.getElementById('clientSearch') : document.getElementById('productSearch');
  appState.searchQuery = input.value;
  if (type === 'cliente') renderClientes();
  else renderProdutos();
}

function updatePedidoStatus(id, status) {
  const pedido = appState.data.pedidos.find(p => p.id === id);
  if (pedido) {
    pedido.status = status;
    saveData();
    renderAgenda();
  }
}

function deletePedido(id) {
  if (confirm('Tem certeza que deseja remover este pedido?')) {
    appState.data.pedidos = appState.data.pedidos.filter(p => p.id !== id);
    saveData();
    renderAgenda();
  }
}

function deleteCliente(id) {
  if (confirm('Tem certeza que deseja remover este cliente?')) {
    appState.data.clientes = appState.data.clientes.filter(c => c.id !== id);
    appState.data.pedidos = appState.data.pedidos.filter(p => p.cliente !== appState.data.clientes.find(c => c.id === id)?.nome);
    saveData();
    renderClientes();
  }
}

function deleteProduto(id) {
  if (confirm('Tem certeza que deseja remover este produto?')) {
    appState.data.produtos = appState.data.produtos.filter(p => p.id !== id);
    saveData();
    renderProdutos();
  }
}

function editCliente(id) {
  const cliente = appState.data.clientes.find(c => c.id === id);
  if (cliente) {
    appState.editingId = id;
    openClienteModal(cliente);
  }
}

function editProduto(id) {
  const produto = appState.data.produtos.find(p => p.id === id);
  if (produto) {
    appState.editingId = id;
    openProdutoModal(produto);
  }
}

function openClienteModal(cliente = null) {
  const modal = document.getElementById('clienteModal');
  if (cliente) {
    document.getElementById('clienteNome').value = cliente.nome;
    document.getElementById('clienteTelefone').value = cliente.telefone;
    document.getElementById('clientePeriodo').value = cliente.periodo;
    document.getElementById('clienteHorarioMax').value = cliente.horarioMax;
    document.getElementById('clientePrazoBoleto').value = cliente.prazoBoleto;
    document.getElementById('clienteCobraEntrega').value = cliente.cobraEntrega ? 'sim' : 'nao';
    document.getElementById('clienteObservacoes').value = cliente.observacoes;
    document.getElementById('clienteAcumulaPedidos').value = cliente.acumulaPedidos;
    document.querySelector('#clienteModal .modal-header').textContent = 'Editar Cliente';
  } else {
    document.getElementById('clienteNome').value = '';
    document.getElementById('clienteTelefone').value = '';
    document.getElementById('clientePeriodo').value = 'manha';
    document.getElementById('clienteHorarioMax').value = '';
    document.getElementById('clientePrazoBoleto').value = '';
    document.getElementById('clienteCobraEntrega').value = 'nao';
    document.getElementById('clienteObservacoes').value = '';
    document.getElementById('clienteAcumulaPedidos').value = '';
    document.querySelector('#clienteModal .modal-header').textContent = 'Novo Cliente';
    appState.editingId = null;
  }
  modal.classList.add('active');
}

function openProdutoModal(produto = null) {
  const modal = document.getElementById('produtoModal');
  if (produto) {
    document.getElementById('produtoNome').value = produto.nome;
    document.getElementById('produtoCategoria').value = produto.categoria;
    document.getElementById('produtoPrecoBase').value = produto.precoBase;
    document.querySelector('#produtoModal .modal-header').textContent = 'Editar Produto';
  } else {
    document.getElementById('produtoNome').value = '';
    document.getElementById('produtoCategoria').value = '';
    document.getElementById('produtoPrecoBase').value = '';
    document.querySelector('#produtoModal .modal-header').textContent = 'Novo Produto';
    appState.editingId = null;
  }
  modal.classList.add('active');
}

function openPedidoModal() {
  const modal = document.getElementById('pedidoModal');
  document.getElementById('pedidoCliente').value = '';
  document.getElementById('pedidoProduto').value = '';
  document.getElementById('pedidoCategoria').value = '';
  document.getElementById('pedidoQuantidade').value = '';
  document.getElementById('pedidoPreco').value = '';
  modal.classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function saveCliente() {
  const nome = document.getElementById('clienteNome').value;
  if (!nome) {
    alert('Nome do cliente é obrigatório');
    return;
  }
  
  const cliente = {
    nome,
    telefone: document.getElementById('clienteTelefone').value,
    periodo: document.getElementById('clientePeriodo').value,
    horarioMax: document.getElementById('clienteHorarioMax').value,
    prazoBoleto: parseInt(document.getElementById('clientePrazoBoleto').value) || 0,
    cobraEntrega: document.getElementById('clienteCobraEntrega').value === 'sim',
    observacoes: document.getElementById('clienteObservacoes').value,
    acumulaPedidos: parseInt(document.getElementById('clienteAcumulaPedidos').value) || 0,
  };
  
  if (appState.editingId) {
    const idx = appState.data.clientes.findIndex(c => c.id === appState.editingId);
    if (idx !== -1) {
      appState.data.clientes[idx] = { ...appState.data.clientes[idx], ...cliente };
    }
  } else {
    cliente.id = Date.now().toString();
    appState.data.clientes.push(cliente);
  }
  
  saveData();
  closeModal('clienteModal');
  renderClientes();
}

function saveProduto() {
  const nome = document.getElementById('produtoNome').value;
  if (!nome) {
    alert('Nome do produto é obrigatório');
    return;
  }
  
  const produto = {
    nome,
    categoria: document.getElementById('produtoCategoria').value,
    precoBase: parseFloat(document.getElementById('produtoPrecoBase').value) || 0,
  };
  
  if (appState.editingId) {
    const idx = appState.data.produtos.findIndex(p => p.id === appState.editingId);
    if (idx !== -1) {
      appState.data.produtos[idx] = { ...appState.data.produtos[idx], ...produto };
    }
  } else {
    produto.id = Date.now().toString();
    appState.data.produtos.push(produto);
  }
  
  saveData();
  closeModal('produtoModal');
  renderProdutos();
}

function savePedido() {
  const cliente = document.getElementById('pedidoCliente').value;
  const produto = document.getElementById('pedidoProduto').value;
  const quantidade = parseInt(document.getElementById('pedidoQuantidade').value);
  
  if (!cliente || !produto || !quantidade) {
    alert('Preencha todos os campos');
    return;
  }
  
  const pedido = {
    id: Date.now().toString(),
    cliente,
    produto,
    categoria: document.getElementById('pedidoCategoria').value,
    quantidade,
    dia: appState.selectedDay,
    status: 'pendente',
    preco: parseFloat(document.getElementById('pedidoPreco').value) || 0,
  };
  
  appState.data.pedidos.push(pedido);
  saveData();
  closeModal('pedidoModal');
  renderAgenda();
}

// Inicializar app
function initApp() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      appState.currentTab = this.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      if (appState.currentTab === 'dashboard') renderDashboard();
      else if (appState.currentTab === 'agenda') renderAgenda();
      else if (appState.currentTab === 'clientes') renderClientes();
      else if (appState.currentTab === 'produtos') renderProdutos();
    });
  });
  
  // Fechar modais ao clicar fora
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === this) {
        this.classList.remove('active');
      }
    });
  });
  
  renderDashboard();
}

// Iniciar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', initApp);
