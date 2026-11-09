-- ============================================================
-- PSN CRM (Pissilone) — Leitura das pesquisas de NPS pelo CRM
-- Projeto wrczcdroekxqsdwdbquf.
-- ============================================================
--
-- "pontos_contato" (pesquisa de satisfação enviada 5 dias após a venda) foi
-- criada sem policy: só as funções da Vercel liam. Os Insights precisam ler
-- para mostrar a taxa de resposta do NPS (respostas ÷ vendas do período).
--
-- Libera SÓ LEITURA para usuário logado. Gravação continua exclusiva das
-- funções serverless (service_role), como antes.
--
-- Seguro de rodar mais de uma vez (drop policy if exists antes de criar).
-- ============================================================

drop policy if exists "pontos_contato_leitura" on public.pontos_contato;
create policy "pontos_contato_leitura" on public.pontos_contato
  for select to authenticated using (true);

-- ============================================================
-- Fim. Depois de rodar, recarregue o CRM (Ctrl+Shift+R).
-- ============================================================
