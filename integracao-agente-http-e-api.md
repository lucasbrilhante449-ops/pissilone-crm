# Integração: Ferramenta HTTP do Agente de IA + API de Mensagens

Este documento descreve **como funciona hoje** a ferramenta de requisição HTTP do agente
de IA e a API de envio de mensagens, para que você desenvolva os endpoints correspondentes
no seu sistema.

---

## Parte 1 — Ferramenta de Requisição HTTP do Agente de IA

O agente de IA pode chamar um endpoint HTTP durante a conversa. A requisição é **configurada
por quem cria o agente** (método, URL, cabeçalhos e corpo). Em tempo de execução, o agente
faz a chamada e — dependendo da configuração — usa a resposta para responder ao cliente.

O seu trabalho é **expor um endpoint** que receba essa requisição e devolva uma resposta.

### 1.1. Sistema de variáveis (`[ ]` e `{{ }}`)

Existem **duas sintaxes distintas** de placeholders, que podem ser usadas na **URL**, nos
**valores dos cabeçalhos** e no **corpo** da requisição:

#### `[ ]` — Colchetes: valores preenchidos pela IA
Cada `[algum_nome]` vira um **parâmetro que o modelo de IA preenche** com base na conversa
com o cliente. O nome dentro dos colchetes descreve o dado esperado.

- `[cep]` → a IA insere o CEP que o cliente informou no chat.
- `[cpf]` → a IA insere o CPF informado.
- `[numero_pedido]` → a IA insere o número do pedido citado na conversa.

> Ou seja: colchetes = **dado dinâmico extraído do diálogo**. Você recebe o valor já
> substituído; nunca recebe o `[cep]` literal.

#### `{{ }}` — Chaves: dados do contato, preenchidos pelo servidor
Cada `{{variavel}}` é substituído **no servidor** (não pela IA) por dados do contato /
CRM interno da plataforma. Variáveis disponíveis:

| Variável                 | Conteúdo                                          |
|--------------------------|---------------------------------------------------|
| `{{contact_name}}`       | Nome do contato                                   |
| `{{contact_phone}}`      | Telefone (somente dígitos, ex.: `5511999999999`)  |
| `{{pushName}}`           | Nome exibido no WhatsApp                           |
| `{{contact_agent}}`      | Atendente atribuído                               |
| `{{contact_department}}` | Departamento atribuído                            |
| `{{contact_funnel}}`     | Etapa atual do funil                              |
| `{{contact_funnel_emoji}}` | Emoji da etapa do funil                         |
| `{{contact_tags}}`       | Tags do contato (separadas por vírgula)           |
| `{{custom_<chave>}}`     | Qualquer campo personalizado (ex.: `{{custom_cnpj}}`) |

> Ou seja: chaves = **dado do contato já conhecido pela plataforma**. Você recebe o valor
> já substituído.

**Resumo:** `[colchetes]` = a IA preenche na hora; `{{chaves}}` = a plataforma preenche
com dados do contato. As duas podem coexistir na mesma requisição.

### 1.2. O que o seu endpoint recebe

- **Método:** `GET` ou `POST`.
- **URL:** com todos os placeholders **já substituídos** por valores reais.
- **Cabeçalhos:** os que forem configurados (útil para autenticação — veja 1.5).
- **Corpo** (apenas em `POST`), em um destes formatos:
  - **JSON** → `Content-Type: application/json`
  - **Form** → `Content-Type: application/x-www-form-urlencoded`
  - **Texto cru** → `Content-Type: text/plain`

**Exemplo — consulta (GET):**
Configuração da URL: `https://seu-crm.com/api/clientes/[cpf]`
Requisição recebida: `GET https://seu-crm.com/api/clientes/12345678900`

**Exemplo — criação (POST, JSON):**
Configuração do corpo:
```json
{ "nome": "{{contact_name}}", "telefone": "{{contact_phone}}", "produto": "[produto]" }
```
Corpo recebido:
```json
{ "nome": "Maria Silva", "telefone": "5511999999999", "produto": "Plano Premium" }
```

### 1.3. O que o seu endpoint deve retornar

- Retorne **JSON** (recomendado). O agente lê os campos do JSON e os usa para responder
  ao cliente em linguagem natural. Retorne dados objetivos e nomeados, ex.:
  ```json
  { "cep": "01001-000", "logradouro": "Praça da Sé", "cidade": "São Paulo", "uf": "SP" }
  ```
