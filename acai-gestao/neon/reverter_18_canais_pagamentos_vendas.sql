-- Reverte a migração 18 somente quando não há vendas ou cadastros customizados
-- dependentes dos novos dados. Se houver dados, a operação aborta e os mantém.
do $$
begin
  if exists (select 1 from public.venda_detalhes) then
    raise exception 'Reversão 18 abortada: existem detalhes de vendas que precisam ser preservados.';
  end if;

  if exists (
    select 1 from public.tipos_venda
     where codigo not in ('balcao', 'delivery_proprio', 'aplicativo')
        or (codigo = 'balcao' and (nome <> 'Balcão' or categoria <> 'balcao' or not ativo))
        or (codigo = 'delivery_proprio' and (nome <> 'Delivery próprio' or categoria <> 'delivery' or not ativo))
        or (codigo = 'aplicativo' and (nome <> 'Aplicativo' or categoria <> 'aplicativo' or not ativo))
  ) or exists (
    select 1 from public.formas_pagamento
     where codigo not in ('dinheiro', 'pix', 'debito', 'credito', 'outros')
        or (codigo = 'dinheiro' and (nome <> 'Dinheiro' or categoria <> 'dinheiro' or not ativo))
        or (codigo = 'pix' and (nome <> 'PIX' or categoria <> 'pix' or not ativo))
        or (codigo = 'debito' and (nome <> 'Cartão de débito' or categoria <> 'debito' or not ativo))
        or (codigo = 'credito' and (nome <> 'Cartão de crédito' or categoria <> 'credito' or not ativo))
        or (codigo = 'outros' and (nome <> 'Outras formas' or categoria <> 'outros' or not ativo))
  ) then
    raise exception 'Reversão 18 abortada: existem cadastros personalizados ou padrões alterados que precisam ser preservados.';
  end if;
end
$$;

drop trigger if exists organizations_catalogos_venda on public.organizations;
drop function if exists public.seed_catalogos_venda_nova_organizacao();
drop function if exists public.registrar_venda_completa(
  jsonb, text, uuid, uuid, uuid, text, text, text, numeric, text, text, numeric, numeric, numeric
);
drop view if exists public.vw_clientes_resumo;
drop view if exists public.vw_resumo;
drop view if exists public.vw_faturamento_diario;
drop table if exists public.venda_detalhes;
drop table if exists public.formas_pagamento;
drop table if exists public.tipos_venda;

create or replace view public.vw_clientes_resumo as
select
  c.id, c.codigo, c.nome, c.telefone, c.email, c.desde, c.tier,
  count(v.id) filter (where v.status <> 'Cancelada') as pedidos,
  coalesce(sum(v.total) filter (where v.status <> 'Cancelada'), 0) as total,
  max(v.criado_em)::date as ultima_compra
from public.clientes c
left join public.vendas v on v.cliente_id = c.id
group by c.id;
alter view public.vw_clientes_resumo set (security_invoker = on);

create or replace view public.vw_resumo as
select
  (select coalesce(sum(total), 0) from public.vendas
    where status <> 'Cancelada' and criado_em >= date_trunc('month', current_date)) as faturamento_mes,
  (select coalesce(sum(total), 0) from public.vendas
    where status <> 'Cancelada' and criado_em::date = current_date) as faturamento_hoje,
  (select count(*) from public.vendas where criado_em::date = current_date) as vendas_hoje,
  (select count(*) from public.vendas
    where status = 'Cancelada' and criado_em::date = current_date) as cancelamentos_hoje,
  (select coalesce(avg(total), 0) from public.vendas where status <> 'Cancelada') as ticket_medio,
  (select count(*) from public.clientes) as total_clientes,
  (select count(*) from public.clientes where desde >= current_date - 30) as novos_clientes,
  (select count(*) from public.clientes where tier = 'VIP') as clientes_vip,
  (select coalesce(sum(quantidade * custo), 0) from public.produtos where ativo) as valor_estoque,
  (select count(*) from public.produtos where ativo and quantidade < minimo) as itens_abaixo_minimo;
alter view public.vw_resumo set (security_invoker = on);

create or replace view public.vw_faturamento_diario as
select criado_em::date as dia, sum(total) as total
from public.vendas
where status <> 'Cancelada' and criado_em >= current_date - 30
group by 1
order by 1;
alter view public.vw_faturamento_diario set (security_invoker = on);

grant select on public.vw_clientes_resumo, public.vw_resumo, public.vw_faturamento_diario to authenticated;

notify pgrst, 'reload schema';
