-- ============================================================================
-- 16 · Compras e entradas de mercadoria
-- ============================================================================
-- Re-executável e não destrutivo. Depende de 00, 01, 04, 05, 06 e 07.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE
--   O sistema já sabia VENDER (08/11), mas não sabia COMPRAR. Sem isso, todo
--   saldo do estoque só podia nascer de uma contagem manual: não havia
--   fornecedor, nota, custo, frete, lote, validade nem histórico de entrada.
--
-- O QUE ELA FAZ
--   • `fornecedores` — cadastro próprio (não usa `profiles`: fornecedor não é
--     usuário do sistema e não pode virar conta de login).
--   • `compras` — cabeçalho: fornecedor, documento, frete, desconto e status.
--   • `compras_itens` — itens com unidade de COMPRA e fator de conversão para a
--     unidade de ESTOQUE (1 caixa = 12 un, 1 fardo = 6 kg...).
--   • `confirmar_recebimento_compra()` — recebe em transação única: grava o
--     movimento `fornecedor -> estoque` no livro-razão, atualiza o custo médio
--     do produto e o status da compra. O navegador NÃO escreve no livro-razão.
--
-- STATUS
--   rascunho · aguardando_recebimento · recebimento_parcial ·
--   recebido_confirmado · cancelado
--
-- REGRAS QUE O BANCO IMPÕE
--   • Compra recebida/cancelada não pode ser editada pelo navegador (RLS).
--   • Não existe segunda entrada para o mesmo item: o RPC trava a compra
--     (`for update`) e recusa quantidade acima do saldo pendente.
--   • Recebimento parcial continua permitido até completar; depois fecha.
--   • Custo médio muda; PREÇO DE VENDA NÃO. Faturamento não é tocado aqui.
--
-- Reverter: neon/reverter_16_compras_entradas.sql
-- ============================================================================

