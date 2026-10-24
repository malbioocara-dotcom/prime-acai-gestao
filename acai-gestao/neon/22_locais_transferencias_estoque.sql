-- ============================================================================
-- 22 · Estoques geral e da loja com transferências rastreáveis
-- ============================================================================
-- A quantidade legada `produtos.quantidade` continua representando a loja.
-- O estoque geral passa a ser calculado pelo mesmo livro-razão imutável.

create table if not exists public.estoque_locais (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
    references public.organizations(id) on delete restrict,
  codigo text not null check (codigo in ('geral', 'loja')),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (organization_id, codigo)
);

insert into public.estoque_locais (organization_id, codigo, nome)
select o.id, local.codigo, local.nome
  from public.organizations o
 cross join (values ('geral', 'Estoque geral'), ('loja', 'Estoque da loja'))
   as local(codigo, nome)
on conflict (organization_id, codigo) do nothing;

create or replace function public.seed_locais_estoque_nova_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.estoque_locais (organization_id, codigo, nome) values
    (new.id, 'geral', 'Estoque geral'),
    (new.id, 'loja', 'Estoque da loja')
  on conflict (organization_id, codigo) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_locais_estoque on public.organizations;
create trigger organizations_locais_estoque
  after insert on public.organizations
  for each row execute function public.seed_locais_estoque_nova_organizacao();

alter table public.movimentacoes_estoque
  drop constraint if exists movimentacoes_estoque_origem_check,
  drop constraint if exists movimentacoes_estoque_destino_check;

alter table public.movimentacoes_estoque
  add constraint movimentacoes_estoque_origem_check
  check (origem in ('abertura', 'contagem', 'fornecedor', 'estoque',
                    'estoque_geral', 'buffet', 'sobra', 'perda', 'cliente')),
  add constraint movimentacoes_estoque_destino_check
  check (destino in ('abertura', 'contagem', 'fornecedor', 'estoque',
                     'estoque_geral', 'buffet', 'sobra', 'perda', 'cliente'));

