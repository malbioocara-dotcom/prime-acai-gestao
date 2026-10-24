/**
 * Confere o módulo de Compras na base real, sem deixar rastro.
 *
 * Uso:
 *   npm run verificar:compras
 *
 * Precisa de `DATABASE_URL` no `.env` (ou no ambiente). O roteiro abre uma
 * transação, cria fornecedor/compra/itens, recebe (total e parcial), confere
 * estoque, custo médio, movimentos e o bloqueio de segunda entrada — e termina
 * com ROLLBACK em tudo.
 *
 * Por que o teste simula a sessão do jeito que simula:
 *   • o papel `authenticated` vem antes do claim (SET ROLE descarta GUCs);
 *   • a primeira avaliação de `auth.uid()` numa conexão nova devolve nulo, então
 *     há uma transação descartável de aquecimento antes das medições.
 * Isso está documentado em `neon/README.md` e é o mesmo caminho que o Data API
 * usa em produção.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

function lerEnv() {
  try {
    const texto = readFileSync(join(raiz, '.env'), 'utf8')
    const env = {}
    for (const linha of texto.split(/\r?\n/)) {
      if (linha.trim().startsWith('#')) continue
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    return env
  } catch {
    return {}
  }
}

const env = lerEnv()
const base = (process.env.DATABASE_URL || env.DATABASE_URL || '').trim()

if (!base) {
  console.log('\n  DATABASE_URL não configurada. Nada a verificar.\n')
  process.exit(0)
}

// Evita o pooler: o teste depende da mesma sessão entre as transações.
const connectionString = base.replace('-pooler', '')

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

const q = async (sql, params) => (await client.query(sql, params)).rows
let falhas = 0

function conferir(condicao, mensagem) {
  if (condicao) {
    console.log(`  ok    ${mensagem}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${mensagem}`)
  }
}

async function comoUsuario(usuario, acao) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: usuario.id }),
    ])
    // Força as funções security definer a ler o claim desta transação. Chamar
    // auth.uid() direto não funciona para o papel authenticated (sem USAGE no
    // schema auth); `minha_organizacao()` é a porta pública.
    await q('select public.minha_organizacao() as org')
    return await acao()
  } finally {
    await client.query('rollback')
  }
}

const sufixo = Date.now()
const admin = (
  await q(`select id, full_name, organization_id from profiles where role='admin' and is_active order by created_at limit 1`)
)[0]
const caixa = (
  await q(`select id, full_name from profiles where role='cashier' and is_active order by created_at limit 1`)
)[0]
const produto = (
  await q(`select id, nome, unidade, custo::float8 as custo, quantidade::float8 as quantidade
             from produtos where ativo and controla_estoque order by nome limit 1`)
)[0]

if (!admin) {
  console.error('Sem perfil admin ativo para verificar.')
  process.exit(1)
}
if (!produto) {
  console.error('Sem produto com controle de estoque para verificar.')
  process.exit(1)
}

console.log(`\n  Admin: ${admin.full_name}`)
console.log(`  Produto: ${produto.nome} (${produto.unidade}) | saldo ${produto.quantidade} | custo ${produto.custo}\n`)

// Aquecimento: a primeira auth.uid() da conexão devolve nulo de propósito.
await client.query('begin')
await client.query('set local role authenticated')
await q(`select public.pode('compras', 'consultar')`)
await client.query('rollback')

/* --------------------------------------------------------- entrada total -- */
console.log('  Entrada total')
try {
  await comoUsuario(admin, async () => {
    const fornecedor = (
      await q(
        `insert into fornecedores (nome, organization_id)
         values ($1, $2) returning id`,
        [`FORNECEDOR VERIFICACAO ${sufixo}`, admin.organization_id],
      )
    )[0]

    const compra = (
      await q(
        `insert into compras
           (numero, data_compra, fornecedor_id, tipo_documento, numero_nota,
            frete_valor, desconto_valor, status, usuario_id, organization_id)
         values ($1, current_date, $2, 'com_nota', 'NF-VERIFICACAO', 10, 2, 'rascunho', $3, $4)
         returning id, status`,
        [`C-VERIF-${sufixo}`, fornecedor.id, admin.id, admin.organization_id],
      )
    )[0]

    await q(`update compras set status='aguardando_recebimento' where id=$1`, [compra.id])

    const item = (
      await q(
        `insert into compras_itens
           (compra_id, produto_id, nome, unidade_compra, fator_conversao,
            quantidade_solicitada, custo_unitario, desconto_valor)
         values ($1, $2, $3, 'cx', 12, 2, 30, 0)
         returning id`,
        [compra.id, produto.id, produto.nome],
      )
    )[0]

    const saldoAntes = Number(
      (await q(`select quantidade::float8 as quantidade from produtos where id=$1`, [produto.id]))[0].quantidade,
    )
    const custoAntes = Number(
      (await q(`select custo::float8 as custo from produtos where id=$1`, [produto.id]))[0].custo,
    )

    const receb = (
      await q(`select * from confirmar_recebimento_compra($1, $2::jsonb)`, [
        compra.id,
        JSON.stringify([{ item_id: item.id, quantidade: 2, lote: 'LOTE-VERIF', validade: '2027-01-31' }]),
      ])
    )[0]

    conferir(receb.status === 'recebido_confirmado', 'compra fica recebida e confirmada')
    conferir(Number(receb.itens_recebidos) === 1, 'RPC informa 1 item recebido')

    const depois = (
      await q(
        `select c.status, c.data_recebimento, ci.quantidade_recebida::float8 as recebida,
                ci.lote, p.quantidade::float8 as saldo, p.custo::float8 as custo
           from compras c
           join compras_itens ci on ci.compra_id = c.id
           join produtos p on p.id = ci.produto_id
          where c.id = $1`,
        [compra.id],
      )
    )[0]

    conferir(Number(depois.recebida) === 2, 'item recebeu 2 caixas')
    conferir(Number(depois.saldo) - saldoAntes === 24, 'estoque entrou com 24 un (2 × 12)')
    conferir(depois.lote === 'LOTE-VERIF', 'lote foi gravado')

    const custoEsperado = ((Math.max(saldoAntes, 0) * custoAntes + 68) / (Math.max(saldoAntes, 0) + 24))
    conferir(Math.abs(Number(depois.custo) - custoEsperado) < 0.02, 'custo médio inclui frete e desconto')
    conferir(depois.data_recebimento !== null, 'data de recebimento preenchida')

    const movimento = (
      await q(
        `select quantidade::float8 as quantidade, origem, destino
           from movimentacoes_estoque
          where produto_id = $1
          order by criado_em desc limit 1`,
        [produto.id],
      )
    )[0]
    conferir(movimento?.origem === 'fornecedor' && movimento?.destino === 'estoque', 'movimento é fornecedor → estoque')
    conferir(Number(movimento?.quantidade) === 24, 'movimento registra 24 un')

    let duplicou = false
    await client.query('savepoint duplicidade')
    try {
      await q(`select * from confirmar_recebimento_compra($1, $2::jsonb)`, [
        compra.id,
        JSON.stringify([{ item_id: item.id, quantidade: 1 }]),
      ])
    } catch {
      duplicou = true
    }
    await client.query('rollback to savepoint duplicidade')
    conferir(duplicou, 'segunda entrada na mesma compra é recusada')
  })
} catch (erro) {
  falhas += 1
  console.error('  FALHA inesperada na entrada total:', erro.message)
}

