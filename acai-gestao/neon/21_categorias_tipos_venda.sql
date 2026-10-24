-- ============================================================================
-- 21 · Categorias configuráveis para tipos de venda
-- ============================================================================
-- Mantém os códigos usados pelo PDV para regras de delivery/aplicativo e
-- permite cadastrar novas categorias sem mudar o contrato de vendas.

create table if not exists public.categorias_tipos_venda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
    references public.organizations(id) on delete cascade,
  codigo text not null check (char_length(btrim(codigo)) between 1 and 60),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  descricao text check (descricao is null or char_length(descricao) <= 500),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (organization_id, codigo)
);

create unique index if not exists categorias_tipos_venda_nome_org_idx
  on public.categorias_tipos_venda (
    organization_id,
    lower(regexp_replace(btrim(nome), '[[:space:]]+', ' ', 'g'))
  );

create index if not exists categorias_tipos_venda_org_ativo_idx
  on public.categorias_tipos_venda (organization_id, ativo, nome);

insert into public.categorias_tipos_venda (organization_id, codigo, nome)
select org.id, categoria.codigo, categoria.nome
  from public.organizations org
 cross join (values
   ('balcao', 'Balcão'),
   ('delivery', 'Delivery'),
   ('aplicativo', 'Aplicativo'),
   ('personalizado', 'Personalizado')
 ) as categoria(codigo, nome)
on conflict (organization_id, codigo) do nothing;

alter table public.tipos_venda
  drop constraint if exists tipos_venda_categoria_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tipos_venda_categoria_org_fkey'
       and conrelid = 'public.tipos_venda'::regclass
  ) then
    alter table public.tipos_venda
      add constraint tipos_venda_categoria_org_fkey
      foreign key (organization_id, categoria)
      references public.categorias_tipos_venda (organization_id, codigo)
      on update cascade on delete restrict;
  end if;
end;
$$;

create or replace function public.seed_catalogos_venda_nova_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categorias_tipos_venda (organization_id, codigo, nome) values
    (new.id, 'balcao', 'Balcão'),
    (new.id, 'delivery', 'Delivery'),
    (new.id, 'aplicativo', 'Aplicativo'),
    (new.id, 'personalizado', 'Personalizado')
  on conflict (organization_id, codigo) do nothing;

  insert into public.tipos_venda (organization_id, codigo, nome, categoria) values
    (new.id, 'balcao', 'Balcão', 'balcao'),
    (new.id, 'delivery_proprio', 'Delivery próprio', 'delivery'),
    (new.id, 'aplicativo', 'Aplicativo', 'aplicativo')
  on conflict (organization_id, codigo) do nothing;

  insert into public.formas_pagamento (organization_id, codigo, nome, categoria) values
    (new.id, 'dinheiro', 'Dinheiro', 'dinheiro'),
    (new.id, 'pix', 'PIX', 'pix'),
    (new.id, 'debito', 'Cartão de débito', 'debito'),
    (new.id, 'credito', 'Cartão de crédito', 'credito'),
    (new.id, 'outros', 'Outras formas', 'outros')
  on conflict (organization_id, codigo) do nothing;

  return new;
end;
$$;

alter table public.categorias_tipos_venda enable row level security;

drop policy if exists categorias_tipos_venda_leitura on public.categorias_tipos_venda;
drop policy if exists categorias_tipos_venda_criacao on public.categorias_tipos_venda;
drop policy if exists categorias_tipos_venda_edicao on public.categorias_tipos_venda;

create policy categorias_tipos_venda_leitura on public.categorias_tipos_venda
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (
      (select public.pode('vendas', 'consultar'))
      or (select public.pode('configuracoes', 'ver'))
    )
  );

create policy categorias_tipos_venda_criacao on public.categorias_tipos_venda
  for insert to authenticated
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

create policy categorias_tipos_venda_edicao on public.categorias_tipos_venda
  for update to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  )
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

create or replace function public.tocar_atualizado_em_categoria_tipo_venda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists categorias_tipos_venda_atualizado_em
  on public.categorias_tipos_venda;
create trigger categorias_tipos_venda_atualizado_em
  before update on public.categorias_tipos_venda
  for each row execute function public.tocar_atualizado_em_categoria_tipo_venda();

revoke all on public.categorias_tipos_venda from anonymous, authenticated;
grant select, insert, update on public.categorias_tipos_venda to authenticated;
revoke delete on public.categorias_tipos_venda from authenticated;

revoke all on function public.tocar_atualizado_em_categoria_tipo_venda()
  from public, anonymous, authenticated;
grant execute on function public.tocar_atualizado_em_categoria_tipo_venda()
  to authenticated;
