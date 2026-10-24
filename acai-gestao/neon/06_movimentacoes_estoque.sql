-- ============================================================================
-- 06 · Estoque: livro-razão de movimentações
-- ============================================================================
-- Re-executável e não destrutivo. Depende de 00, 01 e 04.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE
--   `produtos.quantidade` era um número solto: nascia com o valor digitado no
--   cadastro e nunca mais mudava. Não existia como registrar uma compra, um
--   preparo de buffet, uma sobra reaproveitada ou uma perda — nem como saber
--   quem mexeu, quando e por quê. Sem isso a venda por peso (P3) e o
--   fechamento do buffet (P5) não teriam em que se apoiar.
--
-- O QUE ELA FAZ
--   Todo saldo passa a ser DERIVADO de um livro-razão append-only. Cada linha
--   de `movimentacoes_estoque` tira uma quantidade de um LOCAL (`origem`) e
--   põe em outro (`destino`):
--
--       saldo = Σ movimentos que ENTRAM em 'estoque'
--             − Σ movimentos que SAEM de 'estoque'
--
--   `produtos.quantidade` continua existindo, agora como CACHE desse cálculo,
--   reescrito por trigger. É ele que as telas, as views e o Dashboard já leem
--   — mudar isso quebraria o que está no ar. E o cache NUNCA é digitado: o
--   trigger sobrescreve qualquer valor que venha do navegador pelo valor do
--   livro-razão. Editar saldo à mão é impossível, não é só desencorajado.
--
-- OS LOCAIS (vocabulário único, validado por CHECK)
--   abertura   contagem inicial, quando o sistema entra no ar
--   contagem   contagem física de fechamento (P5)
--   fornecedor fora da loja: compra
--   estoque    o estoque da loja — é o único que mexe em produtos.quantidade
--   buffet     o que foi preparado e está em uso no buffet
--   sobra      sobra reaproveitável, devolvida ao estoque
--   perda      descarte: vencido, estragado, derramado
--   cliente    fora da loja: venda
--
-- POR QUE O LIVRO É IMUTÁVEL
--   Nenhuma linha pode ser alterada nem apagada. Corrigir um lançamento é
--   registrar o lançamento inverso — é o que o estorno (P4) vai fazer. Assim
--   nenhum saldo histórico muda sem deixar rastro.
--
-- QUEM ESCREVE
--   Ninguém escreve direto: não há GRANT de INSERT/UPDATE/DELETE para
--   `authenticated`. Quem insere é o RPC `registrar_movimentacao()` (migração
--   07), que confere permissão, carimba o usuário da sessão e mantém tudo numa
--   transação só.
--
-- Reverter: neon/reverter_06_movimentacoes_estoque.sql
-- ============================================================================

-- ============================================================================
-- 1. O livro-razão
-- ============================================================================
create table if not exists public.movimentacoes_estoque (
  id              uuid primary key default gen_random_uuid(),
  -- Mesmo padrão de `recipientes`: a organização vem do banco, nunca do corpo
  -- da requisição. `restrict` (e não `cascade`) porque apagar uma organização
  -- não pode apagar em silêncio o histórico do que mexeu no estoque.
  organization_id uuid not null default public.minha_organizacao()
                  references public.organizations (id) on delete restrict,
  -- `restrict`: movimentação é histórico. Apagar o produto não pode apagar o
  -- rastro do que aconteceu com ele.
  produto_id      uuid not null references public.produtos (id) on delete restrict,
  quantidade      numeric(12, 3) not null check (quantidade > 0),
  origem          text not null
                  check (origem in ('abertura', 'contagem', 'fornecedor', 'estoque',
                                    'buffet', 'sobra', 'perda', 'cliente')),
  destino         text not null
                  check (destino in ('abertura', 'contagem', 'fornecedor', 'estoque',
                                     'buffet', 'sobra', 'perda', 'cliente')),
  motivo          text not null default '',
  -- Vínculo com a venda (P3/P4). `item_venda_id` é o que garante a dedução
  -- única: o índice abaixo não deixa dois movimentos nascerem do mesmo item.
  venda_id        uuid references public.vendas (id) on delete restrict,
  item_venda_id   uuid references public.itens_venda (id) on delete restrict,
  usuario_id      uuid references public.profiles (id) on delete set null,
  criado_em       timestamptz not null default now(),

  constraint movimentacoes_locais_diferentes check (origem <> destino),
  -- Um movimento de venda pertence a uma venda; o contrário não é obrigatório
  -- (uma compra não tem venda).
  constraint movimentacoes_item_exige_venda
    check (item_venda_id is null or venda_id is not null)
);

