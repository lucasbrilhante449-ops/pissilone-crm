# PSN CRM — Documentação Técnica Completa
> Guia para desenvolvimento e manutenção via Claude Code

---

## 1. Visão Geral

CRM customizado para a **Pissilone** — marca de camisetas nordestinas de Mossoró/RN.  
Fundadores: **Lucas** e **Ana**.

| Item | Valor |
|------|-------|
| URL do CRM | `https://lucasbrilhante449-ops.github.io/pissilone-crm` |
| Repositório | `https://github.com/lucasbrilhante449-ops/pissilone-crm` |
| Arquivo principal | `index-github.html` na raiz do repositório |
| Banco de dados | Supabase (PostgreSQL) |
| Hospedagem | GitHub Pages (estático) |

---

## 2. Infraestrutura

### 2.1 Supabase

| Item | Valor |
|------|-------|
| Project URL | `https://wrczcdroekxqsdwdbquf.supabase.co` |
| Anon Key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyY3pjZHJvZWt4cXNkd2RicXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MzU2MjAsImV4cCI6MjA5NzQxMTYyMH0.00e-b72vyYYUJOq2439UabxpT1baIC8uqg4wzMRU81c` |
| Região | South America (São Paulo) |

### 2.2 Tabelas no Supabase

#### Tabela `contatos`
Colunas efetivamente lidas/escritas por `doSync()`/`apiSave()`:

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | text (PK) | Timestamp único gerado com `Date.now()` |
| nome | text | Nome do cliente |
| tel | text | Telefone |
| et | text | Etiqueta legada (atendimento/fechado/perdido) |
| canal | text | Canal de origem (instagram/story/anuncio/indicacao/atelie/busca/whatsapp/outro) |
| valor | numeric | Valor da negociação atual |
| produto | text | Produto de interesse |
| obs | text | Observação livre |
| data | text | ISO timestamp de criação |
| compras | integer | Contador legado |
| funil | text | ID do funil (d2c/b2b/pissifa) |
| etapa | text | ID da etapa (ex: d2c-bv, psf-neg) |
| usuario | text | ID do responsável (lucas/ana) |
| followup | text | Data do próximo contato (YYYY-MM-DD) — hoje é preenchido com a mesma data de `atv_data` |
| motivo_perda | text | Motivo da perda |
| atv_data | text | Data da atividade agendada (YYYY-MM-DD) |
| atv_desc | text | Descrição da atividade |
| resultado | text | Resultado legado (ganho/perda/vazio) |
| atv_hist | integer | Contador de checkpoints de atividade concluídos |
| neg_hist | text | JSON string com histórico de negociações (ver seção 6) |
| aniversario | text | Data de aniversário (YYYY-MM-DD), coluna própria |
| cod_marketup | text | Código do cliente no MarketUp (ERP), coluna própria |
| nf_emitida | boolean | Legado — hoje o controle de nota fiscal é por negociação dentro de `neg_hist[].nf` (ver seção 6), não neste campo |
| meta | text | JSON string "guarda-chuva" com campos que não têm coluna própria: `email`, `cpf`, `endereco`, `notas`, `cidade`, `uf`, `cep`, `nps`, `log_hist` (timeline de notas/atividades), `campos` (valores dos campos personalizados, por id), `oficinas_hist` (histórico de participações em oficinas — array de `{oficina, data_inscricao, status, data_oficina}`, ver seção 5) e `oficina_atual` (nome da oficina selecionada, espelha `produto` quando `funil==='servicos'`) |

**Importante:** vários campos exibidos no modal de contato (email, CPF, endereço, cidade, UF, CEP, notas, NPS, campos personalizados, timeline) **não** têm coluna própria no Supabase — são serializados dentro da coluna `meta`. Ao adicionar um campo novo no formulário, decida se ele entra em `meta` (mais simples, sem migração de schema) ou vira coluna nova (só se precisar de filtro/index no banco).

#### Tabela `config`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | integer (PK) | Sempre 1 (única linha) |
| dados | text | JSON string com toda a configuração: `{funis, usuarios, campos_personalizados}` |

#### Tabela `catalogo`
Catálogo de produtos, usado no autocomplete de itens de pedido. Hierarquia: **Categoria → Produto → (se aplicável) Estampa/Cor/Tamanho**. Estampa é uma característica do produto (ex: a estampa "Kit Nordeste Vivo" só faz sentido dentro do produto "Camiseta"), não uma entidade categorizável por si só — a categoria vive no **produto**.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | (PK) | Gerado pelo Supabase |
| nome | text | Nome do item (ex: "Camiseta", "Kit Nordeste Vivo", "Azul", "GG") |
| tipo | text | `produto` / `estampa` / `cor` / `tamanho` |
**Ordem de exibição dos tamanhos:** `catalogo.tamanhos` não fica em ordem alfabética — `loadCatalogo()` chama `ordenarTamanhos()` (usa a constante `TAMANHO_ORDEM`) pra ordenar sempre como Infantil → PP → P → M → G → GG → XG → Único; tamanhos com nome fora dessa lista caem no fim, em ordem alfabética. Vale pra tudo que usa `catalogo.tamanhos` direto (chips na aba Catálogo, autocomplete de itens do pedido, colunas da grade de Estoque), sem precisar reordenar em cada lugar.

| categoria | text | Só usada quando `tipo='produto'`: `moda` / `decor_home` / `acessorios` (vazio = sem categoria). Alimenta o KPI "Vendas por categoria" nos Insights. Coluna adicionada manualmente via SQL Editor (`ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS categoria text;`), não existia na criação original da tabela. |
| tem_variacao | boolean | Só usada quando `tipo='produto'`. Se `true`, o produto tem variação de Estampa/Cor/Tamanho (ex: Camiseta) e esses campos aparecem no modal de pedido ao selecioná-lo; se `false`/vazio, o produto é "simples" (ex: Chaveiro, Ímã) e só pede quantidade. Coluna adicionada via `ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS tem_variacao boolean DEFAULT false;`. |
| natureza | text | Só usada quando `tipo='produto'`: `produto` (padrão) ou `servico`. Diferencia produto físico (camiseta etc.) de oficina/serviço vendido no funil Serviços. Itens com `natureza='servico'` sempre têm `tem_variacao=false` forçado (oficinas não têm estampa/cor/tamanho) e aparecem no select de oficina do modal de contato. Coluna adicionada via `supabase-migration-oficinas.sql` (`ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS natureza text DEFAULT 'produto';`). |
| foto_url | text | Só usada quando `tipo='cor'`. Link de uma foto de referência daquela cor, colado manualmente na aba Catálogo (campo abaixo do nome de cada cor). Usado pelo endpoint `/estoque` da Edge Function `pissilone-agent` (seção 15) pra enviar a foto direto no WhatsApp quando o agente de IA confirma quais cores estão disponíveis num tamanho. Coluna adicionada via `supabase-migration-agente-ia.sql` (`ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS foto_url text;`). |

#### Tabela `estoque`
Controle de estoque da **peça lisa** (produto + cor + tamanho, sem estampa — estampa é produzida sob demanda). Criada via `supabase-migration-estoque.sql`. Chave única `(produto, cor, tamanho)`, usada para `upsert` via `on_conflict=produto,cor,tamanho`.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | bigint (PK) | Gerado pelo Supabase |
| produto | text | Nome do produto, casado por texto com `catalogo.produtos[].nome` (ex: "Camiseta") |
| cor | text | Nome da cor, casado por texto com `catalogo.cores[].nome` |
| tamanho | text | Nome do tamanho, casado por texto com `catalogo.tamanhos[].nome` |
| quantidade | integer | Quantidade disponível em estoque (pode ficar negativa se houver overselling — sinaliza o problema em vez de esconder) |

**Entrada:** sempre manual, direto no CRM (aba Catálogo → botão "📦 Estoque" no produto → grade Cor × Tamanho, editável célula a célula).
**Saída:** automática — ao confirmar um **Ganho** (`confirmarGanho()`), todo item do pedido com `cor` e `tamanho` preenchidos desconta a quantidade correspondente (`estampa` é ignorada de propósito: a peça lisa é a mesma independente da estampa aplicada depois). Reabrir o card (`reabrirCard()`) ou editar um ganho já salvo (`saveEditNeg()`) devolve/reajusta o estoque automaticamente, para nunca ficar dessincronizado de um ganho revertido ou corrigido.
**Escopo:** só produtos com `tem_variacao=true` no catálogo (hoje só Camiseta) mostram o botão "📦 Estoque" — produtos simples não têm cor/tamanho pra rastrear.
**Limitação conhecida:** excluir um contato que já teve ganho registrado não devolve o estoque automaticamente (só reabrir/editar o ganho fazem isso) — não implementado por ser um caso raro e fora do pedido original.

**Função `estoque_ajustar(p_produto, p_cor, p_tamanho, p_delta)`:** upsert atômico em SQL (`insert ... on conflict (produto,cor,tamanho) do update set quantidade = quantidade + delta`), criada via `supabase-migration-agente-ia.sql`. Usada só pela Edge Function `pissilone-agent` (seção 15) — o navegador continua usando o padrão ler-depois-escrever (`ajustarEstoque()`/`upsertEstoque()`), que é aceitável porque só Lucas e Ana mexem nele manualmente; a Edge Function precisa ser atômica porque duas vendas do agente de IA podem chegar quase ao mesmo tempo.

#### Tabela `pedido_agente_pendente`
Carrinho temporário do **agente de IA** (seção 15), por telefone — não é usada pelo navegador. Guarda os itens que o agente foi adicionando numa conversa (via rota `/adicionar-item-pedido`) até o cliente fechar a compra (`/dar-ganho`, que lê tudo, aplica a venda e limpa o carrinho). Criada via `supabase-migration-agente-ia.sql`, RLS habilitado sem nenhuma policy — só a Edge Function (service_role) acessa.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | bigint (PK) | Gerado pelo Supabase |
| telefone | text | Telefone normalizado (só dígitos), chave de agrupamento do carrinho |
| produto / estampa / cor / tamanho | text | Igual ao item de pedido do navegador (`pedidoItens`/`neg_hist[].itens`) |
| qty | integer | Quantidade daquele item |
| criado_em | timestamptz | Usado pra descartar itens de um carrinho abandonado (mais de 6h) antes de somar um item novo — evita misturar um pedido velho esquecido com uma compra futura |

#### Tabela `encomendas`
Kanban de produção (aba "Encom."). Um registro por **item** de pedido com `cor` e `tamanho` preenchidos (a peça que precisa de estampa sob produção — mesmo critério usado pra descontar `estoque`). Criada via `supabase-migration-encomendas.sql`.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | bigint (PK) | Gerado pelo Supabase |
| contato_id | text | Id do contato (`contatos.id`), sem FK estrita |
| contato_nome | text | Nome do cliente, denormalizado pra exibir no card sem precisar de join |
| venda_id | text | Identifica a qual Ganho (registro de `neg_hist`) o item pertence — formato `contato_id + '_' + timestamp`, gerado em `confirmarGanho()` e gravado também em `neg_hist[].venda_id`. Usado só para apagar as encomendas certas ao reabrir o card, não aparece na UI. |
| produto / estampa / cor / tamanho | text | Copiados do item do pedido no momento do ganho |
| qty | integer | Quantidade daquele item |
| data_pedido | date | Data do ganho (mesma data registrada em `neg_hist[].d`) |
| prazo | date | Prazo de entrega — default `data_pedido + 2 dias úteis`, editável pelo usuário no card |
| entregue | boolean | `true` quando o card é arrastado pra coluna "Entregues" |
| data_entrega | date | Preenchida automaticamente (hoje) quando `entregue` vira `true` |

**Criação:** automática, dentro de `confirmarGanho()` (`criarEncomendasDoGanho()`), logo após descontar o estoque.
**Remoção automática:** ao reabrir um card que teve ganho (`reabrirCard()`), além de devolver o estoque (`moverEstoquePedido(itens,1)`), o CRM apaga todas as encomendas daquele `venda_id` via `removerEncomendasDoGanho()` — evita produzir peça de uma venda desfeita (desistência do cliente ou ganho marcado sem querer). Isso vale mesmo se o item já tiver sido marcado como "Entregue".
**Status exibido (Pedidos/Atrasados/Entregues) é sempre calculado, nunca uma coluna própria:** `entregue=true` → Entregues; senão `prazo < hoje` → Atrasados; senão → Pedidos. Isso significa que reabrir uma entrega (arrastar de volta) cai direto em Atrasados se o prazo já tiver passado, mesmo que o usuário solte no card em cima da coluna "Pedidos".
**Limitação conhecida:** editar os itens de um ganho já confirmado (`saveEditNeg()`) não cria, ajusta nem remove encomendas — só a confirmação inicial (`confirmarGanho()`) e a reabertura (`reabrirCard()`) mexem na tabela. Também não considera feriados no cálculo de dias úteis, só sábado/domingo.

#### Tabela `usage_log`
Log de atividade da equipe (aba "Log"). Alimentada por `logAction(action, details)` a cada ação relevante (contato criado/editado, ganho/perda confirmados, atividade concluída, parabéns de aniversário enviados). Registros com mais de 7 dias são apagados automaticamente por `purgeLogs()` no carregamento do app.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| ts | timestamp | Data/hora do evento (default do Supabase) |
| action | text | Chave da ação (ex: `contato_criado`, `ganho_confirmado`) |
| details | text | Texto livre com o detalhe (ex: nome do cliente, valor) |

Se essa tabela não existir no Supabase, a aba Log mostra um aviso e o restante do app funciona normalmente (o `fetch` falha silenciosamente em `logAction`).

### 2.3 Row Level Security e login (Supabase Auth) — versão simples
O CRM exige login (email/senha via Supabase Auth) pra ler ou escrever qualquer coisa. **Sem distinção de papel por enquanto** — hoje são só você e a Ana, e qualquer um que tenha login criado tem acesso total a tudo (Funil, Contatos, Insights, Catálogo, Config, exclusão de card, etc.). RLS de `contatos`/`config`/`catalogo`/`usage_log` exige só `to authenticated` (estar logado), sem tabela de perfil/papel nenhuma.

Script completo em `supabase-setup-auth.sql` (raiz do projeto) — rodar uma vez no SQL Editor. Depois disso, os logins são criados direto no painel: **Authentication → Users → Add user** (um pra você, um pra Ana). Não tem autocadastro nem tela de gerenciamento de usuários dentro do CRM — pra revogar acesso de alguém, é só desativar/apagar o usuário direto no painel do Supabase.

**Decisão consciente de manter simples por agora:** já existia uma versão desenhada com 3 papéis (superadmin/gerente/consultor), tabela `perfis`, RLS por papel e uma Edge Function (`manage-access`) pra criar acesso de dentro do CRM sem precisar do painel do Supabase. Essa versão ficou complexa demais pro que é preciso agora (só 2 pessoas, ambas com acesso total) e esbarrou num bug do próprio painel do Supabase (erro de `removeChild` causado por extensão/tradutor do navegador) na hora de rodar o SQL. Descartamos por ora — o arquivo `supabase/functions/manage-access/index.ts` ficou no repo sem uso, não é chamado por nada no `index-github.html`, é só um rascunho pronto pra quando for realmente necessário diferenciar papéis (ex: contratar um consultor). Quando isso acontecer, é só recuperar a lógica de `papel`/RLS por papel e religar a Edge Function.

#### Sessão no cliente
Sem SDK — login/refresh são `fetch` direto na API de Auth do Supabase (`/auth/v1/token?grant_type=password` / `grant_type=refresh_token`). A sessão (`access_token`/`refresh_token`/`expires_at`) fica em `localStorage` (chave `psn_auth_session`) e é renovada automaticamente a cada 1 min se faltar menos de 2 min pra expirar. `SB_HDR.Authorization` é mutado in-place (não reatribuído) pra sempre carregar o token do usuário logado — é por isso que `sbGet`/`sbUpsert`/`sbDelete` não precisaram mudar de assinatura.

---

## 3. Arquitetura do Código

### 3.1 Stack
- **HTML/CSS/JS puro** — sem frameworks, sem build, sem npm
- **Single file** — tudo em um único `index-github.html` (~3050 linhas: CSS embutido + HTML + JS embutido)
- **Supabase REST API** — chamadas fetch diretas, sem SDK
- **GitHub Pages** — deploy automático ao fazer push no main

### 3.2 Funções de API Supabase

```javascript
// Leitura
async function sbGet(table, filters='')
// Ex: sbGet('contatos', 'select=*&order=data.asc')

