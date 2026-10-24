-- ============================================================================
-- 18 · Tipos de venda, formas de pagamento e dados de entrega/aplicativos
-- ============================================================================
-- Aditiva: preserva vendas históricas e mantém registrar_venda() como a
-- autoridade transacional para itens e movimentos de estoque.

create table if not exists public.tipos_venda (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete cascade,
  codigo          text not null,
  nome            text not null check (char_length(btrim(nome)) between 1 and 80),
  categoria       text not null check (categoria in ('balcao', 'delivery', 'aplicativo', 'personalizado')),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (organization_id, codigo)
);

create unique index if not exists tipos_venda_nome_org_idx
  on public.tipos_venda (organization_id, lower(nome));

create table if not exists public.formas_pagamento (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete cascade,
  codigo          text not null,
  nome            text not null check (char_length(btrim(nome)) between 1 and 80),
  categoria       text not null check (categoria in ('dinheiro', 'pix', 'debito', 'credito', 'outros')),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (organization_id, codigo)
);

create unique index if not exists formas_pagamento_nome_org_idx
  on public.formas_pagamento (organization_id, lower(nome));

insert into public.tipos_venda (organization_id, codigo, nome, categoria)
select o.id, s.codigo, s.nome, s.categoria
  from public.organizations o
 cross join (values
   ('balcao', 'Balcão', 'balcao'),
   ('delivery_proprio', 'Delivery próprio', 'delivery'),
   ('aplicativo', 'Aplicativo', 'aplicativo')
 ) as s(codigo, nome, categoria)
on conflict (organization_id, codigo) do nothing;

insert into public.formas_pagamento (organization_id, codigo, nome, categoria)
select o.id, s.codigo, s.nome, s.categoria
  from public.organizations o
 cross join (values
   ('dinheiro', 'Dinheiro', 'dinheiro'),
   ('pix', 'PIX', 'pix'),
   ('debito', 'Cartão de débito', 'debito'),
   ('credito', 'Cartão de crédito', 'credito'),
   ('outros', 'Outras formas', 'outros')
 ) as s(codigo, nome, categoria)
on conflict (organization_id, codigo) do nothing;

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

drop trigger if exists organizations_catalogos_venda on public.organizations;
create trigger organizations_catalogos_venda
  after insert on public.organizations
  for each row execute function public.seed_catalogos_venda_nova_organizacao();

create table if not exists public.venda_detalhes (
  venda_id                 uuid primary key references public.vendas(id) on delete cascade,
  organization_id          uuid not null default public.minha_organizacao()
                             references public.organizations(id) on delete cascade,
  tipo_venda_id            uuid references public.tipos_venda(id) on delete restrict,
  tipo_venda_nome          text not null,
  forma_pagamento_id       uuid references public.formas_pagamento(id) on delete restrict,
  forma_pagamento_nome     text not null,
  endereco_entrega         text,
  taxa_entrega             numeric(12, 2) not null default 0 check (taxa_entrega >= 0),
  plataforma               text,
  pedido_externo           text,
  comissao_percentual      numeric(5, 2) not null default 0
                             check (comissao_percentual between 0 and 100),
  taxa_aplicativo           numeric(12, 2) not null default 0 check (taxa_aplicativo >= 0),
  total_cobrado             numeric(12, 2) not null check (total_cobrado >= 0),
  valor_recebido            numeric(12, 2) check (valor_recebido >= 0),
  troco                     numeric(12, 2) not null default 0 check (troco >= 0),
  comissao_estimada         numeric(12, 2) not null default 0 check (comissao_estimada >= 0),
  valor_liquido_estimado    numeric(12, 2) not null check (valor_liquido_estimado >= 0),
  criado_em                 timestamptz not null default now()
);

create index if not exists venda_detalhes_org_idx
  on public.venda_detalhes (organization_id);

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
  count(v.id) filter (where v.status <> 'Cancelada') as pedidos,
  coalesce(sum(v.total + coalesce(d.taxa_entrega, 0))
    filter (where v.status <> 'Cancelada'), 0) as total,
  max(v.criado_em)::date as ultima_compra
from public.clientes c
left join public.vendas v on v.cliente_id = c.id
left join public.venda_detalhes d on d.venda_id = v.id
group by c.id;
alter view public.vw_clientes_resumo set (security_invoker = on);

