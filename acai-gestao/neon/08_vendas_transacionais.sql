-- ============================================================================
-- 08 · Venda transacional (RPC `registrar_venda`)
-- ============================================================================
-- Re-executável e não destrutivo. Depende de 00, 01, 04, 05, 06 e 07.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE
--   Até aqui a venda era montada pelo navegador: um INSERT em `vendas`, outro
--   em `itens_venda` e, se o segundo falhasse, um DELETE para não deixar pedido
--   vazio. Três viagens ao banco, nenhuma transação, e nada ligando a venda ao
--   estoque — vender não tirava nada da prateleira.
--
--   A P2 criou o livro-razão do estoque e o índice que impede um item de venda
--   gerar dois movimentos. Esta migração fecha o circuito: a venda e os seus
--   movimentos nascem JUNTOS, dentro de uma transação, por uma função que o
--   banco executa — não o navegador.
--
-- O QUE ELA FAZ
--   • `itens_venda` ganha o peso bruto, a tara, o peso líquido, o método de
--     peso e o recipiente usado. O peso líquido é o que era vendido; bruto e
--     tara ficam gravados para a conta poder ser refeita depois.
--   • `itens_venda.total` é coluna GERADA (`round(quantidade * preco, 2)`): o
--     valor da linha deixa de ser recalculado em ponto flutuante no navegador
--     (era onde `0,450 kg × R$ 69,90` dava R$ 31,45 em vez de R$ 31,46).
--   • `vendas` ganha `chave_idempotencia` (única) e `usuario_id`.
--   • A RPC `registrar_venda` grava venda + itens + movimentos numa transação,
--     confere permissão no banco, calcula o total e carimba quem vendeu.
--   • `vendas`/`itens_venda` passam a ser só de LEITURA para `authenticated`:
--     a única porta de escrita é a RPC.
--
-- A CONTA DO PESO É DO BANCO
--   O navegador manda o que foi lido na balança (bruto + tara, ou o líquido já
--   pronto). Quem subtrai a tara, converte gramas em quilos e multiplica pelo
--   preço é a função — em `numeric`, decimal exato. O preço NÃO vem do corpo da
--   requisição: vem de `produtos.preco`. O que a venda guarda é uma CÓPIA do
--   preço aplicado, para que mudar o cadastro depois não reescreva o passado.
--
-- POR QUE `metodo_peso = 'balanca'` É RECUSADO
--   O valor existe no domínio desde a 04 (para o contrato não quebrar), mas
--   este sistema não tem hardware nem backend para falar com balança. Aceitar
--   esse método gravaria uma venda que ninguém leu.
--
-- Reverter: neon/reverter_08_vendas_transacionais.sql
-- ============================================================================

-- ============================================================================
-- 1. A venda passa a ser rastreável
-- ============================================================================
alter table public.vendas add column if not exists chave_idempotencia text;
alter table public.vendas add column if not exists usuario_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendas_usuario_fk') then
    alter table public.vendas
      add constraint vendas_usuario_fk foreign key (usuario_id)
      references public.profiles (id) on delete set null;
  end if;
end
$$;

-- Duas requisições com a mesma chave são a MESMA venda (o operador clicou duas
-- vezes, a rede repetiu o POST). `where ... is not null` porque as vendas que já
-- existem não têm chave, e no Postgres vários nulos convivem num índice único.
create unique index if not exists vendas_chave_idempotencia_idx
  on public.vendas (chave_idempotencia) where chave_idempotencia is not null;

-- Código do pedido quando o operador não digita nenhum. Antes a tela adivinhava
-- (`max(codigo) + 1`), o que dava o mesmo número para dois caixas abrindo a tela
-- ao mesmo tempo. Sequência resolve a corrida.
create sequence if not exists public.vendas_codigo_seq;

do $$
declare
  v_maior bigint;