// Escrita (upsert — cria ou atualiza pelo id)
async function sbUpsert(table, data)
// Ex: sbUpsert('contatos', { id:'123', nome:'João', ... })

// Exclusão
async function sbDelete(table, id)
// Ex: sbDelete('contatos', '123')
```

### 3.3 Fluxo de Dados

```
Usuário → Browser → fetch() → Supabase REST API → PostgreSQL
                                    ↓
                              doSync() → contatos[] em memória → renderAll()
```

**IMPORTANTE:** Toda operação de escrita chama `apiSave(c)` e depois `doSync()` para recarregar os dados. Nunca modifique `contatos[]` sem chamar `doSync()` depois.

---

## 4. Estrutura de Estado (Variáveis Globais)

```javascript
let authSession = null;   // {access_token, refresh_token, expires_at, user:{id,email}} — sessão de login, espelhada em localStorage
let contatos = [];        // Array de todos os contatos carregados
let cfg = { funis, usuarios, campos_personalizados }; // Configuração (funis, etapas, usuários, campos custom)
let funilAtivo = 'd2c';   // Funil sendo visualizado no kanban
let filtroC = 'todos';    // Filtro de etapa na aba Contatos
let filtroAtv = 'todos';  // Filtro de atividade no funil
let filtroRes = 'todos';  // Filtro de resultado no funil
let filtroTier = 'todos'; // Filtro de tier Pissifã (ouro/prata/bronze/comum) na aba Contatos
let filtroGL = 'todos';   // Filtro do modal "Ganhos" (todos/NF emitida/sem NF)
let filtroAniversario = ''; // Filtro de mês de aniversário na aba Contatos
let periodo = '0';        // Período dos insights (1/7/30/90/0=tudo)
let periodoCustom = { ativo, de, ate }; // Período customizado (com presets: hoje/ontem/semana/mês/mês passado)
let userAtivo = 'todos';  // Filtro de usuário global ('todos' | 'sem' | id do usuário)
let editCid = null, editFid = null, editEfid = null, editEid = null; // IDs em edição: contato, funil, funil-da-etapa, etapa
let perdaCid = null;      // ID aguardando motivo de perda
let ganhoCid = null;      // ID aguardando confirmação de valor de ganho
let atvCid = null;        // ID com modal de atividade aberto
let editNegCid = null, editNegIdx = null; // Contato + índice do registro de neg_hist sendo editado (modal "Editar ganho")
let editCampoId = null;   // ID do campo personalizado em edição
let motivoSel = '';       // Chip de motivo de perda selecionado
let dragId = null;        // ID sendo arrastado no kanban
let currentDetailId = null;    // ID do contato aberto no modal de detalhe
let detTimelineFilter = 'todos'; // Filtro da timeline no modal de detalhe (todos/notas/atividades/registros)
let catalogo = { estampas: [], cores: [], tamanhos: [], produtos: [] }; // Catálogo de produtos (carregado da tabela `catalogo`). Cada item de `produtos` carrega `categoria` (moda/decor_home/acessorios/'') e `temVariacao` (boolean)
var pedidoItens = [];     // Itens do pedido sendo montado no modal de confirmação de ganho
var editNegItens = [];    // Itens do pedido sendo editados no modal "Editar ganho"
let editNegOrigin = 'detail'; // De onde `openEditNeg()` foi chamado: 'detail' (timeline do contato) ou 'ganhos' (lista de Ganhos no Insights) — define para onde `saveEditNeg()` volta depois de salvar
var importarLinhas = [];  // Linhas parseadas do CSV no modal de importação
```

Também existem globais auxiliares de curto prazo usados só para alimentar os modais de detalhe de Insights: `_insightsLista` (lista filtrada corrente, para `showAtvDetail`) e `_npsLista` (lista base do NPS, para `showNpsDetail`).

---

## 5. Funis e Etapas

### D2C (id: `d2c`)
| ID da Etapa | Nome |
|-------------|------|
| d2c-bv | Boas Vindas 🤝 |
| d2c-ni | Necessidade de Interesse 🔍 |
| d2c-neg | Negociação Comercial 🤑 ← ganho/perda aqui |
| d2c-cn | Cliente Novo |
| d2c-cr | Cliente Para Resgate |

### B2B (id: `b2b`)
| ID da Etapa | Nome |
|-------------|------|
| b2b-prosp | Prospecção |
| b2b-prop | Proposta |
| b2b-neg | Negociação ← ganho/perda aqui |
| b2b-fech | Fechado |
| b2b-perd | Perdido |

### Pissifã — clientes recorrentes (id: `pissifa`)
| ID da Etapa | Nome | Comportamento |
|-------------|------|---------------|
| psf-ativo | Ativo 🟢 | Estado padrão após recompra |
| psf-contato | Em contato 📞 | Tentando reativar |
| psf-neg | Negociando 🤑 | ← ganho/perda aqui |
| psf-inativo | Inativo 😴 | Após perda |

### Serviços — oficinas de pintura (id: `servicos`)
| ID da Etapa (seed inicial) | Nome | Comportamento |
|-------------|------|---------------|
| ser-int | Interessados | Triagem inicial — **não** conta como negociação, sem botões ✓/✗ (igual "Boas Vindas" no D2C) |
| ser-pre | Pré-inscrição | Conta como "negociação" (mostra botões ✓/✗ no card); arrastar/mover pra cá é um movimento **livre**, não abre modal nenhum |
| ser-ins | Inscrito | Só se chega aqui confirmando **Ganho** (pagamento) — é o único gatilho do modal de pagamento; também conta como "negociação", permitindo cancelar (✗) direto daqui |
| ser-part | Participou | Cliente compareceu à oficina — mover pra cá só registra a participação, sem modal |

**Importante — roteamento 100% por NOME da etapa, nunca por ID fixo.** `isNegociacao()`/`isGanho()` (para o funil `servicos`) e o `isGanhoAlvo` do `dropCard()` decidem se uma etapa é "Pré-inscrição"/"Inscrito"/"Participou" checando **substring no nome** (`nome.includes('inscrição')`, `.includes('inscrito')`, `.includes('participou')`), não os IDs `ser-pre`/`ser-ins`/`ser-part` do seed inicial. `confirmarGanho()` também resolve o destino do card por nome (`acharEtapaServicosPorNome()`), nunca escrevendo `c.etapa='ser-ins'` direto.

**Por quê:** o usuário edita/renomeia/apaga etapas livremente na aba Config (isso já é uma funcionalidade normal do app) — cada edição dessas mantém o `id` original da etapa, mas o `nome` muda. Depender de ID fixo pra decidir "essa é a etapa de pagamento" quebra silenciosamente assim que o texto exibido não bate mais com o que o código espera (foi exatamente o que causou um bug real: depois de renomear as etapas, o card só avançava pra "Pré-inscrição" dando Ganho, porque a etapa que o código achava que era "Inscrito" por ID tinha sido renomeada pra "Pré-inscrição"). Casando pelo **nome atual** exibido no card, o comportamento sempre reflete o que a tela mostra, não o histórico de quando cada etapa foi criada.

**Não existe mais etapa "Cancelado"** — foi removida pelo usuário direto no Config do CRM. Perda em Serviços agora funciona igual ao funil **B2B**: o card **não muda de etapa**, só fica marcado com `resultado='perda'` e `motivo_perda` (mostrado em vermelho no card). Como o card continua numa etapa de "negociação" (Pré-inscrição/Inscrito), os botões ✓/✗ continuam aparecendo mesmo depois de marcar perda — dá pra tentar de novo ou foi só um engano, mesmo comportamento que o B2B já tinha.

Cada contato do funil Serviços representa **uma inscrição/status atual**; o histórico de todas as oficinas que o cliente já fez fica em `oficinas_hist` (dentro de `meta`, ver seção 2.2), não em cards separados. Oficinas são cadastradas no Catálogo como itens `tipo='produto'` com `natureza='servico'` (ver seção 2.2); o modal de contato mostra um select "Oficina" (em vez do campo texto "Produto") quando o funil selecionado é Serviços — escolher uma oficina ali preenche `produto`/`oficina_atual`.

**Registro de participação (`registrarParticipacao(c, status)`)** — adiciona `{oficina, data_inscricao, status, data_oficina}` a `c.oficinas_hist`, chamado em três pontos: ao confirmar ganho (`status:'inscrito'`, card vai pra etapa cujo nome contém "inscrito"), ao mover/arrastar pra etapa cujo nome contém "participou" (`status:'participou'`) e ao confirmar perda (`status:'cancelado'`, sem mover o card). Exibido cronologicamente no modal de detalhe do contato ("Participações em Oficinas").

**Regras de roteamento automático ao confirmar Ganho/Perda** (em `confirmarGanho()` / `confirmPerda()`):
- **D2C**: Ganho em `d2c-neg` → card vai para `d2c-cn` (Cliente Novo). Se for o **segundo** ganho do cliente no funil D2C, o CRM **move** o próprio card pro Pissifã (`moverParaPissifaAuto`: muda `c.funil`/`c.etapa` no mesmo `id`, sem criar card novo) — mantém `neg_hist` único desde a 1ª compra. Não move se já existir outro card com o mesmo telefone no Pissifã (proteção contra duplicatas antigas, criadas antes dessa mudança pela extinta `duplicarParaPissifaAuto`). Perda em `d2c-neg` → card vai para `d2c-cr` (Cliente Para Resgate). **Como a 2ª venda é registrada:** o card só tem botão Ganho na etapa Negociação — pra uma recompra de um cliente já em "Cliente Novo", a equipe arrasta o card de volta pra `d2c-neg` e dá Ganho de novo; é nesse segundo Ganho que a mudança de funil acontece.
- **B2B**: sem roteamento automático de etapa — o resultado só é registrado no histórico.
- **Pissifã**: Ganho em `psf-neg` → card volta automaticamente para `psf-ativo`. Perda em `psf-neg` → card vai automaticamente para `psf-inativo`.
- **Serviços**: Ganho em qualquer etapa de negociação → card vai pra etapa "Inscrito" (achada por nome) e registra participação `inscrito`. Perda → **não move o card** (igual B2B), só registra `cancelado` em `oficinas_hist`. Nunca duplica para Pissifã (a duplicação automática só roda para `funil==='d2c'`).

**Drag & drop também dispara Ganho/Perda:** se o card está numa etapa de negociação (`isNegociacao`) e é arrastado direto para uma etapa cujo nome indica "Cliente Novo"/"Fechado" (ganho, D2C/B2B) ou, no caso de Serviços, cujo nome contém "inscrito" (ganho) — ou "Perdido"/"Inativo" (perda, D2C/B2B/Pissifã) —, o modal correspondente abre automaticamente. Serviços não tem mais alvo de perda por drag (não existe etapa "Cancelado" pra arrastar) — perda só acontece pelo botão ✗. Mover um card de Serviços pra uma etapa cujo nome contém "participou" só registra a participação e move direto, sem abrir modal — qualquer outro movimento (ex: Interessados → Pré-inscrição) é livre, sem modal nem registro.

**Aba Oficinas e coluna "Cancelados":** como perda não move mais o card pra uma etapa própria, a aba Oficinas (`renderOficinas()`) lê as etapas de `cfg.funis['servicos']` **dinamicamente** (não tem mais lista fixa de IDs) e soma uma coluna sintética "Cancelados" contando `c.resultado==='perda'` — contatos cancelados saem da contagem da etapa onde estão parados e entram só nessa coluna, sem contar duas vezes.

---

## 6. Lógica de Negociação (neg_hist)

### Estrutura do `neg_hist`
```json
[
  {"r": "ganho", "d": "2026-06-10", "m": "", "v": 190.00, "itens": [{"produto":"Camiseta","estampa":"Kit Nordeste Vivo","cor":"Azul","tamanho":"G","qty":1}], "nf": true, "fp": "pix"},
  {"r": "perda", "d": "2026-06-20", "m": "Preço alto", "v": 0},
  {"r": "ganho", "d": "2026-07-15", "m": "", "v": 94.90, "itens": [], "nf": false, "fp": "credito_vista"}
]
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| r | string | Resultado: "ganho" ou "perda" |
| d | string | Data ISO: "YYYY-MM-DD" (editável no modal de ganho, não é sempre "hoje") |
| m | string | Motivo (só para perda) |
| v | number | Valor da negociação (só para ganho) |
| itens | array | Itens do pedido: `{produto, estampa, cor, tamanho, qty}`. `produto` é obrigatório; `estampa`/`cor`/`tamanho` só existem se o produto tiver `temVariacao=true` no catálogo. Usados na aba Insights ("Produtos mais vendidos", "Vendas por categoria" e no cálculo de PA) |
| nf | boolean | **Legado/descontinuado** — controle de nota fiscal não faz mais parte do processo. Ainda gravado como `false` em `confirmarGanho()` por compatibilidade, mas o modal "Ganhos" não lê nem alterna esse campo (não existe mais `toggleNFGanho`) |
| fp | string | Forma de pagamento: `credito_vista` / `credito_parcelado` / `pix` / `dinheiro` / `debito` / `bonificacao` (rótulos em `FORMA_PAG_LABEL`) |

