-- ============================================================================
-- REVERSÃO da migração 05 · Produtos: volta a política permissiva da 00
-- ============================================================================
-- Restaura exatamente o que `05_produtos_rls_permissoes.sql` substituiu:
--   for all to authenticated using (true) with check (true)
--
-- ⚠ Isto REABRE o buraco: qualquer pessoa logada volta a poder inserir,
--   alterar e apagar produtos pelo Data API, ignorando a tela de Permissões.
--   Use só para diagnosticar ("será que foi a 05 que quebrou o Estoque?").
--
-- Para rodar:
--   node neon/aplicar.mjs reverter_05
-- ============================================================================

drop policy if exists produtos_leitura  on public.produtos;
drop policy if exists produtos_criacao  on public.produtos;
drop policy if exists produtos_edicao   on public.produtos;
drop policy if exists produtos_exclusao on public.produtos;

drop policy if exists usuario_produtos on public.produtos;
create policy usuario_produtos on public.produtos
  for all to authenticated
  using (true)
  with check (true);

-- Conferência: deve existir UMA política (usuario_produtos, cmd=ALL).
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='produtos';
