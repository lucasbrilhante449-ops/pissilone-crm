-- ============================================================
-- PSN CRM (Pissilone) — Limpeza de dados do estoque antes do
-- alinhamento com a Nuvemshop. Rode uma vez no SQL Editor do
-- Supabase (projeto wrczcdroekxqsdwdbquf).
-- ============================================================

-- 1) Nunca deve existir quantidade negativa no estoque (mesmo
--    internamente no CRM) — zera o que já tiver ficado negativo.
update public.estoque set quantidade = 0 where quantidade < 0;

-- 2) Padroniza a linha mal formatada "camisa"/"azul"/"m" (minúsculo,
--    criada por engano em algum momento) pro nome canônico
--    "Camiseta"/"Azul"/"M". Soma na linha canônica se ela já existir,
--    em vez de sobrescrever.
insert into public.estoque(produto,cor,tamanho,quantidade)
select 'Camiseta','Azul','M', greatest(0,quantidade)
from public.estoque where produto='camisa' and cor='azul' and tamanho='m'
on conflict (produto,cor,tamanho) do update set quantidade = estoque.quantidade + excluded.quantidade;

delete from public.estoque where produto='camisa' and cor='azul' and tamanho='m';

-- 3) Mescla "Coral / Laranja" dentro de "Laranja" (mesma cor física,
--    cadastrada duas vezes por engano) — soma o estoque de cada
--    tamanho, não descarta nenhuma peça contada.
insert into public.estoque(produto,cor,tamanho,quantidade)
select produto, 'Laranja', tamanho, greatest(0,quantidade)
from public.estoque where cor='Coral / Laranja'
on conflict (produto,cor,tamanho) do update set quantidade = estoque.quantidade + excluded.quantidade;

delete from public.estoque where cor='Coral / Laranja';
delete from public.catalogo where tipo='cor' and nome='Coral / Laranja';

-- 4) Rede de segurança final, caso alguma soma acima resulte negativa
--    por algum motivo inesperado.
update public.estoque set quantidade = greatest(quantidade,0) where quantidade < 0;

-- 5) A partir de agora, estoque_ajustar() (usada pelo webhook da
--    Nuvemshop e pelo agente de IA) nunca deixa a quantidade ir
--    abaixo de 0 — substitui a versão criada em
--    supabase-migration-agente-ia.sql.
create or replace function public.estoque_ajustar(p_produto text, p_cor text, p_tamanho text, p_delta integer)
returns void language sql as $$
  insert into public.estoque(produto,cor,tamanho,quantidade)
  values (p_produto,p_cor,p_tamanho,greatest(0,p_delta))
  on conflict (produto,cor,tamanho)
  do update set quantidade = greatest(0, estoque.quantidade + p_delta);
$$;

-- ============================================================
-- Fim. Depois de rodar, recarregue o CRM (Ctrl+Shift+R).
-- ============================================================
