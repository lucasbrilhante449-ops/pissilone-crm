-- ============================================================
-- PSN CRM (Pissilone) — Link da estampa no site
-- Projeto wrczcdroekxqsdwdbquf.
-- ============================================================
--
-- "url_site": endereço da página do produto na Nuvemshop vinculado à
-- estampa, espelhado pela Edge Function pissilone-agent (espelharProdutoNs).
-- O Catálogo do CRM usa no botão "Ver no site" / copiar link (atendimento
-- manda o link da compra pelo WhatsApp).
--
-- Aditivo e seguro: ADD COLUMN IF NOT EXISTS, sem default, sem backfill.
-- ============================================================

alter table public.catalogo add column if not exists url_site text;