create index if not exists idx_mov_estoque_produto
  on public.movimentacoes_estoque (produto_id, criado_em desc);
create index if not exists idx_mov_estoque_org
  on public.movimentacoes_estoque (organization_id, criado_em desc);
create index if not exists idx_mov_estoque_venda
  on public.movimentacoes_estoque (venda_id) where venda_id is not null;

-- A regra "nunca deduzir duas vezes" mora aqui: um item de venda gera no
-- máximo UM movimento de estoque. Não é convenção de código — é o banco.
create unique index if not exists mov_estoque_item_venda_unico
  on public.movimentacoes_estoque (item_venda_id) where item_venda_id is not null;

-- ============================================================================
-- 2. O saldo a partir do livro-razão
-- ============================================================================
-- `security definer` porque quem chama (a sessão do navegador) não tem SELECT
-- nas linhas de outras organizações — o cálculo é do banco, não do cliente.
create or replace function public.saldo_estoque(p_produto_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sum(case when m.destino = 'estoque' then m.quantidade
             when m.origem  = 'estoque' then -m.quantidade
             else 0::numeric end),
    0::numeric)
    from public.movimentacoes_estoque m
   where m.produto_id = p_produto_id
$$;

-- ============================================================================
-- 3. Triggers
-- ============================================================================

-- 3.1 O livro é imutável.
create or replace function public.movimentacao_e_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'Movimentação de estoque não pode ser alterada nem apagada (é histórico). Registre a movimentação inversa para corrigir.';
end;
$$;

drop trigger if exists movimentacoes_estoque_imutavel on public.movimentacoes_estoque;
create trigger movimentacoes_estoque_imutavel
  before update or delete on public.movimentacoes_estoque
  for each row execute function public.movimentacao_e_imutavel();

-- 3.2 Cada movimento refaz o cache do produto.
create or replace function public.movimento_de_estoque_aplica_saldo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só 'estoque' tem saldo. Uma compra que vai direto para o buffet não passa
  -- pelo estoque da loja, então não mexe em `produtos.quantidade`.
  if new.destino = 'estoque' or new.origem = 'estoque' then
    update public.produtos
       set quantidade = public.saldo_estoque(new.produto_id)
     where id = new.produto_id;
  end if;

  return null;
end;
$$;

drop trigger if exists movimentacoes_estoque_aplica_saldo on public.movimentacoes_estoque;
create trigger movimentacoes_estoque_aplica_saldo
  after insert on public.movimentacoes_estoque
  for each row execute function public.movimento_de_estoque_aplica_saldo();

-- 3.3 `produtos.quantidade` é cache: o livro-razão manda.
create or replace function public.produtos_saldo_vem_do_livro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saldo numeric;
begin
  v_saldo := public.saldo_estoque(new.id);

  -- `produtos.quantidade` tem `check (quantidade >= 0)`. A mensagem do check
  -- seria técnica; aqui o erro explica o que fazer.
  if v_saldo < 0 then
    raise exception
      'Saldo insuficiente para "%": o livro-razão fecharia em % %. Registre a entrada antes de dar esta saída.',
      new.nome, v_saldo, new.unidade;
  end if;

  -- Sobrescreve o que o navegador mandou. Não há caminho para "digitar"
  -- saldo: no INSERT de um item novo o livro está vazio, então isto zera.
  new.quantidade := v_saldo;
  return new;
end;
$$;