drop view if exists public.vw_resumo;
create or replace view public.vw_resumo as
select
  (select coalesce(sum(v.total + coalesce(d.taxa_entrega, 0)), 0)
     from public.vendas v left join public.venda_detalhes d on d.venda_id = v.id
    where v.status <> 'Cancelada' and v.criado_em >= date_trunc('month', current_date)) as faturamento_mes,
  (select coalesce(sum(v.total + coalesce(d.taxa_entrega, 0)), 0)
     from public.vendas v left join public.venda_detalhes d on d.venda_id = v.id
    where v.status <> 'Cancelada' and v.criado_em::date = current_date) as faturamento_hoje,
  (select count(*) from public.vendas where criado_em::date = current_date) as vendas_hoje,
  (select count(*) from public.vendas
    where status = 'Cancelada' and criado_em::date = current_date) as cancelamentos_hoje,
  (select coalesce(avg(v.total + coalesce(d.taxa_entrega, 0)), 0)
     from public.vendas v left join public.venda_detalhes d on d.venda_id = v.id
    where v.status <> 'Cancelada') as ticket_medio,
  (select count(*) from public.clientes) as total_clientes,
  (select count(*) from public.clientes where desde >= current_date - 30) as novos_clientes,
  (select count(*) from public.clientes where tier = 'VIP') as clientes_vip,
  (select coalesce(sum(quantidade * custo), 0) from public.produtos where ativo) as valor_estoque,
  (select count(*) from public.produtos where ativo and quantidade < minimo) as itens_abaixo_minimo;
alter view public.vw_resumo set (security_invoker = on);

drop view if exists public.vw_faturamento_diario;
create or replace view public.vw_faturamento_diario as
select
  v.criado_em::date as dia,
  sum(v.total + coalesce(d.taxa_entrega, 0)) as total
from public.vendas v
left join public.venda_detalhes d on d.venda_id = v.id
where v.status <> 'Cancelada'
  and v.criado_em >= current_date - 30
group by 1
order by 1;
alter view public.vw_faturamento_diario set (security_invoker = on);

alter table public.tipos_venda enable row level security;
alter table public.formas_pagamento enable row level security;
alter table public.venda_detalhes enable row level security;

drop policy if exists tipos_venda_leitura on public.tipos_venda;
create policy tipos_venda_leitura on public.tipos_venda
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('vendas', 'consultar'))
  );

drop policy if exists tipos_venda_criacao on public.tipos_venda;
create policy tipos_venda_criacao on public.tipos_venda
  for insert to authenticated
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

drop policy if exists tipos_venda_edicao on public.tipos_venda;
create policy tipos_venda_edicao on public.tipos_venda
  for update to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  )
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

drop policy if exists formas_pagamento_leitura on public.formas_pagamento;
create policy formas_pagamento_leitura on public.formas_pagamento
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('vendas', 'consultar'))
  );

drop policy if exists formas_pagamento_criacao on public.formas_pagamento;
create policy formas_pagamento_criacao on public.formas_pagamento
  for insert to authenticated
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

drop policy if exists formas_pagamento_edicao on public.formas_pagamento;
create policy formas_pagamento_edicao on public.formas_pagamento
  for update to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  )
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('configuracoes', 'editar'))
  );

drop policy if exists venda_detalhes_leitura on public.venda_detalhes;
create policy venda_detalhes_leitura on public.venda_detalhes
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('vendas', 'consultar'))
  );

grant select, insert, update on public.tipos_venda, public.formas_pagamento to authenticated;
grant select on public.venda_detalhes to authenticated;
revoke delete on public.tipos_venda, public.formas_pagamento from authenticated;
revoke insert, update, delete on public.venda_detalhes from public, anonymous, authenticated;
revoke all on public.vw_clientes_resumo, public.vw_resumo, public.vw_faturamento_diario from anonymous;
grant select on public.vw_clientes_resumo, public.vw_resumo, public.vw_faturamento_diario to authenticated;

