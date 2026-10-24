-- ============================================================================
-- 10. O código do pedido: sequência no lugar certo e o próximo número exposto
-- ============================================================================
--
-- Dois ajustes pequenos, ambos sobre a numeração que a 08 introduziu.
--
-- 1) A POSIÇÃO DA SEQUÊNCIA
--
-- A 08 semeou a sequência com o maior código que existia na época, via
-- `setval(...)`, cujo `is_called` fica `true` por padrão. Isso estava certo no
-- instante em que rodou — mas `nextval` NÃO volta atrás no rollback: todo
-- número entregue a uma transação que terminou desfeita (um teste, um
-- diagnóstico, uma venda que falhou depois de numerada) fica QUEIMADO e abre um
-- buraco na numeração. O operador veria #9389 e depois #9391, sem explicação.
--
-- Aqui a sequência volta a ficar exatamente no maior código gravado, de modo
-- que o próximo pedido seja o seguinte natural.
--
-- O `lock table ... in exclusive mode` é o que torna isso seguro, e é o ponto
-- delicado: rebaixar a sequência enquanto uma venda está no ar poderia entregar
-- de novo um número que aquela venda ainda vai gravar. Uma venda em curso já
-- pediu `nextval` e segura um bloqueio da tabela até o commit; pedir o
-- bloqueio exclusivo aqui ESPERA essa venda terminar. Só depois disso o `max()`
-- é lido — e aí ele já enxerga o número que estava "no ar". Nenhuma venda em
-- curso, nenhum número repetido.
--
-- 2) DE QUEM É O PRÓXIMO NÚMERO
--
-- `public.proximo_codigo_venda()` devolve o número que a próxima venda vai
-- receber, SEM consumir nada (lê a sequência; não chama `nextval`). É o que a
-- tela mostra no campo "Pedido" quando o operador não digita nada. Antes a tela
-- adivinhava `max(codigo) + 1` no navegador: divergia da sequência assim que um
-- número era queimado e quebrava quando os códigos passam de quatro dígitos
-- (ordenação de TEXTO: '#10000' vem antes de '#9999'). Agora quem responde é a
-- mesma sequência que vai numerar o pedido.
--
-- Reverter: `reverter_10_codigo_do_pedido.sql` (derruba a função; a posição da
-- sequência não é "esquema", e restaurar o buraco seria devolver o defeito).
-- ============================================================================

-- Espera qualquer venda em curso terminar antes de mexer na sequência.
lock table public.vendas in exclusive mode;

do $$
declare
  v_maior bigint;
  v_alvo  bigint;
begin
  select max((substring(codigo from 2))::bigint)
    into v_maior
    from public.vendas
   where codigo ~ '^#[0-9]+$';

  -- Piso de 4800 é o mesmo da 08, para o caso de base vazia.
  v_alvo := greatest(coalesce(v_maior, 0), 4800);

  if v_alvo <> (select last_value from public.vendas_codigo_seq) then
    perform setval('public.vendas_codigo_seq', v_alvo, true);
  end if;
end
$$;

create or replace function public.proximo_codigo_venda()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codigo text;
begin
  -- Mesma autorização da leitura de vendas: quem não consulta, não espia a
  -- numeração do negócio.
  if not public.pode('vendas', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar vendas.'
      using errcode = '42501';
  end if;

  -- `is_called = false` é sequência recém-criada que ainda não entregou nada:
  -- o próximo `nextval` devolve o próprio `last_value`.
  select '#' || (case when s.is_called then s.last_value + 1 else s.last_value end)::text
    into v_codigo
    from public.vendas_codigo_seq s;

  return v_codigo;
end
$$;

comment on function public.proximo_codigo_venda() is
  'Código que a próxima venda vai receber. NÃO consome o número da sequência.';

do $$
begin
  revoke execute on function public.proximo_codigo_venda() from public, anonymous;
  grant execute on function public.proximo_codigo_venda() to authenticated;
end
$$;

-- O Data API guarda um cache do esquema e não enxerga uma função nova sozinho:
-- até o cache ser atualizado, a chamada responde
-- "Could not find the function public.proximo_codigo_venda ... in the schema
-- cache". O `notify` abaixo é o caminho do PostgREST puro (self-hosted). No
-- Neon, que gerencia o Data API, quem manda atualizar é a CLI:
--
--   npx neon data-api refresh-schema --project-id <projeto> --database neondb
--
-- (a tela não depende disso: sem a função, ela cai no cálculo pelo último código)
notify pgrst, 'reload schema';
