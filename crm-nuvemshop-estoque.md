# Integração de estoque: CRM Pissilone + Nuvemshop

Especificação para implementar. Ponto de partida: o CRM atual (`index.html` no GitHub Pages + Google Sheets via Apps Script).

---

## 1. Objetivo

Ter **um único estoque**, que mora na Nuvemshop, espelhado no CRM.

- Venda no site: a Nuvemshop baixa o estoque sozinha e o CRM só reflete.
- Venda fora do site (loja física, WhatsApp, feira), registrada no CRM: o CRM manda a baixa para a Nuvemshop pela API.
- Reposição e ajustes de estoque: **somente na Nuvemshop**. O CRM nunca edita estoque, só lê e envia baixas e devoluções ligadas a uma venda.

Por que não manter dois estoques sincronizando nos dois sentidos: gera conflito, venda descontada duas vezes ou nenhuma, e ninguém sabe qual número vale.

## 2. Fluxos

| Onde vende | O que acontece |
|---|---|
| Site (Nuvemshop) | A Nuvemshop baixa o estoque. O espelho no CRM se atualiza na próxima sincronização (a cada 15 min) ou no botão "Atualizar agora". |
| Loja física, WhatsApp, feira | O card no CRM recebe os itens vendidos. Ao marcar **Ganho**, o Apps Script confere o estoque ao vivo e baixa na Nuvemshop. O espelho é atualizado em seguida. |
| Venda desfeita | Ao desmarcar **Ganho** de um card que já baixou estoque, o Apps Script devolve as quantidades à Nuvemshop, uma única vez. |
| Reposição (a Ana pintou mais peças) | Lançada na Nuvemshop. O CRM vê na próxima sincronização. |

## 3. Contexto do CRM atual (não quebrar)

- **Front-end:** arquivo único `index.html` no GitHub Pages.
- **Back-end:** Google Apps Script publicado como Web App, com `doPost(e)` lendo `JSON.parse(e.postData.contents)` e roteando por `action` (`getAll`, `save`, `delete`).
- **Planilha de contatos:** 17 colunas, de A a Q: `id, nome, tel, et, canal, valor, produto, obs, data, compras, funil, etapa, usuario, followup, motivo_perda, atv_data, atv_desc`.
- **Ganho e Perdido:** o campo `et` vale `'fechado'` (ganho), `'perdido'` ou `'atendimento'` (neutro), independente da etapa do funil. Funções no front: `toggleGanho(id)` e `togglePerdido(id)`.
- **Configuração** (funis, etapas, usuários) no `localStorage`, na chave `psn_cfg3`.
- Função de chamada do front:

```js
async function apiPost(payload) {
  const r = await fetch(API, { method: 'POST', body: JSON.stringify(payload) });
  const text = await r.text();
  try { return JSON.parse(text); } catch(e) { return {}; }
}
```

> **REGRA CRÍTICA:** no `fetch` do navegador para o Apps Script, **nunca** adicionar `Content-Type: application/json`. O Apps Script rejeita em silêncio (preflight de CORS). Essa regra vale **só** para navegador → Apps Script. Nas chamadas do Apps Script → Nuvemshop (`UrlFetchApp`), o `contentType: 'application/json'` é obrigatório e correto.

> **SEGURANÇA:** o `index.html` é público no GitHub Pages. O token da Nuvemshop **nunca** vai para o front-end. Ele fica nas Script Properties do Apps Script, e toda chamada à Nuvemshop sai do Apps Script.

## 4. Pré-requisitos (fazer antes de codar)

- [ ] Loja reaberta, com todos os produtos cadastrados e **controle de estoque ativado** em cada variação.
- [ ] **SKU preenchido** em todas as variações. É ele que aparece para busca no CRM.
- [ ] Criar conta de parceiro Nuvemshop, criar um app no painel de parceiros, instalar na loja da Pissilone e obter o **access token** e o **store_id** (OAuth 2, conforme o guia de autenticação da documentação).
- [ ] Conferir se a loja usa **Múltiplos Locais de estoque**. Se usar, a API de estoque muda (`inventory_levels` com `location_id`) e esta especificação precisa de ajuste.
- [ ] Conferir a **versão vigente da API** na documentação (na data de escrita, `2025-03`).

