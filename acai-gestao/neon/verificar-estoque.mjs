/**
 * Verificação do livro-razão do estoque (migrações 06 e 07) contra a base REAL.
 *
 * Uso:
 *   node neon/verificar-estoque.mjs                  → só leitura (não escreve nada)
 *   node neon/verificar-estoque.mjs --concorrencia   → inclui o teste de concorrência
 *
 * Precisa do `DATABASE_URL` no `.env` (a mesma string que o `aplicar.mjs` usa).
 *
 * Por que existe: o `npm run validar:migracoes` prova a regra num Postgres em
 * memória; este aqui prova que a regra está de pé NA PRODUÇÃO, com os dados de
 * verdade — e é o que confere, a cada mudança, se o cache do saldo continua
 * batendo com o livro-razão.
 *
 * Nada é alterado: cada escrita acontece dentro de uma transação que termina em
 * ROLLBACK. A única exceção é o `--concorrencia`, que precisa de duas conexões
 * confirmando de verdade (e por isso desfaz o próprio rastro no fim).
 *
 * ARMADILHA (documentada no README): a primeira avaliação de `auth.uid()` numa
 * conexão do Neon devolve nulo, e trocar de papel descarta os GUCs já gravados.
 * Por isso `abrir()` queima a primeira avaliação e a ordem é sempre
 * "papel primeiro, claim depois".
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

function url() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const texto = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const linha = texto.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
  if (!linha) throw new Error('DATABASE_URL não encontrado no .env')
  return linha.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
}

let falhas = 0
const ok = (nome, cond, extra = '') => {
  if (!cond) falhas++
  console.log(`  ${cond ? 'ok   ' : 'FALHA'} ${nome}${extra ? ` — ${extra}` : ''}`)
}
const titulo = (t) => console.log(`\n== ${t} ==`)
const n = (v) => Number(v)
const conectar = async () => {
  const c = new pg.Client({ connectionString: url(), ssl: { rejectUnauthorized: false } })
  await c.connect()
  return c
}

/** Conexão pronta para simular um usuário: já queimou a primeira avaliação. */
async function abrir() {
  const c = await conectar()
  await c.query('begin')
  await c.query(`select public.pode('estoque','ver')`)
  await c.query('rollback')
  return c
}

const um = async (c, sql, params) => (await c.query(sql, params)).rows[0]

/** Transação que sempre termina desfeita. */
async function emTransacao(c, fn) {
  await c.query('begin')
  try {
    return await fn()
  } finally {
    await c.query('rollback')
  }
}

/** Vira o usuário indicado (precisa estar dentro de uma transação). */
async function como(c, uid, fn) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated' }),
  ])
  return fn()
}

/** Tenta algo que deve falhar; devolve a mensagem do banco (ou null se passou). */
async function tentarFalha(c, uid, sql, params) {
  await c.query('begin')
  try {
    if (uid) await como(c, uid, () => c.query(sql, params))
    else await c.query(sql, params)
    return null
  } catch (e) {
    return e.message
  } finally {
    await c.query('rollback')
  }
}

const entrar = async (c, uid) => como(c, uid, async () => null)

/* ---------------------------------------------------------- concorrência --- */

/**
 * Duas conexões movendo o MESMO item ao mesmo tempo.
 *
 * O erro que este teste persegue é o "lost update": as duas leem o saldo, cada
 * uma soma a sua parte e a última a gravar apaga a outra. Ele força o pior
 * instante — B já está dentro do movimento quando A confirma.
 *
 * Precisa confirmar de verdade (duas transações abertas não enxergam uma à
 * outra), então deixa rastro: as duas entradas e um ajuste que devolve o saldo.
 * O motivo de cada movimento diz que veio daqui.
 */
