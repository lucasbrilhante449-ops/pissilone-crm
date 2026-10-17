-- ============================================================
-- PSN CRM (Pissilone) — Webhook de Pedidos da Nuvemshop
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf).
-- ============================================================
--
-- O que isso faz: cria "nuvemshop_pedidos_processados", usada só pra
-- controle de idempotência — garante que o mesmo pedido da Nuvemshop
-- nunca vira card/ganho duas vezes, mesmo se o webhook disparar mais
-- de uma vez pro mesmo pedido (reentrega é normal em webhook). A rota
-- /webhook-nuvemshop-pedido da Edge Function tenta inserir o id do
-- pedido ANTES de processar; se a inserção falhar (unique violation),
-- é porque já foi processado, e a rota para ali sem fazer nada de novo.
--
-- Só a Edge Function (service_role) acessa essa tabela — por isso RLS
-- habilitado sem nenhuma policy pra usuário autenticado (mesmo padrão
-- de pedido_agente_pendente, ver supabase-migration-agente-ia.sql).
-- ============================================================

create table if not exists public.nuvemshop_pedidos_processados (
  order_id text primary key,
  processado_em timestamptz not null default now()
);

alter table public.nuvemshop_pedidos_processados enable row level security;
-- Sem policy nenhuma: só a Edge Function (service_role, que ignora RLS) acessa essa tabela.

-- ============================================================
-- Fim.
-- ============================================================
