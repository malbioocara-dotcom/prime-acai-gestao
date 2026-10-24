-- ============================================================================
-- 07 · Estoque: movimentação vinda do navegador (RPC)
-- ============================================================================
-- Re-executável e não destrutivo. Depende de 06.
--
-- POR QUE SÃO RPCs E NÃO INSERT DIRETO
--   A 06 não dá INSERT em `movimentacoes_estoque` para ninguém: quem escreve é
--   uma função `security definer`. Isso concentra num só lugar o que o banco
--   não pode deixar passar —
--
--     • permissão conferida no banco (`estoque.criar` / `estoque.editar`),
--       não na tela;
--     • `usuario_id` carimbado com o usuário da sessão: o navegador não pode
--       dizer quem é nem movimentar em nome de outro;
--     • `organization_id` vindo do banco;
--     • movimento + saldo do produto numa transação só — o navegador não tem
--       transação, e sem isso um INSERT poderia valer com o saldo falhando.
--
-- DUAS PORTAS, PROPOSITALMENTE
--   `registrar_movimentacao` — o dia a dia: compra, uso no buffet, sobra,
--     perda, venda. Não aceita 'abertura' nem 'contagem': essas são contagem
--     física, não movimento operacional.
--   `ajustar_saldo` — contagem física: o operador informa o número CONTADO e a
--     função registra a diferença (para cima ou para baixo). É assim que o
--     sistema entra no ar com os itens que já existiam.
--
-- Reverter: neon/reverter_07_movimentacoes_rpc.sql
-- ============================================================================

