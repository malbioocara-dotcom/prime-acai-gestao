-- ============================================================================
-- 09 · Vendas: a única porta de escrita é a RPC
-- ============================================================================
-- Depende de 08. Re-executável.
--
-- POR QUE ESTA MIGRAÇÃO É SEPARADA DA 08
--   A 08 trouxe a `registrar_venda` e as colunas novas — tudo ADITIVO. O app
--   que estava no ar continuava vendendo pelo caminho antigo (INSERT direto em
--   `vendas` e `itens_venda`). Esta migração fecha esse caminho, e por isso só
--   pode ser aplicada DEPOIS que o frontend que usa a RPC estiver publicado.
--   Separar as duas é o que evita a janela em que ninguém consegue vender.
--
-- O QUE ELA FECHA, E POR QUÊ
--   Um INSERT direto em `vendas` criava pedido sem item, sem movimento de
--   estoque, sem total conferido e sem carimbo de quem vendeu — e o navegador
--   podia escolher o preço. Com a 08 existe uma função que faz tudo isso dentro
--   de uma transação; deixar a porta antiga aberta seria ter as duas verdades.
--
--   A LEITURA continua liberada para quem tem `vendas.consultar` (política
--   criada na 08). Só a escrita sai de cena.
--
-- Reverter: neon/reverter_09_vendas_somente_rpc.sql
-- ============================================================================

revoke insert, update, delete on public.vendas, public.itens_venda from anonymous, authenticated;

grant select on public.vendas, public.itens_venda to authenticated;

-- ============================================================================
-- Conferência (não altera nada)
-- ============================================================================
-- Esperado: nenhuma linha (INSERT/UPDATE/DELETE fora do dono).
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('vendas', 'itens_venda')
--      and grantee in ('authenticated', 'anonymous')
--      and privilege_type <> 'SELECT';
