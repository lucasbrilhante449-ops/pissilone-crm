-- ============================================================
-- PSN CRM (Pissilone) — Ponto de Contato pós-venda (5 dias)
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf).
-- ============================================================
--
-- O que isso faz:
-- Cria "pontos_contato" — uma linha por venda que já gerou (ou vai gerar)
-- uma pesquisa de satisfação 5 dias após a compra. O "id" é o token que
-- vai na URL pública /avaliacao?tok=... mandada por WhatsApp (ver
-- api/cron/pontos-contato.js, api/avaliacao.js, api/avaliacao-enviar.js
-- no repositório — funções serverless da Vercel, fora do escopo da
-- Maria/agente de IA).
--
-- O "unique(venda_id)" trava no banco contra a mesma venda gerar duas
-- pesquisas (além do check em JS que já lê as vendas processadas antes
-- de criar uma nova linha).
-- ============================================================

create table if not exists public.pontos_contato (
  id text primary key,
  contato_id text not null,
  contato_nome text not null default '',
  contato_tel text not null default '',
  venda_id text not null,
  data_compra date,
  nota integer,
  respondido_em timestamptz,
  criado_em timestamptz not null default now(),
  unique(venda_id)
);

alter table public.pontos_contato enable row level security;
-- Sem policy nenhuma: só as funções serverless da Vercel (service_role,
-- que ignora RLS) acessam essa tabela — mesmo padrão de
-- pedido_agente_pendente em supabase-migration-agente-ia.sql.

-- ============================================================
-- Fim. Depois de rodar, configure as env vars da Vercel (SUPABASE_URL,
-- SUPABASE_SERVICE_ROLE_KEY, AA_SEND_TOKEN, AA_INSTANCE_NAME,
-- CRON_SECRET, PUBLIC_SITE_URL) e faça o deploy (git push).
-- ============================================================