drop trigger if exists produtos_saldo_do_livro on public.produtos;
create trigger produtos_saldo_do_livro
  before insert or update on public.produtos
  for each row execute function public.produtos_saldo_vem_do_livro();

-- ============================================================================
-- 4. Saldos iniciais: o que já existia entra no livro
-- ============================================================================
-- Os itens cadastrados ANTES desta migração têm saldo mas não têm histórico.
-- Sem este passo, o primeiro UPDATE em qualquer um deles zeraria o saldo (o
-- trigger acima o recalcularia de um livro vazio). Consolidar aqui, ANTES de
-- existir gente escrevendo, é o que torna o cache verdadeiro.
--
-- É idempotente: só cria a abertura de quem ainda não tem NENHUM movimento.
-- Rodar de novo não duplica nada.
--
-- `organization_id` explícito porque esta linha nasce fora de uma sessão de
-- usuário (o `default` depende do JWT). Hoje a loja é única; quando houver
-- mais de uma, `produtos` ganha `organization_id` e isto passa a vir de lá.
insert into public.movimentacoes_estoque
  (organization_id, produto_id, quantidade, origem, destino, motivo)
select (select o.id from public.organizations o order by o.created_at, o.id limit 1),
       p.id,
       p.quantidade,
       'abertura',
       'estoque',
       'Saldo inicial do cadastro, consolidado pela migração 06'
  from public.produtos p
 where p.quantidade <> 0
   and not exists (
     select 1 from public.movimentacoes_estoque m where m.produto_id = p.id
   );

-- ============================================================================
-- 5. GRANTs e RLS
-- ============================================================================
-- Mesmo cuidado da 01 e da 04: o Data API concede DML amplo nas tabelas do
-- schema public, então REVOGAMOS tudo e devolvemos só o necessário.
revoke all on public.movimentacoes_estoque from anonymous, authenticated;

-- Leitura só. Sem INSERT/UPDATE/DELETE: quem escreve é o RPC (migração 07) e
-- o trigger de imutabilidade fecha a porta dos fundos.
grant select on public.movimentacoes_estoque to authenticated;

alter table public.movimentacoes_estoque enable row level security;

-- Quem consulta estoque lê o histórico do estoque — a mesma permissão que
-- abre a lista de produtos na 05, para não existir tela meio visível.
drop policy if exists movimentacoes_leitura on public.movimentacoes_estoque;
create policy movimentacoes_leitura on public.movimentacoes_estoque
  for select to authenticated
  using (
    organization_id = public.minha_organizacao()
    and (select public.pode('estoque', 'consultar'))
  );

-- As funções de trigger não são RPC: nunca são chamadas pelo navegador. Mesmo
-- assim seguem o padrão da 04 (revoga de public/anonymous, concede a
-- authenticated), porque é o papel que dispara os triggers.
do $$
begin
  revoke execute on function public.movimentacao_e_imutavel() from public, anonymous;
  revoke execute on function public.movimento_de_estoque_aplica_saldo() from public, anonymous;
  revoke execute on function public.produtos_saldo_vem_do_livro() from public, anonymous;
  revoke execute on function public.saldo_estoque(uuid) from public, anonymous;

  grant execute on function public.movimentacao_e_imutavel() to authenticated;
  grant execute on function public.movimento_de_estoque_aplica_saldo() to authenticated;
  grant execute on function public.produtos_saldo_vem_do_livro() to authenticated;
  grant execute on function public.saldo_estoque(uuid) to authenticated;
end
$$;

-- ============================================================================
-- 6. Conferência (não altera nada)
-- ============================================================================
-- Saldo do cache tem que bater com o livro-razão em TODOS os itens. Esperado:
-- nenhuma linha.
--
--   select p.codigo, p.nome, p.quantidade, public.saldo_estoque(p.id) as do_livro
--     from public.produtos p
--    where p.quantidade is distinct from public.saldo_estoque(p.id);
--
-- Histórico de um item:
--
--   select criado_em, origem, destino, quantidade, motivo, usuario_id
--     from public.movimentacoes_estoque
--    where produto_id = '<uuid>' order by criado_em desc;
