-- ============================================================================
-- Desfaz a 11 (estorno).
-- ============================================================================
--
-- O que NÃO tem estado anterior a restaurar, de propósito:
--
--   • derrubar `estorno_de_id` NÃO apaga as linhas que um dia foram criadas por
--     um estorno — o livro-razão é imutável (06). Elas perdem só o vínculo com
--     o movimento original; o saldo derivado continua certo, porque é a soma do
--     livro.
--   • `vendas.estornada_em`/`estornada_por` e o status 'Cancelada' também não
--     voltam atrás: uma venda estornada não volta a ser 'Concluída'.
--
-- O que este arquivo faz é só o "esquema": derruba a função, o índice único e
-- as colunas da 11. Quem chama o estorno (a tela de Vendas) para de achar a RPC
-- e o botão deixa de fazer efeito.
-- ============================================================================

drop function if exists public.estornar_venda(uuid, text);

drop index if exists public.mov_estoque_estorno_unico;

alter table public.movimentacoes_estoque drop column if exists estorno_de_id;
alter table public.vendas drop column if exists estornada_em;
alter table public.vendas drop column if exists estornada_por;

-- Mesmo aviso da 11, pelo mesmo motivo: o cache do Data API precisa largar a
-- função (no Neon: `npx neon data-api refresh-schema`).
notify pgrst, 'reload schema';
