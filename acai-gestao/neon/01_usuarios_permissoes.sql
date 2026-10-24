-- ============================================================================
-- 01 · Usuários, convites e permissões por módulo × ação
--
-- Re-executável e NÃO destrutivo. Depende de 00_banco_neon.sql.
--
-- Ideia geral
--   • O PERFIL (profiles.role) continua sendo a base: admin / manager / cashier.
--   • Em cima dele, `role_permissions` diz o que cada perfil pode, e
--     `user_permissions` permite conceder/negar por usuário. A NEGAÇÃO
--     individual vence a concessão herdada; sem regra, nada é concedido.
--   • A autoridade é a função public.pode(modulo, acao) — usada pelo RLS e
--     espelhada pelo front (que só mostra/esconde; não é segurança).
--   • Contas NÃO nascem aqui: quem cria a conta é o Neon Auth. O app manda um
--     CONVITE (tabela `invites`); ao entrar, `garantir_perfil()` aplica o
--     convite (perfil + permissões). Nenhuma senha passa por este arquivo.
-- ============================================================================

-- ============================================================================
-- 1. Colunas novas em profiles
-- ============================================================================
alter table public.profiles add column if not exists email         text;
alter table public.profiles add column if not exists username      text;
alter table public.profiles add column if not exists last_login_at timestamptz;

-- E-mail único por organização (a conta em si é única no Neon Auth).
create unique index if not exists profiles_email_org_idx
  on public.profiles (organization_id, lower(email))
  where email is not null;

-- Preenche o e-mail dos perfis que já existiam, a partir da conta no Neon Auth.
-- Fica num bloco que engole o erro caso o papel dono de neon_auth.user não
-- permita a leitura: o e-mail é preenchido de novo no próximo login.
do $$
begin
  update public.profiles p
     set email = lower(u.email)
    from neon_auth.user u
   where u.id = p.id
     and (p.email is null or btrim(p.email) = '');
exception when others then
  raise notice 'Backfill de e-mail ignorado: %', sqlerrm;
end
$$;

-- ============================================================================
-- 2. Catálogo de perfis
-- ============================================================================
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  is_system   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.roles (name, description) values
  ('admin',   'Administrador — acesso administrativo completo.'),
  ('manager', 'Gerente — módulos autorizados, sem administração de usuários.'),
  ('cashier', 'Operador de caixa — operação do dia a dia.')
on conflict (name) do nothing;

-- ============================================================================
-- 3. Catálogo de permissões (módulos e ações REAIS do sistema)
-- ============================================================================
create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  module_key  text not null,
  action_key  text not null,
  description text not null default '',
  unique (module_key, action_key)
);

insert into public.permissions (module_key, action_key, description) values
  ('dashboard',    'ver',             'Abrir o Dashboard'),
  ('vendas',       'ver',             'Ver o menu e abrir Vendas'),
  ('vendas',       'consultar',       'Consultar pedidos e histórico'),
  ('vendas',       'criar',           'Registrar venda'),
  ('vendas',       'editar',          'Alterar pedido'),
  ('vendas',       'excluir',         'Excluir pedido'),
  ('estoque',      'ver',             'Ver o menu e abrir Estoque'),
  ('estoque',      'consultar',       'Consultar produtos e insumos'),
  ('estoque',      'criar',           'Cadastrar produto ou insumo'),
  ('estoque',      'editar',          'Alterar produto ou insumo'),
  ('estoque',      'excluir',         'Excluir produto ou insumo'),
  ('clientes',     'ver',             'Ver o menu e abrir Clientes'),
  ('clientes',     'consultar',       'Consultar clientes'),
  ('clientes',     'criar',           'Cadastrar cliente'),
  ('clientes',     'editar',          'Alterar cliente'),
  ('clientes',     'excluir',         'Excluir cliente'),
  ('financeiro',   'ver',             'Ver o menu e abrir Financeiro'),
  ('financeiro',   'consultar',       'Consultar lançamentos'),
  ('financeiro',   'criar',           'Registrar lançamento'),
  ('financeiro',   'editar',          'Alterar lançamento'),
  ('financeiro',   'excluir',         'Excluir lançamento'),
  ('configuracoes','ver',             'Ver a Configuração da Empresa'),
  ('configuracoes','editar',          'Alterar dados e logomarca da empresa'),
  ('usuarios',     'ver',             'Ver o Cadastro de Usuários'),
  ('usuarios',     'criar',           'Convidar novos usuários'),
  ('usuarios',     'editar',          'Alterar dados e perfil do usuário'),
  ('usuarios',     'desativar',       'Ativar ou desativar usuário'),
  ('usuarios',     'permissoes',      'Configurar permissões do usuário'),
  ('usuarios',     'redefinir_senha', 'Iniciar redefinição de senha'),
  ('permissoes',   'ver',             'Ver a tela de Permissões de Acesso'),
  ('permissoes',   'editar',          'Alterar as permissões dos perfis')
