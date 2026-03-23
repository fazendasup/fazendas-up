# FazendasUp - Gestão de Pedidos e Entregas

Um site responsivo para gestão completa de pedidos, clientes e produtos da FazendasUp.

## 🌐 Acesso

**URL:** https://fazendasup.github.io/fazendas-up/

O site funciona em qualquer navegador (Chrome, Safari, Firefox) e qualquer dispositivo (iPhone, Android, Tablet, Computador).

## ✨ Funcionalidades

### 📊 Dashboard
- Resumo semanal com total de pedidos, itens, clientes e produtos
- Status de entregas (Pendentes, Entregues, Cancelados)
- Volume de pedidos por dia da semana
- Top 5 produtos mais pedidos

### 📅 Agenda
- Visualização de pedidos organizados por dia da semana
- Agrupamento por cliente
- Busca rápida de pedidos
- Adicionar e deletar pedidos

### 👥 Clientes
- Lista completa de clientes
- Período de entrega (Manhã/Tarde)
- Observações personalizadas
- Busca de clientes
- Adicionar e deletar clientes

### 🥬 Produtos
- Catálogo de produtos
- Preço base de cada produto
- Busca de produtos
- Adicionar e deletar produtos

## 💾 Como Funciona

Os dados são salvos **automaticamente no seu navegador** usando localStorage. Isso significa:

✅ Funciona **sem internet** (após primeira visita)  
✅ Dados persistem entre acessos  
✅ Cada navegador/dispositivo tem seus próprios dados  

## 🚀 Como Usar

### Adicionar um Novo Cliente
1. Clique na aba **👥 Clientes**
2. Clique no botão **+ Novo Cliente**
3. Preencha o nome, período de entrega e observações
4. Clique em **Salvar**

### Adicionar um Novo Produto
1. Clique na aba **🥬 Produtos**
2. Clique no botão **+ Novo Produto**
3. Preencha o nome e preço base
4. Clique em **Salvar**

### Adicionar um Novo Pedido
1. Clique na aba **📅 Agenda**
2. Clique no botão **+ Novo Pedido**
3. Selecione o cliente, dia da semana, produto e quantidade
4. Clique em **Salvar**

### Deletar Dados
Clique no ícone 🗑️ ao lado de qualquer item para deletar

### Buscar
Use a barra de busca em cada aba para filtrar dados

## 📱 Responsividade

O site se adapta automaticamente a qualquer tamanho de tela:
- **Desktop:** Layout com sidebar lateral
- **Tablet:** Layout otimizado para toque
- **Celular:** Abas horizontais na parte superior

## 🔄 Sincronização Entre Dispositivos

Atualmente, os dados são salvos **localmente em cada dispositivo**. Se você quiser sincronizar entre múltiplos dispositivos (iPhone, Computador, etc), é possível adicionar Firebase no futuro.

## 📊 Dados de Exemplo

Ao abrir o site pela primeira vez, você verá dados de exemplo com:
- 5 clientes
- 20 produtos
- 19 pedidos de exemplo

Você pode deletar esses dados e começar do zero quando quiser.

## 🛠️ Tecnologia

- **HTML5** - Estrutura
- **CSS3** - Design responsivo
- **JavaScript** - Lógica e interatividade
- **localStorage** - Armazenamento de dados
- **GitHub Pages** - Hospedagem gratuita

## 📝 Notas

- Todos os dados são salvos no navegador (não em servidor)
- Limpar cache/cookies do navegador apagará os dados
- O site é totalmente funcional offline após primeira visita
- Não requer login ou cadastro

## 🚀 Próximos Passos (Opcional)

Se você quiser:
- ✅ Sincronizar dados entre dispositivos → Adicionar Firebase
- ✅ Fazer backup dos dados → Exportar para CSV/Excel
- ✅ Adicionar mais funcionalidades → Integrar com API

Entre em contato para mais informações!
