# Teste da automacao Telegram

Este projeto ja esta com integracao para comandos por Telegram no `server.js`.

## 1) Configurar ambiente

No PowerShell:

```powershell
cd "c:\Users\adson\dev\fazendas-up"
$env:TELEGRAM_BOT_TOKEN="SEU_TOKEN"
$env:TELEGRAM_ALLOWED_CHAT_IDS="SEU_CHAT_ID"
$env:OPENAI_API_KEY="SUA_OPENAI_KEY"
node .\server.js
```

Se estiver correto, o terminal mostra:

- `Servidor rodando em http://localhost:3001`
- `Telegram bot ativo (long polling).`

## 2) Fluxo padrao de retorno do bot

Para qualquer acao de escrita:

1. Retorno de recebimento do comando
2. Pre-confirmacao do que sera feito
3. Resultado final:
   - sucesso
   - cancelado
   - erro

## 3) Comandos de apoio

- `/ajuda`
- `/estado`
- `/pendente`

## 4) Comandos de pedidos

- Criar:
  - `/pedido criar cliente="Felicori" produto="Rucula" quantidade=3 dia="segunda-feira"`
- Editar:
  - `/pedido editar cliente="Felicori" produto="Rucula" quantidade=5`
- Excluir:
  - `/pedido excluir cliente="Felicori" produto="Rucula" dia="segunda-feira"`
- Linguagem natural:
  - `acrescentar 3 ruculas ao pedido do Felicori`

## 5) Comandos de clientes

- Criar:
  - `/cliente criar nome="Felicori" observacoes="Atende manha" cobraEntrega=sim`
- Editar:
  - `/cliente editar nome="Felicori" novo_nome="Felicori Loja" prazoBoleto="30 dias"`
- Preco especial:
  - `/cliente preco_add nome="Felicori" produto="Rucula" preco=7.9`
  - `/cliente preco_remove nome="Felicori" produto="Rucula"`
- Excluir:
  - `/cliente excluir nome="Felicori"`

## 6) Comandos de produtos

- Criar:
  - `/produto criar nome="Rucula" precoBase=4.5 categorias="Buque,Desfolhado"`
- Editar:
  - `/produto editar nome="Rucula" novo_nome="Rucula Hidro" precoBase=5.2`
- Excluir:
  - `/produto excluir nome="Rucula"`

## 7) Audio

Envie audio/voice no Telegram com o comando falado. O fluxo esperado:

1. `Audio recebido. Transcrevendo...`
2. `Transcricao concluida com sucesso: "..."`
3. Pre-confirmacao
4. `confirmar` ou `cancelar`

## 8) Checklist rapido

1. Rodar `/estado` para validar leitura.
2. Fazer um comando de alteracao e responder `cancelar`.
3. Repetir e responder `confirmar`.
4. Confirmar mudanca em `dados-sync.json` e na tela web.
