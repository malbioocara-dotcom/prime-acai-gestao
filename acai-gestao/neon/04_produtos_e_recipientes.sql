-- ============================================================================
-- 04 · Produtos por tipo de venda e recipientes (tara)
-- ============================================================================
-- Re-executável e NÃO destrutivo. Depende de 00_banco_neon.sql e
-- 01_usuarios_permissoes.sql.
--
-- O que entra aqui
--   • produtos ganha: descrição, tipo de venda (peso / unidade / receita),
--     controle de estoque, método de controle e método de entrada do peso.
--   • tabela `recipientes`: identificação + tara em gramas + situação.
--   • tabela `recipientes_historico`: toda alteração de tara/nome, com quem e
--     quando. O histórico é escrito por TRIGGER (`security definer`), nunca
--     pelo navegador.
--
-- O que NÃO muda
--   • Nenhuma coluna é removida, nenhuma linha é apagada e nenhum dado de
--     negócio é inserido. `produtos.preco` continua sendo o preço de venda —
--     por quilo quando o tipo é 'peso' (a unidade da venda é derivada do tipo,
--     veja a função `public.unidade_de_venda`).
--   • O saldo (`produtos.quantidade`) continua uma coluna: ela vira saldo-cache
--     mantido por trigger a partir do ledger de movimentações (migração 06).
--     Aqui ainda não há ledger — a coluna segue editável como sempre foi.
--
-- Métodos de peso
--   'liquido'    — a balança/o operador informa o PESO LÍQUIDO já pronto.
--                  A tara NÃO é subtraída de novo.
--   'bruto_tara' — informa-se o peso BRUTO; o sistema subtrai a tara.
--   'balanca'    — reservado para integração física futura. Este projeto NÃO
--                  tem backend nem hardware para falar com balança, então o
--                  valor existe no domínio (para não quebrar contrato depois)
--                  mas NÃO é oferecido na interface nem aceito no cálculo.
--
-- Reverter: neon/reverter_04_produtos_e_recipientes.sql
-- ============================================================================

-- ============================================================================
-- 1. Colunas novas em produtos
-- ============================================================================
alter table public.produtos add column if not exists descricao        text;
alter table public.produtos add column if not exists tipo_venda       text     not null default 'unidade';
alter table public.produtos add column if not exists controla_estoque boolean  not null default true;
alter table public.produtos add column if not exists metodo_estoque   text     not null default 'movimentacoes';
alter table public.produtos add column if not exists metodo_peso      text;

