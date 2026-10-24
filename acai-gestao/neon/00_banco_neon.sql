-- ============================================================================
-- Prime Açaí · Gestão — banco no Neon (script único)
--
-- Como aplicar: Neon Console -> SQL Editor -> cole este arquivo inteiro e rode.
-- É re-executável: pode rodar mais de uma vez sem erro.
--
-- PRÉ-REQUISITO: habilite o Data API na branch, com "Use Neon Auth" marcado.
-- Isso cria o schema `neon_auth` (onde vivem as contas). Este script referencia
-- `neon_auth.user`, então rode-o DEPOIS de habilitar o Data API/Auth.
--
-- ATENÇÃO: a seção 10 (seed) APAGA os dados das tabelas de negócio antes de
-- inserir. Rode este script em desenvolvimento; em produção, comente a seção 10.
--
-- Mapa rápido (o que veio do Supabase e o que mudou):
--   01_schema.sql  -> seções 2, 3 e 8   (idêntico; Postgres puro)
--   02_seed.sql    -> seção 10          (idêntico)
--   03_rls.sql     -> seção 9           (papel `anon` -> `anonymous`; sem service_role)
--   04_usuarios.sql-> seções 4, 5 e 9   (auth.users -> neon_auth.user; trigger -> garantir_perfil())
--   06_empresa.sql -> seção 6           (mesmo RLS)
--   07_storage.sql -> seção 7           (bucket `logos` -> tabela company_logos)
-- ============================================================================

-- ============================================================================
-- 1. Extensões
-- ============================================================================
-- gen_random_uuid() já é do core (PG13+); a extensão fica só por segurança.
create extension if not exists "pgcrypto";

-- ============================================================================
-- 2. Tabelas de negócio
-- ============================================================================
create table if not exists public.produtos (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null unique,
  nome       text not null,
  categoria  text not null,
  quantidade numeric(12, 3) not null default 0 check (quantidade >= 0),
  minimo     numeric(12, 3) not null default 0 check (minimo >= 0),
  unidade    text not null default 'un',
  custo      numeric(12, 2) not null default 0 check (custo >= 0),
  preco      numeric(12, 2) not null default 0 check (preco >= 0),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table if not exists public.clientes (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nome        text not null,
  telefone    text,
  email       text,
  desde       date not null default current_date,
  tier        text not null default 'Novo'
              check (tier in ('Novo', 'Recorrente', 'VIP')),
  observacoes text,
  criado_em   timestamptz not null default now()
);

create table if not exists public.vendas (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null unique,
  cliente_id uuid references public.clientes (id) on delete set null,
  status     text not null default 'Aguardando'
             check (status in ('Aguardando', 'Em preparo', 'Concluída', 'Cancelada')),
  pagamento  text not null default 'Pix'
             check (pagamento in ('Pix', 'Crédito', 'Débito', 'Dinheiro', 'Misto')),
  total      numeric(12, 2) not null default 0 check (total >= 0),
  criado_em  timestamptz not null default now()
);

create table if not exists public.itens_venda (
  id             uuid primary key default gen_random_uuid(),
  venda_id       uuid not null references public.vendas (id) on delete cascade,
  produto_id     uuid references public.produtos (id) on delete set null,
  descricao      text not null,
  quantidade     numeric(12, 3) not null default 1 check (quantidade > 0),
  preco_unitario numeric(12, 2) not null default 0 check (preco_unitario >= 0)
);

create table if not exists public.lancamentos (
  id        uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria text not null,
  tipo      text not null check (tipo in ('entrada', 'saida')),
  valor     numeric(12, 2) not null check (valor >= 0),
  forma     text,
  data      date not null default current_date,
  criado_em timestamptz not null default now()
);

-- ============================================================================
-- 3. Índices
-- ============================================================================
create index if not exists idx_vendas_criado_em     on public.vendas (criado_em desc);
create index if not exists idx_vendas_cliente       on public.vendas (cliente_id);
create index if not exists idx_vendas_status        on public.vendas (status);
create index if not exists idx_itens_venda_venda    on public.itens_venda (venda_id);
create index if not exists idx_itens_venda_produto  on public.itens_venda (produto_id);
create index if not exists idx_produtos_ativo       on public.produtos (ativo);
create index if not exists idx_lancamentos_data     on public.lancamentos (data desc);

-- ============================================================================
-- 4. Organizações e perfis
-- ============================================================================
-- Antes: profiles.id -> auth.users(id). Agora as contas vivem em neon_auth.user
-- (schema criado pelo Managed Better Auth). O papel e a organização continuam
-- sendo decididos no BANCO, nunca pelo navegador.
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  created_at timestamptz not null default now()
);

