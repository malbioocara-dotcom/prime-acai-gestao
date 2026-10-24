-- ============================================================================
-- 19 · Imagens persistentes de produtos
-- ============================================================================
-- Armazena arquivos binários (bytea), nunca Base64 em coluna textual.
-- Uma imagem pertence a um único produto; trocar/remover não afeta outros
-- produtos. O caminho estável é derivado do produto e permanece no banco.
--
-- O catálogo de produtos ainda é global no modelo atual do sistema. As
-- leitura também é liberada a vendas.consultar para exibir imagens no PDV;
-- escrita continua restrita às permissões de estoque.
-- Não introduz isolamento organizacional que a tabela produtos não possui.
--
-- Limite: 512 KiB por imagem para manter a Data API utilizável no navegador.
-- A aplicação verifica MIME real e tamanho antes de chamar a RPC.
--
-- Reversão: reverter_19_imagens_produtos.sql remove a RPC mas mantém a tabela
-- e os arquivos para evitar perda acidental de imagens já enviadas.
-- ============================================================================

create table if not exists public.imagens_produtos (
  produto_id uuid primary key
    references public.produtos (id) on delete cascade,
  caminho text generated always as ('produtos/' || produto_id::text) stored unique,
  mime text not null
    check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  conteudo bytea not null
    check (
      octet_length(conteudo) between 12 and 524288
      and (
        (mime = 'image/jpeg' and substring(conteudo from 1 for 3) = decode('ffd8ff', 'hex'))
        or (mime = 'image/png' and substring(conteudo from 1 for 8) = decode('89504e470d0a1a0a', 'hex'))
        or (
          mime = 'image/webp'
          and substring(conteudo from 1 for 4) = convert_to('RIFF', 'UTF8')
          and substring(conteudo from 9 for 4) = convert_to('WEBP', 'UTF8')
        )
      )
    ),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_imagens_produtos_atualizado
  on public.imagens_produtos (atualizado_em desc);

alter table public.imagens_produtos enable row level security;

drop policy if exists imagens_produtos_leitura on public.imagens_produtos;
drop policy if exists imagens_produtos_criacao on public.imagens_produtos;
drop policy if exists imagens_produtos_edicao on public.imagens_produtos;
drop policy if exists imagens_produtos_remocao on public.imagens_produtos;

create policy imagens_produtos_leitura on public.imagens_produtos
  for select to authenticated
  using (
    (select public.pode('estoque', 'consultar'))
    or (select public.pode('vendas', 'consultar'))
  );

create policy imagens_produtos_criacao on public.imagens_produtos
  for insert to authenticated
  with check (
    (select public.pode('estoque', 'criar'))
    or (select public.pode('estoque', 'editar'))
  );

create policy imagens_produtos_edicao on public.imagens_produtos
  for update to authenticated
  using ((select public.pode('estoque', 'editar')))
  with check ((select public.pode('estoque', 'editar')));

create policy imagens_produtos_remocao on public.imagens_produtos
  for delete to authenticated
  using ((select public.pode('estoque', 'editar')));

revoke all on public.imagens_produtos from anonymous, authenticated;
grant select, insert, update, delete on public.imagens_produtos to authenticated;

create or replace function public.salvar_produto_com_imagem(
  p_produto jsonb,
  p_mime text default null,
  p_conteudo bytea default null,
  p_remover_imagem boolean default false
)
returns public.produtos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_produto public.produtos;
  v_id uuid := nullif(p_produto ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.produtos (
      codigo, nome, descricao, categoria, quantidade, minimo, unidade,
      custo, preco, ativo, tipo_venda, controla_estoque, metodo_estoque,
      metodo_peso
    )
    values (
      p_produto ->> 'codigo',
      p_produto ->> 'nome',
      nullif(p_produto ->> 'descricao', ''),
      p_produto ->> 'categoria',
      0,
      coalesce(nullif(p_produto ->> 'minimo', '')::numeric, 0),
      coalesce(nullif(p_produto ->> 'unidade', ''), 'un'),
      coalesce(nullif(p_produto ->> 'custo', '')::numeric, 0),
      coalesce(nullif(p_produto ->> 'preco', '')::numeric, 0),
      coalesce((p_produto ->> 'ativo')::boolean, true),
      coalesce(nullif(p_produto ->> 'tipo_venda', ''), 'unidade'),
      coalesce((p_produto ->> 'controla_estoque')::boolean, true),
      coalesce(nullif(p_produto ->> 'metodo_estoque', ''), 'movimentacoes'),
      nullif(p_produto ->> 'metodo_peso', '')
    )
    returning * into v_produto;
  else
    update public.produtos
       set codigo = p_produto ->> 'codigo',
           nome = p_produto ->> 'nome',
           descricao = nullif(p_produto ->> 'descricao', ''),
           categoria = p_produto ->> 'categoria',
           minimo = coalesce(nullif(p_produto ->> 'minimo', '')::numeric, 0),
           unidade = coalesce(nullif(p_produto ->> 'unidade', ''), 'un'),
           custo = coalesce(nullif(p_produto ->> 'custo', '')::numeric, 0),
           preco = coalesce(nullif(p_produto ->> 'preco', '')::numeric, 0),
           ativo = coalesce((p_produto ->> 'ativo')::boolean, true),
           tipo_venda = coalesce(nullif(p_produto ->> 'tipo_venda', ''), 'unidade'),
           controla_estoque = coalesce((p_produto ->> 'controla_estoque')::boolean, true),
           metodo_estoque = coalesce(nullif(p_produto ->> 'metodo_estoque', ''), 'movimentacoes'),
           metodo_peso = nullif(p_produto ->> 'metodo_peso', '')
     where id = v_id
     returning * into v_produto;

    if not found then
      raise exception 'Produto não encontrado ou sem permissão para edição.';
    end if;
  end if;

  if p_remover_imagem then
    delete from public.imagens_produtos where produto_id = v_produto.id;
  elsif p_mime is not null or p_conteudo is not null then
    if p_mime not in ('image/jpeg', 'image/png', 'image/webp')
       or p_conteudo is null
       or octet_length(p_conteudo) not between 1 and 524288 then
      raise exception 'Imagem inválida: formato não permitido ou tamanho acima de 512 KiB.';
    end if;

    insert into public.imagens_produtos (produto_id, mime, conteudo)
    values (v_produto.id, p_mime, p_conteudo)
    on conflict (produto_id) do update
      set mime = excluded.mime,
          conteudo = excluded.conteudo,
          atualizado_em = now();
  end if;

  return v_produto;
end;
$$;

revoke all on function public.salvar_produto_com_imagem(jsonb, text, bytea, boolean)
  from public, anonymous;
grant execute on function public.salvar_produto_com_imagem(jsonb, text, bytea, boolean)
  to authenticated;
