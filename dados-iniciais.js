// Dados iniciais para demonstração
const dadosIniciais = {
  clientes: [
    { id: 'client_1', nome: 'Grand Amazon', periodoEntrega: 'Manhã', observacoes: '' },
    { id: 'client_2', nome: 'Rodrigues Jacira Reis', periodoEntrega: 'Tarde', observacoes: 'Boleto para 21 dias' },
    { id: 'client_3', nome: 'Rodrigues Ponta Negra', periodoEntrega: 'Manhã', observacoes: '' },
    { id: 'client_4', nome: 'Supermercado Central', periodoEntrega: 'Tarde', observacoes: 'Entrega até 18h' },
    { id: 'client_5', nome: 'Restaurante da Cidade', periodoEntrega: 'Manhã', observacoes: 'Diariamente' },
  ],
  produtos: [
    { nome: 'Alface Crespa Verde', precoBase: 3.50 },
    { nome: 'Alface Americana', precoBase: 4.00 },
    { nome: 'Alface MIX', precoBase: 3.75 },
    { nome: 'Rúcula', precoBase: 5.00 },
    { nome: 'Espinafre', precoBase: 4.50 },
    { nome: 'Tomate Caqui', precoBase: 6.00 },
    { nome: 'Tomate Cereja', precoBase: 7.00 },
    { nome: 'Cenoura', precoBase: 2.50 },
    { nome: 'Beterraba', precoBase: 3.00 },
    { nome: 'Abóbora', precoBase: 4.00 },
    { nome: 'Brócolis', precoBase: 5.50 },
    { nome: 'Couve-flor', precoBase: 6.00 },
    { nome: 'Pimentão Vermelho', precoBase: 5.50 },
    { nome: 'Pimentão Verde', precoBase: 4.50 },
    { nome: 'Cebola', precoBase: 2.00 },
    { nome: 'Alho', precoBase: 8.00 },
    { nome: 'Batata Doce', precoBase: 3.50 },
    { nome: 'Batata Comum', precoBase: 2.50 },
    { nome: 'Micro Mostarda', precoBase: 6.50 },
    { nome: 'Micro Brócolis', precoBase: 7.00 },
  ],
  pedidos: [
    { id: 'order_1', id_cliente: 'client_1', cliente: 'Grand Amazon', dia_semana: 'Segunda', produto: 'Micro Mostarda', quantidade: 1, status: 'pendente' },
    { id: 'order_2', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Segunda', produto: 'Alface Americana', quantidade: 5, status: 'pendente' },
    { id: 'order_3', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Segunda', produto: 'Alface MIX', quantidade: 3, status: 'pendente' },
    { id: 'order_4', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Segunda', produto: 'Alface Crespa Verde', quantidade: 10, status: 'pendente' },
    { id: 'order_5', id_cliente: 'client_3', cliente: 'Rodrigues Ponta Negra', dia_semana: 'Segunda', produto: 'Alface Americana', quantidade: 8, status: 'pendente' },
    { id: 'order_6', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Terça', produto: 'Tomate Caqui', quantidade: 20, status: 'pendente' },
    { id: 'order_7', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Terça', produto: 'Cenoura', quantidade: 15, status: 'pendente' },
    { id: 'order_8', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Terça', produto: 'Rúcula', quantidade: 5, status: 'pendente' },
    { id: 'order_9', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Terça', produto: 'Espinafre', quantidade: 4, status: 'pendente' },
    { id: 'order_10', id_cliente: 'client_1', cliente: 'Grand Amazon', dia_semana: 'Quarta', produto: 'Brócolis', quantidade: 12, status: 'pendente' },
    { id: 'order_11', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Quarta', produto: 'Pimentão Vermelho', quantidade: 6, status: 'pendente' },
    { id: 'order_12', id_cliente: 'client_3', cliente: 'Rodrigues Ponta Negra', dia_semana: 'Quarta', produto: 'Tomate Cereja', quantidade: 8, status: 'pendente' },
    { id: 'order_13', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Quinta', produto: 'Couve-flor', quantidade: 10, status: 'pendente' },
    { id: 'order_14', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Quinta', produto: 'Alface Crespa Verde', quantidade: 7, status: 'pendente' },
    { id: 'order_15', id_cliente: 'client_1', cliente: 'Grand Amazon', dia_semana: 'Sexta', produto: 'Beterraba', quantidade: 5, status: 'pendente' },
    { id: 'order_16', id_cliente: 'client_2', cliente: 'Rodrigues Jacira Reis', dia_semana: 'Sexta', produto: 'Abóbora', quantidade: 3, status: 'pendente' },
    { id: 'order_17', id_cliente: 'client_3', cliente: 'Rodrigues Ponta Negra', dia_semana: 'Sexta', produto: 'Cebola', quantidade: 10, status: 'pendente' },
    { id: 'order_18', id_cliente: 'client_4', cliente: 'Supermercado Central', dia_semana: 'Sábado', produto: 'Alho', quantidade: 2, status: 'pendente' },
    { id: 'order_19', id_cliente: 'client_5', cliente: 'Restaurante da Cidade', dia_semana: 'Sábado', produto: 'Batata Doce', quantidade: 8, status: 'pendente' },
  ]
};

// Função para carregar dados iniciais
function carregarDadosIniciais() {
  const dadosSalvos = localStorage.getItem('fazendas-up-data');
  if (!dadosSalvos) {
    localStorage.setItem('fazendas-up-data', JSON.stringify(dadosIniciais));
    console.log('Dados iniciais carregados!');
    location.reload();
  }
}

// Carregar ao iniciar
carregarDadosIniciais();
