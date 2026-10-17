-- ============================================================
-- PSN CRM (Pissilone) — Vínculo com Nuvemshop: 1 estampa pode ter N produtos
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf).
-- ============================================================
--
-- Correção do campo criado em supabase-migration-nuvemshop-vinculo-catalogo.sql:
-- na prática, uma estampa às vezes está cadastrada em MAIS DE UM produto na
-- Nuvemshop (ex: "Bonitinha da Cobal" tem um produto pra Azul/Branco e outro
-- separado só pra Rosa — mesma estampa, dois product_id diferentes). Um campo
-- de texto único não dá conta disso.
--
-- "nuvemshop_produto_ids" substitui "nuvemshop_produto_id": guarda um JSON
-- array de product_id em texto, ex: '["220822465","220823740"]'. Migra os 3
-- vínculos já feitos automaticamente antes de apagar a coluna antiga.
-- ============================================================

alter table public.catalogo add column if not exists nuvemshop_produto_ids text;

update public.catalogo
set nuvemshop_produto_ids = '["' || nuvemshop_produto_id || '"]'
where nuvemshop_produto_id is not null and nuvemshop_produto_ids is null;

alter table public.catalogo drop column if exists nuvemshop_produto_id;

-- ============================================================
-- Fim.
-- ============================================================