### Funções relacionadas
```javascript
parseNegHist(c)           // Parseia neg_hist, retorna array ([] se vazio/inválido)
setResultado(id, tipo)    // Ganho abre abrirModalGanho(id); perda abre modal-perda
abrirModalGanho(id)       // Popula modal de ganho: valor, data, forma de pagamento, itens do pedido, histórico anterior
adicionarItemPedido()     // Adiciona item (estampa/cor/tamanho/qty) ao pedido corrente (via seletor autocomplete do catálogo)
confirmarGanho()          // Salva ganho (valor, data, itens, forma de pagamento) no neg_hist, roteia etapa e dispara auto-duplicação Pissifã se aplicável
confirmPerda()            // Salva perda com motivo no neg_hist, roteia etapa
reabrirCard()             // Remove último registro do neg_hist
openEditNeg(cid, idx)     // Abre modal para editar um ganho já registrado (data, valor, forma de pagamento, itens)
saveEditNeg()             // Salva as edições do ganho no índice `editNegIdx` do neg_hist. Ao terminar: se `editNegOrigin==='ganhos'` reabre o modal "Ganhos" (fluxo de correção em lote); senão reabre o Detalhe do contato. Sempre chama `renderInsights()` se a aba Insights estiver ativa, para os gráficos não ficarem com dado desatualizado atrás do modal
openGanhosModal()         // Abre modal com todos os ganhos do período/filtro corrente, com resumo com/sem produtos vinculados
```

### Botões Ganho/Perda
Aparecem **apenas** quando `isNegociacao(fid, eid)` retorna `true`:
```javascript
function isNegociacao(fid, eid) {
  // Verifica pelo ID da etapa (mais robusto)
  if (eid === 'psf-neg' || eid === 'd2c-neg' || eid === 'b2b-neg') return true;
  // Fallback: verifica pelo nome da etapa
  // ...
}
```

---

## 7. Atividades

Cada contato pode ter uma atividade agendada:
- `atv_data` — data (YYYY-MM-DD)
- `atv_desc` — descrição
- `atv_hist` — contador de atividades concluídas

### Status de atividade
```javascript
function atvStatus(c) {
  // 'sem'       → sem atividade (bolinha vermelha)
  // 'atrasada'  → data no passado (bolinha amarela)
  // 'hoje'      → data é hoje (bolinha verde)
  // 'agendada'  → data no futuro (bolinha cinza)
}
```

### Checkpoint (✓ Check)
Ao clicar em Check (`checkpointAtv()` no modal de atividade, ou `checkpointAtvDetail()` no modal de detalhe): incrementa `atv_hist`, limpa `atv_data` e `atv_desc`, registra um evento `atv_concluida` em `meta.log_hist` e chama `logAction('atividade_concluida', ...)` para a aba Log.

### Criar atividade
Três formas:
1. Clicando na bolinha colorida (kanban, lista de contatos ou modal de detalhe) → modal de atividade
2. Dentro do modal de edição do contato (campos "Próx. atividade" + "Descrição da atividade")
3. Botão "+ Nova" dentro do painel de Atividades do modal de detalhe do contato (`openAtvFromDetail()`)

`saveAtv()` também grava um evento `atv_criada` em `meta.log_hist` (usado na timeline do modal de detalhe, ver seção 11).

---

## 8. Identidade Visual

```css
--L:  #D17543  /* Laranja — header, botões primários */
--L2: #A85528  /* Laranja escuro — hover */
--L3: #FDF0E8  /* Laranja claro — backgrounds */
--L4: #F5C4A8  /* Laranja suave — bordas hover */
--A:  #64A6AC  /* Azul — gráficos de barra */
--A2: #3D7A80  /* Azul escuro — filtros ativos, badges MarketUp */
--A3: #E8F4F5  /* Azul claro — backgrounds info */
--K:  #1A1208  /* Preto quente — card SAFRA, texto principal */
--K2: #3D2E1A  /* Marrom escuro — fundo da sidebar lateral */
--W:  #FDFAF5  /* Creme — fundo de cards */
--G:  #F0EDE6  /* Cinza creme — fundo da página */
--G2: #DDD8D0  /* Cinza médio — bordas */
--G3: #8A7A6A  /* Cinza texto — labels, metadados */
--VD:  #27500A /* Verde escuro — texto de ganhos */
--VD2: #EAF3DE /* Verde claro — background de badges de ganho/NF emitida */
--VM:  #791F1F /* Vermelho escuro — texto de perdas */
--VM2: #FCEBEB /* Vermelho claro — background de badges de perda/sem NF */
--AM:  #633806 /* Âmbar — texto de alertas */
--AM2: #FAEEDA /* Âmbar claro — background de alertas/aniversário */
--Y:  #F2E618  /* Amarelo — logo CRM, highlight busca */
```