- **Código HTTP `2xx` = sucesso.** Qualquer código fora da faixa `200–299` é tratado como
  falha, e o agente informa ao cliente que não conseguiu obter a informação.
- Se a resposta **não** for JSON, ela é tratada como texto puro.
- **A resposta é truncada em ~8.000 caracteres.** Devolva apenas o necessário.

### 1.4. Restrições técnicas

- O endpoint precisa ser **público e acessível pela internet**, preferencialmente **HTTPS**.
  Endereços internos/privados (localhost, IPs de rede local, metadata de nuvem) são
  **bloqueados** por proteção contra SSRF.
- **Timeout:** 15 segundos por padrão (máximo 30 segundos). Responda dentro desse limite.
- Redirecionamentos para destinos internos/privados também são bloqueados.

### 1.5. Segurança dos seus endpoints

Proteja seus endpoints. A forma recomendada: exigir um **token estático** que quem configura
o agente adiciona como **cabeçalho** da ferramenta. Exemplo de cabeçalho configurado:

```
Authorization: Bearer SEU_TOKEN_DO_CRM
```

Seu endpoint valida esse token antes de processar a requisição.

### 1.6. Uso da resposta pelo agente (contexto)

Ao configurar a ferramenta, é possível escolher o comportamento da resposta:
- **Responder com o resultado** — o agente usa o JSON retornado para responder ao cliente
  (ex.: consulta de CEP, saldo, status de pedido). É quando o seu retorno importa.
- **Silenciosa** — o agente apenas executa e não responde nada (ex.: criar um registro no
  CRM, disparar um webhook). Nesses casos, o corpo da resposta não é usado — basta retornar
  `2xx`.

---

## Parte 2 — Enviar mensagens para o chat via API

Além de responder requisições do agente, você pode **enviar mensagens** para as conversas
de forma programática (ex.: notificações a partir do seu CRM).

### 2.1. Gerar um token de API

Gere um token em: **https://aa.app.br/settings/developers**

Use-o no cabeçalho `Authorization: Bearer <token>`.

### 2.2. Endpoint

```
POST https://aa.app.br/api/v1/send
```

### 2.3. Parâmetros (corpo JSON)

| Campo          | Obrigatório | Descrição                                                            |
|----------------|-------------|----------------------------------------------------------------------|
| `instanceName` | sim         | Nome da instância de WhatsApp que enviará a mensagem                  |
| `number`       | sim         | Número de destino (com DDI/DDD, ex.: `5511999999999`)                |
| `type`         | sim         | Um de: `text`, `image`, `video`, `document`, `audio`                 |
| `message`      | condicional | Texto da mensagem. **Obrigatório** para `text`; usado como legenda nos tipos de mídia |
| `mediaUrl`     | condicional | URL pública da mídia. **Obrigatório** para `image`/`video`/`document`/`audio` |
| `fileName`     | não         | Nome do arquivo (usado em `document`)                                |
| `mimetype`     | não         | Tipo MIME da mídia (ex.: `image/jpeg`, `application/pdf`)            |

### 2.4. Exemplo — texto

```bash
curl -X POST "https://aa.app.br/api/v1/send" \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "my-instance-name",
    "number": "5511999999999",
    "type": "text",
    "message": "Hello from API!"
  }'
```

### 2.5. Exemplo — mídia (imagem)

```bash
curl -X POST "https://aa.app.br/api/v1/send" \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "my-instance-name",
    "number": "5511999999999",
    "type": "image",
    "mediaUrl": "https://seu-cdn.com/imagem.jpg",
    "mimetype": "image/jpeg",
    "message": "Legenda opcional"
  }'
```

### 2.6. Respostas

- **Sucesso** — `200 OK`:
  ```json
  { "success": true, "data": { /* ... */ } }
  ```
- **Erros comuns:**
  | Código | Significado                                              |
  |--------|----------------------------------------------------------|
  | `401`  | Token ausente ou inválido                                |
  | `400`  | Payload inválido (campos faltando ou tipo incorreto)     |
  | `404`  | Instância não encontrada / inativa / sem token de acesso |
  | `429`  | Limite de requisições excedido                           |
  | `500`  | Erro interno ao enviar                                    |