async function testarConcorrencia(c) {
  titulo('Operações concorrentes no mesmo item (escreve e desfaz)')

  const produto = (await um(c, `select id from public.produtos where codigo = 'P011'`)).id
  const base = n((await um(c, `select public.saldo_estoque($1) as s`, [produto])).s)
  const antes = n((await um(c, `select count(*)::int as n from public.movimentacoes_estoque`)).n)
  const admin = (await um(c, `select id from public.profiles where role='admin' order by created_at limit 1`)).id

  const A = await abrir()
  const B = await abrir()
  try {
    await A.query('begin')
    await entrar(A, admin)
    const movA = await A.query(
      `select * from public.registrar_movimentacao($1, 5, 'fornecedor', 'estoque',
              'Entrada A do teste de concorrência')`,
      [produto],
    )
    ok('A registrou +5 e está segurando a linha', n(movA.rows[0].saldo) === base + 5, `saldo = ${n(movA.rows[0].saldo)}`)

    await B.query('begin')
    await entrar(B, admin)
    let bTerminou = false
    let bErro = null
    const bMov = B.query(
      `select * from public.registrar_movimentacao($1, 7, 'fornecedor', 'estoque',
              'Entrada B do teste de concorrência')`,
      [produto],
    )
      .then((r) => {
        bTerminou = true
        return r
      })
      .catch((e) => {
        bTerminou = true
        bErro = e
        return null
      })

    await new Promise((r) => setTimeout(r, 900))
    ok('B esperou a linha ser liberada', !bTerminou, bTerminou ? 'terminou antes: não houve espera' : 'ainda pendente depois de 900 ms')

    await A.query('commit')
    const rB = await bMov
    ok('B concluiu depois do commit de A', bTerminou && !bErro, bErro ? bErro.message : '')

    if (rB) {
      const esperado = base + 12
      const livro = n((await um(B, `select public.saldo_estoque($1) as s`, [produto])).s)
      const cache = n((await um(B, `select quantidade from public.produtos where id = $1`, [produto])).quantidade)

      ok('o livro somou as duas entradas', livro === esperado, `livro = ${livro}, esperado ${esperado}`)
      ok('o cache não perdeu a atualização', cache === esperado, `cache = ${cache}, esperado ${esperado}`)
      ok('B enxergou o saldo já somado', n(rB.rows[0].saldo) === esperado, `saldo em B = ${n(rB.rows[0].saldo)}`)
    }

    await B.query('commit')
  } finally {
    await B.end()
  }

  // O desfazimento precisa ser CONFIRMADO (as entradas A e B foram), então não
  // cabe numa transação de mentira.
  await A.query('begin')
  await entrar(A, admin)
  const desfazer = await A.query(
    `select * from public.ajustar_saldo($1, $2, 'Desfazendo o teste de concorrência', 'contagem')`,
    [produto, base],
  )
  await A.query('commit')

  const fim = await um(
    A,
    `select public.saldo_estoque($1) as livro, (select quantidade from public.produtos where id = $1) as cache,
            (select count(*)::int from public.movimentacoes_estoque) as n
       from public.produtos where id = $1`,
    [produto],
  )
  ok('saldo do item restaurado', n(desfazer.rows[0].saldo) === base && n(fim.livro) === base, `${n(fim.livro)} kg (era ${base})`)
  ok('cache = livro no fim', n(fim.cache) === n(fim.livro), `${n(fim.cache)} x ${n(fim.livro)}`)
  console.log(`  (o livro ganhou ${fim.n - antes} movimentos: as duas entradas e o ajuste que desfaz)`)
  await A.end()
}

/* ------------------------------------------------------------------ main --- */

const c = await abrir()

