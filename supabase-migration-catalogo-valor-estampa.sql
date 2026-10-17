-- ============================================================
-- PSN CRM (Pissilone) — Preço do produto + descrição da estampa
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf).
-- ============================================================
--
-- O que isso faz:
-- 1) Adiciona "valor" (numeric) na tabela catalogo — usado só em itens
--    tipo='produto'. É o preço da peça base (a estampa aplicada não muda
--    o preço, só a cor/tamanho variam por estoque — ver "Fluxo de venda
--    de camisa" no prompt da Maria). Fica NULL até o admin preencher na
--    aba Catálogo; enquanto NULL, o endpoint /catalogo/consultar da Edge
--    Function devolve valor:null e a Maria cai no fallback de faixa de
--    preço genérica do prompt (seção 4).
-- 2) Adiciona "descricao" (text) na tabela catalogo — usado só em itens
--    tipo='estampa'. É a "história" por trás da estampa (ex: a homenagem
--    ao poeta Antônio Francisco), hoje só cabe como 1-2 exemplos fixos no
--    prompt da Maria; com essa coluna, cada estampa cadastrada pode ter
--    sua própria história, sem precisar editar o prompt a cada estampa
--    nova.
--
-- (O link de foto da estampa reaproveita a coluna "foto_url" que já
-- existe na tabela desde supabase-migration-agente-ia.sql — sem coluna
-- nova pra isso, só passa a ser populada também pra tipo='estampa'.)
--
-- Aditivo e seguro: ADD COLUMN IF NOT EXISTS, sem default, sem backfill —
-- linhas existentes ficam com NULL.
-- ============================================================

alter table public.catalogo add column if not exists valor numeric;
alter table public.catalogo add column if not exists descricao text;

-- ============================================================
-- Fim. Depois de rodar, rode também supabase-setup-storage-catalogo.sql
-- (bucket de fotos) antes do deploy da Edge Function pissilone-agent que
-- usa a rota /catalogo/consultar.
-- ============================================================
