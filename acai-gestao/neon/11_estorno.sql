-- ============================================================================
-- 11 · Estorno: desfazer uma venda sem reescrever o passado
-- ============================================================================
-- Re-executável e não destrutivo. Depende de 00, 01, 06, 07, 08 e 09.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE
--   A 08 fez a venda nascer inteira — com os movimentos de estoque que ela tira
--   — mas não deixou caminho para DESFAZER. O status 'Cancelada' que a tela
--   oferece só vale no instante do cadastro: a venda entra no histórico SEM tirar
--   estoque. Uma venda já gravada como 'Concluída' tirou o estoque da prateleira
--   e não havia como devolvê-lo — só um UPDATE na mão, que a 09 bloqueia.
--
-- O QUE ESTORNAR É (E O QUE NÃO É)
--   Não é apagar: o livro-razão é imutável (06). Estornar é registrar o
--   movimento INVERSO — o que saiu de `estoque` para o `cliente` volta de
--   `cliente` para o `estoque`, com quantidade igual, um motivo, o autor e a
--   ligação com o movimento original. O saldo se refaz sozinho, porque é a soma
--   do livro.
--
--       venda:     estoque -> cliente   (o que a 08 gravou)
--       estorno:   cliente -> estoque   (o inverso; mesma quantidade)
--
-- POR QUE UMA COLUNA NOVA NO LIVRO
--   `movimentacoes_estoque.estorno_de_id` aponta o movimento que foi estornado.
--   O índice único parcial logo abaixo garante, NO BANCO, que um movimento só
--   pode ser estornado UMA vez — a mesma ideia do índice de `item_venda_id` da
--   06. Sem ele, um clique duplo devolveria o estoque duas vezes.
--
-- POR QUE O STATUS VIRA 'Cancelada' (e não um status novo)
--   As views de faturamento da 00 somam `status <> 'Cancelada'`. Estornar é
--   exatamente tirar a venda do faturamento: usar o status que já existe faz a
--   conta sair certa sozinha, sem tocar em nenhuma view. O que distingue "nasceu
--   cancelada" de "foi estornada depois" é `vendas.estornada_em`.
--
-- QUEM PODE ESTORNAR
--   `vendas.editar` ("Alterar pedido"), conferida pelo banco. Quem só vende
--   (operador de caixa tem `vendas.criar`, não `editar`) não estorna.
--
-- Reverter: neon/reverter_11_estorno.sql
-- ============================================================================

-- ============================================================================
-- 1. O rastro do estorno
-- ============================================================================
-- `restrict` porque movimentação é histórico: apagar o movimento estornado não
-- pode apagar o inverso em silêncio (e o livro nem permite apagar).
alter table public.movimentacoes_estoque
  add column if not exists estorno_de_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'movimentacoes_estorno_fk') then
    alter table public.movimentacoes_estoque
      add constraint movimentacoes_estorno_fk foreign key (estorno_de_id)
      references public.movimentacoes_estoque (id) on delete restrict;
  end if;
end
$$;

-- A regra "um movimento só se estorna uma vez" mora aqui, não no código.
create unique index if not exists mov_estoque_estorno_unico
  on public.movimentacoes_estoque (estorno_de_id) where estorno_de_id is not null;

-- `estornada_em`/`estornada_por` marcam a venda estornada e guardam quem
-- estornou e quando. `set null` no autor: apagar o perfil não apaga o fato.
alter table public.vendas add column if not exists estornada_em  timestamptz;
alter table public.vendas add column if not exists estornada_por uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendas_estornada_por_fk') then
    alter table public.vendas
      add constraint vendas_estornada_por_fk foreign key (estornada_por)
      references public.profiles (id) on delete set null;
  end if;

  -- Venda estornada É venda cancelada (é o status que tira do faturamento). O
  -- contrário não vale: quem nasce 'Cancelada' nunca foi estornada.
  if not exists (select 1 from pg_constraint where conname = 'vendas_estorno_cancela') then
    alter table public.vendas
      add constraint vendas_estorno_cancela check (estornada_em is null or status = 'Cancelada');
  end if;
end
$$;

