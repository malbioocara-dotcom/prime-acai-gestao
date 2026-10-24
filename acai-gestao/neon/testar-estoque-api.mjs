/**
 * Teste do estoque pelo caminho REAL do navegador (Neon Data API / PostgREST).
 *
 * O `verificar-estoque.mjs` fala direto com o Postgres e prova a regra. Aqui a
 * pergunta é outra: **o navegador consegue?** Isto é, o Data API expõe as duas
 * RPCs com os nomes de argumento que o `src/services/movimentacoes.js` manda, o
 * `authenticated` tem `execute`, o embed do autor (`quem:profiles(full_name)`)
 * devolve linha, e a mensagem em português chega ao cliente.
 *
 * Uso:
 *   node neon/testar-estoque-api.mjs
 *
 * Como funciona: cadastra um usuário descartável (signup), pega o JWT no header
 * `set-auth-jwt`, promove esse perfil a admin pelo SQL (é o que dá
 * `estoque.criar`/`estoque.editar`) e conversa com o Data API como ele.
 *
 * Este teste NÃO escreve no livro-razão: a chamada que dá certo é um ajuste de
 * contagem para o MESMO saldo (o banco responde sem criar movimento), e as
 * outras são tentativas que o banco recusa de propósito. Por isso o usuário
 * pode ser apagado depois sem deixar rastro.
 *
 * No fim ele imprime o e-mail e o UID. Apague com:
 *   npx --yes neon@latest neon-auth user delete <UID> --project-id <PROJETO>
 *
 * Precisa do `DATABASE_URL` no `.env` (só para promover/rebaixar o perfil).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

function lerEnv() {
  const env = {}
  for (const linha of readFileSync(join(raiz, '.env'), 'utf8').split(/\r?\n/)) {
    if (linha.trim().startsWith('#')) continue
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

function derivar(base) {
  const url = new URL(base)
  const [primeiro, ...resto] = url.hostname.split('.')
  const porta = url.port ? `:${url.port}` : ''
  const caminho = url.pathname.replace(/\/+$/, '')
  return {
    auth: `${url.protocol}//${[primeiro, 'neonauth', ...resto].join('.')}${porta}${caminho}/auth`,
    data: `${url.protocol}//${[primeiro, 'apirest', ...resto].join('.')}${porta}${caminho}/rest/v1`,
  }
}

const env = lerEnv()
const ORIGEM = 'https://prime-acai-gestao.pages.dev'
const { auth: authBase, data: dataBase } = derivar(env.VITE_NEON_URL)

let falhas = 0
const ok = (rotulo, cond, detalhe = '') => {
  if (!cond) falhas++
  console.log(`  ${cond ? 'OK   ' : 'FALHA'} ${rotulo.padEnd(48)} ${detalhe}`)
}

const stamp = Date.now()
const email = `e2e.estoque.${stamp}@primeacai.local`
const senha = `Teste!${stamp}`

console.log(`\nAuth:  ${authBase}\nData:  ${dataBase}\nUser:  ${email}\n`)

const H = { 'Content-Type': 'application/json', Origin: ORIGEM }

// 1) cadastro + sessão
const sign = await fetch(`${authBase}/sign-up/email`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ email, password: senha, name: 'E2E Estoque', callbackURL: `${ORIGEM}/` }),
})
const signJson = await sign.json().catch(() => null)
ok('sign-up', sign.ok, `HTTP ${sign.status} ${signJson?.message ?? ''}`)
const uid = signJson?.user?.id
const cookie = (sign.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

const sess = await fetch(`${authBase}/get-session`, { headers: { Origin: ORIGEM, cookie } })
const jwt = sess.headers.get('set-auth-jwt')
ok('get-session devolve set-auth-jwt', Boolean(jwt && jwt.split('.').length === 3), jwt ? `${jwt.slice(0, 24)}…` : 'sem JWT')
if (!jwt) {
  console.log('\n  Sem JWT; abortando.\n')
  process.exit(1)
}

const req = async (caminho, init = {}) => {
  const r = await fetch(dataBase + caminho, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, ...(init.headers || {}) },
  })
  const texto = await r.text()
  let json = null
  try {
    json = JSON.parse(texto)
  } catch {
    /* vazio */
  }
  return { status: r.status, json, texto }
}
const rpc = (fn, body = {}) =>
  req(`/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// O usuário nasce como caixa e sem permissão de estoque: quem manda no estoque
// precisa de `estoque.criar`/`estoque.editar`, então o perfil é promovido a
// admin pelo SQL (é o mesmo que aprovar alguém no sistema).
await rpc('garantir_perfil')

const urlBanco = process.env.DATABASE_URL || env.DATABASE_URL
if (!urlBanco) {
  console.log('\n  Sem DATABASE_URL (defina no ambiente ou no .env); abortando.\n')
  process.exit(1)
}
const db = new pg.Client({ connectionString: urlBanco, ssl: { rejectUnauthorized: false } })
await db.connect()
const virar = async (papel) => {
  await db.query(
    `update public.profiles
        set role = $2, is_active = true, aprovado_em = coalesce(aprovado_em, now())
      where id = $1`,
    [uid, papel],
  )
}
await virar('admin')
ok('perfil descartável promovido a admin', true, `uid ${String(uid).slice(0, 8)}…`)

// 2) a consulta do histórico é a MESMA que a tela de Estoque faz
console.log('\n1) Histórico com o autor (a consulta exata da tela)')
const historico = await req(
  '/movimentacoes_estoque?select=id,produto_id,quantidade,origem,destino,motivo,venda_id,criado_em,quem:profiles(full_name)&order=criado_em.desc&limit=5',
)
const linhas = Array.isArray(historico.json) ? historico.json : []
ok('o embed do autor responde', historico.status === 200, `HTTP ${historico.status} ${String(historico.texto).slice(0, 60)}`)
ok('vieram movimentos', linhas.length > 0, `${linhas.length} linhas`)
ok(
  'o autor vem preenchido (full_name)',
  linhas.some((l) => l.quem && typeof l.quem.full_name === 'string' && l.quem.full_name.length > 0),
  JSON.stringify(linhas.find((l) => l.quem)?.quem ?? null),
)

// 3) os dados do item que vai servir de cobaia
console.log('\n2) O item de teste')
const produto = await req('/produtos?select=id,codigo,nome,quantidade&codigo=eq.P011')
const item = Array.isArray(produto.json) ? produto.json[0] : null
ok('lê o item P011 pelo identificador', produto.status === 200 && Boolean(item), `HTTP ${produto.status}`)
const idItem = item?.id
const saldoInicial = Number(item?.quantidade ?? NaN)
ok('o saldo do item é legível', Number.isFinite(saldoInicial), `${saldoInicial} kg`)

// 4) a RPC de contagem, pelo navegador, pedindo o MESMO saldo
console.log('\n3) ajustar_saldo pela RPC (sem criar movimento)')
const mesmo = await rpc('ajustar_saldo', {
  p_produto_id: idItem,
  p_contado: saldoInicial,
  p_motivo: 'Conferência de leitura (teste de API)',
  p_local: 'contagem',
})
const mesmoLinha = Array.isArray(mesmo.json) ? mesmo.json[0] : mesmo.json
ok('a RPC responde 200', mesmo.status === 200, `HTTP ${mesmo.status} ${String(mesmo.texto).slice(0, 60)}`)
ok(
  'devolve saldo_anterior, saldo e movimentacao_id (o que a tela lê)',
  mesmoLinha && 'saldo_anterior' in mesmoLinha && 'saldo' in mesmoLinha && 'movimentacao_id' in mesmoLinha,
  JSON.stringify(mesmoLinha ?? null).slice(0, 80),
)
ok('contar o mesmo saldo não cria movimento', mesmoLinha?.movimentacao_id === null, `movimentacao_id=${mesmoLinha?.movimentacao_id}`)

// 5) a RPC de movimento é alcançável (o erro prova que ela rodou: a checagem de
//    permissão e o casamento dos nomes dos argumentos vêm ANTES do saldo)
console.log('\n4) registrar_movimentacao: o navegador chega até ela')
const saida = await rpc('registrar_movimentacao', {
  p_produto_id: idItem,
  p_qtd: 999999,
  p_origem: 'estoque',
  p_destino: 'perda',
  p_motivo: 'Teste de API: saída maior que o saldo',
})
ok('saída maior que o saldo é recusada', saida.status >= 400, `HTTP ${saida.status}`)
ok(
  'e a mensagem vem em português',
  /saldo insuficiente/i.test(saida.json?.message ?? saida.texto),
  String(saida.json?.message ?? saida.texto).slice(0, 78),
)

const semMotivo = await rpc('registrar_movimentacao', {
  p_produto_id: idItem,
  p_qtd: 1,
  p_origem: 'fornecedor',
  p_destino: 'estoque',
  p_motivo: '   ',
})
ok('movimento sem motivo é recusado', semMotivo.status >= 400 && /motivo/i.test(semMotivo.json?.message ?? ''), String(semMotivo.json?.message ?? '').slice(0, 60))

const origemIgual = await rpc('registrar_movimentacao', {
  p_produto_id: idItem,
  p_qtd: 1,
  p_origem: 'estoque',
  p_destino: 'estoque',
  p_motivo: 'Teste de API: origem igual ao destino',
})
ok('origem igual ao destino é recusada', origemIgual.status >= 400 && /mesmo local/i.test(origemIgual.json?.message ?? ''), String(origemIgual.json?.message ?? '').slice(0, 60))

// 6) e o caixa comum?
console.log('\n5) O caixa comum')
await virar('cashier')
const caixaMov = await rpc('registrar_movimentacao', {
  p_produto_id: idItem,
  p_qtd: 1,
  p_origem: 'fornecedor',
  p_destino: 'estoque',
  p_motivo: 'Teste de API: caixa tentando movimentar',
})
ok('não movimenta estoque', caixaMov.status >= 400, `HTTP ${caixaMov.status}`)
ok(
  'e a mensagem é a de permissão',
  /não tem permissão para movimentar estoque/i.test(caixaMov.json?.message ?? ''),
  String(caixaMov.json?.message ?? '').slice(0, 78),
)
const caixaLe = await req('/movimentacoes_estoque?select=id,motivo&limit=1')
ok('mas continua lendo o histórico', caixaLe.status === 200 && (caixaLe.json || []).length === 1, `HTTP ${caixaLe.status}`)

// 7) nada foi escrito
console.log('\n6) O livro não mudou')
const fim = await req('/produtos?select=quantidade&id=eq.' + idItem)
ok('o saldo do item é o mesmo de antes', Number(fim.json?.[0]?.quantidade) === saldoInicial, `${fim.json?.[0]?.quantidade} kg`)
await db.query(`delete from public.notifications where titulo ilike '%E2E%' or mensagem ilike '%E2E%'`).catch(() => {})
await db.end()

console.log(`\n  EMAIL=${email}`)
console.log(`  UID=${uid ?? ''}`)
console.log(`\n  Apague com:\n  npx --yes neon@latest neon-auth user delete ${uid} --project-id <PROJETO>\n`)
console.log(falhas === 0 ? '  Tudo certo.\n' : `  ${falhas} falha(s).\n`)
process.exitCode = falhas === 0 ? 0 : 1