on conflict (module_key, action_key) do update set description = excluded.description;

-- ============================================================================
-- 4. Permissões por perfil
-- ============================================================================
create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id)       on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- Administrador: tudo.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r, public.permissions p
 where r.name = 'admin'
on conflict do nothing;

-- Gerente: todos os módulos de operação/gestão. NÃO administra usuários nem
-- permissões (não pode conceder privilégios superiores aos seus).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p
    on p.module_key in ('dashboard','vendas','estoque','clientes','financeiro','configuracoes')
 where r.name = 'manager'
on conflict do nothing;

-- Operador de caixa: só a operação do dia a dia. Sem financeiro, sem
-- configurações, sem usuários.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p
    on (p.module_key = 'dashboard' and p.action_key = 'ver')
    or (p.module_key = 'vendas'    and p.action_key in ('ver','consultar','criar'))
    or (p.module_key = 'estoque'   and p.action_key in ('ver','consultar'))
    or (p.module_key = 'clientes'  and p.action_key in ('ver','consultar','criar'))
 where r.name = 'cashier'
on conflict do nothing;

-- ============================================================================
-- 5. Permissões individuais (conceder/negar por usuário)
-- ============================================================================
create table if not exists public.user_permissions (
  user_id       uuid not null references public.profiles(id)    on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  allowed       boolean not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, permission_id)
);

-- ============================================================================
-- 6. Convites (a conta é criada pelo Neon Auth; aqui só a intenção)
-- ============================================================================
create table if not exists public.invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email            text not null,
  full_name        text not null,
  role             text not null default 'cashier' check (role in ('admin','manager','cashier')),
  is_active        boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  accepted_user_id uuid references public.profiles(id) on delete set null
);

create unique index if not exists invites_email_pendente_idx
  on public.invites (organization_id, lower(email))
  where accepted_at is null;

create table if not exists public.invite_permissions (
  invite_id     uuid not null references public.invites(id)     on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  allowed       boolean not null,
  primary key (invite_id, permission_id)
);

-- ============================================================================
-- 7. Trilha de auditoria (nunca guarda segredos)
-- ============================================================================
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid,
  actor_user_id   uuid,
  target_user_id  uuid,
  action          text not null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists audit_logs_org_data_idx
  on public.audit_logs (organization_id, created_at desc);

-- ============================================================================
-- 8. Funções — a autoridade do sistema
-- ============================================================================

-- Precedência: negação/concessão individual > concessão do perfil > nada.
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

