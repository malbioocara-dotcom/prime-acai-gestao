-- ============================================================================
-- Reverter 06 · Estoque: livro-razão de movimentações
-- ============================================================================
-- Desfaz a 06 por completo: tira o trigger que governa `produtos.quantidade`,
-- apaga o livro-razão e as funções.
--
-- O QUE ACONTECE COM OS SALDOS
--   `produtos.quantidade` fica exatamente com o último valor que o livro-razão
--   calculou. Nenhum saldo é perdido nem zerado — o que se perde é o HISTÓRICO
--   (quem movimentou, quando, por quê). É por isso que esta reversão é para
--   emergência, não para uso rotineiro.
--
-- Rodar com:  node neon/aplicar.mjs reverter_06
-- ============================================================================

-- 1. Primeiro o trigger em `produtos`: sem ele, o saldo volta a ser um campo
--    que qualquer UPDATE altera (é o comportamento da 05).
drop trigger if exists produtos_saldo_do_livro on public.produtos;

-- 2. Depois o trigger de aplicação de saldo (evita update em tabela que está
--    para ser apagada).
drop trigger if exists movimentacoes_estoque_aplica_saldo on public.movimentacoes_estoque;

-- 3. Por último o de imutabilidade (é ele que impede o DELETE abaixo).
drop trigger if exists movimentacoes_estoque_imutavel on public.movimentacoes_estoque;

-- 4. O livro-razão em si. `cascade` levaria junto os índices e as policies.
drop table if exists public.movimentacoes_estoque;

-- 5. As funções — só depois de não haver mais nada que as chame.
drop function if exists public.produtos_saldo_vem_do_livro();
drop function if exists public.movimento_de_estoque_aplica_saldo();
drop function if exists public.movimentacao_e_imutavel();
drop function if exists public.saldo_estoque(uuid);

-- ============================================================================
-- Conferência
-- ============================================================================
-- Esperado: `to_regclass` nulo e nenhum trigger em produtos.
--
--   select to_regclass('public.movimentacoes_estoque');
--   select tgname from pg_trigger
--    where tgrelid = 'public.produtos'::regclass and not tgisinternal;