begin
  select max((substring(codigo from 2))::bigint)
    into v_maior
    from public.vendas
   where codigo ~ '^#[0-9]+$';

  -- `last_value` de uma sequência virgem é 1; só sobe se o histórico for maior.
  if coalesce(v_maior, 0) >= (select last_value from public.vendas_codigo_seq) then
    perform setval('public.vendas_codigo_seq', greatest(coalesce(v_maior, 0), 4800));
  end if;
end
$$;

-- ============================================================================
-- 2. O item da venda guarda como o peso foi apurado
-- ============================================================================
alter table public.itens_venda add column if not exists metodo_peso    text;
alter table public.itens_venda add column if not exists peso_bruto_g   integer;
alter table public.itens_venda add column if not exists tara_g         integer;
alter table public.itens_venda add column if not exists peso_liquido_g integer;
alter table public.itens_venda add column if not exists recipiente_id  uuid;

-- Valor da linha. GERADA pelo banco: não entra no INSERT e não pode ser
-- sobrescrita por ninguém. Vale para os três tipos de venda — num item por
-- peso, `quantidade` já é o líquido em quilos e `preco_unitario` o preço do
-- quilo, então a mesma fórmula serve.
alter table public.itens_venda add column if not exists total numeric(12, 2)
  generated always as (round(quantidade * preco_unitario, 2)) stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itens_venda_recipiente_fk') then
    alter table public.itens_venda
      add constraint itens_venda_recipiente_fk foreign key (recipiente_id)
      references public.recipientes (id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'itens_venda_metodo_peso_valido') then
    alter table public.itens_venda add constraint itens_venda_metodo_peso_valido
      check (metodo_peso is null or metodo_peso in ('liquido', 'bruto_tara', 'balanca'));
  end if;

  -- Bicondicional: item por peso tem peso líquido; item de unidade/receita não
  -- tem NENHUM dado de peso (nem zero, nem sobra de formulário).
  if not exists (select 1 from pg_constraint where conname = 'itens_venda_peso_coerente') then
    alter table public.itens_venda add constraint itens_venda_peso_coerente
      check ((metodo_peso is null) = (peso_liquido_g is null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'itens_venda_pesos_nao_negativos') then
    alter table public.itens_venda add constraint itens_venda_pesos_nao_negativos
      check ((peso_bruto_g is null or peso_bruto_g >= 0)
             and (tara_g is null or tara_g >= 0)
             and (peso_liquido_g is null or peso_liquido_g > 0));
  end if;

  -- 'bruto_tara': bruto e tara informados e a subtração fecha.
  if not exists (select 1 from pg_constraint where conname = 'itens_venda_bruto_menos_tara') then
    alter table public.itens_venda add constraint itens_venda_bruto_menos_tara
      check (metodo_peso is distinct from 'bruto_tara'
             or (peso_bruto_g is not null
                 and tara_g is not null
                 and peso_liquido_g = peso_bruto_g - tara_g));
  end if;

  -- 'liquido': a balança já descontou a tara. Guardar bruto/tara aqui seria
  -- convidar alguém a subtrair a tara de novo.
  if not exists (select 1 from pg_constraint where conname = 'itens_venda_liquido_sem_tara') then
    alter table public.itens_venda add constraint itens_venda_liquido_sem_tara
      check (metodo_peso is distinct from 'liquido'
             or (peso_bruto_g is null and tara_g is null));
  end if;

  -- Mesmo teto de `recipientes.tara_g`: pega o dedo na balança (300 no lugar
  -- de 30) antes de virar preço errado.
  if not exists (select 1 from pg_constraint where conname = 'itens_venda_tara_maxima') then
    alter table public.itens_venda add constraint itens_venda_tara_maxima
      check (tara_g is null or tara_g <= 5000);
  end if;

  -- A quantidade de um item por peso É o peso líquido em quilos.
  if not exists (select 1 from pg_constraint where conname = 'itens_venda_quantidade_e_o_liquido') then
    alter table public.itens_venda add constraint itens_venda_quantidade_e_o_liquido
      check (metodo_peso is null
             or quantidade = round(peso_liquido_g::numeric / 1000, 3));
  end if;
end
$$;

create index if not exists idx_itens_venda_recipiente
  on public.itens_venda (recipiente_id) where recipiente_id is not null;

-- ============================================================================
-- 3. Leitura de números vindos do JSON
-- ============================================================================
-- O navegador manda número como texto ("480", "0,450"). Estas duas funções são
-- o único lugar que converte, para a mensagem de erro ser sempre a mesma — e em
-- português. São internas: quem chama é a `registrar_venda`.
create or replace function public.numero_do_item(
  p_item   jsonb,
  p_campo  text,
  p_rotulo text
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'Item da venda em formato inesperado (era esperado um objeto).';
  end if;

  v_texto := btrim(coalesce(p_item ->> p_campo, ''));

  -- Ausente não é erro: quem chamou decide se o campo é obrigatório.
  if v_texto = '' then
    return null;
  end if;

  if v_texto !~ '^-?[0-9]+([.,][0-9]+)?$' then
    raise exception 'Informe um número válido para %.', p_rotulo;
  end if;

  return replace(v_texto, ',', '.')::numeric;
end;
$$;

comment on function public.numero_do_item(jsonb, text, text) is
  'Lê um número do item da venda; nulo quando o campo não veio. Uso interno da registrar_venda().';

create or replace function public.inteiro_do_item(
  p_item   jsonb,
  p_campo  text,
  p_rotulo text
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_numero numeric := public.numero_do_item(p_item, p_campo, p_rotulo);
begin
  if v_numero is null then
    return null;
  end if;

  if v_numero < 0 then
    raise exception '% não pode ser negativo.', p_rotulo;
  end if;

  -- Gramas inteiras: é a precisão de uma balança de cozinha e o que as colunas
  -- `peso_*_g` aceitam.
  return round(v_numero)::integer;
end;
$$;

comment on function public.inteiro_do_item(jsonb, text, text) is
  'Como numero_do_item, mas em gramas inteiras e recusando negativo.';

-- ============================================================================
-- 4. A venda transacional
-- ============================================================================
create or replace function public.registrar_venda(
  p_itens      jsonb,
  p_chave      text default null,
  p_cliente_id uuid default null,
  p_pagamento  text default 'Pix',
  p_status     text default 'Concluída',
  p_codigo     text default null
)
returns table (
  id         uuid,
  codigo     text,
  total      numeric,
  status     text,
  pagamento  text,
  criado_em  timestamptz,
  ja_existia boolean,
  itens      integer,
  movimentos integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := public.minha_organizacao();
  v_usuario  uuid := auth.uid();
  v_chave    text := nullif(btrim(coalesce(p_chave, '')), '');
  v_codigo   text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_venda    uuid;
  -- Criada AGORA (true) x já existia por causa da chave (false). É o que separa
  -- "registrei a venda e baixei o estoque" de "isto já tinha sido registrado".
  v_nova     boolean := false;
  v_itens    integer := 0;
  v_mov      integer := 0;
  v_total    numeric(12, 2);
  v_deduz    boolean;
  v_item     jsonb;
  v_prod     record;
  v_prod_id  uuid;
  v_item_id  uuid;
  v_metodo   text;
  v_bruto    integer;
  v_tara     integer;
  v_liquido  integer;
  v_qtd      numeric(12, 3);
  v_numero   numeric;
  v_recip    uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para registrar a venda.';
  end if;

  if not public.pode('vendas', 'criar') then
    raise exception 'Sua conta não tem permissão para registrar venda.'
      using errcode = '42501';
  end if;

  -- ------------------------------------------------------- já foi registrada?
  -- Caminho comum do "cliquei duas vezes": a venda existe, devolve ela mesma
  -- sem tocar em estoque.
  if v_chave is not null then
    select v.id into v_venda
      from public.vendas v
     where v.chave_idempotencia = v_chave;
  end if;

  if v_venda is null then
    if p_itens is null or jsonb_typeof(p_itens) <> 'array'
       or coalesce(jsonb_array_length(p_itens), 0) = 0 then
      raise exception 'A venda precisa de pelo menos um item.';
    end if;

    if p_status is null
       or p_status not in ('Aguardando', 'Em preparo', 'Concluída', 'Cancelada') then
      raise exception 'Status inválido para a venda: %.', coalesce(p_status, '(vazio)');
    end if;

    if p_pagamento is null
       or p_pagamento not in ('Pix', 'Crédito', 'Débito', 'Dinheiro', 'Misto') then
      raise exception 'Forma de pagamento inválida: %.', coalesce(p_pagamento, '(vazio)');
    end if;

    if p_cliente_id is not null
       and not exists (select 1 from public.clientes c where c.id = p_cliente_id) then
      raise exception 'Cliente não encontrado.';
    end if;

    if v_codigo is null then
      v_codigo := '#' || nextval('public.vendas_codigo_seq')::text;
    end if;

    if exists (select 1 from public.vendas v where v.codigo = v_codigo) then
      raise exception 'O pedido % já existe. Use outro código de pedido.', v_codigo;
    end if;

    -- Duas requisições simultâneas com a mesma chave caem aqui: a segunda
    -- espera a primeira commitar e recebe `unique_violation`. Em vez de um erro
    -- técnico, vira o mesmo resultado idempotente.
    begin
      insert into public.vendas as v
        (codigo, cliente_id, status, pagamento, total, chave_idempotencia, usuario_id)
      values
        (v_codigo, p_cliente_id, p_status, p_pagamento, 0, v_chave, v_usuario)
      returning v.id into v_venda;

      v_nova := true;
    exception
      when unique_violation then
        if v_chave is not null then
          select v.id into v_venda
            from public.vendas v
           where v.chave_idempotencia = v_chave;
        end if;

        if v_venda is null then
          raise exception 'O pedido % já existe. Use outro código de pedido.', v_codigo;
        end if;
    end;
  end if;

  -- ------------------------------------------------------------- os itens ---
  if v_nova then
    -- `Cancelada` entra no histórico mas não tira estoque: quem cancela depois
    -- usa o estorno (P4), que registra o movimento inverso.
    v_deduz := coalesce(p_status, 'Concluída') <> 'Cancelada';

    for v_item in select value from jsonb_array_elements(p_itens) loop
      begin
        v_prod_id := nullif(btrim(coalesce(v_item ->> 'produto_id', '')), '')::uuid;
      exception
        when others then
          v_prod_id := null;
      end;

      if v_prod_id is null then
        raise exception 'Todo item da venda precisa de um produto do cadastro.';
      end if;

      select p.id, p.nome, p.tipo_venda, p.metodo_peso, p.preco,
             p.controla_estoque, p.metodo_estoque
        into v_prod
        from public.produtos p
       where p.id = v_prod_id;

      if v_prod.id is null then
        raise exception 'Item de estoque não encontrado (produto_id %).', v_prod_id;
      end if;

      v_metodo  := null;
      v_bruto   := null;
      v_tara    := null;
      v_liquido := null;
      v_recip   := null;

      if v_prod.tipo_venda = 'peso' then
        v_metodo := coalesce(
          nullif(btrim(coalesce(v_item ->> 'metodo_peso', '')), ''),
          v_prod.metodo_peso
        );

        if v_metodo = 'balanca' or v_prod.metodo_peso = 'balanca' then
          raise exception 'A leitura por balança integrada ainda não está disponível neste sistema.';
        end if;

        if v_metodo not in ('liquido', 'bruto_tara') then
          raise exception 'Informe como o peso de "%" foi obtido.', v_prod.nome;
        end if;

        begin
          v_recip := nullif(btrim(coalesce(v_item ->> 'recipiente_id', '')), '')::uuid;
        exception
          when others then
            v_recip := null;
        end;

        if v_recip is not null
           and not exists (select 1 from public.recipientes r where r.id = v_recip) then
          raise exception 'Recipiente não encontrado (recipiente_id %).', v_recip;
        end if;

        if v_metodo = 'liquido' then
          -- A balança já descontou a tara: bruto e tara ficam NULOS.
          v_liquido := public.inteiro_do_item(
            v_item, 'peso_liquido_g', 'o peso líquido de "' || v_prod.nome || '"'
          );

          if v_liquido is null then
            raise exception 'Informe o peso líquido de "%".', v_prod.nome;
          end if;
          if v_liquido <= 0 then
            raise exception 'O peso líquido de "%" precisa ser maior que zero.', v_prod.nome;
          end if;
        else
          v_bruto := public.inteiro_do_item(
            v_item, 'peso_bruto_g', 'o peso bruto de "' || v_prod.nome || '"'
          );
          v_tara := public.inteiro_do_item(
            v_item, 'tara_g', 'a tara de "' || v_prod.nome || '"'
          );

          -- Sem tara digitada, vale a do recipiente escolhido no cadastro.
          if v_tara is null and v_recip is not null then
            select r.tara_g into v_tara from public.recipientes r where r.id = v_recip;
          end if;

          if v_bruto is null then
            raise exception 'Informe o peso bruto de "%".', v_prod.nome;
          end if;
          if v_tara is null then
            raise exception
              'Informe a tara de "%" ou escolha o recipiente: no método "peso bruto menos a tara" ela é obrigatória.',
              v_prod.nome;
          end if;
          if v_tara > 5000 then
            raise exception 'A tara de "%" não pode passar de 5000 g. Confira a gramatura.', v_prod.nome;
          end if;
          if v_tara > v_bruto then
            raise exception
              'A tara de "%" não pode ser maior que o peso bruto (o peso líquido ficaria negativo).',
              v_prod.nome;
          end if;

          v_liquido := v_bruto - v_tara;

          if v_liquido <= 0 then
            raise exception 'O peso líquido de "%" ficou zero. Confira o peso bruto e a tara.', v_prod.nome;
          end if;
        end if;

        -- Quilos com 3 casas — a quantidade do item por peso É o líquido.
        v_qtd := round(v_liquido::numeric / 1000, 3);
      else
        if nullif(btrim(coalesce(v_item ->> 'metodo_peso', '')), '') is not null then
          raise exception 'O item "%" não é vendido por peso.', v_prod.nome;
        end if;

        v_qtd := public.numero_do_item(
          v_item, 'quantidade', 'a quantidade de "' || v_prod.nome || '"'
        );

        if v_qtd is null then
          raise exception 'Informe a quantidade de "%".', v_prod.nome;
        end if;
        if v_qtd <= 0 then
          raise exception 'A quantidade de "%" precisa ser maior que zero.', v_prod.nome;
        end if;
      end if;

      -- O preço é o do cadastro: o corpo da requisição não manda no preço.
      insert into public.itens_venda as i
        (venda_id, produto_id, descricao, quantidade, preco_unitario,
         metodo_peso, peso_bruto_g, tara_g, peso_liquido_g, recipiente_id)
      values
        (v_venda, v_prod.id, v_prod.nome, v_qtd, v_prod.preco,
         v_metodo, v_bruto, v_tara, v_liquido, v_recip)
      returning i.id into v_item_id;

      v_itens := v_itens + 1;

      -- Um item -> no máximo UM movimento. O índice único de `item_venda_id`
      -- (migração 06) é quem garante, não a boa vontade do código.
      if v_deduz and v_prod.controla_estoque and v_prod.metodo_estoque = 'movimentacoes' then
        insert into public.movimentacoes_estoque
          (organization_id, produto_id, quantidade, origem, destino, motivo,
           venda_id, item_venda_id, usuario_id)
        values
          (v_org, v_prod.id, v_qtd, 'estoque', 'cliente',
           'Venda ' || v_codigo, v_venda, v_item_id, v_usuario);

        v_mov := v_mov + 1;
      end if;
    end loop;

    -- Total do pedido = soma dos totais das linhas, como numa nota: cada linha
    -- é arredondada uma vez e o pedido soma valores já fechados.
    select coalesce(sum(i.total), 0) into v_total
      from public.itens_venda i
     where i.venda_id = v_venda;

    update public.vendas v set total = v_total where v.id = v_venda;
  end if;

  return query
    select v.id,
           v.codigo,
           v.total,
           v.status,
           v.pagamento,
           v.criado_em,
           (not v_nova),
           (select count(*)::integer from public.itens_venda i where i.venda_id = v.id),
           (select count(*)::integer from public.movimentacoes_estoque m where m.venda_id = v.id)
      from public.vendas v
     where v.id = v_venda;
end;
$$;

comment on function public.registrar_venda(jsonb, text, uuid, text, text, text) is
  'Registra a venda inteira (itens, pesos, total e movimentos de estoque) numa transação. Exige vendas.criar. Repetir a mesma chave não duplica nada.';

-- ============================================================================
-- 5. GRANTs e RLS
-- ============================================================================
-- O Data API concede DML amplo nas tabelas do schema public; a 00 revogou o que
-- sabia e deixou `vendas`/`itens_venda` abertos para os papéis.
--
-- A REVOGAÇÃO da escrita NÃO fica aqui: ela mora na `09_vendas_somente_rpc.sql`.
-- O motivo é não ter janela de app quebrado — esta migração é ADITIVA (colunas,
-- sequência e a RPC nova), então o app que está no ar continua vendendo pelo
-- caminho antigo enquanto o frontend novo não sobe. Só depois do deploy a porta
-- antiga fecha.
grant select on public.vendas, public.itens_venda to authenticated;

alter table public.vendas      enable row level security;
alter table public.itens_venda enable row level security;

-- `vendas` e `itens_venda` nasceram antes de existir organização por linha
-- (lacuna de loja única, documentada desde a fase 1): a política aqui é por
-- PERMISSÃO, que é o que dá para garantir sem inventar coluna.
drop policy if exists usuario_vendas on public.vendas;
drop policy if exists usuario_itens_venda on public.itens_venda;

drop policy if exists vendas_leitura on public.vendas;
create policy vendas_leitura on public.vendas
  for select to authenticated
  using ((select public.pode('vendas', 'consultar')));

drop policy if exists itens_venda_leitura on public.itens_venda;
create policy itens_venda_leitura on public.itens_venda
  for select to authenticated
  using ((select public.pode('vendas', 'consultar')));

-- As funções auxiliares NÃO são RPC: quem chama é a `registrar_venda`, que é
-- `security definer`. Sem GRANT para ninguém, não há como chamá-las de fora.
do $$
begin
  revoke execute on function public.numero_do_item(jsonb, text, text) from public, anonymous;
  revoke execute on function public.inteiro_do_item(jsonb, text, text) from public, anonymous;
  revoke execute on function public.registrar_venda(jsonb, text, uuid, text, text, text) from public, anonymous;

  grant execute on function public.registrar_venda(jsonb, text, uuid, text, text, text) to authenticated;
end
$$;

-- ============================================================================
-- 6. Conferência (não altera nada)
-- ============================================================================
-- Itens e venda têm que fechar (a coluna `total` é gerada, então isto acusa só
-- divergência de dado antigo, não de fórmula):
--
--   select v.codigo, v.total as da_venda, sum(i.total) as dos_itens
--     from public.vendas v join public.itens_venda i on i.venda_id = v.id
--    group by v.id, v.codigo, v.total
--   having v.total is distinct from sum(i.total);
--
-- Venda por peso sem o líquido correspondente (esperado: nenhuma linha):
--
--   select * from public.itens_venda
--    where metodo_peso is not null
--      and quantidade <> round(peso_liquido_g::numeric / 1000, 3);