## 5. Referência da API Nuvemshop

Documentação: https://tiendanube.github.io/api-documentation/

- **Base:** `https://api.nuvemshop.com.br/{versao}/{store_id}`
- **Headers obrigatórios:**
  - `Authorization: Bearer {ACCESS_TOKEN}`
  - `User-Agent: Pissilone CRM ({email-de-contato})`. Sem ele, a API devolve 400.
  - `Content-Type: application/json` nas requisições com corpo.
- **Limite de requisições:** balde de 40 requisições, esvaziando a 2 por segundo. Excesso devolve 429. Usar `Utilities.sleep` entre páginas e tratar 429 com nova tentativa.

| Uso | Endpoint |
|---|---|
| Listar produtos com variações (espelho) | `GET /products?page={n}&per_page=200` |
| Ler uma variação (estoque ao vivo) | `GET /products/{product_id}/variants/{variant_id}` |
| Baixar ou devolver estoque | `POST /products/{product_id}/variants/stock` |

Corpo para baixar 2 unidades de uma variação:

```json
{ "action": "variation", "value": -2, "id": 144 }
```

Para devolver, usar `value` positivo. Atenção: tirar mais do que existe **não dá erro**, o estoque só vai a 0. Por isso a conferência ao vivo antes da baixa é obrigatória.

Observações sobre o retorno de produtos:

- `name` vem por idioma (`{ "pt": "Taça pintada" }`). Usar `name.pt`.
- Em cada variação, `stock` igual a `null` significa estoque infinito (sem controle). Mostrar como "sem controle" no CRM e não permitir baixa.
- Na paginação, parar quando a página vier vazia ou com 404.

## 6. Modelo de dados

### 6.1 Nova aba "Estoque" (espelho, escrita só pelo Apps Script)

| Coluna | Campo | Exemplo |
|---|---|---|
| A | `variant_id` | 144 |
| B | `product_id` | 1234 |
| C | `sku` | TACA-AZUL-01 |
| D | `nome` | Taça pintada azul |
| E | `variacao` | Unidade (ou valores da variação: tamanho, cor) |
| F | `preco` | 120.00 |
| G | `estoque` | 3 (vazio = sem controle) |
| H | `publicado` | TRUE |
| I | `atualizado_em` | 2026-10-18T14:30:00-03:00 |

A sincronização **reescreve a aba inteira** a cada execução. Ninguém edita essa aba à mão.

### 6.2 Novas colunas na aba de contatos

A planilha passa de 17 para **19 colunas**:

| Coluna | Campo | Conteúdo |
|---|---|---|
| R | `itens` | JSON com os itens vendidos: `[{"product_id":1234,"variant_id":144,"sku":"TACA-AZUL-01","nome":"Taça pintada azul","qtd":2}]` |
| S | `estoque_baixado` | Vazio, ou a data e hora ISO da baixa. Garante uma baixa por venda. |

Atualizar o mapeamento em `doSync()` (`r[17]`, `r[18]`) e em `contatoPayload()`, e a escrita no Apps Script.

O campo `produto` (texto livre) continua existindo para observação, mas **não é usado para baixar estoque**.

## 7. Apps Script: o que implementar

### 7.1 Script Properties

`NS_TOKEN`, `NS_STORE_ID`, `NS_API_VERSION`, `NS_USER_AGENT`.

### 7.2 Helper de chamada