**Tipografia:** Barlow (corpo) + Barlow Condensed Italic 900 (logo e números grandes nos insights)

**Navegação:** a navegação principal é uma **sidebar lateral fixa** (`.sidebar`, fundo `--K2`) com ícones SVG + rótulo, não mais uma barra de abas horizontal no topo. As seções são: Funil, Contatos, Insights, Catálogo, Config, Aniversariantes (com badge de notificação), Oficinas, Encomendas (com badge de notificação) e Log.

---

## 9. Funções Principais

### Autenticação (versão simples — sem papéis)
```javascript
fazerLogin() / logout() / renovarSessao()  // Login por email/senha, logout, renovação de token (via /auth/v1/token)
carregarSessaoSalva() / salvarSessao(s)      // Lê/grava a sessão no localStorage e chama aplicarAuthHeader()
entrarNoApp()                                 // Pós-login: libera #app-root, mostra o email no header, chama iniciarApp()
```
Todo mundo com login criado (você e a Ana) tem acesso total — não tem checagem de papel nem botão escondido por permissão. Ver seção 2.3 pra entender por que foi simplificado assim e o que existia antes (`souSuperadmin`/`souConsultor`/Controle de Acesso/Edge Function) caso você queira recuperar depois.

### Renderização
```javascript
renderAll()          // Chama renderFunil() + renderContatos() + renderUbtns() + updateBdayNotif()
renderFunil()        // Monta o kanban com todas as colunas
renderContatos()     // Lista de contatos filtrada (etapa, tier Pissifã, aniversário, busca)
renderInsights()     // Dashboard de métricas (bloco grande, ver abaixo)
renderConfig()       // Aba Configurar: funis/etapas, usuários, campos personalizados
renderCatalogo()     // Aba Catálogo: estampas, cores, tamanhos
renderAniversario()  // Aba Aniversariantes do mês
renderLog()          // Aba Log de uso (últimos 7 dias)
renderUbtns()        // Botões de usuário no header + "Sem resp." + contador
showTab(id)          // Alterna entre as 7 seções da sidebar e dispara o render correspondente
```

### Config
```javascript
loadCfg()       // Carrega config do Supabase (fallback: localStorage), garante cfg.campos_personalizados
saveCfg()       // Salva config no Supabase + localStorage (também roda a cada 5 min via setInterval)
loadCatalogo()  // Carrega estampas/cores/tamanhos da tabela `catalogo`
```

### Contatos
```javascript
doSync()              // Carrega todos os contatos do Supabase e desserializa a coluna `meta`
apiSave(c)            // Upsert de um contato no Supabase (serializa email/cpf/endereco/notas/log_hist/campos/cidade/uf/cep/nps em `meta`)
sbDelete('contatos', id) // Remove contato
openContato(id, fid, eid) // Abre modal de edição/criação (agora com email, CPF, aniversário, endereço, cidade/UF/CEP, cód. MarketUp)
saveContato()         // Salva contato do modal
matchUser(c)          // Helper de filtro por usuário ativo, incluindo 'sem' (sem responsável)
```

### Modais principais
```javascript
openContato(id, fid, eid)   // Modal de contato (criar/editar)
openContatoDetail(id)       // Modal de DETALHE do contato — dados, LTV/tier, campos personalizados, notas, timeline, atividades (ver seção 11)
openAtv(id)                 // Modal de atividade
openFunilModal(fid)         // Modal de funil
openEtapaModal(fid, eid)    // Modal de etapa
openUserModal()             // Modal de usuário
openCatalogoModal(tipo)     // Modal para adicionar item ao catálogo (estampa/cor/tamanho)
openCampoModal(campoId)     // Modal de criação/edição de campo personalizado
openImportModal()           // Modal de importação de clientes via CSV
openGanhosModal()           // Modal com a lista de todos os ganhos do período + filtro "sem produtos vinculados" (diagnóstico de PA)
openEditNeg(cid, idx)       // Modal para editar um ganho já registrado
closeM(id)                  // Fecha qualquer modal pelo id do elemento (Esc e clique fora também fecham)
```

### Catálogo de produtos e itens de pedido
```javascript
catSelFilter(tipo, ctx)  // Filtra o dropdown de autocomplete (produto/estampa/cor/tamanho) por texto digitado; se tipo='produto', também chama updProdutoVariacaoUI
catSelPick(tipo, ctx, v) // Seleciona um item do dropdown; se tipo='produto', também chama updProdutoVariacaoUI
catSelAddNew(tipo, ctx)  // Cria um item novo no catálogo direto do autocomplete (POST em `catalogo`) — produto criado assim nasce sem categoria/temVariacao
updProdutoVariacaoUI(ctx, nome) // Mostra/esconde o bloco de Estampa/Cor/Tamanho (#variacao-wrap-novo ou #variacao-wrap-edit) conforme o produto digitado tiver `temVariacao=true` no catálogo
adicionarItemPedido()    // Adiciona {produto, estampa, cor, tamanho, qty} ao pedido do ganho sendo confirmado — produto é obrigatório
adicionarItemEditNeg()   // Idem, mas para o modal de edição de um ganho já salvo
saveCatalogoItem() / delCatalogoItem(id, tipo) // CRUD de itens do catálogo (aba Catálogo)
setCategoriaProduto(id, categoria) // PATCH direto na tabela `catalogo` — muda a categoria (moda/decor_home/acessorios) de um produto pelo select inline na aba Catálogo
setVariacaoProduto(id, temVariacao) // PATCH direto na tabela `catalogo` — liga/desliga a flag `tem_variacao` de um produto pelo checkbox inline na aba Catálogo
setNaturezaProduto(id, natureza) // PATCH direto na tabela `catalogo` — muda `natureza` (produto/servico) pelo select inline; força tem_variacao=false ao virar serviço
onNaturezaChange()       // No modal de novo item do catálogo, oculta categoria/variação quando natureza='servico' é escolhida
```

### Estoque (peça lisa: produto + cor + tamanho)
```javascript
loadEstoque()                        // Carrega a tabela `estoque` inteira para o array global `estoque`
getEstoqueQtd(produto, cor, tamanho) // Lê a quantidade atual (0 se não existir linha ainda)
upsertEstoque(produto, cor, tamanho, quantidade) // Grava a quantidade absoluta (upsert por on_conflict=produto,cor,tamanho) e recarrega `estoque`
ajustarEstoque(produto, cor, tamanho, delta)     // Soma/subtrai um delta em cima da quantidade atual (usa getEstoqueQtd + upsertEstoque)
moverEstoquePedido(itens, sinal)     // Percorre itens de um pedido (de neg_hist) e ajusta estoque de cada item com cor+tamanho preenchidos; sinal=-1 (saída, ganho) ou +1 (volta, reabrir/editar)
openEstoqueModal(produtoNome)        // Abre o modal #modal-estoque com a grade Cor × Tamanho do produto
renderEstoqueGrid()                  // Monta a tabela HTML da grade (linhas=cores, colunas=tamanhos), célula em vermelho quando quantidade<=0
salvarEstoqueCelula(cor, tamanho, valor) // onChange de uma célula da grade — chama upsertEstoque com o valor absoluto digitado
```
Chamado em `confirmarGanho()` (desconta após salvar o ganho), `reabrirCard()` (devolve se o último registro removido era um ganho) e `saveEditNeg()` (devolve os itens antigos e desconta os itens novos, para refletir a edição sem duplicar nem perder movimentação).

### Campos personalizados
```javascript
openCampoModal(campoId) // Cria/edita um campo (nome + lista de opções, uma por linha)
saveCampo()              // Salva o campo em cfg.campos_personalizados e persiste via saveCfg()
delCampo(id)             // Remove o campo da config (valores já salvos nos contatos são mantidos, só somem da UI)
saveCampoValor(cid, campoId, valor) // Salva o valor selecionado de um campo para um contato específico (grava em c.campos)
getNps(c)                // Lê o NPS do contato — primeiro procura um campo personalizado cujo nome contenha "nps", senão usa c.nps
```

### Importação / Exportação CSV
```javascript
csvField(v)             // Escapa um valor para CSV (aspas se contiver ";", '"' ou quebra de linha)
baixarArquivo(nome, conteudo) // Gera Blob + <a download> e dispara o download do arquivo
exportarClientesCSV()   // Baixa "clientes-modelo.csv" já preenchido com todos os contatos (mesmas colunas do import)
fmtDFullAno(iso)        // Converte data ISO (yyyy-mm-dd) para dd/mm/aaaa (ano completo) para exibir no CSV
openImportModal()      // Abre o modal e reseta o estado
handleImportFile(e)    // Lê o arquivo, faz parse (separador ";", ignora cabeçalho), chama marcarDuplicados, popula importarLinhas
marcarDuplicados(rows)  // Marca r._dupMotivo ("já cadastrado" ou "duplicado no arquivo") comparando tel/cpf normalizados contra contatos[] e entre as próprias linhas
renderImportPreview(rows) // Mostra prévia dos primeiros 10 registros, destacando duplicados em vermelho com o motivo
executeImport()         // Cria um contato por linha (funil d2c / etapa d2c-bv), pulando linhas com r._dupMotivo
```

### Aniversariantes
```javascript
getMonthBirthdays()   // Contatos com aniversário no mês corrente, ordenados por dia
getTodayBirthdays()   // Contatos que fazem aniversário hoje
markBdaySent(cid)     // Marca "parabéns enviado" no localStorage do dia (chave psn_bday_YYYYMMDD) e loga a ação
updateBdayNotif()     // Atualiza o badge numérico no ícone "Aniver." da sidebar com aniversariantes de hoje ainda não marcados
```

### Log de uso
```javascript
logAction(action, details) // POST assíncrono em usage_log; falha silenciosa se a tabela não existir
purgeLogs()                 // Apaga registros com mais de 7 dias, chamado uma vez no boot
formatActionName(action)    // Rótulo em pt-BR para cada tipo de ação
```

