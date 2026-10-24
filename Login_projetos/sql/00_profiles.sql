-- ============================================================================
-- Login_projetos — 00 · Organizações e perfis
-- ============================================================================
--
-- Como aplicar: Neon Console -> SQL Editor -> cole este arquivo inteiro e rode.
-- É re-executável (pode rodar mais de uma vez sem erro).
--
-- PRÉ-REQUISITO: habilite o Data API na branch, com "Use Neon Auth" marcado.
-- Isso cria o schema `neon_auth` (onde vivem as contas). Este script referencia
-- `neon_auth.user`, então rode-o DEPOIS de habilitar o Data API/Auth.
--
-- O que este arquivo monta:
--   * tabela de organizações (uma linha por "conta"/loja/empresa);
--   * tabela de perfis (liga a conta do Neon Auth aos papéis do app);
--   * funções auxiliares (eh_admin, eh_gestor, minha_organizacao);
--   * GRANTs e RLS: cada um lê o próprio perfil; admin lê os da organização;
--     ninguém escreve papel/ativo pelo Data API.
--
-- Depois dele, rode `01_garantir_perfil.sql`, que cria o perfil de quem entra.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. Organizações
-- ============================================================================
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  created_at timestamptz not null default now()
);

-- Ajuste o nome para o seu projeto. Só cria se a tabela estiver vazia.
insert into public.organizations (nome)
select 'Minha Empresa'
where not exists (select 1 from public.organizations);

-- ============================================================================
-- 2. Perfis
-- ============================================================================
-- `id` é o mesmo id da conta em `neon_auth.user`. Papel e organização são
-- decididos no BANCO, nunca pelo navegador.
create table if not exists public.profiles (
  id              uuid primary key,
  full_name       text not null,
  email           text,
  organization_id uuid not null references public.organizations (id),
  role            text not null default 'cashier',
  is_active       boolean not null default true,
  aprovado_em     timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Reforço para bancos que já existiam sem alguma coluna.
alter table public.profiles add column if not exists full_name     text;
alter table public.profiles add column if not exists email         text;
alter table public.profiles add column if not exists organization_id uuid;
alter table public.profiles add column if not exists role          text not null default 'cashier';
alter table public.profiles add column if not exists is_active     boolean not null default true;
alter table public.profiles add column if not exists aprovado_em   timestamptz;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists created_at    timestamptz not null default now();
alter table public.profiles add column if not exists updated_at    timestamptz not null default now();

-- Saneamento de linhas antigas.
update public.profiles
   set organization_id = (select id from public.organizations order by created_at, id limit 1)
 where organization_id is null;

update public.profiles
   set full_name = 'Usuario'
 where full_name is null or btrim(full_name) = '';

alter table public.profiles alter column full_name       set not null;
alter table public.profiles alter column organization_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_valido') then
    alter table public.profiles
      add constraint profiles_role_valido check (role in ('admin', 'manager', 'cashier'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_nome_tamanho') then
    alter table public.profiles
      add constraint profiles_nome_tamanho check (char_length(full_name) between 1 and 120);
  end if;
end
$$;

create index if not exists profiles_organization_idx on public.profiles (organization_id);
create index if not exists profiles_role_idx         on public.profiles (role);

-- FK para a conta no neon_auth. Fica num bloco que engole o erro caso o papel
-- dono de `neon_auth.user` não permita a referência: a FK é um conforto (apaga
-- o perfil junto com a conta), não uma necessidade do app.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_usuario_fk') then
    alter table public.profiles
      add constraint profiles_usuario_fk
      foreign key (id) references neon_auth.user (id) on delete cascade;
  end if;
exception when others then
  raise notice 'FK profiles -> neon_auth.user nao criada: %', sqlerrm;
end
$$;

-- --------------------------------------------------------------- updated_at --
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.tocar_updated_at();

-- ============================================================================
-- 3. Funções auxiliares
-- ============================================================================
-- `auth.uid()` é do próprio Data API do Neon: devolve o claim `sub` do JWT como
-- UUID (o mesmo nome que o Supabase usava, então as políticas não mudam).
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
      and role = 'admin'
  );
$$;

create or replace function public.eh_gestor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
      and role in ('admin', 'manager')
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

-- ============================================================================
-- 4. GRANTs e RLS
-- ============================================================================
-- Papéis do Data API do Neon: `authenticated` (com JWT válido) e `anonymous`
-- (sem JWT). Diferente do Supabase, não existem `anon` nem `service_role`.
--
-- CUIDADO: se você marcou "Grant public schema access" ao habilitar o Data API,
-- o Neon concedeu SELECT/INSERT/UPDATE/DELETE em TODAS as tabelas para
-- `authenticated`. Isso daria UPDATE em `profiles.role` — o que a segurança
-- deste módulo proíbe. Por isso aqui REVOGAMOS o UPDATE amplo e concedemos só a
-- coluna `full_name`.

revoke all    on public.profiles from anonymous, authenticated;
grant  select on public.profiles to authenticated;
grant  update (full_name) on public.profiles to authenticated;

revoke all    on public.organizations from anonymous, authenticated;
grant  select on public.organizations to authenticated;

-- Funções: nada para o anônimo; o logado pode as auxiliares.
revoke execute on function public.eh_admin()          from public, anonymous;
revoke execute on function public.eh_gestor()         from public, anonymous;
revoke execute on function public.minha_organizacao() from public, anonymous;

grant  execute on function public.eh_admin()          to authenticated;
grant  execute on function public.eh_gestor()         to authenticated;
grant  execute on function public.minha_organizacao() to authenticated;

-- ------------------------------------------------------------------- RLS -----
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;

-- Perfis: cada um lê o próprio; admin lê os da mesma organização.
drop policy if exists perfis_leitura_propria on public.profiles;
create policy perfis_leitura_propria on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists perfis_leitura_admin on public.profiles;
create policy perfis_leitura_admin on public.profiles
  for select to authenticated
  using (public.eh_admin() and organization_id = public.minha_organizacao());

drop policy if exists perfis_atualizacao_propria on public.profiles;
create policy perfis_atualizacao_propria on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Organizações: só a própria.
drop policy if exists organizacoes_leitura on public.organizations;
create policy organizacoes_leitura on public.organizations
  for select to authenticated
  using (id = public.minha_organizacao());

-- ============================================================================
-- 5. Primeiro administrador
-- ============================================================================
-- O cadastro cria todo mundo como `cashier`. Depois que a primeira pessoa se
-- cadastrar e entrar (o perfil é criado pelo `garantir_perfil()`), promova-a a
-- administrador rodando, no SQL Editor:
--
--   update public.profiles
--      set role = 'admin', is_active = true, aprovado_em = now()
--    where email = 'voce@exemplo.com';
--
-- Feito isso, o painel de administração do seu app passa a poder promover os
-- demais (via RPC próprio, fora do escopo deste módulo).
-- ============================================================================
