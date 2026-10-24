-- ============================================================================
-- Reversão da 08 · Venda transacional
-- ============================================================================
-- Desfaz o que a `08_vendas_transacionais.sql` criou e devolve as permissões
-- largas que existiam antes (DML direto em vendas/itens_venda).
--
-- ATENÇÃO: isto APAGA os dados de peso e o total das linhas de venda. Se já
-- houver venda por peso registrada, ela perde bruto, tara, líquido, recipiente
-- e o valor da linha. É reversão de desenvolvimento, não operação de produção.
--
-- Uso:  node neon/aplicar.mjs reverter_08
-- ============================================================================

-- ============================================================================
-- 1. As portas de escrita
-- ============================================================================
drop function if exists public.registrar_venda(jsonb, text, uuid, text, text, text);
drop function if exists public.inteiro_do_item(jsonb, text, text);
drop function if exists public.numero_do_item(jsonb, text, text);

drop sequence if exists public.vendas_codigo_seq;

-- ============================================================================
-- 2. Colunas novas
-- ============================================================================
alter table public.itens_venda drop constraint if exists itens_venda_recipiente_fk;
alter table public.itens_venda drop column if exists total;
alter table public.itens_venda drop column if exists metodo_peso;
alter table public.itens_venda drop column if exists peso_bruto_g;
alter table public.itens_venda drop column if exists tara_g;
alter table public.itens_venda drop column if exists peso_liquido_g;
alter table public.itens_venda drop column if exists recipiente_id;

drop index if exists public.idx_itens_venda_recipiente;

alter table public.vendas drop constraint if exists vendas_usuario_fk;
drop index if exists public.vendas_chave_idempotencia_idx;
alter table public.vendas drop column if exists chave_idempotencia;
alter table public.vendas drop column if exists usuario_id;

-- ============================================================================
-- 3. GRANTs e políticas, de volta ao que a 00/01 deixaram
-- ============================================================================
grant select, insert, update, delete on public.vendas, public.itens_venda to authenticated;

drop policy if exists vendas_leitura on public.vendas;
drop policy if exists itens_venda_leitura on public.itens_venda;
drop policy if exists usuario_vendas on public.vendas;
drop policy if exists usuario_itens_venda on public.itens_venda;

create policy usuario_vendas on public.vendas
  for all to authenticated using (true) with check (true);

create policy usuario_itens_venda on public.itens_venda
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- 4. Conferência (não altera nada)
-- ============================================================================
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='itens_venda'
--      and column_name in ('total','metodo_peso','peso_liquido_g');
--   -- esperado: 0