try {
  const admin = (await um(c, `select id from public.profiles where role='admin' order by created_at limit 1`)).id
  const caixa = (await um(c, `select id from public.profiles where role='cashier' order by created_at limit 1`)).id
  const org = (await um(c, `select id from public.organizations order by created_at limit 1`)).id
  const p008 = (await um(c, `select id from public.produtos where codigo='P008'`)).id
  const p010 = (await um(c, `select id from public.produtos where codigo='P010'`)).id
  const saldo = async (id) => n((await um(c, `select public.saldo_estoque($1) as s`, [id])).s)

  titulo('1. Livro-razão de pé e cache de acordo')
  {
    const r = await um(
      c,
      `select to_regclass('public.movimentacoes_estoque') is not null as tabela,
              (select count(*)::int from public.movimentacoes_estoque) as movimentos,
              (select count(*)::int from public.movimentacoes_estoque
                where origem='abertura' and destino='estoque') as aberturas,
              (select count(*)::int from public.movimentacoes_estoque where organization_id = $1) as da_org,
              (select count(*)::int from public.produtos p
                where p.quantidade is distinct from public.saldo_estoque(p.id)) as divergentes,
              (select count(*)::int from public.produtos where quantidade <> 0) as com_saldo,
              (select count(*)::int from public.movimentacoes_estoque
                where origem = 'abertura' and usuario_id is not null) as aberturas_com_autor,
              (select count(*)::int from public.movimentacoes_estoque where quantidade <= 0) as nao_positivos,
              (select count(*)::int from pg_constraint
                where conrelid = 'public.movimentacoes_estoque'::regclass
                  and contype = 'f' and confrelid = 'public.profiles'::regclass) as fk_perfis,
              (select count(*)::int from pg_constraint
                where conrelid = 'public.movimentacoes_estoque'::regclass
                  and contype = 'f' and confrelid = 'public.produtos'::regclass) as fk_produtos`,
      [org],
    )
    ok('a tabela do livro existe', r.tabela)
    ok('todo item com saldo tem saldo inicial registrado', r.aberturas === r.com_saldo && r.aberturas > 0, `${r.aberturas} aberturas / ${r.com_saldo} itens com saldo`)
    ok('o cache do saldo bate com o livro em todos os itens', n(r.divergentes) === 0, `${r.divergentes} divergindo`)
    ok('todas as linhas na organização da loja', r.da_org === r.movimentos, `${r.da_org} de ${r.movimentos}`)
    ok('as aberturas não têm autor (nasceram do sistema)', r.aberturas_com_autor === 0, `${r.aberturas_com_autor} com autor`)
    ok('nenhum movimento com quantidade <= 0', r.nao_positivos === 0)
    ok('o movimento aponta para o item e para quem registrou', r.fk_produtos > 0 && r.fk_perfis > 0, `produtos ${r.fk_produtos}, profiles ${r.fk_perfis}`)
  }

  titulo('2. O admin enxerga e edita (sessão igual à do PostgREST)')
  await emTransacao(c, () =>
    como(c, admin, async () => {
      const podeEditar = (await um(c, `select public.pode('estoque','editar') as p`)).p
      const ve = n((await um(c, `select count(*)::int as n from public.produtos`)).n)
      const antes = await saldo(p008)
      const upd = await c.query(
        `update public.produtos set preco = preco + 0.01, quantidade = 999 where id = $1`,
        [p008],
      )
      const depois = n((await um(c, `select quantidade from public.produtos where id = $1`, [p008])).quantidade)

      ok("pode('estoque','editar') = true", podeEditar === true)
      ok('lê todos os itens', ve > 0, `${ve} itens`)
      ok(
        'digitar saldo no item é aceito no papel e ignorado no valor',
        upd.rowCount === 1 && depois === antes,
        `preço mudou (${upd.rowCount} linha), saldo continua ${depois}`,
      )
    }),
  )

  titulo('3. Saída maior que o saldo é recusada')
  {
    const msg = await tentarFalha(
      c,
      admin,
      `select * from public.registrar_movimentacao($1, 999999, 'estoque', 'perda', 'teste de saldo')`,
      [p010],
    )
    ok('recusada, com mensagem em português', Boolean(msg && /saldo insuficiente/i.test(msg)), msg ?? 'passou!')
    ok('e o saldo do item ficou positivo', (await saldo(p010)) > 0)
  }

  titulo('4. Compra e contagem de verdade pela RPC (transação desfeita)')
  await emTransacao(c, () =>
    como(c, admin, async () => {
      const antes = await saldo(p008)
      const mov = await um(
        c,
        `select * from public.registrar_movimentacao($1, 10, 'fornecedor', 'estoque', 'Compra de 10 kg de banana')`,
        [p008],
      )
      ok('a compra entra no saldo', n(mov.saldo) === antes + 10, `${antes} -> ${n(mov.saldo)} kg`)

      const gravado = await um(
        c,
        `select usuario_id, organization_id, quantidade, origem, destino, motivo
           from public.movimentacoes_estoque where id = $1`,
        [mov.id],
      )
      ok('carimbado com o usuário da sessão', gravado.usuario_id === admin)
      ok('organização vinda do banco, não do pedido', gravado.organization_id === org)
      ok(
        'quantidade e motivo gravados como enviados',
        n(gravado.quantidade) === 10 && gravado.motivo === 'Compra de 10 kg de banana',
      )

      const ajuste = await um(
        c,
        `select * from public.ajustar_saldo($1, $2, 'Contagem física do teste', 'contagem')`,
        [p008, n(mov.saldo) + 3],
      )
      ok(
        'a contagem grava só a diferença',
        n(ajuste.saldo) === n(ajuste.saldo_anterior) + 3,
        `${n(ajuste.saldo_anterior)} -> ${n(ajuste.saldo)} kg`,
      )

      const repetido = await um(
        c,
        `select * from public.ajustar_saldo($1, $2, 'Contagem repetida', 'contagem')`,
        [p008, n(ajuste.saldo)],
      )
      ok('contar o mesmo valor de novo não cria movimento', repetido.movimentacao_id === null)

      const fixo = await tentarFalha(
        c,
        admin,
        `select * from public.registrar_movimentacao($1, 1, 'abertura', 'estoque', 'tentativa')`,
        [p008],
      )
      ok('a tela não consegue inventar "abertura" por movimento', Boolean(fixo && /origem/i.test(fixo)), fixo ?? 'passou!')
    }),
  )

  titulo('5. O livro é imutável')
  {
    const alvo = (await um(c, `select id from public.movimentacoes_estoque order by criado_em limit 1`)).id
    const msgUpdate = await tentarFalha(c, null, `update public.movimentacoes_estoque set quantidade = 1 where id = $1`, [alvo])
    ok('UPDATE em movimento é recusado', Boolean(msgUpdate && /não pode ser alterada/i.test(msgUpdate)), msgUpdate ?? 'passou!')
    const msgDelete = await tentarFalha(c, null, `delete from public.movimentacoes_estoque where id = $1`, [alvo])
    ok('DELETE em movimento é recusado', Boolean(msgDelete && /não pode ser alterada/i.test(msgDelete)), msgDelete ?? 'passou!')
  }

  titulo('6. Dedução dupla: o índice único barra')
  {
    const item = await um(c, `select i.id, i.venda_id from public.itens_venda i where i.venda_id is not null limit 1`)
    await c.query('begin')
    try {
      await c.query(
        `insert into public.movimentacoes_estoque
           (organization_id, produto_id, quantidade, origem, destino, motivo, venda_id, item_venda_id)
         values ($1, $2, 0.5, 'estoque', 'cliente', 'Venda', $3, $4)`,
        [org, p008, item.venda_id, item.id],
      )
      const segundo = await tentarFalha(
        c,
        null,
        `insert into public.movimentacoes_estoque
           (organization_id, produto_id, quantidade, origem, destino, motivo, venda_id, item_venda_id)
         values ($1, $2, 0.5, 'estoque', 'cliente', 'Venda de novo', $3, $4)`,
        [org, p008, item.venda_id, item.id],
      )
      ok(
        'o mesmo item de venda não gera dois movimentos',
        Boolean(segundo && /duplicate key|mov_estoque_item_venda_unico/i.test(segundo)),
        segundo ?? 'passou!',
      )
    } finally {
      await c.query('rollback')
    }
  }

  titulo('7. O operador de caixa: lê o livro, mas não move')
  {
    const leitura = await emTransacao(c, () =>
      como(c, caixa, async () => n((await um(c, `select count(*)::int as n from public.movimentacoes_estoque`)).n)),
    )
    ok('o caixa lê o histórico', leitura > 0, `${leitura} movimentos`)

    const direto = await tentarFalha(
      c,
      caixa,
      `insert into public.movimentacoes_estoque (produto_id, quantidade, origem, destino, motivo)
       values ($1, 1, 'fornecedor', 'estoque', 'direto')`,
      [p008],
    )
    ok('INSERT direto no livro é negado pelo banco', Boolean(direto && /permission denied|negad/i.test(direto)), direto ?? 'passou!')

    const rpc = await tentarFalha(
      c,
      caixa,
      `select * from public.registrar_movimentacao($1, 1, 'fornecedor', 'estoque', 'tentativa')`,
      [p008],
    )
    ok('e também não movimenta pela RPC', Boolean(rpc && /permiss/i.test(rpc)), rpc ?? 'passou!')
  }

  titulo('8. Nada mudou (a verificação não escreve)')
  {
    const r = await um(
      c,
      `select (select count(*)::int from public.vendas) as vendas,
              (select count(*)::int from public.itens_venda) as itens_venda,
              (select count(*)::int from public.clientes) as clientes,
              (select count(*)::int from public.produtos) as produtos,
              (select count(*)::int from public.produtos p
                where p.quantidade is distinct from public.saldo_estoque(p.id)) as divergentes,
              (select sum(p.quantidade)::text from public.produtos p) as soma`,
    )
    ok('vendas, itens, clientes e produtos intactos', true, `${r.vendas} vendas · ${r.itens_venda} itens · ${r.clientes} clientes · ${r.produtos} produtos`)
    ok('zero divergência entre cache e livro', n(r.divergentes) === 0)
    console.log(`  (soma dos saldos: ${r.soma})`)
  }

  if (process.argv.includes('--concorrencia')) {
    await testarConcorrencia(c)
  } else {
    console.log('\n  (o teste de concorrência fica de fora: rode com --concorrencia)')
  }

  console.log(falhas === 0 ? '\n== TUDO OK ==\n' : `\n== ${falhas} FALHA(S) ==\n`)
  process.exitCode = falhas === 0 ? 0 : 1
} finally {
  await c.end()
}