-- Atalho: pode "ver" o módulo (usado para montar o menu).
create or replace function public.acesso_modulo(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.pode(p_modulo, 'ver'); $$;

-- Permissões efetivas do usuário logado (só as concedidas), em uma chamada.
create or replace function public.minhas_permissoes()
returns table (modulo text, acao text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.module_key, p.action_key
    from public.permissions p
   where public.pode(p.module_key, p.action_key)
   order by p.module_key, p.action_key;
$$;

-- Perfil do usuário logado, do jeito que o front espera.
create or replace function public.meu_perfil()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$ select * from public.profiles where id = (select auth.uid()); $$;

-- ------------------------------------------------------ administração ------

-- Lista usuários da organização + convites pendentes. Só admin.
create or replace function public.listar_usuarios()
returns table (
  id           uuid,
  full_name    text,
  email        text,
  username     text,
  role         text,
  is_active    boolean,
  aprovado_em  timestamptz,
  created_at   timestamptz,
  last_login_at timestamptz,
  pendente     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem listar usuários.' using errcode = '42501';
  end if;

  return query
    select pr.id, pr.full_name, pr.email, pr.username, pr.role, pr.is_active,
           pr.aprovado_em, pr.created_at, pr.last_login_at, false
      from public.profiles pr
     where pr.organization_id = public.minha_organizacao()
    union all
    select i.id, i.full_name, i.email, null::text, i.role, i.is_active,
           null::timestamptz, i.created_at, null::timestamptz, true
      from public.invites i
     where i.organization_id = public.minha_organizacao()
       and i.accepted_at is null
     order by 10, 2;
end;
$$;

-- Matriz completa de um usuário: catálogo + herdado do perfil + decisão
-- individual + efetivo. Só admin. (para a tela de Permissões)
create or replace function public.permissoes_do_usuario(alvo uuid)
returns table (
  modulo      text,
  acao        text,
  perfil      text,
  individual  boolean,
  efetivo     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  papel text;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem ver permissões de terceiros.' using errcode = '42501';
  end if;

  select role into papel from public.profiles
   where id = alvo and organization_id = public.minha_organizacao();

  return query
    select p.module_key, p.action_key, papel,
           (select up.allowed from public.user_permissions up
             where up.user_id = alvo and up.permission_id = p.id),
           coalesce(
             (select up.allowed from public.user_permissions up
               where up.user_id = alvo and up.permission_id = p.id),
             exists (select 1 from public.role_permissions rp
                       join public.roles r on r.id = rp.role_id
                      where r.name = papel and rp.permission_id = p.id),
             false
           )
      from public.permissions p
     order by p.module_key, p.action_key;
end;
$$;

-- Cria um convite (a conta em si nasce no Neon Auth, quando a pessoa entrar).
create or replace function public.convidar_usuario(
  p_email text,
  p_nome  text,
  p_role  text,
  p_permissoes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org      uuid := public.minha_organizacao();
  conv_id  uuid;
  item     jsonb;
  perm_id  uuid;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem convidar usuários.' using errcode = '42501';
  end if;

  if p_role not in ('admin','manager','cashier') then
    raise exception 'Perfil inválido: %', p_role using errcode = '22023';
  end if;

  if p_email is null or position('@' in p_email) < 2 then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;

  insert into public.invites (organization_id, email, full_name, role, created_by)
  values (org, lower(btrim(p_email)), btrim(p_nome), p_role, (select auth.uid()))
  returning id into conv_id;

  for item in select * from jsonb_array_elements(coalesce(p_permissoes, '[]'::jsonb)) loop
    select id into perm_id from public.permissions
     where module_key = item->>'modulo' and action_key = item->>'acao';

    if perm_id is not null then
      insert into public.invite_permissions (invite_id, permission_id, allowed)
      values (conv_id, perm_id, coalesce((item->>'permitido')::boolean, true))
      on conflict (invite_id, permission_id)
      do update set allowed = excluded.allowed;
    end if;
  end loop;

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (org, (select auth.uid()), null, 'convite_criado',
          jsonb_build_object('email', p_email, 'role', p_role));

  return conv_id;
end;
$$;

-- Cancela um convite ainda pendente.
create or replace function public.cancelar_convite(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo public.invites;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem cancelar convites.' using errcode = '42501';
  end if;

  delete from public.invites
   where id = p_id and organization_id = public.minha_organizacao() and accepted_at is null
  returning * into alvo;

  if alvo.id is null then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (organization_id, actor_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), 'convite_cancelado',
          jsonb_build_object('email', alvo.email));
end;
$$;

-- Altera nome e perfil de um usuário. Não muda a própria conta nem deixa um
-- administrador se rebaixar/perder o próprio acesso.
create or replace function public.atualizar_usuario(alvo uuid, p_nome text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar usuários.' using errcode = '42501';
  end if;

  if p_role not in ('admin','manager','cashier') then
    raise exception 'Perfil inválido: %', p_role using errcode = '22023';
  end if;

  if alvo = (select auth.uid()) and p_role <> (select role from public.profiles where id = alvo) then
    raise exception 'Um administrador não pode alterar o próprio perfil.' using errcode = '42501';
  end if;

  update public.profiles
     set full_name = left(btrim(p_nome), 120),
         role      = p_role
   where id = alvo
     and organization_id = public.minha_organizacao();

  if not found then
    raise exception 'Usuário não encontrado nesta organização.' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), alvo, 'usuario_atualizado',
          jsonb_build_object('nome', p_nome, 'role', p_role));
end;
$$;

-- Define (concede/nega) uma permissão individual.
create or replace function public.definir_permissao_usuario(
  alvo uuid, p_modulo text, p_acao text, p_permitido boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  perm_id uuid;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;

  if alvo = (select auth.uid()) and p_modulo in ('usuarios','permissoes') and p_permitido = false then
    raise exception 'Um administrador não pode remover o próprio acesso administrativo.' using errcode = '42501';
  end if;

  select id into perm_id from public.permissions
   where module_key = p_modulo and action_key = p_acao;
  if perm_id is null then
    raise exception 'Permissão inexistente: %.%', p_modulo, p_acao using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.profiles
     where id = alvo and organization_id = public.minha_organizacao()
  ) then
    raise exception 'Usuário não encontrado nesta organização.' using errcode = 'P0002';
  end if;

  insert into public.user_permissions (user_id, permission_id, allowed)
  values (alvo, perm_id, p_permitido)
  on conflict (user_id, permission_id)
  do update set allowed = excluded.allowed, updated_at = now();

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), alvo, 'permissao_alterada',
          jsonb_build_object('modulo', p_modulo, 'acao', p_acao, 'permitido', p_permitido));
end;
$$;

-- Remove a decisão individual (volta a valer o perfil).
create or replace function public.remover_permissao_usuario(alvo uuid, p_modulo text, p_acao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;

  delete from public.user_permissions up
   using public.permissions p
   where up.permission_id = p.id
     and up.user_id = alvo
     and p.module_key = p_modulo
     and p.action_key = p_acao;

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), alvo, 'permissao_restaurada',
          jsonb_build_object('modulo', p_modulo, 'acao', p_acao));
end;
$$;

-- Restaura todas as decisões individuais de um usuário (volta ao perfil).
create or replace function public.restaurar_permissoes_usuario(alvo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;

  delete from public.user_permissions where user_id = alvo;

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), alvo, 'permissoes_restauradas',
          jsonb_build_object('origem', 'perfil'));
