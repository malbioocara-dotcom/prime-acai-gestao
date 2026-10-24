-- ============================================================================
-- 12. Vendas de 17 a 19 de outubro de 2026 (dados de estudo)
-- ============================================================================
-- A base só tinha movimento até 16/10; os três dias seguintes estavam vazios.
-- Este arquivo preenche 17, 18 e 19 de outubro com o MESMO padrão do seed
-- (seção 10 da `00_banco_neon.sql`): vendas, itens, o lançamento "Vendas do dia
-- (PDV)" e as despesas recorrentes do período.
--
-- Três decisões que importam:
--
-- 1) O DIA É O DIA DO OPERADOR (America/Fortaleza, UTC−3), não o dia UTC.
--    O banco roda em GMT, e é por isso que o seed distribuía as vendas das
--09h às 18h: `dia + 9h + random()*9h` em GMT são 06h–15h em Fortaleza. Aqui a
--    janela é 09h–21h LOCAL (12h–24h UTC), escrita com offset explícito
--    (`T12:00:00Z`) para não depender do fuso da sessão.
--
-- 2) O CÓDIGO VEM DA SEQUÊNCIA. A venda #9390 já existe (foi registrada hoje
--    pelo app), então a próxima é #9391. Usar `nextval()` no próprio insert
--    garante isso sem contar ninguém: sem colisão com o que já existe e sem
--    setval manual — a sequência termina exatamente no último código gerado.
--    A venda #9390 também NÃO recebe itens deste script (ela já tem os seus).
--
-- 3) O LIVRO-RAZÃO DO ESTOQUE NÃO É TOCADO — igual ao seed. As 8389 vendas
--    históricas não têm movimento de estoque; esta geração segue o mesmo
--    padrão. (O movimento só nasce da RPC `registrar_venda`, que calcula o
--    peso e valida o saldo.)
--
-- As vendas de HOJE são limitadas a `now()` (a loja abriu às 9h; o que
-- estiver no futuro não existe). Os totais seguem o seed: gerados por sorteio,
-- independente dos itens — como os 8389 registros que já existiam.
--
-- NÃO reexecutar: este arquivo insere, não é idempotente. Para desfazer, rode
-- `node neon/aplicar.mjs reverter_12` (ou o arquivo `reverter_12_vendas_17_19_out.sql`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) As vendas
--
-- 52 + 48 + 44 = 144 pedidos, dentro da faixa do seed (44–64/dia).
-- Códigos: #9391 em diante (a sequência decide; hoje ela estava em 9390).
-- ----------------------------------------------------------------------------
insert into public.vendas (codigo, cliente_id, status, pagamento, total, criado_em)
select
  '#' || lpad(nextval('public.vendas_codigo_seq')::text, 4, '0'),
  c.id,
  (array['Concluída', 'Concluída', 'Concluída', 'Concluída', 'Em preparo', 'Aguardando', 'Cancelada'])[(1 + floor(random() * 7))::int],
  (array['Pix', 'Crédito', 'Débito', 'Dinheiro'])[(1 + floor(random() * 4))::int],
  round((18 + random() * 90)::numeric, 2),
  least(
    (d.dia::text || 'T12:00:00Z')::timestamptz + (random() * interval '12 hours'),
    now()
  )
from (
  select date '2026-10-17' as dia, 52 as pedidos
  union all select date '2026-10-18', 48
  union all select date '2026-10-19', 44
) d
cross join lateral generate_series(1, d.pedidos) as pedido (n)
cross join lateral (
  select id from public.clientes order by random() limit 1
) c;

-- ----------------------------------------------------------------------------
-- 2) Os itens de cada venda
--
-- `codigo >= '#9391'` separa esta geração do que já existia (a #9390 de hoje
-- já tem os seus itens e fica de fora). 1–2 itens por pedido, como o seed.
-- ----------------------------------------------------------------------------
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
  where v.codigo >= '#9391'
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

-- ----------------------------------------------------------------------------
-- 3) O lançamento financeiro do dia
--
-- Uma linha "Vendas do dia (PDV)" por dia, como o seed fazia — mas com duas
-- regras que a execução real mostrou fazerem falta:
--
--   • TOTAL DO DIA INTEIRO, não só desta geração: a data é `criado_em::date`
--     (UTC, o fuso da sessão — o mesmo critério do seed) e a soma é de todas
--     as vendas não canceladas do dia, inclusive as que já existiam (a #9390,
--     feita pelo app, entra no PDV de 19/10).
--
--   • ATUALIZA EM VEZ DE DUPLICAR: 17/10 já tinha um PDV do seed (as vendas
--     que rodaram naquele dia). A primeira versão deste script inseria outro, e o
--     dia ficou com duas linhas. Aqui a linha existente é atualizada; a linha
--     só é inserida num dia que ainda não tem PDV.
--
-- Por isso as vendas das 21h–24h de um dia caem no PDV do dia seguinte (UTC):
-- é o mesmo comportamento do seed, e o que as views da base esperam.
-- ----------------------------------------------------------------------------
with pdv as (
  select criado_em::date as dia, round(sum(total), 2) as total
    from public.vendas
   where status <> 'Cancelada'
     and criado_em::date >= '2026-10-17'
   group by 1
)
update public.lancamentos l
   set valor = pdv.total
  from pdv
 where l.descricao = 'Vendas do dia (PDV)'
   and l.data = pdv.dia;

insert into public.lancamentos (descricao, categoria, tipo, valor, forma, data)
select 'Vendas do dia (PDV)', 'Vendas', 'entrada', t.total, 'Misto', t.dia
  from (
    select criado_em::date as dia, round(sum(total), 2) as total
      from public.vendas
     where status <> 'Cancelada'
       and criado_em::date >= '2026-10-17'
     group by 1
  ) t
 where not exists (
       select 1 from public.lancamentos l
        where l.descricao = 'Vendas do dia (PDV)'
          and l.data = t.dia
     );

-- ----------------------------------------------------------------------------
-- 4) As despesas recorrentes do período
--
-- Mesma tabela do seed e MESMA ÂNCORA (17/05 — o dia em que a 00 rodou), para
-- que a fase do calendário continue a de antes: 18/10 compra polpa e 19/10
-- compra embalagens. As demais categorias não caem nenhum dos três dias.
-- ----------------------------------------------------------------------------
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
  date '2026-05-17',
  date '2026-10-19',
  make_interval(days => t.a_cada_dias)
) as d;

-- ----------------------------------------------------------------------------
-- 5) Conferência (não altera nada)
-- ----------------------------------------------------------------------------
select 'vendas geradas' as item, count(*)::text as valor
  from public.vendas where codigo >= '#9391'
union all
select 'itens gerados', count(*)::text
  from public.itens_venda i
  join public.vendas v on v.id = i.venda_id
 where v.codigo >= '#9391'
union all
select 'dias com PDV', count(*)::text
  from public.lancamentos
 where descricao = 'Vendas do dia (PDV)'
   and data >= '2026-10-17'
union all
select 'despesas geradas', count(*)::text
  from public.lancamentos
 where descricao in ('Compra de polpa de açaí', 'Frutas e adicionais', 'Embalagens e descartáveis')
   and data >= '2026-10-17';

-- A sequência já está onde deve estar: o próximo pedido é o código seguinte
-- ao último gerado, sem ninguém precisar de setval.
select '#' || (case when s.is_called then s.last_value + 1 else s.last_value end)::text as proximo_codigo
  from public.vendas_codigo_seq s;
