# Servidor de Sincronização - FazendasUp

## O que é?

Um servidor Node.js que sincroniza dados em tempo real entre múltiplos dispositivos/computadores usando WebSocket.

## Como Funciona?

1. Quando você salva dados em um computador, eles são enviados ao servidor
2. O servidor recebe e armazena os dados
3. Todos os outros computadores conectados recebem os dados automaticamente
4. A página é atualizada instantaneamente

## Instalação e Execução

### Pré-requisitos
- Node.js instalado (https://nodejs.org)

### Passos

1. **Instalar dependências** (já feito):
```bash
npm install express ws cors
```

2. **Iniciar o servidor**:
```bash
node server.js
```

Você deve ver:
```
Servidor rodando em http://localhost:3001
```

3. **Acessar a página**:
- Abra https://fazendasup.github.io/fazendas-up/ em qualquer navegador
- A página se conectará automaticamente ao servidor

## Como Usar em Rede Local

Se você quer que outros computadores na sua rede se conectem:

1. Descubra o IP do seu computador:
   - Windows: `ipconfig` (procure por "IPv4 Address")
   - Mac/Linux: `ifconfig` (procure por "inet")

2. Os outros computadores devem acessar:
   ```
   https://fazendasup.github.io/fazendas-up/
   ```
   E o servidor deve estar rodando no computador com IP X.X.X.X

## Como Usar em Produção (Nuvem)

Para colocar online (acessível de qualquer lugar):

1. Faça deploy em um serviço como:
   - Railway (https://railway.app) - Gratuito
   - Render (https://render.com) - Gratuito
   - Heroku (https://www.heroku.com) - Pago

2. Configure a variável de ambiente `PORT`:
   ```bash
   PORT=3001 node server.js
   ```

## Dados

Os dados são salvos em `dados-sync.json` no mesmo diretório do servidor.

## Troubleshooting

**Erro: "Cannot find module 'express'"**
- Execute: `npm install express ws cors`

**Erro: "Port 3001 already in use"**
- Mude a porta: `PORT=3002 node server.js`

**Não sincroniza entre computadores**
- Verifique se ambos estão na mesma rede
- Verifique se o firewall não está bloqueando a porta 3001
