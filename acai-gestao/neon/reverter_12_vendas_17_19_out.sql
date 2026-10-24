-- ============================================================================
-- Reversão da 12 — apaga exatamente o que a geração de 17–19/10 criou
-- ============================================================================
-- Reverte `12_vendas_17_19_out.sql`. A ordem importa: lançamentos primeiro,
-- depois itens, depois vendas.
--
-- Três ressalvas:
--
-- 1) O RANGE DE CÓDIGOS é o da execução real em produção (#9391–#9534). Vendas
--    feitas DEPOIS desta geração recebem códigos maiores e ficam de fora —
--    por isso a janela é um range e não um "tudo de 17/10 em diante".
--
-- 2) O GUARDA DO LIVRO-RAZÃO: só é apagada a venda que NÃO tem movimento em
--    `movimentacoes_estoque`. A geração nunca toca no livro (é o padrão do
--    seed: as vendas históricas não têm movimento), então as dela passam; uma
--    venda da geração que tenha sido estornada depois (e ganhou o movimento
--    inverso) fica. Sem este guarda, o delete dos itens esbarra no RESTRICT do
--    `movimentacoes_estoque.item_venda_id` — foi assim que o validador pegou
--    o problema na primeira versão deste arquivo.
--
-- 3) OS LANÇAMENTOS: as despesas recorrentes de 17/10 em diante e os PDV de
--    18/10 em diante são apagados (o app não lança "Vendas do dia (PDV)"
--    sozinho — a venda não gera lançamento financeiro —, então só pode ser o
--    que a geração gravou; mas se alguém criar um PDV ou uma despesa dessas
--    para 18/10 em diante, a reversão apaga também). O PDV de 17/10 é
--    diferente: ele JÁ existia do seed, e a geração só atualizou o valor.
--    Por isso ele é restaurado no passo 4, e não apagado.
--
-- 4) A sequência volta ao maior código que restou (a mesma lógica da 10).
-- ============================================================================

begin;

-- 1) As despesas recorrentes da geração (o histórico termina em 16/10, então
--    isto só pode ter sido criado por esta geração)
delete from public.lancamentos
 where descricao in (
       'Compra de polpa de açaí',
       'Frutas e adicionais',
       'Embalagens e descartáveis',
       'Energia elétrica',
       'Pagamento de funcionário',
       'Marketing digital'
     )
   and data >= '2026-10-17';

-- 2) Os PDV dos dias que NÃO tinham antes (17/10 já tinha do seed — ver passo 4)
delete from public.lancamentos
 where descricao = 'Vendas do dia (PDV)'
   and data >= '2026-10-18';

-- 3) Itens e vendas da geração (só os que estão livres no livro-razão)
delete from public.itens_venda
 where venda_id in (
       select v.id
         from public.vendas v
        where v.codigo between '#9391' and '#9534'
          and not exists (
                select 1
                  from public.movimentacoes_estoque m
                  join public.itens_venda i on i.id = m.item_venda_id
                 where i.venda_id = v.id
              )
     );

delete from public.vendas
 where codigo between '#9391' and '#9534'
   and not exists (
         select 1
           from public.movimentacoes_estoque m
           join public.itens_venda i on i.id = m.item_venda_id
          where i.venda_id = vendas.id
       );

-- 4) O PDV de 17/10 volta ao valor de antes da geração. As vendas desta
--    geração acabam de ser apagadas, então a soma do que restou daquele dia
--    (todas com código menor que #9391) é exatamente o total que o seed tinha
--    gravado — a reversão não precisa saber o número de cor.
update public.lancamentos l
   set valor = (
         select coalesce(round(sum(v.total), 2), 0)
           from public.vendas v
          where v.status <> 'Cancelada'
            and v.criado_em::date = '2026-10-17'
            and v.codigo < '#9391'
       )
 where l.descricao = 'Vendas do dia (PDV)'
   and l.data = '2026-10-17';

-- 4) A sequência volta ao maior código que restou
do $$
declare
  v_maior bigint;
begin
  select max((substring(codigo from 2))::bigint)
    into v_maior
    from public.vendas
   where codigo ~ '^#[0-9]+$';

  perform setval('public.vendas_codigo_seq', greatest(coalesce(v_maior, 0), 4800), true);
end
$$;

commit;

-- Conferência: nada da geração resta.
select
  (select count(*) from public.vendas where codigo between '#9391' and '#9534') as vendas_restantes,
  (select count(*) from public.lancamentos
    where descricao = 'Vendas do dia (PDV)' and data >= '2026-10-17') as pdvs_restantes;
