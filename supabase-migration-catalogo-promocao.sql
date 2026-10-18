-- ============================================================
-- PSN CRM (Pissilone) — Preço original da estampa (promoção)
-- Projeto wrczcdroekxqsdwdbquf.
-- ============================================================
--
-- O valor da estampa no Catálogo é espelhado do site (espelharProdutoNs na
-- Edge Function pissilone-agent): é o preço que o cliente paga, ou seja, o
-- promocional quando houver. "valor_original" guarda o preço normal só
-- enquanto a estampa está em promoção no site (NULL quando não está) — o CRM
-- usa isso pra mostrar a tag "Promoção" e o preço "de".
--
-- Aditivo e seguro: ADD COLUMN IF NOT EXISTS, sem default, sem backfill.
-- ============================================================

alter table public.catalogo add column if not exists valor_original numeric;
