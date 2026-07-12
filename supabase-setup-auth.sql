-- ============================================================
-- PSN CRM (Pissilone) — Login obrigatório (versão simples)
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf).
-- ============================================================
--
-- O que isso faz: exige estar logado (Supabase Auth) pra ler ou
-- escrever qualquer coisa no CRM. Sem distinção de papel por
-- enquanto — todo mundo que tiver login criado tem acesso total.
-- (Gerente/Consultor com permissões diferentes fica pra depois,
-- quando for realmente necessário.)
--
-- DEPOIS de rodar este arquivo, crie os logins direto no painel:
--   Authentication → Users → Add user
--   → um pra você, um pra Ana (email + senha).
-- Não precisa de mais nenhum passo em SQL depois disso.
-- ============================================================

-- ── Limpeza de uma tentativa anterior (com tabela de papéis) ──
-- Só roda se você chegou a rodar a versão antiga; se nunca rodou,
-- os "if exists"/"cascade" abaixo simplesmente não fazem nada.
--
-- Ordem importa: primeiro apagamos as POLÍTICAS antigas (que dependiam
-- das funções is_admin()/is_superadmin()/etc.), só depois as funções —
-- senão o Postgres recusa apagar uma função ainda usada por uma política
-- (foi exatamente o erro "cannot drop function is_admin() because other
-- objects depend on it" que apareceu). O "cascade" nas linhas de função
-- é uma segurança extra pra cobrir qualquer política que o loop abaixo
-- não tenha pego (ex: políticas na própria tabela perfis).

-- Remove QUALQUER política nessas 4 tabelas, sem depender do nome exato.
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('contatos','config','catalogo','usage_log')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.is_superadmin() cascade;
drop function if exists public.is_ativo() cascade;
drop function if exists public.auth_papel() cascade;
drop table if exists public.perfis cascade;

-- ── Liga RLS e libera tudo pra qualquer usuário logado (authenticated) ──
alter table public.contatos  enable row level security;
alter table public.config    enable row level security;
alter table public.catalogo  enable row level security;
alter table public.usage_log enable row level security;

create policy "contatos_authenticated"  on public.contatos  for all to authenticated using (true) with check (true);
create policy "config_authenticated"    on public.config    for all to authenticated using (true) with check (true);
create policy "catalogo_authenticated"  on public.catalogo  for all to authenticated using (true) with check (true);
create policy "usage_log_authenticated" on public.usage_log for all to authenticated using (true) with check (true);

-- ============================================================
-- Fim. Agora crie os 2 logins em Authentication → Users → Add user.
-- ============================================================
