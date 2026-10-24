-- ============================================================================
-- REVERSÃO da migração 04 · Produtos por tipo de venda e recipientes
-- ============================================================================
-- Desfaz EXATAMENTE o que `04_produtos_e_recipientes.sql` criou.
--
-- ATENÇÃO — o que se perde
--   • As tabelas `recipientes` e `recipientes_historico` são APAGADAS, com
--     todas as taras cadastradas e todo o histórico de alteração.
--   • As colunas novas de `produtos` são apagadas, com o tipo de venda, o
--     controle de estoque e o método de peso de cada produto.
--   Os produtos em si, os saldos, as vendas e os itens NÃO são tocados.
--
-- Ordem: reverter a 05 (RLS) antes desta, se ela tiver sido aplicada — a 05 só
-- troca políticas de `produtos`, então não há dependência real entre as duas.
--
-- Este arquivo NÃO é aplicado por `node neon/aplicar.mjs` sem filtro, porque o
-- nome não começa com número. Para rodá-lo:
--   node neon/aplicar.mjs reverter_04
-- ============================================================================

drop trigger if exists recipientes_historico_trg on public.recipientes;
drop trigger if exists recipientes_updated_at      on public.recipientes;
drop function if exists public.registrar_historico_recipiente();

drop table if exists public.recipientes_historico;
drop table if exists public.recipientes;

-- As constraints que referenciam estas colunas caem junto com elas.
alter table public.produtos drop column if exists descricao;
alter table public.produtos drop column if exists tipo_venda;
alter table public.produtos drop column if exists controla_estoque;
alter table public.produtos drop column if exists metodo_estoque;
alter table public.produtos drop column if exists metodo_peso;

drop index if exists public.idx_produtos_tipo_venda;

comment on column public.produtos.preco is null;

-- Conferência: não deve sobrar nada.
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='produtos'
--    and column_name in ('descricao','tipo_venda','controla_estoque','metodo_estoque','metodo_peso');
-- select to_regclass('public.recipientes'), to_regclass('public.recipientes_historico');