/* ------------------------------------------------------ entrada parcial -- */
console.log('\n  Entrada parcial')
try {
  await comoUsuario(admin, async () => {
    const fornecedor = (
      await q(
        `insert into fornecedores (nome, organization_id)
         values ($1, $2) returning id`,
        [`FORNECEDOR PARCIAL ${sufixo}`, admin.organization_id],
      )
    )[0]

    const compra = (
      await q(
        `insert into compras
           (numero, data_compra, fornecedor_id, tipo_documento, status, usuario_id, organization_id)
         values ($1, current_date, $2, 'sem_nota', 'rascunho', $3, $4)
         returning id`,
        [`C-PARCIAL-${sufixo}`, fornecedor.id, admin.id, admin.organization_id],
      )
    )[0]

    await q(`update compras set status='aguardando_recebimento' where id=$1`, [compra.id])

    const item = (
      await q(
        `insert into compras_itens
           (compra_id, produto_id, nome, unidade_compra, fator_conversao,
            quantidade_solicitada, custo_unitario)
         values ($1, $2, $3, 'kg', 1, 3, 10)
         returning id`,
        [compra.id, produto.id, produto.nome],
      )
    )[0]

    const saldoAntes = Number(
      (await q(`select quantidade::float8 as quantidade from produtos where id=$1`, [produto.id]))[0].quantidade,
    )

    async function receber(quantidade) {
      const r = (
        await q(`select * from confirmar_recebimento_compra($1, $2::jsonb)`, [
          compra.id,
          JSON.stringify([{ item_id: item.id, quantidade }]),
        ])
      )[0]
      const c = (
        await q(
          `select c.status, c.data_recebimento, ci.quantidade_recebida::float8 as recebida
             from compras c join compras_itens ci on ci.compra_id = c.id
            where c.id = $1`,
          [compra.id],
        )
      )[0]
      return { r, c }
    }

    const primeira = await receber(1)
    conferir(primeira.r.status === 'recebimento_parcial', '1ª parcial mantém a compra aberta')
    conferir(primeira.c.status === 'recebimento_parcial', 'status gravado é recebimento parcial')
    conferir(Number(primeira.c.recebida) === 1 && primeira.c.data_recebimento === null, 'parcial não fecha data de recebimento')

    const segunda = await receber(1)
    conferir(segunda.r.status === 'recebimento_parcial', '2ª parcial continua aberta')

    let excedeu = false
    await client.query('savepoint excedente')
    try {
      await q(`select * from confirmar_recebimento_compra($1, $2::jsonb)`, [
        compra.id,
        JSON.stringify([{ item_id: item.id, quantidade: 2 }]),
      ])
    } catch {
      excedeu = true
    }
    await client.query('rollback to savepoint excedente')
    conferir(excedeu, 'quantidade acima do pendente é recusada')

    const terceira = await receber(1)
    conferir(terceira.r.status === 'recebido_confirmado', 'última parcial fecha a compra')
    conferir(terceira.c.data_recebimento !== null, 'data de recebimento preenchida ao fechar')

    const saldoDepois = Number(
      (await q(`select quantidade::float8 as quantidade from produtos where id=$1`, [produto.id]))[0].quantidade,
    )
    conferir(saldoDepois - saldoAntes === 3, 'as três parciais somam 3 kg no estoque')

    const movimentos = await q(
      `select count(*)::int as total
         from movimentacoes_estoque
        where produto_id = $1 and motivo like $2`,
      [produto.id, `Compra C-PARCIAL-${sufixo}%`],
    )
    conferir(movimentos[0].total === 3, 'foram gravados 3 movimentos, um por recebimento')
  })
} catch (erro) {
  falhas += 1
  console.error('  FALHA inesperada na entrada parcial:', erro.message)
}

/* ------------------------------------------------------------- permissão -- */
if (caixa) {
  console.log('\n  Permissão do caixa')
  try {
    await comoUsuario(caixa, async () => {
      const p = (
        await q(`select public.pode('compras','criar') as criar, public.pode('compras','editar') as editar`)
      )[0]
      conferir(p.criar === false, 'caixa não cria compra/fornecedor')
      conferir(p.editar === false, 'caixa não confirma recebimento')
    })
  } catch (erro) {
    falhas += 1
    console.error('  FALHA inesperada na permissão:', erro.message)
  }
} else {
  console.log('\n  (sem caixa ativo; permissão do caixa não verificada)')
}

await client.end()

if (falhas) {
  console.log(`\n  ${falhas} verificação(ões) falharam.\n`)
  process.exit(1)
}

console.log('\n  Compras: tudo certo (nada foi gravado).\n')
