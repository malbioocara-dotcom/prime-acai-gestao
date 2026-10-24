-- ============================================================================
-- 05 · Produtos: RLS por PERMISSÃO (e não mais "qualquer logado")
-- ============================================================================
-- Re-executável e NÃO destrutivo. Depende de 00, 01 e 04.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE
--   A 00_banco_neon.sql deixou as tabelas de negócio com
--       for all to authenticated using (true) with check (true)
--   Ou seja: a interface esconde o botão "Novo item" de quem não tem
--   `estoque.criar`, mas o banco aceitava o INSERT de qualquer pessoa logada.
--   Como este é justamente o módulo de Estoque, a política passa a exigir a
--   permissão de verdade — a autoridade continua sendo `public.pode(...)`,
--   a mesma que a tela de Permissões edita.
--
-- ALCANCE
--   Só `public.produtos`. As outras tabelas de negócio (vendas, itens_venda,
--   clientes, lancamentos) seguem como estão: mudá-las agora quebraria fluxos
--   que não fazem parte desta entrega.
--
-- IMPACTO ESPERADO
--   • admin / manager: nada muda (têm todas as ações de 'estoque').
--   • cashier: continua LENDO produtos (tem estoque.consultar) e passa a não
--     poder cadastrar/editar/excluir — exatamente o que a tela já mostrava.
--   • Uma negação individual de `estoque.consultar` faz a tela de Estoque e o
--     `valor_estoque` do Dashboard caírem para dados de exemplo. É o
--     comportamento correto: sem permissão, sem dado.
--
-- Reverter: neon/reverter_05_produtos_rls_permissoes.sql
-- ============================================================================

-- Sai a política permissiva da 00, entram as quatro por ação.
drop policy if exists usuario_produtos on public.produtos;

drop policy if exists produtos_leitura  on public.produtos;
drop policy if exists produtos_criacao  on public.produtos;
drop policy if exists produtos_edicao   on public.produtos;
drop policy if exists produtos_exclusao on public.produtos;

-- O `(select ...)` em volta de `pode()` faz o Postgres resolvê-la UMA vez por
-- consulta (initplan), em vez de reavaliar por linha.
create policy produtos_leitura on public.produtos
  for select to authenticated
  using ((select public.pode('estoque', 'consultar')));

create policy produtos_criacao on public.produtos
  for insert to authenticated
  with check ((select public.pode('estoque', 'criar')));

create policy produtos_edicao on public.produtos
  for update to authenticated
  using ((select public.pode('estoque', 'editar')))
  with check ((select public.pode('estoque', 'editar')));

create policy produtos_exclusao on public.produtos
  for delete to authenticated
  using ((select public.pode('estoque', 'excluir')));

-- ============================================================================
-- Conferência
-- ============================================================================
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='produtos' order by policyname;
-- Esperado: produtos_criacao(INSERT), produtos_edicao(UPDATE),
--           produtos_exclusao(DELETE), produtos_leitura(SELECT).