-- ============================================================================
-- 1. Movimento operacional
-- ============================================================================
create or replace function public.registrar_movimentacao(
  p_produto_id uuid,
  p_qtd        numeric,
  p_origem     text,
  p_destino    text,
  p_motivo     text
)
returns table (
  id         uuid,
  produto_id uuid,
  quantidade numeric,
  origem     text,
  destino    text,
  motivo     text,
  saldo      numeric,
  criado_em  timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := public.minha_organizacao();
  v_usuario  uuid := auth.uid();
  v_nome     text;
  v_controla boolean;
  v_id       uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para registrar a movimentação.';
  end if;

  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para movimentar estoque.'
      using errcode = '42501';
  end if;

  select p.nome, p.controla_estoque
    into v_nome, v_controla
    from public.produtos p
   where p.id = p_produto_id;

  if v_nome is null then
    raise exception 'Item de estoque não encontrado.';
  end if;

  if not v_controla then
    raise exception 'O item "%" está marcado como "sem controle de estoque".', v_nome;
  end if;

  if p_qtd is null or p_qtd <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;

  -- Movimento sem motivo é movimento que ninguém consegue auditar depois.
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da movimentação.';
  end if;

  if p_origem is null
     or p_origem not in ('fornecedor', 'estoque', 'buffet', 'sobra', 'perda', 'cliente')
     or p_destino is null
     or p_destino not in ('fornecedor', 'estoque', 'buffet', 'sobra', 'perda', 'cliente') then
    raise exception
      'Origem e destino precisam ser um destes locais: fornecedor, estoque, buffet, sobra, perda, cliente.';
  end if;

  if p_origem = p_destino then
    raise exception 'A origem e o destino não podem ser o mesmo local (%).', p_origem;
  end if;

  -- Daqui para baixo é tudo o que o navegador não consegue fazer junto.
  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values
    (v_org, p_produto_id, p_qtd, p_origem, p_destino, btrim(p_motivo), v_usuario)
  returning movimentacoes_estoque.id into v_id;

  return query
    select m.id,
           m.produto_id,
           m.quantidade,
           m.origem,
           m.destino,
           m.motivo,
           public.saldo_estoque(m.produto_id),
           m.criado_em
      from public.movimentacoes_estoque m
     where m.id = v_id;
end;
$$;

comment on function public.registrar_movimentacao(uuid, numeric, text, text, text) is
  'Registra um movimento de estoque (compra, buffet, sobra, perda, venda). Exige estoque.criar e motivo.';

-- ============================================================================
-- 2. Contagem física (ajuste de saldo)
-- ============================================================================
create or replace function public.ajustar_saldo(
  p_produto_id uuid,
  p_contado    numeric,
  p_motivo     text,
  p_local      text default 'contagem'
)
returns table (
  saldo_anterior  numeric,
  saldo           numeric,
  movimentacao_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := public.minha_organizacao();
  v_usuario  uuid := auth.uid();
  v_nome     text;
  v_controla boolean;
  v_atual    numeric;
  v_delta    numeric;
  v_origem   text;
  v_destino  text;
  v_id       uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para ajustar o saldo.';
  end if;

  -- Ajuste mexe no saldo diretamente: pede a permissão de EDITAR, não a de
  -- criar movimento avulso.
  if not public.pode('estoque', 'editar') then
    raise exception 'Sua conta não tem permissão para ajustar saldo de estoque.'
      using errcode = '42501';
  end if;

  select p.nome, p.controla_estoque
    into v_nome, v_controla
    from public.produtos p
   where p.id = p_produto_id;

  if v_nome is null then
    raise exception 'Item de estoque não encontrado.';
  end if;

  if not v_controla then
    raise exception 'O item "%" está marcado como "sem controle de estoque".', v_nome;
  end if;

  if p_contado is null or p_contado < 0 then
    raise exception 'A quantidade contada não pode ser negativa.';
  end if;

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do ajuste.';
  end if;

  if p_local is null or p_local not in ('abertura', 'contagem') then
    raise exception 'O ajuste por contagem usa o local "abertura" (saldo inicial) ou "contagem" (contagem física).';
  end if;

  v_atual := public.saldo_estoque(p_produto_id);
  v_delta := p_contado - v_atual;

  -- Contou exatamente o que o sistema já diz: não inventa movimento. Um
  -- lançamento de valor zero só poluiria o histórico.
  if v_delta = 0 then
    return query select v_atual, v_atual, null::uuid;
    return;
  end if;

  if v_delta > 0 then
    v_origem  := p_local;    -- abertura/contagem -> estoque
    v_destino := 'estoque';
  else
    v_origem  := 'estoque';  -- estoque -> abertura/contagem
    v_destino := p_local;
  end if;

  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values
    (v_org, p_produto_id, abs(v_delta), v_origem, v_destino, btrim(p_motivo), v_usuario)
  returning movimentacoes_estoque.id into v_id;

  return query select v_atual, public.saldo_estoque(p_produto_id), v_id;
end;
$$;

comment on function public.ajustar_saldo(uuid, numeric, text, text) is
  'Contagem física: informa o saldo CONTADO e registra só a diferença. Exige estoque.editar.';

-- ============================================================================
-- 3. GRANTs
-- ============================================================================
-- São as duas únicas portas de escrita no estoque, e as duas conferem
-- permissão por dentro — por isso podem ser expostas ao papel `authenticated`.
do $$
begin
  revoke execute on function public.registrar_movimentacao(uuid, numeric, text, text, text) from public, anonymous;
  revoke execute on function public.ajustar_saldo(uuid, numeric, text, text) from public, anonymous;

  grant execute on function public.registrar_movimentacao(uuid, numeric, text, text, text) to authenticated;
  grant execute on function public.ajustar_saldo(uuid, numeric, text, text) to authenticated;
end
$$;

-- ============================================================================
-- 4. Conferência (não altera nada)
-- ============================================================================
-- Chamada de leitura, sem mover nada:
--
--   select public.saldo_estoque('<uuid do produto>');
--
-- Movimentar de verdade (troque o uuid):
--
--   select * from public.registrar_movimentacao(
--     '<uuid>', 10, 'fornecedor', 'estoque', 'Compra de 10 kg');
