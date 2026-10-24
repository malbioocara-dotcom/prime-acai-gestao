-- ============================================================================
-- Reverter 07 · Estoque: RPCs de movimentação
-- ============================================================================
-- Só as funções. A 06 (livro-razão + saldo) continua aplicada — para desfazer
-- tudo, rode esta antes de `reverter_06`.
--
-- Efeito: o navegador perde as duas portas de escrita no estoque. O livro-razão
-- e o saldo continuam válidos; só não há mais como registrar movimento pela
-- tela.
--
-- Rodar com:  node neon/aplicar.mjs reverter_07
-- ============================================================================

drop function if exists public.registrar_movimentacao(uuid, numeric, text, text, text);
drop function if exists public.ajustar_saldo(uuid, numeric, text, text);

-- ============================================================================
-- Conferência
-- ============================================================================
-- Esperado: as duas consultas não retornam linha.
--
--   select proname from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('registrar_movimentacao', 'ajustar_saldo');
