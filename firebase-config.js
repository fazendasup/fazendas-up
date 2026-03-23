// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBD5cx-apukNZ43amrdGPno_ztvBu64iCM",
  authDomain: "fazendas-up.firebaseapp.com",
  databaseURL: "https://fazendas-up-default-rtdb.firebaseio.com",
  projectId: "fazendas-up",
  storageBucket: "fazendas-up.firebasestorage.app",
  messagingSenderId: "822688134918",
  appId: "1:822688134918:web:bff3ef926d436c8c1b9087"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Função para salvar dados no Firebase
function saveToFirebase(path, data) {
  database.ref(path).set(data).catch(error => {
    console.error('Erro ao salvar:', error);
  });
}

// Função para ler dados do Firebase
function readFromFirebase(path, callback) {
  database.ref(path).on('value', snapshot => {
    callback(snapshot.val());
  });
}

// Função para sincronizar dados locais com Firebase
function syncToFirebase() {
  const data = {
    pedidos: appState.data.pedidos,
    clientes: appState.data.clientes,
    produtos: appState.data.produtos,
    precosPersonalizados: appState.data.precosPersonalizados
  };
  saveToFirebase('fazendas-up', data);
}

// Função para carregar dados do Firebase
function loadFromFirebase() {
  readFromFirebase('fazendas-up', (data) => {
    if (data) {
      appState.data = data;
      localStorage.setItem('fazendas-up-data', JSON.stringify(appState.data));
      // Re-renderizar a tela atual
      if (appState.currentTab === 'dashboard') renderDashboard();
      else if (appState.currentTab === 'agenda') renderAgenda();
      else if (appState.currentTab === 'clientes') renderClientes();
      else if (appState.currentTab === 'produtos') renderProdutos();
    }
  });
}

// Sincronizar a cada 5 segundos
setInterval(syncToFirebase, 5000);

// Carregar dados ao iniciar
window.addEventListener('load', loadFromFirebase);
