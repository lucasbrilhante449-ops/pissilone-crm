-- ============================================================
-- PSN CRM (Pissilone) — Marcação "feito à mão"
-- Projeto wrczcdroekxqsdwdbquf.
-- ============================================================
--
-- "Feito à mão" não é categoria: uma camiseta com aplique de crochê continua
-- sendo Camiseta, uma peça de casa bordada continua sendo Linha Casa. Por isso
-- vira uma marcação no item do Catálogo (produto ou estampa), e os Insights
-- mostram, dentro de cada categoria, quanto das peças/faturamento foi feito à
-- mão.
--
-- NULL = ainda não informado (o espelhamento da Nuvemshop preenche estampa
-- nova pelo nome/categoria "Artesanais" do site; depois só muda à mão no CRM).
--
-- Backfill: estampas com crochê, macramê ou bordado no nome = true; demais
-- estampas = false. Produtos ficam NULL até alguém marcar.
-- ============================================================

alter table public.catalogo add column if not exists feito_a_mao boolean;

update public.catalogo
   set feito_a_mao = (nome ~* '(croch|macram|bordad)')
 where tipo = 'estampa' and feito_a_mao is null;
