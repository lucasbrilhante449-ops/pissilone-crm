-- ============================================================
-- PSN CRM (Pissilone) — Funil "Serviços" (Oficinas)
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf).
-- ============================================================
--
-- O que isso faz: adiciona a coluna "natureza" na tabela catalogo,
-- para diferenciar itens que são Produto (camisetas etc.) de itens
-- que são Serviço (oficinas de pintura). Itens já existentes viram
-- 'produto' automaticamente (não quebra nada do que já existe).
--
-- A tabela catalogo já tem RLS habilitado com a policy
-- "catalogo_authenticated" (criada em supabase-setup-auth.sql),
-- então nenhuma policy nova é necessária aqui.
-- ============================================================

alter table public.catalogo add column if not exists natureza text default 'produto';
update public.catalogo set natureza = 'produto' where natureza is null;

-- ============================================================
-- Fim. Depois de rodar, é só recarregar o CRM (Ctrl+Shift+R).
-- ============================================================