insert into public.organizations (nome)
select 'Prime Açaí'
where not exists (select 1 from public.organizations);

create table if not exists public.profiles (
  id              uuid primary key,
  full_name       text not null,
  organization_id uuid not null references public.organizations(id),
  role            text not null default 'cashier',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name       text;
alter table public.profiles add column if not exists organization_id uuid;
alter table public.profiles add column if not exists role            text not null default 'cashier';
alter table public.profiles add column if not exists is_active       boolean not null default true;
alter table public.profiles add column if not exists created_at      timestamptz not null default now();
alter table public.profiles add column if not exists updated_at      timestamptz not null default now();

update public.profiles
   set organization_id = (select id from public.organizations order by created_at, id limit 1)
 where organization_id is null;

update public.profiles set full_name = 'Usuário' where full_name is null or btrim(full_name) = '';

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

-- Chave estrangeira para a conta no neon_auth. Fica num bloco que engole o erro
-- caso o papel dono do neon_auth.user não permita a referência: a FK é um
-- conforto (apaga o perfil junto com a conta), não uma necessidade do app.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_usuario_fk') then
    alter table public.profiles
      add constraint profiles_usuario_fk
      foreign key (id) references neon_auth.user (id) on delete cascade;
  end if;
exception when others then
  raise notice 'FK profiles -> neon_auth.user não criada: %', sqlerrm;
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
-- 5. Funções (papéis, organização e criação do perfil)
-- ============================================================================
-- `auth.uid()` é do próprio Data API do Neon: devolve o claim `sub` do JWT como
-- UUID. É o mesmo nome que o Supabase usava, então as políticas não mudam.
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

-- Antes era um trigger em auth.users. O Neon Auth cria as contas em
-- neon_auth.user, um schema gerenciado; em vez de pendurar um trigger lá, o app
-- chama esta função logo depois do login/cadastro. Ela é `security definer` e
-- fixa papel ('cashier') e organização no BANCO — o navegador não escolhe nada.
create or replace function public.garantir_perfil()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  org  uuid;
  nome text;
  linha public.profiles;
begin
  if uid is null then
    raise exception 'Sem sessão ativa.' using errcode = '42501';
  end if;

  select id into org from public.organizations order by created_at, id limit 1;
  if org is null then
    raise exception 'Nenhuma organização cadastrada.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1))
    into nome
    from neon_auth.user u
   where u.id = uid;

  insert into public.profiles (id, full_name, organization_id, role, is_active)
  values (uid, left(coalesce(nome, 'Usuário'), 120), org, 'cashier', true)
  on conflict (id) do nothing;

  select * into linha from public.profiles where id = uid;
  return linha;
end;
$$;

-- Só admin muda papel / ativa conta. Continuam existindo para a promoção pelo
-- SQL Editor sem abrir a coluna `role` para escrita direta.
create or replace function public.definir_papel_do_usuario(alvo uuid, novo_papel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar papéis.' using errcode = '42501';
  end if;

  if novo_papel not in ('admin', 'manager', 'cashier') then
    raise exception 'Papel inválido: %', novo_papel using errcode = '22023';
  end if;

  if alvo = (select auth.uid()) then
    raise exception 'Um administrador não pode alterar o próprio papel.' using errcode = '42501';
  end if;

  update public.profiles
     set role = novo_papel
   where id = alvo
     and organization_id = public.minha_organizacao();

  if not found then
    raise exception 'Usuário não encontrado nesta organização.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.definir_ativo_do_usuario(alvo uuid, ativo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem ativar ou desativar usuários.' using errcode = '42501';
  end if;

  if alvo = (select auth.uid()) then
    raise exception 'Um administrador não pode desativar a própria conta.' using errcode = '42501';
  end if;

  update public.profiles
     set is_active = ativo
   where id = alvo
     and organization_id = public.minha_organizacao();

  if not found then
    raise exception 'Usuário não encontrado nesta organização.' using errcode = 'P0002';
  end if;
end;
$$;

-- ============================================================================
-- 6. Configuração da empresa
-- ============================================================================
create table if not exists public.company_settings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null unique
                        default public.minha_organizacao()
                        references public.organizations(id) on delete cascade,

  nome_fantasia       text,
  razao_social        text,
  cnpj                text,
  inscricao_estadual  text,
  inscricao_municipal text,

  telefone            text,
  whatsapp            text,
  email               text,
  site                text,

  cep                 text,
  uf                  text,
  municipio           text,
  bairro              text,
  logradouro          text,
  numero              text,
  complemento         text,
  referencia          text,

  moeda               text not null default 'BRL',
  fuso                text not null default 'America/Fortaleza',
  formato_data        text not null default 'DD/MM/AAAA',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.company_settings add column if not exists nome_fantasia       text;
alter table public.company_settings add column if not exists razao_social        text;
alter table public.company_settings add column if not exists cnpj                text;
alter table public.company_settings add column if not exists inscricao_estadual  text;
alter table public.company_settings add column if not exists inscricao_municipal text;
alter table public.company_settings add column if not exists telefone            text;
alter table public.company_settings add column if not exists whatsapp            text;
alter table public.company_settings add column if not exists email               text;
alter table public.company_settings add column if not exists site                text;
alter table public.company_settings add column if not exists cep                 text;
alter table public.company_settings add column if not exists uf                  text;
alter table public.company_settings add column if not exists municipio           text;
alter table public.company_settings add column if not exists bairro              text;
alter table public.company_settings add column if not exists logradouro          text;
alter table public.company_settings add column if not exists numero              text;
alter table public.company_settings add column if not exists complemento         text;
alter table public.company_settings add column if not exists referencia          text;
alter table public.company_settings add column if not exists moeda               text not null default 'BRL';
alter table public.company_settings add column if not exists fuso                text not null default 'America/Fortaleza';
alter table public.company_settings add column if not exists formato_data        text not null default 'DD/MM/AAAA';
alter table public.company_settings add column if not exists created_at          timestamptz not null default now();
alter table public.company_settings add column if not exists updated_at          timestamptz not null default now();

update public.company_settings
   set organization_id = (select id from public.organizations order by created_at, id limit 1)
 where organization_id is null;

alter table public.company_settings alter column organization_id set not null;
alter table public.company_settings alter column moeda           set default 'BRL';
alter table public.company_settings alter column fuso            set default 'America/Fortaleza';
alter table public.company_settings alter column formato_data    set default 'DD/MM/AAAA';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_settings_organizacao_unica') then
    alter table public.company_settings
      add constraint company_settings_organizacao_unica unique (organization_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_settings_nome_tamanho') then
    alter table public.company_settings
      add constraint company_settings_nome_tamanho
      check (nome_fantasia is null or char_length(nome_fantasia) <= 160);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_settings_moeda_valida') then
    alter table public.company_settings
      add constraint company_settings_moeda_valida check (moeda in ('BRL'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_settings_formato_valido') then
    alter table public.company_settings
      add constraint company_settings_formato_valido
      check (formato_data in ('DD/MM/AAAA', 'AAAA-MM-DD'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_settings_fuso_valido') then
    alter table public.company_settings
      add constraint company_settings_fuso_valido check (fuso ~ '^[A-Za-z]+/[A-Za-z_+-]+$');
  end if;
end
$$;

drop trigger if exists company_settings_updated_at on public.company_settings;
create trigger company_settings_updated_at
  before update on public.company_settings
  for each row execute function public.tocar_updated_at();

-- ============================================================================
-- 7. Logomarca (substitui o Storage)
-- ============================================================================
-- O Neon não tem bucket. A imagem (até 2 MB) é guardada aqui como base64, uma
-- linha por organização. O app monta um data URL para exibir. O RLS desta tabela
-- é o mesmo da configuração da empresa: lê quem é da organização, escreve só
-- admin/gerente.
create table if not exists public.company_logos (
  organization_id uuid primary key
                    default public.minha_organizacao()
                    references public.organizations(id) on delete cascade,
  mime            text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  -- base64 de no máximo 2 MB (~2,8 MB em base64). O limite real também é
  -- conferido no navegador, antes de subir.
  conteudo        text not null check (octet_length(conteudo) <= 2900000),
  atualizado_em   timestamptz not null default now()
);

-- A coluna de data aqui se chama `atualizado_em` (não `updated_at`), então este
-- gatilho tem função própria — e ela precisa existir ANTES do `create trigger`.
create or replace function public.tocar_updated_at_company_logos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists company_logos_updated_at on public.company_logos;
create trigger company_logos_updated_at
  before update on public.company_logos
  for each row execute function public.tocar_updated_at_company_logos();

-- ============================================================================
-- 8. Views de leitura
-- ============================================================================
-- security_invoker = on (PG15+): a view roda com as permissões de quem consulta
-- e passa pelo RLS das tabelas de baixo.
drop view if exists public.vw_clientes_resumo;
create or replace view public.vw_clientes_resumo as
select
  c.id,
  c.codigo,
  c.nome,
  c.telefone,
  c.email,
  c.desde,
  c.tier,
  count(v.id) filter (where v.status <> 'Cancelada')                 as pedidos,
  coalesce(sum(v.total) filter (where v.status <> 'Cancelada'), 0)  as total,
  max(v.criado_em)::date                                            as ultima_compra
from public.clientes c
left join public.vendas v on v.cliente_id = c.id
group by c.id;
alter view public.vw_clientes_resumo set (security_invoker = on);

drop view if exists public.vw_resumo;
create or replace view public.vw_resumo as
select
  (select coalesce(sum(total), 0) from public.vendas
     where status <> 'Cancelada'
       and criado_em >= date_trunc('month', current_date))       as faturamento_mes,
  (select coalesce(sum(total), 0) from public.vendas
     where status <> 'Cancelada'
       and criado_em::date = current_date)                       as faturamento_hoje,
  (select count(*) from public.vendas
     where criado_em::date = current_date)                       as vendas_hoje,
  (select count(*) from public.vendas
     where status = 'Cancelada'
       and criado_em::date = current_date)                       as cancelamentos_hoje,
  (select coalesce(avg(total), 0) from public.vendas
     where status <> 'Cancelada')                                as ticket_medio,
  (select count(*) from public.clientes)                         as total_clientes,
  (select count(*) from public.clientes
     where desde >= current_date - 30)                           as novos_clientes,
  (select count(*) from public.clientes where tier = 'VIP')       as clientes_vip,
  (select coalesce(sum(quantidade * custo), 0) from public.produtos
     where ativo)                                                as valor_estoque,
  (select count(*) from public.produtos
     where ativo and quantidade < minimo)                        as itens_abaixo_minimo;
alter view public.vw_resumo set (security_invoker = on);

drop view if exists public.vw_faturamento_diario;
create or replace view public.vw_faturamento_diario as
select
  criado_em::date as dia,
  sum(total)      as total
from public.vendas
where status <> 'Cancelada'
  and criado_em >= current_date - 30
group by 1
order by 1;
alter view public.vw_faturamento_diario set (security_invoker = on);

drop view if exists public.vw_vendas_por_categoria;
create or replace view public.vw_vendas_por_categoria as
select
  p.categoria,
  sum(i.quantidade * i.preco_unitario) as total
from public.itens_venda i
join public.vendas v   on v.id = i.venda_id and v.status <> 'Cancelada'
join public.produtos p on p.id = i.produto_id
group by 1
order by 2 desc;
alter view public.vw_vendas_por_categoria set (security_invoker = on);

drop view if exists public.vw_fluxo_mensal;
create or replace view public.vw_fluxo_mensal as
select
  date_trunc('month', data)::date as mes,
  coalesce(sum(valor) filter (where tipo = 'entrada'), 0) as entradas,
  coalesce(sum(valor) filter (where tipo = 'saida'), 0)   as saidas
from public.lancamentos
group by 1
order by 1;
alter view public.vw_fluxo_mensal set (security_invoker = on);

drop view if exists public.vw_fluxo_mesmo_periodo;
create or replace view public.vw_fluxo_mesmo_periodo as
select
  date_trunc('month', data)::date as mes,
  coalesce(sum(valor) filter (where tipo = 'entrada'), 0) as entradas,
  coalesce(sum(valor) filter (where tipo = 'saida'), 0)   as saidas
from public.lancamentos
where data >= (date_trunc('month', current_date) - interval '1 month')::date
  and data <= current_date
  and extract(day from data) <= extract(day from current_date)
group by 1
order by 1;
alter view public.vw_fluxo_mesmo_periodo set (security_invoker = on);

-- ============================================================================
-- 9. Permissões (GRANT) e RLS
-- ============================================================================
-- Papéis do Data API do Neon: `authenticated` (com JWT válido) e `anonymous`
-- (sem JWT). Diferente do Supabase, não existem `anon` nem `service_role`.
--
-- CUIDADO: se você marcou "Grant public schema access" ao habilitar o Data API,
-- o Neon concedeu SELECT/INSERT/UPDATE/DELETE em TODAS as tabelas do schema
-- public para `authenticated`. Isso daria UPDATE em `profiles.role` — o que a
-- segurança deste app proíbe. Por isso a seção de `profiles` REVOGA o UPDATE
-- amplo e concede só a coluna full_name.
-- ---------------------------------------------------------------------------

-- Tabelas de negócio: liberadas por inteiro para quem está logado; nada para o
-- papel anônimo (sem GRANT, quem não está logado nem começa a consulta).
revoke all on public.produtos, public.clientes, public.vendas, public.itens_venda, public.lancamentos
  from anonymous;
grant select, insert, update, delete
  on public.produtos, public.clientes, public.vendas, public.itens_venda, public.lancamentos
  to authenticated;

-- Views.
revoke all on public.vw_clientes_resumo, public.vw_resumo, public.vw_faturamento_diario,
              public.vw_vendas_por_categoria, public.vw_fluxo_mensal, public.vw_fluxo_mesmo_periodo
  from anonymous;
grant select
  on public.vw_clientes_resumo, public.vw_resumo, public.vw_faturamento_diario,
     public.vw_vendas_por_categoria, public.vw_fluxo_mensal, public.vw_fluxo_mesmo_periodo
  to authenticated;

-- Perfis: leitura sim; escrita só na própria linha e só em full_name.
revoke all    on public.profiles from anonymous, authenticated;
grant  select on public.profiles to authenticated;
grant  update (full_name) on public.profiles to authenticated;

-- Organizações: só leitura.
revoke all    on public.organizations from anonymous, authenticated;
grant  select on public.organizations to authenticated;

-- Configuração da empresa: sem DELETE (não é operação do app).
revoke all on public.company_settings from anonymous, authenticated;
grant  select, insert, update on public.company_settings to authenticated;

-- Logomarca: pode ser removida (é isso que o botão "Remover logomarca" faz).
revoke all on public.company_logos from anonymous, authenticated;
grant  select, insert, update, delete on public.company_logos to authenticated;

-- Funções: nada para o papel anônimo; o logado pode as auxiliares e o RPC de
-- criação do próprio perfil.
revoke execute on function public.eh_admin() from public, anonymous;
revoke execute on function public.eh_gestor() from public, anonymous;
revoke execute on function public.minha_organizacao() from public, anonymous;
revoke execute on function public.garantir_perfil() from public, anonymous;
revoke execute on function public.definir_papel_do_usuario(uuid, text) from public, anonymous;
revoke execute on function public.definir_ativo_do_usuario(uuid, boolean) from public, anonymous;

grant execute on function public.eh_admin() to authenticated;
grant execute on function public.eh_gestor() to authenticated;
grant execute on function public.minha_organizacao() to authenticated;
grant execute on function public.garantir_perfil() to authenticated;
grant execute on function public.definir_papel_do_usuario(uuid, text) to authenticated;
grant execute on function public.definir_ativo_do_usuario(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ RLS -----
alter table public.produtos         enable row level security;
alter table public.clientes         enable row level security;
alter table public.vendas           enable row level security;
alter table public.itens_venda      enable row level security;
alter table public.lancamentos      enable row level security;
alter table public.organizations    enable row level security;
alter table public.profiles         enable row level security;
alter table public.company_settings enable row level security;
alter table public.company_logos    enable row level security;

-- Negócio: quem está logado vê e mexe em tudo (é a loja inteira).
drop policy if exists usuario_produtos    on public.produtos;
drop policy if exists usuario_clientes    on public.clientes;
drop policy if exists usuario_vendas      on public.vendas;
drop policy if exists usuario_itens_venda on public.itens_venda;
drop policy if exists usuario_lancamentos on public.lancamentos;

create policy usuario_produtos    on public.produtos    for all to authenticated using (true) with check (true);
create policy usuario_clientes    on public.clientes    for all to authenticated using (true) with check (true);
create policy usuario_vendas      on public.vendas      for all to authenticated using (true) with check (true);
create policy usuario_itens_venda on public.itens_venda for all to authenticated using (true) with check (true);
create policy usuario_lancamentos on public.lancamentos for all to authenticated using (true) with check (true);

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

-- Organizações.
drop policy if exists organizacoes_leitura on public.organizations;
create policy organizacoes_leitura on public.organizations
  for select to authenticated
  using (id = public.minha_organizacao());

-- Configuração da empresa: lê quem é da organização; escreve admin/gerente.
drop policy if exists empresa_leitura on public.company_settings;
create policy empresa_leitura on public.company_settings
  for select to authenticated
  using (organization_id = public.minha_organizacao());

drop policy if exists empresa_criacao on public.company_settings;
create policy empresa_criacao on public.company_settings
  for insert to authenticated
  with check (organization_id = public.minha_organizacao() and public.eh_gestor());

drop policy if exists empresa_atualizacao on public.company_settings;
create policy empresa_atualizacao on public.company_settings
  for update to authenticated
  using (organization_id = public.minha_organizacao() and public.eh_gestor())
  with check (organization_id = public.minha_organizacao() and public.eh_gestor());

-- Logomarca: mesmas regras da configuração da empresa.
drop policy if exists logo_leitura on public.company_logos;
create policy logo_leitura on public.company_logos
  for select to authenticated
  using (organization_id = public.minha_organizacao());

drop policy if exists logo_envio on public.company_logos;
create policy logo_envio on public.company_logos
  for insert to authenticated
  with check (organization_id = public.minha_organizacao() and public.eh_gestor());

drop policy if exists logo_troca on public.company_logos;
create policy logo_troca on public.company_logos
  for update to authenticated
  using (organization_id = public.minha_organizacao() and public.eh_gestor())
  with check (organization_id = public.minha_organizacao() and public.eh_gestor());

drop policy if exists logo_exclusao on public.company_logos;
create policy logo_exclusao on public.company_logos
  for delete to authenticated
  using (organization_id = public.minha_organizacao() and public.eh_gestor());

-- ============================================================================
-- 10. Dados de exemplo (APAGA as tabelas de negócio antes de inserir)
-- ============================================================================
-- Esta seção roda **só em base vazia**. Se já existir qualquer dado de negócio,
-- ela ABORTA em vez de apagar — é isso que impede um `aplicar.mjs` sem filtro de
-- zerar a produção (a `00` roda o arquivo inteiro numa transação, então o
-- `raise` desfaz tudo o que veio antes neste arquivo).
--
-- Para semear de propósito numa base que já tem dados (ambiente de estudo),
-- peça na mão: `set app.semear = 'on';` antes de rodar este arquivo.
do $$
declare
  v_registros bigint;
begin
  select (select count(*) from public.vendas)
       + (select count(*) from public.itens_venda)
       + (select count(*) from public.lancamentos)
       + (select count(*) from public.produtos)
       + (select count(*) from public.clientes)
    into v_registros;

  if v_registros > 0 and coalesce(current_setting('app.semear', true), '') <> 'on' then
    raise exception using
      message = format('Seed abortado: a base já tem %s registros de negócio.', v_registros),
      hint = 'A seção 10 (dados de exemplo) faz truncate nas tabelas. Se a intenção é mesmo semear, rode `set app.semear = ''on'';` antes deste arquivo.';
  end if;
end $$;

truncate public.itens_venda, public.vendas, public.lancamentos, public.produtos, public.clientes
  restart identity cascade;

insert into public.produtos (codigo, nome, categoria, quantidade, minimo, unidade, custo, preco) values
  ('P001', 'Açaí tradicional 300ml', 'Açaí',       86, 40, 'un',  5.20, 15.90),
  ('P002', 'Açaí tradicional 500ml', 'Açaí',       48, 45, 'un',  9.40, 21.90),
  ('P003', 'Açaí tradicional 700ml', 'Açaí',       22, 30, 'un', 12.80, 28.50),
  ('P004', 'Açaí zero açúcar 500ml', 'Açaí',       31, 25, 'un', 10.10, 23.90),
  ('P005', 'Granola crocante',       'Adicionais',  9, 15, 'kg', 18.00,  3.50),
  ('P006', 'Leite em pó',            'Adicionais', 14, 10, 'kg', 32.00,  4.00),
  ('P007', 'Morango fresco',         'Frutas',      6, 12, 'kg', 24.50,  5.00),
  ('P008', 'Banana prata',           'Frutas',     21, 10, 'kg',  6.80,  3.00),
  ('P009', 'Copo 500ml com tampa',   'Embalagens', 640, 300, 'un', 0.42,  0.00),
  ('P010', 'Colher descartável',     'Embalagens', 250, 400, 'un', 0.08,  0.00);

insert into public.clientes (codigo, nome, telefone, email, desde, tier) values
  ('C-0912', 'Fernanda Dias',  '(11) 98812-4471', 'fernanda.dias@email.com',  '2024-03-11', 'VIP'),
  ('C-0887', 'Maria Souza',    '(11) 99145-2210', 'maria.souza@email.com',    '2024-06-02', 'VIP'),
  ('C-1104', 'Ana Beatriz',    '(11) 97733-8102', 'ana.beatriz@email.com',    '2025-01-19', 'Recorrente'),
  ('C-1207', 'Juliana Reis',   '(11) 98120-9944', 'juliana.reis@email.com',   '2025-04-27', 'Recorrente'),
  ('C-1330', 'Carlos Lima',    '(11) 99671-3320', 'carlos.lima@email.com',    '2025-08-14', 'Recorrente'),
  ('C-1455', 'Pedro Alves',    '(11) 98402-1177', 'pedro.alves@email.com',    '2026-01-08', 'Recorrente'),
  ('C-1502', 'Lucas Moreira',  '(11) 99033-7765', 'lucas.moreira@email.com',  '2026-07-22', 'Novo'),
  ('C-1531', 'Rafael Nunes',   '(11) 98890-4402', 'rafael.nunes@email.com',   '2026-09-30', 'Novo');

insert into public.vendas (codigo, cliente_id, status, pagamento, total, criado_em)
select
  '#' || lpad((1000 + row_number() over (order by d.dia, pedido.n))::text, 4, '0'),
  c.id,
  (array['Concluída', 'Concluída', 'Concluída', 'Concluída', 'Em preparo', 'Aguardando', 'Cancelada'])[(1 + floor(random() * 7))::int],
  (array['Pix', 'Crédito', 'Débito', 'Dinheiro'])[(1 + floor(random() * 4))::int],
  round((18 + random() * 90)::numeric, 2),
  least(d.dia::date + interval '9 hours' + random() * interval '9 hours', now())
from (
  select d as dia, (44 + floor(random() * 21))::int as pedidos
  from generate_series(current_date - interval '5 months', current_date, interval '1 day') as d
) d
cross join lateral generate_series(1, d.pedidos) as pedido (n)
cross join lateral (
  select id from public.clientes where pedido.n > 0 order by random() limit 1
) c;

insert into public.itens_venda (venda_id, produto_id, descricao, quantidade, preco_unitario)
select
  s.venda_id,
  p.id,
  p.nome,
  (1 + floor(random() * 3))::int,
  p.preco
from (
  select v.id as venda_id, (1 + floor(random() * 2))::int as qtd
  from public.vendas v
) s
cross join lateral generate_series(1, s.qtd) as item (n)
cross join lateral (
  select p.id, p.nome, p.preco
  from public.produtos p
  where p.preco > 0
    and item.n > 0
  order by random()
  limit 1
) p;

insert into public.lancamentos (descricao, categoria, tipo, valor, forma, data)
select
  'Vendas do dia (PDV)',
  'Vendas',
  'entrada',
  round(sum(total), 2),
  'Misto',
  criado_em::date
from public.vendas
where status <> 'Cancelada'
group by criado_em::date;

insert into public.lancamentos (descricao, categoria, tipo, valor, forma, data)
select
  t.descricao,
  t.categoria,
  'saida',
  round((t.minimo + random() * (t.maximo - t.minimo))::numeric, 2),
  (array['Pix', 'Crédito', 'Débito automático', 'Transferência'])[(1 + floor(random() * 4))::int],
  d::date
from (values
  ('Compra de polpa de açaí',   'Insumos',       2, 2000, 3300),
  ('Frutas e adicionais',       'Insumos',       4,  550, 1050),
  ('Embalagens e descartáveis', 'Insumos',       5,  480,  870),
  ('Energia elétrica',          'Contas fixas', 30,  700, 1100),
  ('Pagamento de funcionário',  'Pessoal',      15, 1500, 2800),
  ('Marketing digital',         'Marketing',    10,  280,  620)
) as t (descricao, categoria, a_cada_dias, minimo, maximo)
cross join lateral generate_series(
  current_date - interval '5 months',
  current_date,
  make_interval(days => t.a_cada_dias)
) as d;

-- ============================================================================
-- 11. Conferência (não altera nada)
-- ============================================================================
select 'produtos' as tabela, count(*) as registros from public.produtos
union all select 'clientes',    count(*) from public.clientes
union all select 'vendas',      count(*) from public.vendas
union all select 'itens_venda', count(*) from public.itens_venda
union all select 'lancamentos', count(*) from public.lancamentos;

-- Esperado: 1 linha, nenhum valor nulo.
select * from public.vw_resumo;
