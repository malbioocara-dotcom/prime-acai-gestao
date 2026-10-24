-- ============================================================================
-- 17 · Clientes e financeiro: RLS por permissão + bloqueio de perfis inativos
-- ============================================================================
-- Re-executável e NÃO destrutivo. Depende de 00 e 01.
--
-- A 00 deixou clientes e lançamentos liberados para qualquer conta autenticada.
-- A interface ocultava operações sem permissão, mas o Data API ainda aceitava
-- acesso direto. `pode()` também não verificava se o perfil continuava ativo.
--
-- Estas tabelas pertencem ao modelo atual de loja única e não têm organization_id.
-- As permissões limitam ações, mas não substituem isolamento entre organizações.
--
-- Reverter: neon/reverter_17_clientes_lancamentos_rls_permissoes.sql
-- ============================================================================

create or replace function public.pode(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with eu as (
    select id, role
      from public.profiles
     where id = (select auth.uid())
       and is_active
  ),
  perm as (
    select id
      from public.permissions
     where module_key = p_modulo
       and action_key = p_acao
  )
  select coalesce(
    (select up.allowed
       from public.user_permissions up, eu
      where up.user_id = eu.id
        and up.permission_id = (select id from perm)),
    (select true
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id, eu
      where r.name = eu.role
        and rp.permission_id = (select id from perm)),
    false
  );
$$;

create or replace function public.minha_organizacao()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id
    from public.profiles
   where id = (select auth.uid())
     and is_active;
$$;

-- Clientes -------------------------------------------------------------------
drop policy if exists usuario_clientes on public.clientes;
drop policy if exists clientes_leitura on public.clientes;
drop policy if exists clientes_criacao on public.clientes;
drop policy if exists clientes_edicao on public.clientes;
drop policy if exists clientes_exclusao on public.clientes;

create policy clientes_leitura on public.clientes
  for select to authenticated
  using ((select public.pode('clientes', 'consultar')));

create policy clientes_criacao on public.clientes
  for insert to authenticated
  with check ((select public.pode('clientes', 'criar')));

create policy clientes_edicao on public.clientes
  for update to authenticated
  using ((select public.pode('clientes', 'editar')))
  with check ((select public.pode('clientes', 'editar')));

create policy clientes_exclusao on public.clientes
  for delete to authenticated
  using ((select public.pode('clientes', 'excluir')));

-- Financeiro -----------------------------------------------------------------
drop policy if exists usuario_lancamentos on public.lancamentos;
drop policy if exists lancamentos_leitura on public.lancamentos;
drop policy if exists lancamentos_criacao on public.lancamentos;
drop policy if exists lancamentos_edicao on public.lancamentos;
drop policy if exists lancamentos_exclusao on public.lancamentos;

create policy lancamentos_leitura on public.lancamentos
  for select to authenticated
  using ((select public.pode('financeiro', 'consultar')));

create policy lancamentos_criacao on public.lancamentos
  for insert to authenticated
  with check ((select public.pode('financeiro', 'criar')));

create policy lancamentos_edicao on public.lancamentos
  for update to authenticated
  using ((select public.pode('financeiro', 'editar')))
  with check ((select public.pode('financeiro', 'editar')));

create policy lancamentos_exclusao on public.lancamentos
  for delete to authenticated
  using ((select public.pode('financeiro', 'excluir')));

notify pgrst, 'reload schema';
