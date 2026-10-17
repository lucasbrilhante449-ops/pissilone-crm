-- ============================================================
-- PSN CRM (Pissilone) — Vínculo do Catálogo com a Nuvemshop
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf).
-- ============================================================
--
-- O que isso faz: adiciona "nuvemshop_produto_id" em catalogo — só
-- usada em tipo='estampa' (um produto da Nuvemshop, hoje, sempre
-- corresponde a uma estampa do CRM: produto="Camiseta" + estampa é o
-- resto do nome). Guarda o ID interno do produto na Nuvemshop, que
-- nunca muda mesmo se o nome for editado lá — é a chave real de
-- vínculo, não o nome (texto pode duplicar ou ser renomeado).
--
-- É o campo que fecha o ciclo de estoque único: o sync periódico
-- (Nuvemshop → CRM) e o desconto ao dar Ganho (CRM → Nuvemshop) usam
-- esse ID pra saber a qual produto da loja cada estampa corresponde.
-- ============================================================

alter table public.catalogo add column if not exists nuvemshop_produto_id text;

-- ============================================================
-- Fim. Depois de rodar, é só recarregar o CRM (Ctrl+Shift+R).
-- ============================================================