create or replace function public.registrar_venda_completa(
  p_itens                  jsonb,
  p_chave                  text,
  p_cliente_id             uuid,
  p_tipo_venda_id          uuid,
  p_forma_pagamento_id     uuid,
  p_status                 text,
  p_codigo                 text,
  p_endereco_entrega       text default null,
  p_taxa_entrega           numeric default 0,
  p_plataforma             text default null,
  p_pedido_externo         text default null,
  p_comissao_percentual    numeric default 0,
  p_taxa_aplicativo        numeric default 0,
  p_valor_recebido         numeric default null
)
returns table (
  id                      uuid,
  codigo                  text,
  total                   numeric,
  total_cobrado            numeric,
  status                  text,
  pagamento               text,
  forma_pagamento         text,
  tipo_venda              text,
  criado_em               timestamptz,
  ja_existia              boolean,
  itens                   integer,
  movimentos              integer,
  troco                   numeric,
  comissao_estimada       numeric,
  valor_liquido_estimado  numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org          uuid := public.minha_organizacao();
  v_tipo         public.tipos_venda;
  v_forma        public.formas_pagamento;
  v_venda        record;
  v_detalhe      public.venda_detalhes;
  v_total        numeric(12, 2);
  v_taxa_entrega numeric(12, 2) := coalesce(p_taxa_entrega, 0);
  v_taxa_app     numeric(12, 2) := coalesce(p_taxa_aplicativo, 0);
  v_comissao_pct numeric(5, 2) := coalesce(p_comissao_percentual, 0);
  v_comissao     numeric(12, 2);
  v_troco        numeric(12, 2) := 0;
  v_liquido      numeric(12, 2);
  v_pagamento    text;
begin
  if v_org is null then
    raise exception 'Organização inválida para registrar a venda.';
  end if;

  select t.* into v_tipo
    from public.tipos_venda t
   where t.id = p_tipo_venda_id
     and t.organization_id = v_org
     and t.ativo;
  if v_tipo.id is null then
    raise exception 'Tipo de venda não encontrado ou inativo.';
  end if;

  select f.* into v_forma
    from public.formas_pagamento f
   where f.id = p_forma_pagamento_id
     and f.organization_id = v_org
     and f.ativo;
  if v_forma.id is null then
    raise exception 'Forma de pagamento não encontrada ou inativa.';
  end if;

  if v_taxa_entrega < 0 or v_taxa_app < 0 or v_comissao_pct < 0 or v_comissao_pct > 100 then
    raise exception 'Taxas e comissão precisam ter valores válidos.';
  end if;

  if v_tipo.categoria = 'delivery' and nullif(btrim(coalesce(p_endereco_entrega, '')), '') is null then
    raise exception 'Informe o endereço de entrega.';
  end if;

  if v_tipo.categoria = 'aplicativo'
     and nullif(btrim(coalesce(p_plataforma, '')), '') is null then
    raise exception 'Informe o aplicativo da venda.';
  end if;

  if v_tipo.categoria <> 'aplicativo' and (v_taxa_app <> 0 or v_comissao_pct <> 0) then
    raise exception 'Comissão e taxa do aplicativo só podem ser usadas em vendas por aplicativo.';
  end if;

  v_pagamento := case v_forma.categoria
    when 'dinheiro' then 'Dinheiro'
    when 'pix' then 'Pix'
    when 'debito' then 'Débito'
    when 'credito' then 'Crédito'
    else 'Misto'
  end;

  select * into v_venda
    from public.registrar_venda(
      p_itens, p_chave, p_cliente_id, v_pagamento, p_status, p_codigo
    );

  if not v_venda.ja_existia then
    v_total := round(v_venda.total + v_taxa_entrega, 2);
    v_comissao := case
      when v_tipo.categoria = 'aplicativo' then round(v_total * v_comissao_pct / 100, 2)
      else 0
    end;
    v_liquido := greatest(0, v_total - v_comissao - v_taxa_app);

    if v_forma.categoria = 'dinheiro' then
      if p_valor_recebido is not null and p_valor_recebido < v_total then
        raise exception 'O valor recebido é menor que o total da venda.';
      end if;
      v_troco := greatest(0, round(coalesce(p_valor_recebido, v_total) - v_total, 2));
    elsif p_valor_recebido is not null then
      raise exception 'Informe o valor recebido somente para pagamento em dinheiro.';
    end if;

    insert into public.venda_detalhes (
      venda_id, organization_id, tipo_venda_id, tipo_venda_nome,
      forma_pagamento_id, forma_pagamento_nome, endereco_entrega, taxa_entrega,
      plataforma, pedido_externo, comissao_percentual, taxa_aplicativo,
      total_cobrado, valor_recebido, troco, comissao_estimada,
      valor_liquido_estimado
    ) values (
      v_venda.id, v_org, v_tipo.id, v_tipo.nome,
      v_forma.id, v_forma.nome, nullif(btrim(p_endereco_entrega), ''), v_taxa_entrega,
      nullif(btrim(p_plataforma), ''), nullif(btrim(p_pedido_externo), ''),
      v_comissao_pct, v_taxa_app, v_total,
      case when v_forma.categoria = 'dinheiro' then coalesce(p_valor_recebido, v_total) else null end,
      v_troco, v_comissao, v_liquido
    )
    returning * into v_detalhe;
  else
    select * into v_detalhe
      from public.venda_detalhes
     where venda_id = v_venda.id;
  end if;

  return query
    select v_venda.id,
           v_venda.codigo,
           v_venda.total,
           coalesce(v_detalhe.total_cobrado, v_venda.total),
           v_venda.status,
           v_venda.pagamento,
           coalesce(v_detalhe.forma_pagamento_nome, v_venda.pagamento),
           v_detalhe.tipo_venda_nome,
           v_venda.criado_em,
           v_venda.ja_existia,
           v_venda.itens,
           v_venda.movimentos,
           coalesce(v_detalhe.troco, 0),
           coalesce(v_detalhe.comissao_estimada, 0),
           coalesce(v_detalhe.valor_liquido_estimado, v_venda.total);
end;
$$;

revoke execute on function public.registrar_venda_completa(
  jsonb, text, uuid, uuid, uuid, text, text, text, numeric, text, text, numeric, numeric, numeric
) from public, anonymous;
grant execute on function public.registrar_venda_completa(
  jsonb, text, uuid, uuid, uuid, text, text, text, numeric, text, text, numeric, numeric, numeric
) to authenticated;

notify pgrst, 'reload schema';