end;
$$;

-- Lista a trilha de auditoria da organização.
create or replace function public.listar_auditoria(p_limite int default 100)
returns table (
  id uuid, action text, details jsonb, created_at timestamptz,
  actor text, alvo text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem ver a auditoria.' using errcode = '42501';
  end if;

  return query
    select a.id, a.action, a.details, a.created_at,
           pa.full_name, pt.full_name
      from public.audit_logs a
      left join public.profiles pa on pa.id = a.actor_user_id
      left join public.profiles pt on pt.id = a.target_user_id
     where a.organization_id = public.minha_organizacao()
     order by a.created_at desc
     limit greatest(1, least(coalesce(p_limite, 100), 500));
end;
$$;

-- ------------------------------------------------- garantir_perfil() ------
-- Mantém o comportamento anterior e ACRESCENTA: grava e-mail e último acesso,
-- e aplica um convite pendente para o e-mail da conta.
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
  conv  public.invites;
  linha public.profiles;
  ativo_inicial boolean := false;
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

  -- Convite pendente para este e-mail? Aplica perfil e permissoes.
  select * into conv
    from public.invites
   where organization_id = org
     and lower(email) = mail
     and accepted_at is null
   order by created_at desc
   limit 1;

  if conv.id is not null then
    ativo_inicial := conv.is_active;
  end if;

  insert into public.profiles (id, full_name, email, organization_id, role, is_active)
  values (uid, left(coalesce(nome, 'Usuario'), 120), mail, org, 'cashier', ativo_inicial)
  on conflict (id) do nothing;

  if conv.id is not null then
    update public.profiles
       set role = conv.role, is_active = conv.is_active, full_name = coalesce(nullif(conv.full_name,''), full_name)
     where id = uid;

    insert into public.user_permissions (user_id, permission_id, allowed)
    select uid, ip.permission_id, ip.allowed
      from public.invite_permissions ip
     where ip.invite_id = conv.id
    on conflict (user_id, permission_id)
    do update set allowed = excluded.allowed, updated_at = now();

    update public.invites
       set accepted_at = now(), accepted_user_id = uid
     where id = conv.id;

    insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
    values (org, uid, uid, 'convite_aceito', jsonb_build_object('email', mail));
  end if;

  -- "Ultimo acesso" = quando o app releu a sessao.
  update public.profiles set last_login_at = now() where id = uid;

  select * into linha from public.profiles where id = uid;
  return linha;
end;
$$;

-- ============================================================================
-- 9. Permissões de banco (GRANTs) e RLS
-- ============================================================================
-- O Neon concede INSERT/UPDATE/DELETE a `authenticated` em todas as tabelas do
-- schema public ao habilitar o Data API. Então aqui REVOGAMOS tudo e devolvemos
-- só o necessário — sem isso, qualquer logado poderia escrever direto em
-- user_permissions e escalar privilégio.

revoke all on public.roles, public.permissions, public.role_permissions,
              public.user_permissions, public.invites, public.invite_permissions,
              public.audit_logs
  from anonymous, authenticated;

-- Catálogo: leitura livre para quem está logado (não é sensível).
grant select on public.roles, public.permissions, public.role_permissions to authenticated;

-- O resto (user_permissions, invites, audit_logs) NÃO tem GRANT: só se chega
-- por RPC `security definer`, que checa `eh_admin()`.

alter table public.roles              enable row level security;
alter table public.permissions        enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.user_permissions   enable row level security;
alter table public.invites            enable row level security;
alter table public.invite_permissions enable row level security;
alter table public.audit_logs         enable row level security;

drop policy if exists catalogo_roles on public.roles;
create policy catalogo_roles on public.roles
  for select to authenticated using (true);

drop policy if exists catalogo_permissions on public.permissions;
create policy catalogo_permissions on public.permissions
  for select to authenticated using (true);

drop policy if exists catalogo_role_permissions on public.role_permissions;
create policy catalogo_role_permissions on public.role_permissions
  for select to authenticated using (true);

-- Funções: nada para o papel anônimo.
do $$
declare f text;
begin
  foreach f in array array[
    'public.pode(text, text)',
    'public.acesso_modulo(text)',
    'public.minhas_permissoes()',
    'public.meu_perfil()',
    'public.listar_usuarios()',
    'public.permissoes_do_usuario(uuid)',
    'public.convidar_usuario(text, text, text, jsonb)',
    'public.cancelar_convite(uuid)',
    'public.atualizar_usuario(uuid, text, text)',
    'public.definir_permissao_usuario(uuid, text, text, boolean)',
    'public.remover_permissao_usuario(uuid, text, text)',
    'public.restaurar_permissoes_usuario(uuid)',
    'public.listar_auditoria(integer)'
  ]
  loop
    execute format('revoke execute on function %s from public, anonymous', f);
    execute format('grant  execute on function %s to authenticated', f);
  end loop;
end
$$;

-- ============================================================================
-- 10. Conferência
-- ============================================================================
-- select count(*) as perfis from public.roles;
-- select count(*) as permissoes from public.permissions;
-- select count(*) as permissoes_por_perfil from public.role_permissions;