```js
function nsFetch(method, path, body) {
  const p = PropertiesService.getScriptProperties();
  const url = 'https://api.nuvemshop.com.br/' + p.getProperty('NS_API_VERSION') +
              '/' + p.getProperty('NS_STORE_ID') + path;
  const opt = {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + p.getProperty('NS_TOKEN'),
      'User-Agent': p.getProperty('NS_USER_AGENT')
    },
    muteHttpExceptions: true
  };
  if (body) opt.payload = JSON.stringify(body);

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = UrlFetchApp.fetch(url, opt);
    const code = r.getResponseCode();
    if (code === 429) { Utilities.sleep(1500 * (tentativa + 1)); continue; }
    return { code: code, data: code < 300 ? JSON.parse(r.getContentText() || 'null') : null,
             erro: code >= 300 ? r.getContentText() : null };
  }
  return { code: 429, data: null, erro: 'Limite de requisições' };
}
```

### 7.3 Novas actions no `doPost`

| action | Entrada | O que faz | Retorno |
|---|---|---|---|
| `getEstoque` | nenhuma | Lê a aba Estoque | Linhas da aba |
| `syncEstoque` | nenhuma | Roda a sincronização completa agora (botão "Atualizar agora") | `{ok, total, atualizado_em}` |
| `checarEstoque` | `itens` | Consulta ao vivo cada `variant_id` na Nuvemshop | `[{variant_id, estoque, suficiente}]` |
| `baixarEstoque` | `id` do contato | Ver 7.4 | `{ok}` ou `{ok:false, motivo, itens}` |
| `devolverEstoque` | `id` do contato | Inverso da baixa, ver 7.4 | `{ok}` ou erro |

### 7.4 Regras de `baixarEstoque` e `devolverEstoque`

1. Usar `LockService.getScriptLock()` durante toda a operação, para evitar duas baixas simultâneas.
2. Ler o contato na planilha (não confiar no que o front mandou).
3. **Baixa:** se `estoque_baixado` já estiver preenchido, retornar `{ok:true, ja_baixado:true}` sem chamar a API.
4. **Baixa:** conferir o estoque ao vivo de todos os itens. Se algum for insuficiente, **não baixar nada** e retornar quais itens faltam.
5. **Baixa:** enviar `variation` negativa item a item. Se algum falhar no meio, devolver o que já foi baixado e retornar erro. É tudo ou nada.
6. **Baixa:** gravar `estoque_baixado` com a data e hora e atualizar as linhas daquelas variações na aba Estoque.
7. **Devolução:** só roda se `estoque_baixado` estiver preenchido. Envia `variation` positiva e limpa `estoque_baixado`.

### 7.5 Sincronização automática

- Função `syncEstoque()`: pagina `GET /products`, monta as linhas (uma por variação), reescreve a aba Estoque e grava `atualizado_em`.
- Gatilho baseado em tempo: **a cada 15 minutos**.
- Webhooks da Nuvemshop ficam fora por enquanto. O `doPost` do Apps Script não expõe os headers da requisição, então não dá para validar a assinatura do webhook. Para o volume da Pissilone, 15 minutos bastam.

## 8. Front-end (index.html): o que muda

### 8.1 Itens no card

- No modal de edição do contato, nova seção **"Itens vendidos"**: busca por nome ou SKU na lista do espelho, quantidade e botão de remover.
- Cada item mostra o estoque atual do espelho. Item com estoque 0 aparece desabilitado.
- O campo `valor` pode ser sugerido pela soma de preço × quantidade, editável.

### 8.2 Fluxo do Ganho

Novo comportamento de `toggleGanho(id)`:

1. Card **sem itens**: comportamento atual (só muda `et`).
2. Card **com itens**, marcando Ganho:
   - Chamar `checarEstoque`. Se faltar algo, mostrar quais itens e **não** marcar Ganho.
   - Se estiver tudo ok: salvar `et = 'fechado'`, chamar `baixarEstoque` e mostrar o status ("Estoque baixado na Nuvemshop").
   - Se `baixarEstoque` falhar: reverter `et` e mostrar o erro.
3. Card **com itens e estoque baixado**, desmarcando Ganho: confirmar ("Devolver X itens ao estoque da Nuvemshop?"), chamar `devolverEstoque` e salvar `et = 'atendimento'`.
4. Marcar **Perdido** num card com estoque baixado segue o mesmo caminho da devolução.
5. **Duplicar card** (`confirmDup`) **não copia** `itens` nem `estoque_baixado`.

