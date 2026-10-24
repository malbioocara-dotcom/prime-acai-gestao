-- Reverte somente quando nenhum tipo de venda depende de categoria criada
-- fora do catálogo original. O bloqueio evita converter dados do negócio sem
-- uma decisão explícita do operador.
do $$
begin
  if exists (
    select 1
      from public.tipos_venda
     where categoria not in ('balcao', 'delivery', 'aplicativo', 'personalizado')
  ) then
    raise exception
      'Há tipos de venda usando categorias personalizadas. Reatribua-os a uma categoria padrão antes da reversão.';
  end if;
end;
$$;

alter table public.tipos_venda
  drop constraint if exists tipos_venda_categoria_org_fkey;

drop trigger if exists categorias_tipos_venda_atualizado_em
  on public.categorias_tipos_venda;
drop function if exists public.tocar_atualizado_em_categoria_tipo_venda();

drop policy if exists categorias_tipos_venda_leitura on public.categorias_tipos_venda;
drop policy if exists categorias_tipos_venda_criacao on public.categorias_tipos_venda;
drop policy if exists categorias_tipos_venda_edicao on public.categorias_tipos_venda;
drop table if exists public.categorias_tipos_venda;

alter table public.tipos_venda
  add constraint tipos_venda_categoria_check
  check (categoria in ('balcao', 'delivery', 'aplicativo', 'personalizado'));

create or replace function public.seed_catalogos_venda_nova_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