### Insights (destaques — a função `renderInsights()` é grande e monta tudo por concatenação de string)
```javascript
filtPer(lista) / filtNegsPer(negs, isPrev) // Filtram por período (presets 1/7/30/90/0 ou intervalo custom), isPrev busca o período anterior equivalente para comparação
varPct(curr, prev)      // Formata a variação percentual vs. período anterior (▲/▼ colorido)
svgDonut / svgPieSegs / svgBarV // Helpers que geram SVG inline para donut de conversão, pizza de motivos de perda/NPS/vendas por categoria e barras de receita por mês
itemProdutoEfetivo(it) // Fallback para itens antigos de neg_hist sem campo `produto` (anteriores à introdução do catálogo de Produtos): se o item tem estampa/cor/tamanho mas não tem `produto`, é tratado como "Camiseta" — histórico da Pissilone era 100% camisetas. Usado em vez de `it.produto` direto nas agregações de Insights, nunca reescreve o dado salvo.
// PA e "Vendas por categoria" são calculados inline no início de renderInsights() a partir de `todosItens`
//   (todos os itens de pedido dos ganhos do período): totalPecas = soma de qty; pa = totalPecas / nº de ganhos.
//   A categoria de cada item vem do match (nome do produto efetivo, case-insensitive) contra `catalogo.produtos[].categoria`;
//   itens sem produto efetivo ou com produto não categorizado caem em "Sem categoria".
// "Produtos mais vendidos" tem 4 colunas (Produtos/Estampas/Cores/Tamanhos), cada uma agregando por `qty` a partir de `todosItens` (coluna Produtos também usa `itemProdutoEfetivo`).
renderInsightsPissifa() // Bloco de métricas de recompra do funil Pissifã, com cards clicáveis
showPsfDetail(tipo)     // Modal de lista drill-down por métrica Pissifã (todos/recompras/receita/ticket/vips/freq)
showUserDetail(uid)     // Modal de lista de cards de um responsável, com select inline para reatribuir (changeResponsavel)
showAtvDetail(tipo)     // Modal de lista drill-down por status de atividade (hoje/atrasada/agendada/sem/checkpoint)
showNpsDetail(grupo)    // Modal de lista drill-down por grupo de NPS (promotores/neutros/detratores)
openGanhosModal()       // Modal com todos os ganhos do período, filtro "Sem produtos" (`itens.length===0`) para achar ganhos que puxam o PA pra baixo; cada linha tem botão "Editar" que abre openEditNeg direto
```


### Modal de detalhe do contato (timeline)
```javascript
openContatoDetail(id)   // Monta o modal completo: dados, tier/LTV, campos personalizados, notas, atividades
saveDetNota()            // Salva uma anotação (vai para c.notas e para meta.log_hist como evento "nota")
renderDetTimeline(cid)   // Renderiza a linha do tempo unificada (ganhos, perdas, notas, atividades criadas/concluídas), com filtro por tipo
setDetFilter(f)          // Alterna o filtro da timeline (todos/notas/atividades/registros)
checkpointAtvDetail()    // Conclui a atividade agendada direto do modal de detalhe
```
`openContatoDetail()` também popula (quando `c.oficinas_hist` não está vazio) um bloco separado "Participações em Oficinas" (`#det-oficinas-wrap`/`#det-oficinas`) no `det-left`, em ordem cronológica reversa — não faz parte da timeline principal.

### Aba Oficinas (relatório do funil Serviços)
```javascript
renderOficinas()             // Agrupa contatos do funil servicos por `produto` (nome da oficina), cruzando com catalogo.produtos (natureza='servico') pra listar até oficinas sem inscritos; colunas de etapa vêm de getFunil('servicos').etapas (dinâmico) + coluna sintética "Cancelados" (conta resultado==='perda'), numa tabela com células clicáveis
showOficinaDetail(oficina, etapaId) // Drill-down: reaproveita o modal genérico #modal-psf-detail/#psf-detail-content (mesmo padrão de showUserDetail/showAtvDetail) pra listar os contatos daquela oficina+etapa; etapaId==='CANCELADOS' é um pseudo-valor tratado à parte (filtra por resultado==='perda' em vez de por etapa)
```

### Aba Encomendas (kanban de produção — itens com estampa/cor/tamanho)
Tabela própria no Supabase: `encomendas` (migration em `supabase-migration-encomendas.sql`). Um registro por **item** do pedido (não por venda inteira) — se um ganho tiver 2 camisetas de cor/tamanho diferentes, viram 2 encomendas.
```javascript
criarEncomendasDoGanho(c, itensGanho, dataGanho, vendaId) // Chamado dentro de confirmarGanho() logo após moverEstoquePedido(); filtra itensGanho por it.cor && it.tamanho (mesmo critério do estoque — é a peça que precisa de estampa sob produção, diferente da peça lisa) e insere uma linha em `encomendas` por item (gravando o `vendaId` gerado em confirmarGanho()), com prazo = addDiasUteis(dataGanho, 2)
removerEncomendasDoGanho(vendaId) // Chamado dentro de reabrirCard() junto com moverEstoquePedido(itens,1); apaga (DELETE) todas as encomendas com aquele `venda_id` — evita produzir peça de uma venda desfeita
addDiasUteis(isoDate, dias)  // Soma dias úteis (pula sáb/dom) a uma data ISO; não considera feriados
loadEncomendas()             // Carrega a tabela `encomendas` inteira pro array global `encomendas`, ordenado por prazo; chama updateEncomendasNotif() ao final
encomendaStatus(o)           // Deriva o status de exibição a partir de o.entregue e o.prazo: 'entregue' | 'atrasado' (prazo < hoje e não entregue) | 'aberto' — não é uma coluna própria no banco, é sempre recalculado
apiSaveEncomenda(o)          // PATCH em `encomendas` (prazo, entregue, data_entrega)
editarPrazoEncomenda(id, novoPrazo) // onChange do input de data inline no card — permite o usuário sobrescrever o prazo automático de 2 dias úteis
dropEncomenda(statusAlvo)    // Drag-and-drop do board: soltar na coluna "Entregues" marca entregue=true + data_entrega=hoje; soltar em "Pedidos" ou "Atrasados" reabre (entregue=false) — a divisão entre Pedidos/Atrasados continua sendo automática por prazo, então reabrir um pedido com prazo já vencido volta direto pra coluna Atrasados
delEncomenda(id)             // Remove a linha (ex: encomenda criada por engano)
updateEncomendasNotif()      // Badge numérico no ícone "Encom." da sidebar = quantidade de encomendas com status 'atrasado'
renderEncomendas()           // Monta o board (3 colunas fixas: Pedidos/Atrasados/Entregues) — mesmo padrão visual de drag-and-drop do board do Funil, mas com dragEncomendaId próprio (não reaproveita o dragId do Funil)
```
Limitação conhecida: editar os itens de um ganho já confirmado (`saveEditNeg()`) não cria/ajusta/remove encomendas — só `confirmarGanho()` (cria) e `reabrirCard()` (remove) mexem na tabela.

---

## 10. Regras Críticas de Desenvolvimento

### 10.1 Nunca use template literals aninhados
O CRM usa template literals em muitos lugares, mas **nunca aninhe um backtick dentro de outro**. Isso causa `SyntaxError` silencioso que trava todo o JavaScript.

❌ **Errado:**
```javascript
document.getElementById('x').innerHTML = `
  ${items.map(i => `<div>${i.nome}</div>`).join('')}
`;
```

✅ **Correto — usar função separada ou concatenação:**
```javascript
function renderItems(items) {
  let h = '';
  items.forEach(function(i) { h += '<div>' + i.nome + '</div>'; });
  return h;
}
document.getElementById('x').innerHTML = '<div>' + renderItems(items) + '</div>';
```

### 10.2 Aspas simples dentro de strings JS
Nunca use `font-family:'Barlow Condensed'` dentro de uma string JavaScript com aspas simples. Use `font-family:sans-serif` ou escape como `font-family:&quot;Barlow Condensed&quot;`.

### 10.3 Normalização de datas
Sempre use `normDate(valor)` ao ler datas do banco:
```javascript
function normDate(d) {
  // Converte qualquer formato para YYYY-MM-DD
  // Aceita: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS, DD/MM/YYYY
  // Retorna '' se inválido
}
```

### 10.4 Salvar sempre com doSync()
```javascript
// Padrão obrigatório para qualquer operação de escrita:
ss('ld', 'Salvando...');
try {
  await apiSave(c);
  await doSync(); // SEMPRE chamar depois do save
} catch(ex) {
  ss('er', 'Erro ao salvar');
}
```

### 10.5 Deploy
Após editar o `index-github.html`:
1. Commit no GitHub (branch main)
2. Aguardar 1-3 minutos para GitHub Pages atualizar
3. Testar com `Ctrl+Shift+R` para limpar cache

---

## 11. Funcionalidades Implementadas

### Navegação (sidebar)
9 seções acessíveis por ícones na sidebar lateral esquerda: **Funil, Contatos, Insights, Catálogo, Config, Aniversariantes** (com badge de notificação para aniversariantes de hoje ainda não parabenizados), **Log, Oficinas e Encomendas** (com badge de notificação para pedidos atrasados).

### Kanban (aba Funil)
- Drag & drop entre etapas — se o destino for uma etapa de "ganho" ou "perda" (Cliente Novo/Fechado/Perdido/Inativo/Inscrito), abre automaticamente o modal de confirmação correspondente. Serviços não tem mais destino de perda por drag (perda só pelo botão ✗, não move o card — ver seção 5)
- Cabeçalho fixo com nome + soma de valores em laranja
- Scroll interno por coluna, footer "+ Contato" fixo
- Busca de contato com destaque amarelo em tempo real
- Filtros em dropdown ("Filtros ▾"): Atividade (Todos/Hoje/Agendada/Atrasada/Sem atividade) e Resultado (Todos/Ganhos/Perdidos/Em aberto), com indicador numérico de quantos filtros ativos
- Filtro por oficina (select próprio, só visível quando o funil ativo é Serviços)
- Contador no header: `X cards em D2C · Y total`

### Cards do Kanban
- Dot de atividade colorido (clicável → abre modal de atividade)
- Badge histórico: `📊 Nx` com total de negociações
- Badge `#código` do MarketUp e badge `NF ✓` quando a última venda tem nota fiscal emitida
- Última compra: `🛍 há X dias · Nª compra · 💰 R$Y total` + ícone de tier (🥇/🥈/🥉) quando aplicável
- Badges de campos personalizados (cor por posição da opção selecionada)
- Botões ✓ Ganho e ✗ Perda APENAS na etapa de negociação
- Badge de resultado (ganho/perda) fora da negociação
- Motivo de perda em vermelho
- Botões: ✎ abre modal de **detalhe** do contato (não mais o modal de edição direto), ⧉ duplicar para Pissifã (bloqueado se já existir card com o mesmo telefone no Pissifã), ✕ excluir
- Nome do card e área central também abrem o modal de detalhe ao clicar

### Modal de Ganho
Ao clicar em Ganho → modal pede: data do ganho, valor total, forma de pagamento e itens do pedido. Para cada item, o **Produto** é obrigatório (autocomplete com criação inline no catálogo); se o produto selecionado tiver a flag `temVariacao` marcada no catálogo (ex: Camiseta), aparecem também os campos Estampa/Cor/Tamanho — produtos "simples" (ex: Chaveiro) pedem só a quantidade. Histórico anterior de compras é exibido.

**Validação obrigatória:** `confirmarGanho()` bloqueia a confirmação (feedback em `#fb-neg`) se não houver pelo menos 1 item em `pedidoItens` ou se a forma de pagamento estiver vazia. A mesma regra vale em `saveEditNeg()` (feedback em `#fb-editneg`) — não dá pra salvar um ganho editado sem produto e forma de pagamento. Objetivo: manter o PA e o relatório de forma de pagamento confiáveis.

