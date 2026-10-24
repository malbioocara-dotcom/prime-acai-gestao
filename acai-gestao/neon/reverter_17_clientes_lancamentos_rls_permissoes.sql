-- ============================================================================
-- REVERSÃO da migração 17 · restaura o acesso permissivo anterior
-- ============================================================================
-- ⚠ Reabre acesso de leitura e escrita de clientes e lançamentos a qualquer
-- conta autenticada e permite que perfis inativos continuem usando políticas
-- baseadas em `pode()` e `minha_organizacao()`. Use apenas para diagnóstico.
-- ============================================================================

drop policy if exists clientes_leitura on public.clientes;
drop policy if exists clientes_criacao on public.clientes;
drop policy if exists clientes_edicao on public.clientes;
drop policy if exists clientes_exclusao on public.clientes;
drop policy if exists usuario_clientes on public.clientes;
create policy usuario_clientes on public.clientes
  for all to authenticated using (true) with check (true);

drop policy if exists lancamentos_leitura on public.lancamentos;
drop policy if exists lancamentos_criacao on public.lancamentos;
drop policy if exists lancamentos_edicao on public.lancamentos;
drop policy if exists lancamentos_exclusao on public.lancamentos;
drop policy if exists usuario_lancamentos on public.lancamentos;
create policy usuario_lancamentos on public.lancamentos
  for all to authenticated using (true) with check (true);

create or replace function public.pode(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with eu as (
    select id, role from public.profiles where id = (select auth.uid())
  ),
  perm as (
    select id from public.permissions
     where module_key = p_modulo and action_key = p_acao
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
  select organization_id from public.profiles where id = (select auth.uid());
$$;

notify pgrst, 'reload schema';