-- Amplia a coluna `preco` do comentário "preço unitário" para "preço de venda,
-- na unidade derivada do tipo de venda" (por quilo quando tipo_venda='peso').
comment on column public.produtos.preco is
  'Preço de venda na unidade derivada de tipo_venda (por kg quando peso).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produtos_tipo_venda_valido') then
    alter table public.produtos add constraint produtos_tipo_venda_valido
      check (tipo_venda in ('peso', 'unidade', 'receita'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'produtos_metodo_estoque_valido') then
    alter table public.produtos add constraint produtos_metodo_estoque_valido
      check (metodo_estoque in ('movimentacoes', 'fechamento', 'nenhum'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'produtos_metodo_peso_valido') then
    alter table public.produtos add constraint produtos_metodo_peso_valido
      check (metodo_peso is null or metodo_peso in ('liquido', 'bruto_tara', 'balanca'));
  end if;

  -- Bicondicional: tipo 'peso' EXIGE método de peso, e só ele pode ter método.
  if not exists (select 1 from pg_constraint where conname = 'produtos_metodo_peso_coerente') then
    alter table public.produtos add constraint produtos_metodo_peso_coerente
      check ((tipo_venda = 'peso') = (metodo_peso is not null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'produtos_descricao_tamanho') then
    alter table public.produtos add constraint produtos_descricao_tamanho
      check (descricao is null or char_length(descricao) <= 500);
  end if;
end
$$;

create index if not exists idx_produtos_tipo_venda on public.produtos (tipo_venda);

-- Unidade de VENDA x unidade de ESTOQUE
--   A unidade de venda é derivada do tipo e NÃO vira coluna: duas colunas
--   poderiam divergir. A regra (a mesma de `unidadeDeVenda` em
--   src/services/produtos.js) é:
--       'peso'    -> kg
--       'receita' -> porção
--       'unidade' -> un
--   `produtos.unidade` continua sendo a unidade de ESTOQUE (como o item é
--   contado), que pode ser outra: uma receita tem estoque em 'un' e preço por
--   'porção'.

-- ============================================================================
-- 2. Recipientes (tara)
-- ============================================================================
create table if not exists public.recipientes (
  id              uuid primary key default gen_random_uuid(),
  -- A organização vem do BANCO (sessão), nunca do navegador.
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations (id) on delete cascade,
  nome            text not null,
  tara_g          integer not null default 0 check (tara_g >= 0),
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipientes_nome_tamanho') then
    alter table public.recipientes add constraint recipientes_nome_tamanho
      check (char_length(btrim(nome)) between 1 and 80);
  end if;

  -- Trava de sanidade: nenhum recipiente real passa de 5 kg. Existe para pegar
  -- dedo-na-balança (300 em vez de 30) antes de virar preço errado na venda.
  if not exists (select 1 from pg_constraint where conname = 'recipientes_tara_maxima') then
    alter table public.recipientes add constraint recipientes_tara_maxima
      check (tara_g <= 5000);
  end if;
end
$$;

-- Nome único entre os ATIVOS (dá para desativar "Copo 500ml" e cadastrar outro
-- com o mesmo nome depois). Case-insensitive, sem espaços nas pontas.
create unique index if not exists recipientes_nome_ativo_idx
  on public.recipientes (organization_id, lower(btrim(nome)))
  where ativo;

create index if not exists idx_recipientes_org on public.recipientes (organization_id);

-- -------------------------------------------------------------- histórico --
create table if not exists public.recipientes_historico (
  id              uuid primary key default gen_random_uuid(),
  recipiente_id   uuid not null references public.recipientes (id) on delete cascade,
  organization_id uuid not null,
  nome_anterior   text,
  nome_novo       text,
  tara_g_anterior integer,
  tara_g_novo     integer,
  alterado_por    uuid,
  alterado_em     timestamptz not null default now()
);

-- Quem alterou aponta para `profiles` (e não para o auth) por dois motivos:
-- integridade e o embed `profiles(nome)` no Data API, que é como a tela mostra
-- o autor sem uma consulta a mais.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipientes_historico_autor_fk') then
    alter table public.recipientes_historico
      add constraint recipientes_historico_autor_fk
      foreign key (alterado_por) references public.profiles (id) on delete set null;
  end if;
end
$$;

create index if not exists idx_recipientes_hist on public.recipientes_historico (recipiente_id, alterado_em desc);

-- Trigger do updated_at (reusa a função criada na 00).
drop trigger if exists recipientes_updated_at on public.recipientes;
create trigger recipientes_updated_at
  before update on public.recipientes
  for each row execute function public.tocar_updated_at();

-- Histórico de alteração. É `security definer` por dois motivos:
--   1. escrever mesmo quando o usuário não tem INSERT em recipientes_historico
--      (o GRANT não é dado a ninguém — só se chega aqui pelo trigger);
--   2. carimbar `alterado_por` com o uid da sessão, sem confiar no navegador.
create or replace function public.registrar_historico_recipiente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tara_g is distinct from old.tara_g or new.nome is distinct from old.nome then
    insert into public.recipientes_historico (
      recipiente_id, organization_id, nome_anterior, nome_novo,
      tara_g_anterior, tara_g_novo, alterado_por
    ) values (
      new.id, new.organization_id, old.nome, new.nome,
      old.tara_g, new.tara_g, auth.uid()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists recipientes_historico_trg on public.recipientes;
create trigger recipientes_historico_trg
  after update on public.recipientes
  for each row execute function public.registrar_historico_recipiente();

-- ============================================================================
-- 3. GRANTs e RLS
-- ============================================================================
-- Mesmo cuidado da 01: o Data API concede DML amplo em todas as tabelas do
-- schema public, então REVOGAMOS tudo e devolvemos só o necessário.
revoke all on public.recipientes, public.recipientes_historico from anonymous, authenticated;

-- Sem DELETE de propósito: recipiente não se apaga (perderia o histórico da
-- tara de vendas antigas). A "situação" resolve — desativa e some da lista.
grant select, insert, update on public.recipientes to authenticated;
grant select on public.recipientes_historico to authenticated;

alter table public.recipientes            enable row level security;
alter table public.recipientes_historico  enable row level security;

-- Leitura: qualquer pessoa da organização. Não é dado sensível e a tela de
-- venda precisa da lista para o operador escolher o recipiente.
drop policy if exists recipientes_leitura on public.recipientes;
create policy recipientes_leitura on public.recipientes
  for select to authenticated
  using (organization_id = public.minha_organizacao());

-- Escrita: exige permissão de estoque. O `(select ...)` faz o Postgres avaliar
-- `pode()` uma vez só (initplan) em vez de por linha.
drop policy if exists recipientes_criacao on public.recipientes;
create policy recipientes_criacao on public.recipientes
  for insert to authenticated
  with check (
    organization_id = public.minha_organizacao()
    and (select public.pode('estoque', 'criar'))
  );

drop policy if exists recipientes_edicao on public.recipientes;
create policy recipientes_edicao on public.recipientes
  for update to authenticated
  using (
    organization_id = public.minha_organizacao()
    and (select public.pode('estoque', 'editar'))
  )
  with check (
    organization_id = public.minha_organizacao()
    and (select public.pode('estoque', 'editar'))
  );

drop policy if exists recipientes_historico_leitura on public.recipientes_historico;
create policy recipientes_historico_leitura on public.recipientes_historico
  for select to authenticated
  using (organization_id = public.minha_organizacao());

-- A função do trigger não é RPC: nunca é chamada pelo navegador.
do $$
begin
  revoke execute on function public.registrar_historico_recipiente() from public, anonymous;
  grant  execute on function public.registrar_historico_recipiente() to authenticated;
end
$$;

-- ============================================================================
-- 4. Conferência (não altera nada)
-- ============================================================================
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='produtos'
--  order by ordinal_position;
--
-- OBSERVAÇÃO (ajuste manual, de propósito NÃO automático)
--   Os produtos que já existiam ficaram com tipo_venda='unidade'. Se algum
--   deles é vendido por quilo (ex.: 'Granola crocante', unidade='kg'),
--   ajuste pelo próprio cadastro do Estoque. Não há UPDATE automático aqui
--   para não alterar cadastro sem alguém decidir.