create or replace function public.saldo_estoque_local(p_produto_id uuid, p_local text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_local not in ('geral', 'loja') then
    raise exception 'Local de estoque inválido.';
  end if;

  if p_local = 'loja' then
    return public.saldo_estoque(p_produto_id);
  end if;

  return coalesce((
    select sum(case when m.destino = 'estoque_geral' then m.quantidade
                    when m.origem = 'estoque_geral' then -m.quantidade
                    else 0::numeric end)
      from public.movimentacoes_estoque m
     where m.produto_id = p_produto_id
       and m.organization_id = public.minha_organizacao()
  ), 0::numeric);
end;
$$;

create or replace function public.listar_saldos_estoque_locais()
returns table (produto_id uuid, saldo_geral numeric, saldo_loja numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar estoque.'
      using errcode = '42501';
  end if;

  return query
    select p.id,
           public.saldo_estoque_local(p.id, 'geral'),
           public.saldo_estoque_local(p.id, 'loja')
      from public.produtos p
     where exists (
       select 1
         from public.movimentacoes_estoque m
        where m.produto_id = p.id
          and m.organization_id = public.minha_organizacao()
     )
     order by p.nome;
end;
$$;

create table if not exists public.transferencias_estoque (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
    references public.organizations(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  quantidade numeric(12, 3) not null check (quantidade > 0),
  origem text not null check (origem in ('geral', 'loja')),
  destino text not null check (destino in ('geral', 'loja')),
  motivo text not null check (char_length(btrim(motivo)) between 1 and 500),
  chave_idempotencia text not null,
  movimentacao_id uuid not null unique
    references public.movimentacoes_estoque(id) on delete restrict,
  usuario_id uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint transferencia_locais_diferentes check (origem <> destino),
  unique (organization_id, chave_idempotencia)
);

create index if not exists transferencias_estoque_org_criada_idx
  on public.transferencias_estoque (organization_id, criado_em desc);

alter table public.estoque_locais enable row level security;
alter table public.transferencias_estoque enable row level security;

drop policy if exists estoque_locais_leitura on public.estoque_locais;
create policy estoque_locais_leitura on public.estoque_locais
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );

drop policy if exists transferencias_estoque_leitura on public.transferencias_estoque;
create policy transferencias_estoque_leitura on public.transferencias_estoque
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );

revoke all on public.estoque_locais from anonymous, authenticated;
grant select on public.estoque_locais to authenticated;
revoke all on public.transferencias_estoque from anonymous, authenticated;
grant select on public.transferencias_estoque to authenticated;

create or replace function public.registrar_movimentacao_local(
  p_produto_id uuid,
  p_qtd numeric,
  p_origem text,
  p_destino text,
  p_motivo text
)
returns table (
  id uuid,
  produto_id uuid,
  quantidade numeric,
  origem text,
  destino text,
  motivo text,
  saldo_geral numeric,
  saldo_loja numeric,
  criado_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_nome text;
  v_controla boolean;
  v_id uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para movimentar o estoque.';
  end if;
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para movimentar estoque.'
      using errcode = '42501';
  end if;
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da movimentação.';
  end if;
  if p_origem is null or p_destino is null or p_origem = p_destino
     or p_origem not in ('fornecedor', 'estoque', 'estoque_geral', 'buffet', 'sobra', 'perda', 'cliente')
     or p_destino not in ('fornecedor', 'estoque', 'estoque_geral', 'buffet', 'sobra', 'perda', 'cliente') then
    raise exception 'Escolha locais diferentes e válidos para a movimentação.';
  end if;
  if p_origem in ('estoque', 'estoque_geral') and p_destino in ('estoque', 'estoque_geral') then
    raise exception 'Use a operação de transferência para mover saldo entre locais de estoque.';
  end if;

  select p.nome, p.controla_estoque
    into v_nome, v_controla
    from public.produtos p
   where p.id = p_produto_id
   for update;
  if not found then
    raise exception 'Item de estoque não encontrado.';
  end if;
  if not v_controla then
    raise exception 'O item "%" está marcado como sem controle de estoque.', v_nome;
  end if;

  if p_origem = 'estoque_geral'
     and public.saldo_estoque_local(p_produto_id, 'geral') < p_qtd then
    raise exception 'Saldo insuficiente no estoque geral para "%".', v_nome;
  end if;

  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values
    (v_org, p_produto_id, p_qtd, p_origem, p_destino, btrim(p_motivo), v_usuario)
  returning movimentacoes_estoque.id into v_id;

  return query
    select m.id, m.produto_id, m.quantidade, m.origem, m.destino, m.motivo,
           public.saldo_estoque_local(m.produto_id, 'geral'),
           public.saldo_estoque_local(m.produto_id, 'loja'),
           m.criado_em
      from public.movimentacoes_estoque m
     where m.id = v_id;
end;
$$;

create or replace function public.transferir_estoque_local(
  p_produto_id uuid,
  p_qtd numeric,
  p_origem text,
  p_destino text,
  p_motivo text,
  p_chave_idempotencia text
)
returns table (
  id uuid,
  produto_id uuid,
  quantidade numeric,
  origem text,
  destino text,
  motivo text,
  chave_idempotencia text,
  movimentacao_id uuid,
  saldo_geral numeric,
  saldo_loja numeric,
  criado_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_nome text;
  v_controla boolean;
  v_transferencia public.transferencias_estoque%rowtype;
  v_mov uuid;
  v_id uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para transferir estoque.';
  end if;
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para transferir estoque.'
      using errcode = '42501';
  end if;
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;
  if p_origem not in ('geral', 'loja') or p_destino not in ('geral', 'loja')
     or p_origem = p_destino then
    raise exception 'Selecione o estoque geral e o estoque da loja como locais diferentes.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da transferência.';
  end if;
  if coalesce(btrim(p_chave_idempotencia), '') = '' then
    raise exception 'A chave da transferência não foi informada. Tente novamente.';
  end if;

  select p.nome, p.controla_estoque
    into v_nome, v_controla
    from public.produtos p
   where p.id = p_produto_id
   for update;
  if not found then
    raise exception 'Item de estoque não encontrado.';
  end if;
  if not v_controla then
    raise exception 'O item "%" está marcado como sem controle de estoque.', v_nome;
  end if;

  select t.* into v_transferencia
    from public.transferencias_estoque t
   where t.organization_id = v_org
     and t.chave_idempotencia = p_chave_idempotencia;
  if found then
    return query
      select t.id, t.produto_id, t.quantidade, t.origem, t.destino, t.motivo,
             t.chave_idempotencia, t.movimentacao_id,
             public.saldo_estoque_local(t.produto_id, 'geral'),
             public.saldo_estoque_local(t.produto_id, 'loja'), t.criado_em
        from public.transferencias_estoque t
       where t.id = v_transferencia.id;
    return;
  end if;

  if public.saldo_estoque_local(p_produto_id, p_origem) < p_qtd then
    raise exception 'Saldo insuficiente no estoque % para "%".', p_origem, v_nome;
  end if;

  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values
    (v_org, p_produto_id, p_qtd,
     case p_origem when 'geral' then 'estoque_geral' else 'estoque' end,
     case p_destino when 'geral' then 'estoque_geral' else 'estoque' end,
     btrim(p_motivo), v_usuario)
  returning movimentacoes_estoque.id into v_mov;

  insert into public.transferencias_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo,
     chave_idempotencia, movimentacao_id, usuario_id)
  values
    (v_org, p_produto_id, p_qtd, p_origem, p_destino, btrim(p_motivo),
     p_chave_idempotencia, v_mov, v_usuario)
  returning transferencias_estoque.id into v_id;

  return query
    select t.id, t.produto_id, t.quantidade, t.origem, t.destino, t.motivo,
           t.chave_idempotencia, t.movimentacao_id,
           public.saldo_estoque_local(t.produto_id, 'geral'),
           public.saldo_estoque_local(t.produto_id, 'loja'), t.criado_em
      from public.transferencias_estoque t
     where t.id = v_id;
end;
$$;

revoke all on function public.seed_locais_estoque_nova_organizacao() from public, anonymous, authenticated;
revoke all on function public.saldo_estoque_local(uuid, text) from public, anonymous;
revoke all on function public.listar_saldos_estoque_locais() from public, anonymous;
revoke all on function public.registrar_movimentacao_local(uuid, numeric, text, text, text) from public, anonymous;
revoke all on function public.transferir_estoque_local(uuid, numeric, text, text, text, text) from public, anonymous;
grant execute on function public.listar_saldos_estoque_locais() to authenticated;
grant execute on function public.registrar_movimentacao_local(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.transferir_estoque_local(uuid, numeric, text, text, text, text) to authenticated;
grant execute on function public.listar_saldos_estoque_locais() to authenticated;
grant execute on function public.registrar_movimentacao_local(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.transferir_estoque_local(uuid, numeric, text, text, text, text) to authenticated;
