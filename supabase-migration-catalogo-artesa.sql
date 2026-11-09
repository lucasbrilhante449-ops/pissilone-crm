-- ============================================================
-- PSN CRM (Pissilone) — Artesã responsável pela peça
-- Projeto wrczcdroekxqsdwdbquf.
-- ============================================================
--
-- Peça feita à mão (crochê, macramê, bordado...) passa a dizer QUEM fez
-- e quanto a artesã recebe por unidade. É a base da tela "Impacto" dos
-- Insights (peças vendidas e valor pago por artesã).
--
-- "artesa_id": id da artesã cadastrada na Config do CRM (lista
--   cfg.artesas, dentro da tabela config). Texto, sem chave estrangeira,
--   mesmo padrão de canais/turmas.
-- "valor_pago_artesa": valor pago à artesã por unidade vendida (R$).
--
-- Vale para produto e para estampa (as peças de crochê do site estão
-- cadastradas como estampa de Camiseta). Na venda, vale o da estampa;
-- sem estampa, o do produto.
--
-- Aditivo e seguro: ADD COLUMN IF NOT EXISTS, sem default, sem backfill.
-- ============================================================

alter table public.catalogo add column if not exists artesa_id text;
alter table public.catalogo add column if not exists valor_pago_artesa numeric;

-- ============================================================
-- Fim. Depois de rodar, recarregue o CRM (Ctrl+Shift+R).
-- ============================================================
