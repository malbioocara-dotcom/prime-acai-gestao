-- ============================================================================
-- Reversão da 09 · Vendas: volta a escrita direta
-- ============================================================================
-- Devolve INSERT/UPDATE/DELETE em `vendas`/`itens_venda` para `authenticated`,
-- como a 00/01 deixaram. Serve para voltar a um app que grave sem passar pela
-- RPC — por exemplo durante um rollback do frontend.
--
-- Uso:  node neon/aplicar.mjs reverter_09
-- ============================================================================

grant select, insert, update, delete on public.vendas, public.itens_venda to authenticated;

-- ============================================================================
-- Conferência (não altera nada)
-- ============================================================================
--   select privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='vendas' and grantee='authenticated'
--    order by 1;
--   -- esperado: DELETE, INSERT, SELECT, UPDATE
