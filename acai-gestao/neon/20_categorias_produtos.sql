-- ============================================================================
-- 20 · Categorias reutilizáveis do catálogo de produtos
-- ============================================================================
-- O produto mantém a coluna `categoria` textual já consumida pelo estoque,
-- compras e PDV. As categorias fornecem um catálogo validado para novos
-- cadastros sem renomear colunas nem alterar contratos existentes.
-- Categorias são isoladas por organização; o catálogo de produtos legado é
-- global, portanto categorias já usadas são semeadas para cada organização.
-- A reversão preserva a tabela e seus dados.

create table if not exists public.categorias_produtos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
    references public.organizations(id) on delete cascade,
  nome text not null
    check (char_length(btrim(nome)) between 1 and 80),
  descricao text
    check (descricao is null or char_length(descricao) <= 500),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists categorias_produtos_nome_org_idx
  on public.categorias_produtos (
    organization_id,
    lower(regexp_replace(btrim(nome), '[[:space:]]+', ' ', 'g'))
  );

create index if not exists categorias_produtos_org_ativo_idx
  on public.categorias_produtos (organization_id, ativo, nome);

insert into public.categorias_produtos (organization_id, nome)
select org.id, btrim(produto.categoria)
  from public.organizations org
 cross join (
   select distinct btrim(categoria) as categoria
     from public.produtos
    where btrim(categoria) <> ''
      and char_length(btrim(categoria)) <= 80
 ) produto
on conflict do nothing;

create or replace function public.seed_categorias_produtos_nova_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categorias_produtos (organization_id, nome)
  select new.id, btrim(produto.categoria)
    from public.produtos produto
   where btrim(produto.categoria) <> ''
     and char_length(btrim(produto.categoria)) <= 80
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.seed_categorias_produtos_nova_organizacao()
  from public, anonymous, authenticated;

drop trigger if exists organizations_categorias_produtos on public.organizations;
create trigger organizations_categorias_produtos
  after insert on public.organizations
  for each row execute function public.seed_categorias_produtos_nova_organizacao();

create or replace function public.tocar_atualizado_em_categoria_produto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists categorias_produtos_atualizado_em on public.categorias_produtos;
create trigger categorias_produtos_atualizado_em
  before update on public.categorias_produtos
  for each row execute function public.tocar_atualizado_em_categoria_produto();

alter table public.categorias_produtos enable row level security;

drop policy if exists categorias_produtos_leitura on public.categorias_produtos;
drop policy if exists categorias_produtos_criacao on public.categorias_produtos;
drop policy if exists categorias_produtos_edicao on public.categorias_produtos;

create policy categorias_produtos_leitura on public.categorias_produtos
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (
      (select public.pode('estoque', 'consultar'))
      or (select public.pode('configuracoes', 'ver'))
    )
  );

create policy categorias_produtos_criacao on public.categorias_produtos
  for insert to authenticated
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

create policy categorias_produtos_edicao on public.categorias_produtos
  for update to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  )
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

revoke all on public.categorias_produtos from anonymous, authenticated;
grant select, insert, update on public.categorias_produtos to authenticated;
revoke delete on public.categorias_produtos from authenticated;

revoke all on function public.tocar_atualizado_em_categoria_produto()
  from public, anonymous, authenticated;
grant execute on function public.tocar_atualizado_em_categoria_produto()
  to authenticated;
