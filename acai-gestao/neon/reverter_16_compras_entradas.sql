-- ============================================================================
-- Reverter · 16 Compras e entradas de mercadoria
-- ============================================================================
-- Desfaz o que a migração 16 criou. NÃO mexe em estoque já movimentado: se já
-- houve recebimento, o livro-razão (`movimentacoes_estoque`) continua sendo
-- histórico e não é apagado. Use com consciência.
-- ============================================================================

-- As tabelas primeiro: as políticas (e a função do RPC, que depende do tipo da
-- tabela) caem junto com elas.
drop table if exists public.compras_itens cascade;
drop table if exists public.compras cascade;
drop table if exists public.fornecedores cascade;

drop function if exists public.confirmar_recebimento_compra(uuid, jsonb);
drop function if exists public.compra_editavel(uuid);
drop function if exists public.compra_da_organizacao(uuid);
drop function if exists public.tocar_atualizado_em_compra();

delete from public.permissions where module_key = 'compras';
