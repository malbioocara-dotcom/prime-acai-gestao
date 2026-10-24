do $$
begin
  if exists (
    select 1 from public.movimentacoes_estoque
     where origem = 'estoque_geral' or destino = 'estoque_geral'
  ) or exists (select 1 from public.transferencias_estoque) then
    raise exception
      'Existem movimentos ou transferências do estoque geral. Preserve os dados e migre-os antes de reverter esta estrutura.';
  end if;
end;
$$;

drop function if exists public.transferir_estoque_local(uuid, numeric, text, text, text, text);
drop function if exists public.registrar_movimentacao_local(uuid, numeric, text, text, text);
drop function if exists public.listar_saldos_estoque_locais();
drop function if exists public.saldo_estoque_local(uuid, text);

drop trigger if exists organizations_locais_estoque on public.organizations;
drop function if exists public.seed_locais_estoque_nova_organizacao();

drop table if exists public.transferencias_estoque;
drop table if exists public.estoque_locais;

alter table public.movimentacoes_estoque
  drop constraint if exists movimentacoes_estoque_origem_check,
  drop constraint if exists movimentacoes_estoque_destino_check;

alter table public.movimentacoes_estoque
  add constraint movimentacoes_estoque_origem_check
  check (origem in ('abertura', 'contagem', 'fornecedor', 'estoque',
                    'buffet', 'sobra', 'perda', 'cliente')),
  add constraint movimentacoes_estoque_destino_check
  check (destino in ('abertura', 'contagem', 'fornecedor', 'estoque',
                     'buffet', 'sobra', 'perda', 'cliente'));