### Modal de Contato (criar/editar)
- **Busca de cliente existente** (só ao criar, não ao editar): digitar no campo Nome (2+ caracteres) mostra um autocomplete (`buscarClienteExistente()`) com contatos já cadastrados que batem o nome, deduplicados por telefone. Selecionar um (`selecionarClienteExistente(cid)`) copia telefone, email, CPF, aniversário, endereço, cidade, UF, CEP e código MarketUp para o card novo — não copia funil/etapa/produto/valor/histórico, já que é um card novo (nova participação), não uma edição do card antigo.
- Nome, telefone, funil, etapa, responsável, canal, valor
- Próx. atividade (data) + Descrição da atividade
- Produto (campo texto), ou **select "Oficina"** no lugar dele quando o funil escolhido é Serviços (populado a partir do catálogo com `natureza='servico'`; escolher uma oficina preenche o campo Produto por baixo)
- Observação
- Email, CPF, aniversário, endereço, cidade, UF, CEP, código MarketUp
- Histórico de negociações (data, valor, motivo de cada uma)
- Total gasto acumulado
- Botão "Reabrir card" quando há resultado e fora de negociação

### Modal de Detalhe do Contato (novo — acesso principal a partir do kanban/lista)
Modal de 3 colunas com:
- **Coluna esquerda:** dados do cliente (telefone com link direto para WhatsApp, email, CPF, aniversário, endereço, cidade/UF/CEP, canal, data de cadastro, produto, cód. MarketUp), métricas (badge de tier Pissifã Ouro/Prata/Bronze, LTV, nº de compras, ticket médio, última compra, perdas, checkpoints) e campos personalizados editáveis inline
- **Coluna central:** campo de anotações (salva e registra na timeline) + **linha do tempo unificada** de ganhos, perdas, notas e atividades criadas/concluídas, com filtro por tipo e botão de editar diretamente em cada ganho registrado
- **Coluna direita:** atividade agendada (com checkpoint e edição) e botão "+ Nova" atividade

### Aba Contatos
- Filtros em dropdown por etapa, filtro de tier Pissifã (Ouro/Prata/Bronze/Cliente comum) e filtro por mês de aniversário (com ordenação por dia quando ativo)
- Botão "Importar CSV" (formato `ID;NOME;CPF;TELEFONE;CIDADE;CEP;ENDEREÇO;UF;ANIVERSÁRIO;EMAIL`, separador ponto e vírgula); modal tem botão "Baixar modelo" que exporta os clientes atuais nesse mesmo formato para reimportar depois; ao importar, duplicados (por telefone ou CPF, contra o banco ou dentro do próprio arquivo) aparecem destacados em vermelho na prévia e são ignorados automaticamente na importação
- Badge de aniversário no card quando aplicável

### Aba Catálogo
4 colunas: **Produtos**, Estampas, Cores e Tamanhos, cada uma com contador e botão "+ novo item". Cores, Tamanhos e Estampas aparecem como chips simples removíveis (sem categoria — categoria vive no Produto). **Produtos** aparecem em linha própria com: emoji indicando natureza (🛍️ Produto / 🎨 Serviço), nome, um select inline de **natureza** (via `setNaturezaProduto()`) e, só para produtos físicos, um select de **categoria** (Moda / Decor-Home / Acessórios / Sem categoria via `setCategoriaProduto()`) e um checkbox **"estampa/cor/tam."** (via `setVariacaoProduto()`) — tudo muda na hora, sem reabrir modal. Itens marcados como Serviço nunca mostram categoria/variação (oficinas não têm estampa/cor/tamanho). Ao criar um produto novo (botão "+ Produto") o modal já pede natureza, categoria e a checkbox de variação (os dois últimos só aparecem se a natureza for Produto).

Produtos com a checkbox "estampa/cor/tam." marcada também mostram um botão **"📦 Estoque"**, que abre o modal `#modal-estoque` com uma grade Cor × Tamanho (linhas × colunas geradas a partir dos cadastros de Cor e Tamanho do catálogo). Cada célula é um input numérico editável — mudar o valor salva na hora (`salvarEstoqueCelula()`) e a célula fica vermelha quando a quantidade é 0 ou negativa. Ver seção 2.2 (tabela `estoque`) para a lógica de entrada/saída.

### Aba Aniversariantes
Lista os aniversariantes do mês corrente: destaque para quem faz aniversário hoje (com link de WhatsApp pré-preenchido "Feliz Aniversário!" e botão "Marcar enviado"), depois listas "Já passaram este mês" e "Ainda virão este mês". Badge de contagem no ícone da sidebar.

### Aba Log
Lista cronológica das últimas ações registradas em `usage_log` (contato criado/editado, ganho/perda confirmados, atividade concluída, parabéns enviados), limitada aos últimos 7 dias.

### Aba Oficinas
Relatório do funil Serviços: uma tabela agrupando por oficina (nome do produto/serviço) com uma coluna por etapa configurada (o que estiver em Config → funil Serviços, hoje Interessados/Pré-inscrição/Inscrito/Participou) + coluna "Cancelados" (contatos com `resultado==='perda'`, não é uma etapa) + total. Inclui oficinas cadastradas no Catálogo mesmo sem nenhum inscrito ainda. Clicar num número abre a lista de contatos daquela oficina+etapa (mesmo modal de drill-down `#modal-psf-detail` usado nos Insights), com botão para abrir o contato.

### Insights
Layout bem mais extenso que o original, com:
- 4 hero cards: Receita, Ganhos (clicável → abre lista de ganhos com filtro "Sem produtos", para achar ganhos sem itens vinculados que distorcem o PA), Tx. Conversão (donut SVG), Ticket Médio — todos com variação percentual vs. período anterior
- Mini stats: Negociações, Perdidos, Em aberto, SAFRA, Checkpoints, **PA** (peças por atendimento = total de peças vendidas ÷ nº de ganhos no período, com o total de peças como subtítulo)
- **Aquisição de clientes**: 3 mini-cards:
  - **Clientes novos**: clientes cuja 1ª compra de todos os tempos caiu dentro do período. Agrupado por **telefone** (não por `id` de card): como a 2ª compra no D2C move o card pro Pissifã no mesmo `id` (`moverParaPissifaAuto`, ver seção 5), a 1ª compra pode acabar "dentro" de um card que hoje está com `funil==='pissifa'` — agrupar por telefone garante 1 "primeira compra" por cliente real, e também funciona pra cards antigos duplicados por telefone (criados pela extinta lógica de duplicação), sem contar a mesma pessoa 2x
  - **Conversas WhatsApp** / **Visitas ao Ateliê**: não é só card criado com aquele canal — conta qualquer card com `canal==='whatsapp'`/`'atelie'` que teve **algum evento dentro do período** (criação do card, atividade/nota em `log_hist`, ou ganho/perda em `neg_hist`). Isso cobre o caso de um cliente antigo que manda mensagem de novo ou volta ao ateliê sem gerar um card novo
  - Os 3 cards mostram só o número + rótulo, sem legenda secundária (removida por não refletir mais com precisão a lógica após a mudança de "card criado" para "evento no período")
  - Todos respeitam os filtros de usuário/funil/canal ativos no topo
  - Trocar o campo Canal de um contato existente (modal "Editar contato") agora grava um evento `canal_atualizado` em `log_hist` com a data de hoje — é assim que "cliente falou de novo no WhatsApp" ou "voltou ao Ateliê" passam a contar em Conversas/Visitas mesmo em cards antigos, sem precisar criar um card novo
- Gráfico de barras de receita por mês (até 12 meses)
- Desempenho por responsável (cards clicáveis → drill-down com lista de cards e reatribuição de responsável inline)
- Cards por etapa do funil ativo (barras horizontais)
- Conversão por canal (barras ganho/perda empilhadas)
- **Forma de pagamento**: pizza SVG + barras por forma de pagamento (Crédito à Vista/Parcelado, Pix, Dinheiro, Débito, Bonificação + "Sem forma informada"), ordenado pela mais usada. O **%** é calculado por volume (nº de vendas ÷ total de ganhos do período), não por receita — responde "qual forma os clientes mais usam", não "qual forma gera mais R$". Receita (R$) de cada forma aparece como dado secundário na mesma linha
- Motivos de perda (gráfico de pizza SVG + barras, principal motivo destacado)
- Produtos mais vendidos: top 5 Produtos / Estampas / Cores / Tamanhos (a partir dos itens de pedido registrados nos ganhos)
- **Vendas por categoria**: pizza SVG + barras com peças vendidas e % por categoria (Moda/Decor-Home/Acessórios + "Sem categoria"), calculado a partir da `categoria` de cada produto no catálogo cruzada com os itens dos ganhos do período
- Localização dos clientes: top cidades e top UFs
- Atividades: hoje/atrasadas/agendadas/sem atividade/checkpoints — cada card clicável abre lista drill-down
- **NPS (Net Promoter Score):** pizza SVG de Promotores (9–10) / Neutros (7–8) / Detratores (0–6), score calculado, cada grupo clicável para lista de clientes. O valor de NPS é lido de um campo personalizado chamado "NPS" (ou de `c.nps` como fallback)
- Seção Pissifã: recompras, receita recorrente, ticket médio, VIPs, frequência — cada métrica clicável para lista drill-down
- Filtros: usuário, funil, canal e período (presets 1/7/30/90/tudo + intervalo customizado com atalhos hoje/ontem/semana/mês/mês passado). Pra analisar só Serviços, filtre pelo dropdown de funil — não existe mais toggle de "incluir/excluir" separado (removido: com "Todos funis" selecionado, os dados de todos os funis sempre entram na conta, sem opção de excluir Serviços à parte)

### Configurar
- Criar/renomear/apagar funis e etapas
- Criar/remover usuários
- Criar/editar/apagar **campos personalizados** (nome + lista de opções) exibidos em todos os cards e no modal de detalhe de todos os funis
- Salvar configuração no Supabase (manual + auto-save a cada 5 minutos)
- O funil **Serviços** (Interessados/Pré-inscrição/Inscrito/Participou) é seedado automaticamente em `cfg.funis` na primeira carga após a atualização (`seedServicosFunil()`, chamado dentro de `loadCfg()`), sem precisar recriar manualmente — roda uma vez só e persiste via `saveCfg()`. Etapas depois disso são livres pra editar/apagar/criar no Config normalmente, igual qualquer outro funil

---

## 12. Histórico de Decisões Técnicas

