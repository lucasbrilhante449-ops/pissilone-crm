-- ============================================================
-- PSN CRM (Pissilone) — Bucket de Storage p/ fotos de Catálogo
-- Rode este arquivo INTEIRO uma vez no SQL Editor do Supabase
-- (projeto wrczcdroekxqsdwdbquf), depois de
-- supabase-migration-catalogo-valor-estampa.sql.
-- ============================================================
--
-- O que isso faz: cria o bucket público "catalogo" no Supabase Storage
-- (guarda as fotos de estampa/cor enviadas pela aba Catálogo) e as
-- policies de RLS que deixam qualquer usuário logado no CRM (Ana/Lucas,
-- mesma sessão de Supabase Auth já usada em index-github.html) enviar/
-- sobrescrever/apagar arquivos direto do navegador — mesmo padrão
-- "authenticated" já usado em supabase-setup-auth.sql pras tabelas do
-- CRM. Leitura é pública porque a foto precisa ser acessível sem login
-- pela API de envio de imagem do WhatsApp (aa.app.br), que busca a URL
-- direto.
--
-- Sem passo manual no Dashboard — tudo criado aqui via SQL.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do nothing;

-- storage.objects já vem com RLS habilitado por padrão em todo projeto
-- Supabase — não precisa (nem dá) de "alter table ... enable row level
-- security" aqui.

drop policy if exists "catalogo_bucket_read_public" on storage.objects;
create policy "catalogo_bucket_read_public" on storage.objects
  for select to public using (bucket_id = 'catalogo');

drop policy if exists "catalogo_bucket_insert_authenticated" on storage.objects;
create policy "catalogo_bucket_insert_authenticated" on storage.objects
  for insert to authenticated with check (bucket_id = 'catalogo');

drop policy if exists "catalogo_bucket_update_authenticated" on storage.objects;
create policy "catalogo_bucket_update_authenticated" on storage.objects
  for update to authenticated using (bucket_id = 'catalogo') with check (bucket_id = 'catalogo');

drop policy if exists "catalogo_bucket_delete_authenticated" on storage.objects;
create policy "catalogo_bucket_delete_authenticated" on storage.objects
  for delete to authenticated using (bucket_id = 'catalogo');

-- ============================================================
-- Fim. URL pública de um arquivo enviado:
-- https://wrczcdroekxqsdwdbquf.supabase.co/storage/v1/object/public/catalogo/<path>
-- Teste o upload pela aba Catálogo depois de recarregar o painel.
-- ============================================================