-- ============================================================================
-- 1. Fornecedores
-- ============================================================================
create table if not exists public.fornecedores (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                  references public.organizations (id) on delete restrict,
  nome            text not null,
  cnpj            text,
  telefone        text,
  email           text,
  observacoes     text not null default '',
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- Mesmo fornecedor não se repete na mesma organização (nome sem diferenciar
-- maiúsculas/espaços). O nome continua reservado mesmo se o cadastro for
-- desativado; reative o existente em vez de criar um duplicado.
create unique index if not exists fornecedores_org_nome_unico
  on public.fornecedores (organization_id, lower(btrim(nome)));

create index if not exists idx_fornecedores_org
  on public.fornecedores (organization_id, ativo, nome);

-- ============================================================================
-- 2. Cabeçalho de compras
-- ============================================================================
-- A tabela nasceu mínima numa tentativa anterior (no banco real) e não existia
-- na cadeia de migrations. O `create table if not exists` cobre o banco novo;
-- os `add column if not exists` completam a tabela antiga sem apagar nada.
create table if not exists public.compras (
  id              uuid primary key default gen_random_uuid(),
  numero          text not null,
  data_compra     date not null default current_date,
  data_recebimento date,
  status          text default 'rascunho',
  usuario_id      uuid references public.profiles (id) on delete set null
);

alter table public.compras add column if not exists organization_id uuid;
alter table public.compras add column if not exists fornecedor_id uuid;
alter table public.compras add column if not exists tipo_documento text not null default 'sem_nota';
alter table public.compras add column if not exists numero_nota text;
alter table public.compras add column if not exists observacoes text not null default '';
alter table public.compras add column if not exists desconto_valor numeric(14, 2) not null default 0;
alter table public.compras add column if not exists frete_valor numeric(14, 2) not null default 0;
alter table public.compras add column if not exists criado_em timestamptz not null default now();
alter table public.compras add column if not exists atualizado_em timestamptz not null default now();

update public.compras
   set organization_id = (select o.id from public.organizations o order by o.created_at, o.id limit 1)
 where organization_id is null;

update public.compras set status = 'rascunho' where status is null;
update public.compras set data_compra = current_date where data_compra is null;

alter table public.compras alter column id set default gen_random_uuid();
alter table public.compras alter column data_compra set default current_date;
alter table public.compras alter column status set default 'rascunho';
alter table public.compras alter column status set not null;
alter table public.compras alter column organization_id set default public.minha_organizacao();
alter table public.compras alter column organization_id set not null;
alter table public.compras alter column usuario_id set default auth.uid();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compras_organization_id_fkey') then
    alter table public.compras
      add constraint compras_organization_id_fkey
      foreign key (organization_id) references public.organizations (id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'compras_fornecedor_id_fkey') then
    alter table public.compras
      add constraint compras_fornecedor_id_fkey
      foreign key (fornecedor_id) references public.fornecedores (id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'compras_status_valido') then
    alter table public.compras
      add constraint compras_status_valido
      check (status in ('rascunho', 'aguardando_recebimento', 'recebimento_parcial',
                        'recebido_confirmado', 'cancelado'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'compras_tipo_documento_valido') then
    alter table public.compras
      add constraint compras_tipo_documento_valido
      check (tipo_documento in ('com_nota', 'sem_nota'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'compras_valores_nao_negativos') then
    alter table public.compras
      add constraint compras_valores_nao_negativos
      check (desconto_valor >= 0 and frete_valor >= 0);
  end if;
end
$$;

create unique index if not exists compras_org_numero_unico
  on public.compras (organization_id, numero);

create index if not exists idx_compras_org_data
  on public.compras (organization_id, data_compra desc, criado_em desc);

create index if not exists idx_compras_status
  on public.compras (organization_id, status);

create index if not exists idx_compras_fornecedor
  on public.compras (fornecedor_id);

-- ============================================================================
-- 3. Itens da compra
-- ============================================================================
-- A tentativa anterior deixou uma view presa às colunas mínimas
-- (`quantidade_recebida integer`). Ela não é usada pelo app e impede o ALTER
-- TYPE; sai antes, e o módulo passa a calcular os totais no serviço.
drop view if exists public.vw_compra_resumo;

create table if not exists public.compras_itens (
  id                  uuid primary key default gen_random_uuid(),
  compra_id           uuid,
  produto_id          uuid references public.produtos (id) on delete restrict,
  quantidade_recebida numeric(14, 3) default 0,
  custo_unitario      numeric(14, 4) default 0
);

alter table public.compras_itens add column if not exists nome text not null default '';
alter table public.compras_itens add column if not exists unidade_compra text not null default 'un';
alter table public.compras_itens add column if not exists fator_conversao numeric(14, 4) not null default 1;
alter table public.compras_itens add column if not exists quantidade_solicitada numeric(14, 3) not null default 0;
alter table public.compras_itens add column if not exists desconto_valor numeric(14, 2) not null default 0;
alter table public.compras_itens add column if not exists lote text;
alter table public.compras_itens add column if not exists validade date;
alter table public.compras_itens add column if not exists criado_em timestamptz not null default now();

alter table public.compras_itens alter column id set default gen_random_uuid();
alter table public.compras_itens
  alter column quantidade_recebida type numeric(14, 3)
  using coalesce(quantidade_recebida, 0)::numeric;
alter table public.compras_itens
  alter column custo_unitario type numeric(14, 4)
  using coalesce(custo_unitario, 0)::numeric;

update public.compras_itens set quantidade_recebida = 0 where quantidade_recebida is null;
update public.compras_itens set custo_unitario = 0 where custo_unitario is null;
update public.compras_itens set fator_conversao = 1 where fator_conversao is null or fator_conversao <= 0;

alter table public.compras_itens alter column quantidade_recebida set default 0;
alter table public.compras_itens alter column quantidade_recebida set not null;
alter table public.compras_itens alter column custo_unitario set default 0;
alter table public.compras_itens alter column custo_unitario set not null;
alter table public.compras_itens alter column compra_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compras_itens_compra_id_fkey') then
    alter table public.compras_itens
      add constraint compras_itens_compra_id_fkey
      foreign key (compra_id) references public.compras (id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'compras_itens_quantidades_validas') then
    alter table public.compras_itens
      add constraint compras_itens_quantidades_validas
      check (quantidade_solicitada > 0
             and quantidade_recebida >= 0
             and quantidade_recebida <= quantidade_solicitada
             and fator_conversao > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'compras_itens_valores_nao_negativos') then
    alter table public.compras_itens
      add constraint compras_itens_valores_nao_negativos
      check (custo_unitario >= 0 and desconto_valor >= 0);
  end if;
end
$$;

create index if not exists idx_compras_itens_compra
  on public.compras_itens (compra_id);

create index if not exists idx_compras_itens_produto
  on public.compras_itens (produto_id, validade);

-- ============================================================================
-- 4. `atualizado_em` automático
-- ============================================================================
create or replace function public.tocar_atualizado_em_compra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists compras_atualizado_em on public.compras;
create trigger compras_atualizado_em
  before update on public.compras
  for each row execute function public.tocar_atualizado_em_compra();

drop trigger if exists fornecedores_atualizado_em on public.fornecedores;
create trigger fornecedores_atualizado_em
  before update on public.fornecedores
  for each row execute function public.tocar_atualizado_em_compra();

-- ============================================================================
-- 5. Permissões do módulo
-- ============================================================================
insert into public.permissions (module_key, action_key, description) values
  ('compras', 'ver',       'Ver o menu e abrir Compras'),
  ('compras', 'consultar', 'Consultar compras, recebimentos e fornecedores'),
  ('compras', 'criar',     'Registrar compra e fornecedor'),
  ('compras', 'editar',    'Alterar compra e confirmar recebimento'),
  ('compras', 'excluir',   'Excluir rascunho de compra')
on conflict (module_key, action_key) do update set description = excluded.description;

-- admin e manager recebem tudo; caixa só enxerga (o recebimento exige editar).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.module_key = 'compras'
 where r.name in ('admin', 'manager')
    or (r.name = 'cashier' and p.action_key in ('ver', 'consultar'))
on conflict do nothing;

-- ============================================================================
-- 6. Funções de apoio ao RLS
-- ============================================================================
-- `security definer` para a política dos itens não depender da política da
-- compra (e não entrar em recursão de RLS).
create or replace function public.compra_da_organizacao(p_compra_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.compras c
     where c.id = p_compra_id
       and c.organization_id = public.minha_organizacao()
  )
$$;

create or replace function public.compra_editavel(p_compra_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.compras c
     where c.id = p_compra_id
       and c.organization_id = public.minha_organizacao()
       and c.status in ('rascunho', 'aguardando_recebimento')
  )
$$;

-- ============================================================================
-- 7. Recebimento: UMA transação, UMA entrada por item
-- ============================================================================
create or replace function public.confirmar_recebimento_compra(
  p_compra_id uuid,
  p_itens     jsonb
)
returns table (
  compra_id        uuid,
  status           text,
  data_recebimento date,
  itens_recebidos  integer,
  valor_recebido   numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario        uuid := auth.uid();
  v_org            uuid := public.minha_organizacao();
  v_compra         public.compras%rowtype;
  v_item           public.compras_itens%rowtype;
  v_entrada        jsonb;
  v_qtd            numeric;
  v_qtd_base       numeric;
  v_saldo          numeric;
  v_custo_atual    numeric;
  v_custo_novo     numeric;
  v_controla       boolean;
  v_subtotal_total numeric;
  v_sub_item       numeric;
  v_rateio         numeric;
  v_valor_item     numeric;
  v_motivo         text;
  v_total          numeric := 0;
  v_contador       integer := 0;
  v_todos          boolean;
  v_status         text;
  v_data           date;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para confirmar o recebimento.';
  end if;

  if not public.pode('compras', 'editar') then
    raise exception 'Sua conta não tem permissão para confirmar recebimento de compras.'
      using errcode = '42501';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe pelo menos um item recebido.';
  end if;

  -- O mesmo item duas vezes no mesmo pedido é erro de tela/duplo clique, não
  -- recebimento legítimo. Recusar aqui é o que impede entrada duplicada.
  if exists (
    select 1
      from jsonb_array_elements(p_itens) e
     group by e->>'item_id'
    having count(*) > 1
  ) then
    raise exception 'O mesmo item apareceu duas vezes no recebimento.';
  end if;

  -- Trava a compra: dois cliques simultâneos viram uma espera, e o segundo
  -- encontra o status já atualizado e é recusado.
  select * into v_compra
    from public.compras
   where id = p_compra_id
     and organization_id = v_org
   for update;

  if not found then
    raise exception 'Compra não encontrada.';
  end if;

  if v_compra.status = 'recebido_confirmado' then
    raise exception 'Esta compra já foi recebida e confirmada. Não é possível lançar uma segunda entrada.';
  end if;

  if v_compra.status = 'cancelado' then
    raise exception 'Compra cancelada não pode receber mercadoria.';
  end if;

  select coalesce(sum(ci.quantidade_solicitada * ci.custo_unitario - ci.desconto_valor), 0)
    into v_subtotal_total
    from public.compras_itens ci
   where ci.compra_id = p_compra_id;

  for v_entrada in select * from jsonb_array_elements(p_itens)
  loop
    select ci.* into v_item
      from public.compras_itens ci
     where ci.id = (v_entrada->>'item_id')::uuid
       and ci.compra_id = p_compra_id
     for update;

    if not found then
      raise exception 'Item % não pertence a esta compra.',
        coalesce(v_entrada->>'item_id', '(sem identificação)');
    end if;

    if v_item.produto_id is null then
      raise exception 'O item "%" não tem produto vinculado ao estoque.', v_item.nome;
    end if;

    if v_item.quantidade_solicitada <= 0 then
      raise exception 'O item "%" está com quantidade zerada. Corrija a compra antes de receber.', v_item.nome;
    end if;

    v_qtd := coalesce((v_entrada->>'quantidade')::numeric, 0);

    if v_qtd <= 0 then
      raise exception 'A quantidade recebida de "%" precisa ser maior que zero.', v_item.nome;
    end if;

    if v_qtd > (v_item.quantidade_solicitada - v_item.quantidade_recebida) + 0.0005 then
      raise exception 'A quantidade recebida de "%" (%) passa do saldo pendente (%).',
        v_item.nome, v_qtd, v_item.quantidade_solicitada - v_item.quantidade_recebida;
    end if;

    select p.custo, p.controla_estoque
      into v_custo_atual, v_controla
      from public.produtos p
     where p.id = v_item.produto_id;

    if not found then
      raise exception 'O produto do item "%" não existe mais no estoque.', v_item.nome;
    end if;

    if not v_controla then
      raise exception 'O item "%" está marcado como "sem controle de estoque" e não pode ser recebido.', v_item.nome;
    end if;

    v_saldo    := public.saldo_estoque(v_item.produto_id);
    v_qtd_base := v_qtd * coalesce(v_item.fator_conversao, 1);

    if v_qtd_base <= 0 then
      raise exception 'A conversão de unidade de "%" resultou em quantidade inválida.', v_item.nome;
    end if;

    v_motivo := 'Compra ' || v_compra.numero || ' · ' || v_item.nome;
    if coalesce(btrim(v_entrada->>'lote'), '') <> '' then
      v_motivo := v_motivo || ' · lote ' || btrim(v_entrada->>'lote');
    end if;

    insert into public.movimentacoes_estoque
      (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
    values
      (v_org, v_item.produto_id, v_qtd_base, 'fornecedor', 'estoque', v_motivo, v_usuario);

    update public.compras_itens
       set quantidade_recebida = quantidade_recebida + v_qtd,
           lote = coalesce(nullif(btrim(coalesce(v_entrada->>'lote', '')), ''), lote),
           validade = coalesce(nullif(v_entrada->>'validade', '')::date, validade)
     where id = v_item.id;

    -- Custo médio ponderado, por unidade-base. O desconto do item é rateado na
    -- mesma proporção da quantidade recebida; frete/desconto do cabeçalho são
    -- rateados pelo valor de cada item. PREÇO DE VENDA NÃO É TOCADO.
    v_sub_item := (v_qtd * v_item.custo_unitario)
                  - (v_item.desconto_valor * (v_qtd / v_item.quantidade_solicitada));

    v_rateio := case when v_subtotal_total > 0 then v_sub_item / v_subtotal_total else 0 end;

    v_valor_item := v_sub_item
                    + (v_compra.frete_valor * v_rateio)
                    - (v_compra.desconto_valor * v_rateio);

    if v_valor_item > 0 then
      v_custo_novo := ((greatest(v_saldo, 0) * coalesce(v_custo_atual, 0)) + v_valor_item)
                      / (greatest(v_saldo, 0) + v_qtd_base);

      update public.produtos
         set custo = round(v_custo_novo, 4)
       where id = v_item.produto_id;
    end if;

    v_total    := v_total + v_valor_item;
    v_contador := v_contador + 1;
  end loop;

  select bool_and(ci.quantidade_recebida >= ci.quantidade_solicitada)
    into v_todos
    from public.compras_itens ci
   where ci.compra_id = p_compra_id;

  v_status := case when coalesce(v_todos, false) then 'recebido_confirmado'
                   else 'recebimento_parcial' end;

  v_data := case when v_status = 'recebido_confirmado' then current_date else null end;

  update public.compras c
     set status = v_status,
         data_recebimento = coalesce(v_data, c.data_recebimento)
   where c.id = p_compra_id;

  return query
    select p_compra_id, v_status, v_data, v_contador, round(v_total, 2);
end;
$$;

comment on function public.confirmar_recebimento_compra(uuid, jsonb) is
  'Recebe itens de uma compra em transação única: movimenta fornecedor -> estoque, atualiza custo médio e status. Exige compras.editar.';

-- ============================================================================
-- 8. GRANTs e RLS
-- ============================================================================
revoke all on public.fornecedores, public.compras, public.compras_itens
  from anonymous, authenticated;

grant select, insert, update, delete on public.fornecedores to authenticated;
grant select, insert, update, delete on public.compras to authenticated;
grant select, insert, update, delete on public.compras_itens to authenticated;

alter table public.fornecedores enable row level security;
alter table public.compras enable row level security;
alter table public.compras_itens enable row level security;

-- Fornecedores ---------------------------------------------------------------
drop policy if exists fornecedores_leitura  on public.fornecedores;
drop policy if exists fornecedores_criacao  on public.fornecedores;
drop policy if exists fornecedores_edicao   on public.fornecedores;
drop policy if exists fornecedores_exclusao on public.fornecedores;

create policy fornecedores_leitura on public.fornecedores
  for select to authenticated
  using (
    organization_id = public.minha_organizacao()
    and (select public.pode('compras', 'consultar'))
  );

create policy fornecedores_criacao on public.fornecedores
  for insert to authenticated
  with check (
    organization_id = public.minha_organizacao()
    and (select public.pode('compras', 'criar'))
  );

create policy fornecedores_edicao on public.fornecedores
  for update to authenticated
  using (
    organization_id = public.minha_organizacao()
    and (select public.pode('compras', 'editar'))
  )
  with check (
    organization_id = public.minha_organizacao()
    and (select public.pode('compras', 'editar'))
  );

create policy fornecedores_exclusao on public.fornecedores
  for delete to authenticated
  using (
    organization_id = public.minha_organizacao()
    and (select public.pode('compras', 'excluir'))
  );

-- Compras --------------------------------------------------------------------
drop policy if exists compras_leitura  on public.compras;
drop policy if exists compras_criacao  on public.compras;
drop policy if exists compras_edicao   on public.compras;
drop policy if exists compras_exclusao on public.compras;

create policy compras_leitura on public.compras
  for select to authenticated
  using (
    organization_id = public.minha_organizacao()
    and (select public.pode('compras', 'consultar'))
  );

-- Nasce só como rascunho: o navegador não pode criar uma compra já "recebida".
create policy compras_criacao on public.compras
  for insert to authenticated
  with check (
    organization_id = public.minha_organizacao()
    and status = 'rascunho'
    and (select public.pode('compras', 'criar'))
  );

-- Compra recebida/cancelada não é editável. O RPC (security definer) é quem
-- muda para recebido/parcial; o navegador só transita entre rascunho,
-- aguardando, parcial e cancelado.
create policy compras_edicao on public.compras
  for update to authenticated
  using (
    organization_id = public.minha_organizacao()
    and status in ('rascunho', 'aguardando_recebimento', 'recebimento_parcial')
    and (select public.pode('compras', 'editar'))
  )
  with check (
    organization_id = public.minha_organizacao()
    and status in ('rascunho', 'aguardando_recebimento', 'recebimento_parcial', 'cancelado')
    and (select public.pode('compras', 'editar'))
  );

-- Histórico não se apaga: só rascunho pode sair.
create policy compras_exclusao on public.compras
  for delete to authenticated
  using (
    organization_id = public.minha_organizacao()
    and status = 'rascunho'
    and (select public.pode('compras', 'excluir'))
  );

-- Itens ----------------------------------------------------------------------
drop policy if exists compras_itens_leitura  on public.compras_itens;
drop policy if exists compras_itens_criacao  on public.compras_itens;
drop policy if exists compras_itens_edicao   on public.compras_itens;
drop policy if exists compras_itens_exclusao on public.compras_itens;

create policy compras_itens_leitura on public.compras_itens
  for select to authenticated
  using (
    public.compra_da_organizacao(compra_id)
    and (select public.pode('compras', 'consultar'))
  );

create policy compras_itens_criacao on public.compras_itens
  for insert to authenticated
  with check (
    public.compra_editavel(compra_id)
    and ((select public.pode('compras', 'criar')) or (select public.pode('compras', 'editar')))
  );

create policy compras_itens_edicao on public.compras_itens
  for update to authenticated
  using (
    public.compra_editavel(compra_id)
    and (select public.pode('compras', 'editar'))
  )
  with check (
    public.compra_editavel(compra_id)
    and (select public.pode('compras', 'editar'))
  );

create policy compras_itens_exclusao on public.compras_itens
  for delete to authenticated
  using (
    public.compra_editavel(compra_id)
    and (select public.pode('compras', 'editar'))
  );

-- Funções --------------------------------------------------------------------
do $$
begin
  revoke execute on function public.tocar_atualizado_em_compra() from public, anonymous;
  revoke execute on function public.compra_da_organizacao(uuid) from public, anonymous;
  revoke execute on function public.compra_editavel(uuid) from public, anonymous;
  revoke execute on function public.confirmar_recebimento_compra(uuid, jsonb) from public, anonymous;

  grant execute on function public.tocar_atualizado_em_compra() to authenticated;
  grant execute on function public.compra_da_organizacao(uuid) to authenticated;
  grant execute on function public.compra_editavel(uuid) to authenticated;
  grant execute on function public.confirmar_recebimento_compra(uuid, jsonb) to authenticated;
end
$$;

-- Recarrega o cache de schema do PostgREST/Data API para as tabelas novas
-- aparecerem sem esperar o próximo ciclo.
notify pgrst, 'reload schema';

-- ============================================================================
-- 9. Conferência (não altera nada)
-- ============================================================================
-- Permissões criadas:
--   select module_key, action_key from public.permissions where module_key='compras';
-- Políticas:
--   select tablename, policyname, cmd from pg_policies
--    where schemaname='public' and tablename in ('fornecedores','compras','compras_itens')
--    order by tablename, policyname;
-- Esperado: leitura/criação/edição/exclusão nas três tabelas.