Indicador visual no card: um pequeno selo "estoque baixado" quando `estoque_baixado` estiver preenchido.

### 8.3 Nova tela "Estoque" (só leitura)

- Tabela com busca: nome, variação, SKU, preço, estoque.
- Filtros: zerados, acabando (estoque ≤ 2, configurável) e sem controle.
- Mostra "Atualizado há X min" e o botão **Atualizar agora** (`syncEstoque`).
- Sem campo editável. Texto de apoio: "Para repor ou ajustar estoque, use a Nuvemshop."

## 9. Casos de borda

| Caso | Comportamento |
|---|---|
| Peça única vendida no site minutos antes da venda na loja | `checarEstoque` ao vivo bloqueia o Ganho e mostra o aviso |
| Variação sem controle de estoque (`stock` null) | Não aparece para seleção, ou aparece sem baixa (decidir) |
| Produto excluído na Nuvemshop depois da venda | A devolução falha. Mostrar erro e orientar ajuste manual na Nuvemshop |
| Duplo clique em Ganho | `LockService` + `estoque_baixado` impedem a segunda baixa |
| Falha de rede no meio da baixa | Tudo ou nada (7.4, item 5) |
| Limite de requisições (429) | Nova tentativa automática no `nsFetch` |

## 10. Ordem de implementação

1. **Fase 1, leitura:** Script Properties, `nsFetch`, `syncEstoque`, aba Estoque, gatilho de 15 minutos, `getEstoque` e a tela Estoque no CRM.
   *Pronto quando:* a tela mostra o mesmo número que a Nuvemshop para 5 produtos conferidos à mão.
2. **Fase 2, itens no card:** colunas R e S, seção "Itens vendidos" no modal, ajustes em `doSync()` e `contatoPayload()`.
   *Pronto quando:* itens salvam, recarregam e não aparecem em cards duplicados.
3. **Fase 3, baixa e devolução:** `checarEstoque`, `baixarEstoque`, `devolverEstoque` e o novo fluxo do Ganho e do Perdido.
   *Pronto quando:* passar no checklist abaixo usando um **produto de teste** despublicado.

### Checklist de teste (produto de teste com estoque 3)

- [ ] Venda de 2 no CRM: Nuvemshop vai a 1, espelho mostra 1, card mostra o selo.
- [ ] Clicar Ganho de novo no mesmo card: nada muda.
- [ ] Desmarcar Ganho: Nuvemshop volta a 3, selo some.
- [ ] Tentar vender 4: bloqueado, nada baixa.
- [ ] Venda pelo site: espelho reflete em até 15 minutos ou no "Atualizar agora".
- [ ] Card com 2 itens em que um falha: nenhum dos dois fica baixado.
- [ ] Nenhum `Content-Type` no `fetch` do navegador. Token ausente do `index.html`.

## 11. Fora do escopo agora

- Webhooks da Nuvemshop.
- Edição de estoque pelo CRM.
- Conferência semanal com IA (Claude + conector Nuvemshop cruzando vendas do CRM com estoque e apontando divergências). Entra depois que a integração estiver estável.

## 12. Brief para colar no Antigravity

> Leia este arquivo inteiro e o `index.html` do CRM e o código do Apps Script antes de alterar qualquer coisa. Implemente a Fase 1 apenas. Respeite a regra crítica do `fetch` sem `Content-Type` no navegador e nunca coloque o token da Nuvemshop no front-end. Mantenha o CRM em um único arquivo HTML. Ao final, liste o que mudou e como testar.

## 13. Decisões em aberto

- Itens sem controle de estoque: aparecem para seleção sem baixa, ou não aparecem?
- Limite de "acabando": 2 unidades serve para todos os produtos?
- Quem pode desmarcar um Ganho com estoque baixado: qualquer usuário ou só administradores?