| Decisão | Motivo |
|---------|--------|
| Migração Google Sheets → Supabase | Sheets era lento (Apps Script intermediário). Supabase é direto, gratuito e muito mais rápido |
| Single HTML file | Deploy zero-config via GitHub Pages |
| `neg_hist` como JSON string | Histórico permanente por card sem colunas extras |
| Funções separadas para cada bloco de insights | Evita template literals aninhados que quebram o JS |
| `isNegociacao()` verifica pelo ID da etapa | Mais robusto — não depende do funil estar correto |
| `normDate()` em todos os campos de data | Supabase pode retornar datas em formatos variados |
| Concatenação de string em vez de template literals nos insights | Template literals aninhados causam SyntaxError |
| Coluna `meta` (JSON) para email/CPF/endereço/notas/log_hist/campos/NPS | Evita migração de schema no Supabase a cada campo novo do formulário |
| `itens`, `nf` e `fp` dentro de cada registro de `neg_hist` (em vez de colunas na tabela) | Cada venda pode ter forma de pagamento e itens próprios; mantém tudo no mesmo JSON versionado por negociação |
| Tabela `catalogo` separada (estampas/cores/tamanhos) | Permite autocomplete e reuso de itens entre pedidos sem duplicar texto livre |
| Tabela `usage_log` opcional, com fallback silencioso | Aba Log funciona como "nice to have" sem quebrar o app se a tabela não existir no Supabase |
| Modal de Detalhe do contato como ponto de entrada principal (em vez de abrir direto o modal de edição) | Concentra timeline, notas, atividades e campos personalizados num só lugar sem sobrecarregar o modal de edição |
| Hierarquia Categoria → Produto → Estampa/Cor/Tamanho, com categoria em `catalogo.categoria` por **produto** (não por estampa) | Estampa é uma característica do produto (ex: a estampa só existe dentro da Camiseta), não uma entidade categorizável por si; produto é o nível certo para "o que foi vendido" |
| Flag `tem_variacao` por produto decide se Estampa/Cor/Tamanho aparecem no pedido, em vez de checar o nome do produto (ex: `=== 'Camiseta'`) | Flexível para produtos futuros com variação (ex: Baby Look) sem precisar hardcodar nomes no código — decisão tomada explicitamente pelo usuário ao cadastrar o produto |
| "Vendas por categoria" mede peças (qty), não R$ | O valor da negociação é só o total do pedido — não há preço por item, então ratear R$ por categoria seria uma estimativa; peças vendidas é o dado real disponível |
| PA = peças ÷ nº de vendas (ganhos), não ÷ clientes únicos | Definição clássica de varejo (peça por atendimento); um cliente que compra 2x conta 2x no denominador |
| Itens antigos de `neg_hist` sem `produto` são tratados como "Camiseta" só na leitura (`itemProdutoEfetivo`), sem reescrever o histórico salvo | Todo o histórico de vendas anterior ao catálogo de Produtos era 100% camisetas; reescrever cada `neg_hist` de cada contato no Supabase seria arriscado e desnecessário — resolver na leitura é reversível e não toca dado de produção |
| Login com Supabase Auth (email/senha) em vez de sistema caseiro | Hash de senha, refresh token e API admin corretos e suportados oficialmente — SQL cru pra simular login quebra em upgrades do Supabase |
| `SB_HDR.Authorization` mutado in-place em vez de trocar a assinatura de `sbGet`/`sbUpsert`/`sbDelete` | Todo lugar que usa `SB_HDR` já espalha (`{...SB_HDR}`) no momento da chamada — mutar o objeto uma vez no login/refresh propaga pra tudo sem tocar dezenas de call sites |
| Login sem distinção de papel (todo login = acesso total), logins criados manualmente no painel do Supabase, sem Edge Function | Só existem 2 pessoas hoje (você e Ana), ambas precisam de acesso total — construir papel/RLS por papel/tela de gerenciamento de usuário/Edge Function é complexidade sem necessidade real agora, e esbarrou num bug do próprio painel do Supabase ao rodar o SQL mais complexo. Fica pronto pra retomar (`supabase/functions/manage-access/index.ts`) quando precisar de fato diferenciar permissões |
| Serviços (oficinas) como um 4º funil (`servicos`), em vez de uma estrutura de dados paralela | Reaproveita 100% do Kanban, filtros, insights e modal de detalhe já existentes; um card = status atual do cliente na oficina, histórico completo de participações fica em `oficinas_hist` (dentro de `meta`), não em cards duplicados |
| `natureza` (produto/serviço) como coluna nova em `catalogo`, em vez de tabela separada de "oficinas" | Reaproveita 100% do catálogo, autocomplete e telas existentes; uma oficina é só um "produto" com `natureza='servico'` e sem variação — menos uma tabela pra manter em sincronia |
| Etapas "Pré-inscrição"/"Inscrito" contam como "negociação" (`isNegociacao`) | Único jeito de reaproveitar o fluxo pronto de modal de ganho/valor/forma de pagamento e modal de motivo de perda em vez de construir uma UI de confirmação nova só pra Serviços |
| Toggle "Incluir Serviços" nos Insights foi **removido** depois de testado (2026-07-06) | Com "Todos funis" selecionado o toggle não fazia diferença perceptível pro usuário — os funis já são analisáveis separadamente pelo dropdown de funil, então o toggle era complexidade extra sem ganho real. Insights voltou a agregar todos os funis normalmente quando "Todos funis" está selecionado |
| Etapa "Cancelado" removida do funil Serviços (usuário editou no Config): perda passou a funcionar igual B2B (não move o card, só marca `resultado='perda'`) | Sem etapa própria pra desistência, mover o card pra um ID que não existe mais deixava o card "sumido" do Kanban (nenhuma coluna casava com o ID salvo). Reaproveitar o padrão já existente do B2B evita inventar um comportamento novo |
| `isNegociacao`/`isGanho`/`dropCard`/`confirmarGanho` para o funil Serviços checam **só pelo nome** da etapa (substring `'inscrição'`/`'inscrito'`/`'participou'`), zero referência a ID fixo (`ser-pre`/`ser-ins`/`ser-part`) | Renomear uma etapa existente no Config mantém o `id` original — então checar por ID fixo faz o código continuar tratando a etapa **renomeada** como se ainda fosse a original. Foi exatamente isso que causou um bug real: depois do usuário reorganizar as etapas, o card só avançava pra "Pré-inscrição" dando Ganho, porque o ID que o código achava que era "Inscrito" tinha sido renomeado pra "Pré-inscrição". Casar pelo nome atual elimina essa classe de bug por completo, mesmo que o usuário renomeie/reordene de novo no futuro |
| Aba Oficinas lê as etapas de `cfg.funis['servicos']` dinamicamente, em vez de uma lista fixa | Mesma razão acima — a tabela de relatório precisa acompanhar qualquer etapa que o usuário configurar, sem exigir alteração de código toda vez |
| Busca de cliente existente (`buscarClienteExistente`) ao criar um novo card, copiando dados de contato (não funil/etapa/histórico) | Um mesmo cliente pode aparecer em vários funis (ex: D2C e depois Serviços); evita redigitar telefone/email/CPF/endereço manualmente — mas cada participação continua sendo um card/linha separada no banco, então não copia nada específico daquela negociação |
| Estoque (`estoque`) chaveado por `(produto, cor, tamanho)`, ignorando `estampa` | A Pissilone só controla estoque da camiseta lisa — a estampa é aplicada sob demanda depois da venda, então duas vendas da mesma cor/tamanho com estampas diferentes devem consumir do mesmo saldo |
| Entrada de estoque sempre manual (input numérico direto na grade); saída automática só no Ganho, revertida automaticamente ao reabrir card ou editar o ganho | Pedido explícito do usuário: reposição de estoque é um evento físico (chegada de mercadoria) que só ele sabe registrar; já a saída deve seguir o fluxo de vendas existente sem esforço manual extra, e nunca ficar "presa" se um ganho for dado sem querer e revertido |
| 2ª compra no D2C **move** o card pro Pissifã (`moverParaPissifaAuto`), em vez de duplicar (`duplicarParaPissifaAuto`, removida em 2026-07-12) | O usuário queria histórico único por cliente (LTV/nº de compras corretos num card só), não dois cards com `neg_hist` dividido. Cards já duplicados antes dessa mudança foram deixados como estão (decisão consciente — não valia o risco de mesclar dados de produção manualmente); a proteção "não move se já existe outro card com o mesmo telefone no Pissifã" evita criar um 3º card pra quem já tem os 2 antigos. Como consequência, "Clientes novos" nos Insights passou a agrupar por **telefone** em vez de `id` de card (ver seção 11) |

---

## 13. Problemas Conhecidos e Soluções

### CRM fica em "Conectando..." infinitamente
**Causa:** Erro de sintaxe JavaScript (SyntaxError) que impede o carregamento.  
**Diagnóstico:** Abrir DevTools (F12) → Console → ver linha do erro.  
**Solução comum:** Template literal aninhado ou aspa simples dentro de string JS.

### Verificação rápida de saúde do arquivo
```javascript
// No arquivo index-github.html, contar backticks no script:
// Se ímpar → SyntaxError garantido
// Se par → provavelmente ok
```

### Atividade some após salvar
**Causa histórica:** Havia um filtro que rejeitava timestamps ISO (`2026-06-15T03:00:00.000Z`).  
**Solução atual:** `normDate()` converte qualquer formato em vez de rejeitar.

### Categoria/variação de produto não salva / erro ao salvar produto
**Causa:** as colunas `categoria` e `tem_variacao` na tabela `catalogo` precisam ser criadas manualmente — a REST API do Supabase não faz DDL.  
**Solução:** rodar uma vez no SQL Editor do Supabase:
```sql
ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS categoria text;
ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS tem_variacao boolean DEFAULT false;
```

### Erro `new row for relation "catalogo" violates check constraint "catalogo_tipo_check"` ao criar Produto
**Causa:** a tabela `catalogo` tem um CHECK constraint na coluna `tipo` que só permitia os valores originais (`estampa`/`cor`/`tamanho`) — `produto` foi adicionado depois e não está na lista permitida.  
**Solução:** rodar uma vez no SQL Editor do Supabase:
```sql
ALTER TABLE catalogo DROP CONSTRAINT catalogo_tipo_check;
ALTER TABLE catalogo ADD CONSTRAINT catalogo_tipo_check CHECK (tipo IN ('produto','estampa','cor','tamanho'));
```

### Catálogo não mostra a natureza (Produto/Serviço) ou dá erro ao salvar/marcar item como Serviço
**Causa:** a coluna `natureza` na tabela `catalogo` precisa ser criada manualmente — a REST API do Supabase não faz DDL.  
**Solução:** rodar uma vez no SQL Editor do Supabase o arquivo `supabase-migration-oficinas.sql` (raiz do projeto), ou direto:
```sql
alter table public.catalogo add column if not exists natureza text default 'produto';
update public.catalogo set natureza = 'produto' where natureza is null;
```

### Forma de pagamento aparece "Sem forma informada · 100%" no Insights mesmo após editar ganhos
**Causa:** em `renderInsights()`, o loop que monta `allNegs` a partir de `parseNegHist(c)` não copiava o campo `fp` do registro original para o objeto agregado — mesmo com `fp` gravado corretamente no Supabase (visível na lista de Ganhos), o Insights sempre lia `undefined`.  
**Solução:** incluir `fp:x.fp||''` no `allNegs.push(...)` dentro do `baseContatos.forEach` de `renderInsights()`.  
**Lição:** ao adicionar um novo campo em `neg_hist` (ex.: `fp`, `itens`), checar todos os pontos que reconstroem objetos de negociação a partir do histórico (`renderGanhosModal`, `renderInsights`, etc.) — cada um mantém sua própria cópia dos campos e é fácil esquecer um.