-- ============================================================================
-- 2. O estorno, numa transação
-- ============================================================================
create or replace function public.estornar_venda(
  p_venda_id uuid,
  p_motivo   text
)
returns table (
  venda_id     uuid,
  codigo       text,
  status       text,
  total        numeric,
  movimentos   integer,
  ja_estornada boolean,
  estornada_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org     uuid := public.minha_organizacao();
  v_venda   public.vendas%rowtype;
  v_motivo  text := nullif(btrim(p_motivo), '');
  v_mov     integer := 0;
  v_reg     record;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para estornar a venda.';
  end if;

  -- Estornar mexe no PEDIDO e no ESTOQUE: pede a permissão de alterar pedido,
  -- não a de criar. Assim o operador de caixa — que vende, mas não altera — não
  -- consegue desfazer a própria venda.
  if not public.pode('vendas', 'editar') then
    raise exception 'Sua conta não tem permissão para estornar venda.'
      using errcode = '42501';
  end if;

  if p_venda_id is null then
    raise exception 'Informe o pedido a estornar.';
  end if;

  -- Trava a venda: dois estornos ao mesmo tempo não se atropelam. O segundo
  -- espera o primeiro terminar e então já encontra a venda estornada.
  select * into v_venda
    from public.vendas v
   where v.id = p_venda_id
     for update;

  if v_venda.id is null then
    raise exception 'Pedido não encontrado.';
  end if;

  -- Já estornado: devolve o mesmo resultado, sem devolver estoque de novo. É o
  -- caminho da resposta que se perdeu no meio e o operador repetiu o clique.
  if v_venda.estornada_em is not null then
    return query
      select v.id, v.codigo, v.status, v.total, 0, true, v.estornada_em
        from public.vendas v
       where v.id = p_venda_id;
    return;
  end if;

  -- Nasceu cancelada (a 08 não tirou estoque): não há o que devolver.
  if v_venda.status = 'Cancelada' then
    raise exception 'O pedido % já está cancelado.', v_venda.codigo;
  end if;

  -- Movimento sem motivo é movimento que ninguém audita depois.
  if v_motivo is null then
    raise exception 'Informe o motivo do estorno.';
  end if;

  -- Cada movimento que a venda tirou do estoque ganha o seu inverso. Só os
  -- ORIGINAIS entram (`estorno_de_id is null`): um estorno não se estorna.
  for v_reg in
    select m.id, m.produto_id, m.quantidade, m.origem, m.destino
      from public.movimentacoes_estoque m
     where m.venda_id = p_venda_id
       and m.estorno_de_id is null
     order by m.criado_em
       for update
  loop
    insert into public.movimentacoes_estoque
      (organization_id, produto_id, quantidade, origem, destino, motivo,
       venda_id, item_venda_id, usuario_id, estorno_de_id)
    values
      (v_org, v_reg.produto_id, v_reg.quantidade, v_reg.destino, v_reg.origem,
       'Estorno ' || v_venda.codigo || ': ' || v_motivo,
       p_venda_id, null, v_usuario, v_reg.id);

    v_mov := v_mov + 1;
  end loop;

  update public.vendas
     set status = 'Cancelada',
         estornada_em = now(),
         estornada_por = v_usuario
   where id = p_venda_id;

  -- Estorno é evento sensível: avisa quem administra. Uma linha por estorno
  -- (sem duplicidade), com o autor no `actor_user_id` para a notificação poder
  -- dizer quem fez.
  insert into public.notifications
    (organization_id, recipient_role, tipo, titulo, mensagem, link, actor_user_id)
  values
    (v_org, 'admin', 'venda_estornada',
     'Venda estornada',
     'O pedido ' || v_venda.codigo
       || ' (R$ ' || replace(to_char(v_venda.total, 'FM999999990.00'), '.', ',')
       || ') foi estornado: ' || v_motivo,
     '/vendas', v_usuario);

  return query
    select v.id, v.codigo, v.status, v.total, v_mov, false, v.estornada_em
      from public.vendas v
     where v.id = p_venda_id;
end;
$$;

comment on function public.estornar_venda(uuid, text) is
  'Estorna a venda: devolve o estoque com o movimento inverso, cancela o pedido e deixa o rastro (quem, quando, por quê). Exige vendas.editar. Repetir não devolve estoque duas vezes.';

-- ============================================================================
-- 3. GRANTs
-- ============================================================================
-- A RPC confere a permissão por dentro (`vendas.editar`), por isso pode ser
-- exposta ao papel `authenticated`. A escrita direta nas tabelas continua
-- fechada pela 09.
do $$
begin
  revoke execute on function public.estornar_venda(uuid, text) from public, anonymous;
  grant execute on function public.estornar_venda(uuid, text) to authenticated;
end
$$;

-- ============================================================================
-- 4. Conferência (não altera nada)
-- ============================================================================
-- Vendas estornadas e quem estornou:
--
--   select v.codigo, v.status, v.estornada_em, p.full_name as estornada_por
--     from public.vendas v left join public.profiles p on p.id = v.estornada_por
--    where v.estornada_em is not null
--    order by v.estornada_em desc;
--
-- O inverso de um movimento estornado:
--
--   select m.criado_em, m.origem, m.destino, m.quantidade, m.motivo, m.estorno_de_id
--     from public.movimentacoes_estoque m
--    where m.venda_id = '<uuid da venda>' order by m.criado_em;

-- O Data API guarda um cache do esquema e não enxerga uma função nova sozinho.
-- O `notify` é o caminho do PostgREST puro (self-hosted); no Neon, quem manda
-- atualizar é a CLI:
--
--   npx neon data-api refresh-schema --project-id <projeto> --database neondb
notify pgrst, 'reload schema';
