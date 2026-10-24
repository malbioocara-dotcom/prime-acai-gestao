-- ============================================================================
-- Login_projetos — 01 · garantir_perfil()
-- ============================================================================
--
-- Cria/atualiza o perfil de quem acabou de entrar. Substitui o antigo trigger em
-- `auth.users` (do Supabase): no Neon Auth as contas vivem num schema gerenciado
-- (`neon_auth`), então o app chama esta função logo depois do login/cadastro.
--
-- Ela é `security definer` e FIXA o papel e a organização no BANCO — o navegador
-- não escolhe nada. Se o cliente mandasse `role: 'admin'`, o valor seria
-- ignorado.
--
-- Rode DEPOIS de `00_profiles.sql`.
-- ============================================================================

create or replace function public.garantir_perfil()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  org   uuid;
  nome  text;
  mail  text;
  linha public.profiles;
begin
  if uid is null then
    raise exception 'Sem sessao ativa.' using errcode = '42501';
  end if;

  select id into org from public.organizations order by created_at, id limit 1;
  if org is null then
    raise exception 'Nenhuma organizacao cadastrada.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)),
         lower(u.email)
    into nome, mail
    from neon_auth.user u
   where u.id = uid;

  -- Papel inicial: sempre 'cashier'. Um administrador promove depois.
  insert into public.profiles (id, full_name, email, organization_id, role, is_active, aprovado_em)
  values (uid, left(coalesce(nome, 'Usuario'), 120), mail, org, 'cashier', true, now())
  on conflict (id) do nothing;

  update public.profiles set last_login_at = now() where id = uid;

  select * into linha from public.profiles where id = uid;
  return linha;
end;
$$;

revoke execute on function public.garantir_perfil() from public, anonymous;
grant  execute on function public.garantir_perfil() to authenticated;

-- ============================================================================
-- FLUXO COM APROVAÇÃO (opcional)
-- ============================================================================
-- Se você quiser que TODA conta nova entre PENDENTE e dependa de um
-- administrador para liberar (é o fluxo com aprovação), troque o INSERT acima
-- por este:
--
--   insert into public.profiles (id, full_name, email, organization_id, role, is_active, aprovado_em)
--   values (uid, left(coalesce(nome, 'Usuario'), 120), mail, org, 'cashier', false, null)
--   on conflict (id) do nothing;
--
-- E ajuste a configuração do cliente:
--
--   configurarLogin({ aprovacaoManual: true })
--
-- Com isso, a tela de cadastro mostra "aguarde a aprovação", encerra a sessão e
-- volta para o login; e o app do administrador precisa de um fluxo próprio para
-- aprovar (`is_active = true`, `aprovado_em = now()`).
--
-- A leitura de perfis abaixo é o que permite ao admin listar os pendentes:
-- a política `perfis_leitura_admin` (em `00_profiles.sql`) já cobre isso.
-- ============================================================================