### "Editar contato" apagava o histórico de atividades/notas (`log_hist`) do card
**Causa:** `saveContato()` monta o objeto `c` enviado ao Supabase copiando campo a campo de `prev` (`prev.notas`, `prev.campos`, etc.), mas nunca incluía `log_hist` — toda vez que alguém editava um contato pelo modal "Editar contato" (bem comum: botão ✎ no Kanban, na lista de Contatos, ou no Detalhe), o `apiSave` gravava `log_hist:[]`, apagando silenciosamente todas as notas e atividades registradas anteriormente na Linha do Tempo.  
**Solução:** adicionar `log_hist:Array.isArray(prev.log_hist)?prev.log_hist.slice():[]` ao objeto `c` em `saveContato()`.  
**Lição:** qualquer função que reconstrua o objeto de contato a partir de campos de formulário (em vez de mutar o objeto existente) precisa copiar explicitamente TODOS os campos que não têm input no formulário, não só os "óbvios" — `log_hist` não aparece em nenhum campo do modal "Editar contato", por isso o esquecimento passou despercebido.

### Edição feita no CRM não aparece no site publicado
**Causa:** o arquivo `index-github.html` é editado localmente, mas o site (`github.io`) só reflete o que está no repositório — é preciso fazer upload/commit manual do arquivo atualizado.  
**Diagnóstico:** se um comportamento corrigido no código continua igual "ao vivo", confirmar se o arquivo foi de fato publicado (upload no GitHub) antes de investigar mais bugs.  
**Solução:** após editar `index-github.html`, subir o arquivo (substituindo `index.html`) no repositório `pissilone-crm`, aguardar 1-3 min e testar com Ctrl+Shift+R.

### Dados com funil/etapa trocados
**Causa:** Deleção de coluna na planilha Google Sheets (antes da migração).  
**Regra:** Nunca mais usar Google Sheets. Todos os dados estão no Supabase agora.

---

## 14. Código Fonte Atual

O código-fonte completo e sempre atualizado está em **`index-github.html`**, na raiz do repositório (arquivo único de HTML/CSS/JS, sem build, ~3050 linhas).

Este documento cobre **arquitetura, estrutura de dados e regras de desenvolvimento** — não uma cópia do código linha a linha. Colar o HTML inteiro aqui duplicaria ~200KB de código dentro do Markdown e garantiria que ele ficasse obsoleto de novo a cada edição (foi exatamente o que aconteceu com a versão anterior desta seção). Para consultar o código real, abra `index-github.html` diretamente.

Estrutura interna do arquivo, para orientação rápida:
- `<style>` (linhas iniciais) — variáveis de cor `:root{}` e todo o CSS (ver seção 8)
- `<body>` — sidebar de navegação, panes de cada aba (`#pane-funil`, `#pane-contatos`, `#pane-insights`, `#pane-catalogo`, `#pane-config`, `#pane-aniversario`, `#pane-log`) e todos os `<div class="overlay">` de modais
- `<script>` (final do arquivo) — nesta ordem: config Supabase (`sbGet`/`sbUpsert`/`sbDelete`), **autenticação** (login/sessão — seção 2.3 e seção 9), estado global (seção 4), helpers de data/formatação, config (`loadCfg`/`saveCfg`/`loadCatalogo`), sync de contatos (`doSync`/`apiSave`), tabs, kanban/drag&drop, resultado (ganho/perda), atividades, modal de contato, lista de contatos, insights, config (funis/etapas/usuários/campos), catálogo, importação CSV, modal de ganhos/NF, aniversários, log de uso, header/usuário ativo, `iniciarApp()` + bloco de inicialização `(async function(){...})()` no final (agora só chama `iniciarApp()` se já existir uma sessão salva válida — antes disso, fica na tela de login)

Arquivos adicionais na raiz do projeto (fora do `index-github.html`):
- `supabase-setup-auth.sql` — script de setup do login (rodar no SQL Editor do Supabase); exige estar logado pra ler/escrever, sem distinção de papel
- `supabase-migration-estoque.sql` / `supabase-migration-encomendas.sql` / `supabase-migration-oficinas.sql` / `supabase-migration-agente-ia.sql` — migrações incrementais rodadas uma vez cada no SQL Editor (a REST API do Supabase não faz DDL), na ordem em que as funcionalidades foram adicionadas
- `integracao-agente-http-e-api.md` — doc **da plataforma aa.app.br** (não escrito por nós) descrevendo como a ferramenta HTTP do agente de IA e a API de envio de mensagens funcionam; é o contrato que `supabase/functions/pissilone-agent/` implementa do lado do CRM (ver seção 15)
- `supabase/functions/manage-access/index.ts` — **não usado atualmente**, rascunho de uma versão com papéis (superadmin/gerente/consultor) que foi descartada por complexidade desnecessária pra 2 pessoas (ver seção 2.3); fica no repo pronto pra retomar se um dia for preciso
- `supabase/functions/pissilone-agent/` — Edge Function em uso, ponte entre o agente de IA e o CRM (ver seção 15)

Ao editar o código, siga as regras da seção 10 e depois de testar localmente, faça commit e aguarde o deploy do GitHub Pages (seção 10.5).

---

## 15. Agente de IA (aa.app.br) — Fase 1

### 15.1 Por quê

O CRM inteiro é client-side (navegador → Supabase REST direto). O agente de IA do WhatsApp (plataforma `aa.app.br`) não roda JS no navegador nem loga como usuário humano — ele só chama uma **ferramenta HTTP com URL/método/headers fixos**, configurada por quem monta o agente (contrato completo em `integracao-agente-http-e-api.md`). Por isso existe uma Edge Function nova, `supabase/functions/pissilone-agent/`, que é o único lugar do stack com código server-side.

**Fase 1** (implementada) cobre as ações que o agente usa **durante a conversa**: criar card, cadastrar cliente, verificar estoque (com envio de foto), montar um pedido com vários itens, dar ganho, dar perda, mover card, e atividades. **Fica pra uma Fase 2** (não implementada ainda): parabéns de aniversário e follow-up pós-venda automáticos — isso exige um cron rodando sozinho todo dia (infraestrutura de agendamento nova), e uma forma de marcar uma atividade como "pós-venda" (hoje não existe distinção de tipo de atividade no CRM).

### 15.2 Arquitetura

- **Uma Edge Function**, `supabase/functions/pissilone-agent/`, com rotas internas por path (`index.ts` faz o roteamento por `pathname`, não por function separada por rota).
  - `index.ts` — `Deno.serve`, valida o header `Authorization: Bearer <AGENT_API_TOKEN>` (secret próprio, não é um JWT do Supabase — por isso o deploy precisa de `--no-verify-jwt`), resolve a rota e despacha.
  - `lib.ts` — toda a lógica de negócio replicada em TypeScript: leitura/escrita de `contatos` no mesmo shape de `apiSave()`/`doSync()`, `parseNegHist`, roteamento de etapa por funil, estoque/encomendas, envio de mensagem (Parte 2 do doc da aa.app.br).
  - `routes.ts` — um handler por rota, cada um validando o corpo e chamando os helpers de `lib.ts`.
- **Auth:** usa `SUPABASE_SERVICE_ROLE_KEY` (injetada automaticamente pelo Supabase em toda Edge Function — não é um secret que a gente seta) pra bypassar RLS, porque o agente não tem sessão de usuário. Quem pode chamar a function é controlado só pelo `AGENT_API_TOKEN`.
- **Duplicação deliberada de lógica:** `lib.ts` replica em TypeScript as mesmas regras que já existem em `index-github.html` (`confirmarGanho()`, `confirmPerda()`, `saveAtv()`, `checkpointAtv()`, roteamento de etapa por funil, criação de `encomendas`, etc). **Se uma regra de negócio mudar no navegador (ex: pra onde um ganho do funil X vai depois), replique a mudança em `lib.ts`/`routes.ts` também** — não tem teste automatizado nem abstração compartilhada entre os dois lados hoje.
- **Casamento de contato por telefone:** o agente só tem `{{contact_phone}}` entre chamadas (não guarda o `id` interno do card), então toda rota que precisa achar um contato busca por telefone normalizado, comparando os **últimos 10-11 dígitos** (`telSuffixMatch()`) — não igualdade exata, porque `{{contact_phone}}` sempre vem com código de país (`55...`) e o `tel` salvo no CRM geralmente não tem.
- **Carrinho por telefone (`pedido_agente_pendente`):** como pedidos por WhatsApp costumam ter vários itens e o `[colchete]` da IA preenche texto simples (não array estruturado), o padrão é: `/adicionar-item-pedido` uma vez por item citado na conversa, `/dar-ganho` no fechamento lê tudo que foi acumulado pra aquele telefone. Ver seção 2.2.

### 15.3 Rotas

Todas em `POST`, corpo em JSON, exigem `Authorization: Bearer <AGENT_API_TOKEN>` (401 se faltar/errado). Sucesso = `2xx` + JSON; erro de validação = `4xx` + `{erro:"..."}`.

| Rota | Corpo | Espelha (navegador) |
|---|---|---|
| `/criar-card` | `{telefone, nome, canal?}` | `saveContato()` (criação) — idempotente por telefone, não duplica |
| `/cadastrar-cliente` | `{telefone, nome?, email?, cpf?, aniversario?, endereco?, cidade?, uf?, cep?, cod_marketup?}` | `saveContato()` (edição) — só sobrescreve campos enviados |
| `/estoque` | `{telefone, tamanho, produto?}` | `getEstoqueQtd()` + envia foto de cada cor disponível via API de mensagens (Parte 2) |
| `/adicionar-item-pedido` | `{telefone, produto, estampa?, cor?, tamanho?, qty?}` | `adicionarItemPedido()` — grava no carrinho (`pedido_agente_pendente`) |
| `/dar-ganho` | `{telefone, valor, forma_pagamento, data?}` | `confirmarGanho()` completo — usa o carrinho acumulado, roteia etapa por funil, desconta estoque, cria encomendas, duplica pro Pissifã se for a 2ª compra D2C |
| `/dar-perda` | `{telefone, motivo}` | `confirmPerda()` |
| `/mover-card` | `{telefone, etapa_nome}` | Move a etapa por nome (case-insensitive) dentro do funil atual do contato — genérico, não amarrado a ganho/perda |
| `/atividade/agendar` | `{telefone, data, descricao}` | `saveAtv()` |
| `/atividade/concluir` | `{telefone}` | `checkpointAtv()` |

### 15.4 Secrets necessários (Supabase → Project Settings → Edge Functions → Secrets, ou `supabase secrets set`)

| Secret | Pra quê |
|---|---|
| `AGENT_API_TOKEN` | Token estático que a aa.app.br manda no header `Authorization` de cada ferramenta configurada no agente. Gerado uma vez, colado nos dois lados (aqui e na configuração de cada tool do agente). |
| `AA_SEND_TOKEN` | Token da API de envio de mensagens da aa.app.br (Parte 2 do doc), gerado em `https://aa.app.br/settings/developers`. Usado só pelo endpoint `/estoque` pra mandar as fotos de cor. |
| `AA_INSTANCE_NAME` | Nome da instância de WhatsApp configurada na aa.app.br, exigido pela API de envio. |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` **não precisam ser setados** — toda Edge Function já recebe os dois automaticamente.

### 15.5 Deploy

```
supabase functions deploy pissilone-agent --no-verify-jwt --project-ref wrczcdroekxqsdwdbquf
```
Rodar `supabase-migration-agente-ia.sql` no SQL Editor **antes** do primeiro deploy (cria `pedido_agente_pendente`, a coluna `catalogo.foto_url` e a função `estoque_ajustar`).
