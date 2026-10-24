/**
 * Teste de integração da base real no Neon.
 *
 * Roda exatamente as consultas que o app faz e depois exercita a escrita
 * (insert / update / delete), sempre apagando o que criou no final.
 *
 * Uso:
 *   npm run testar:base
 *
 * Precisa do `.env` preenchido, incluindo uma conta de teste:
 *
 *   VITE_NEON_URL=https://ep-xxx.c-2.us-east-2.aws.neon.tech/neondb
 *   VITE_TESTE_EMAIL=voce@exemplo.com
 *   VITE_TESTE_SENHA=sua-senha
 *
 * As duas da conta de teste também podem vir do ambiente
 * (`$env:VITE_TESTE_SENHA='...'`), que é o jeito de rodar sem deixar a senha
 * num arquivo que o Vite lê (o `.env` é carregado no build do frontend).
 *
 * A conta é necessária porque o RLS é restrito: sem token, o Data API resolve
 * para o papel `anonymous`, que não tem acesso a nada. Sem sessão o script
 * avisa e sai sem erro. Sai com código 1 se algum teste falhar (útil em CI).
 *
 * Como não usamos o SDK aqui (ele é feito para o navegador), derivamos os dois
 * endereços da URL base da mesma forma que o `@neondatabase/neon-js`:
 *   <host>  ->  <prefixo>.neonauth.<resto>  (Auth)
 *           ->  <prefixo>.apirest.<resto>   (Data API)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

// ----------------------------------------------------------------- .env --
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

/** Mesma derivação de endereços do SDK (veja defaultDeriveNeonUrls). */
function derivarEnderecos(base) {
  const url = new URL(base)
  const labels = url.hostname.split('.')
  const [primeiro, ...resto] = labels
  const authHost = [primeiro, 'neonauth', ...resto].join('.')
  const apiHost = [primeiro, 'apirest', ...resto].join('.')
  const caminho = url.pathname.replace(/\/+$/, '')
  const porta = url.port ? `:${url.port}` : ''
  return {
    auth: `${url.protocol}//${authHost}${porta}${caminho}/auth`,
    data: `${url.protocol}//${apiHost}${porta}${caminho}/rest/v1`,
  }
}

const env = lerEnv()
const base = (env.VITE_NEON_URL || '').trim()
const emailTeste = (process.env.VITE_TESTE_EMAIL || env.VITE_TESTE_EMAIL || '').trim()
const senhaTeste = (process.env.VITE_TESTE_SENHA || env.VITE_TESTE_SENHA || '').trim()

/**
 * O Neon Auth (Better Auth) exige `Origin` e recusa com "Missing or null Origin"
 * quando ele não vem — é o mesmo domínio de confiança do app publicado.
 */
const ORIGEM = (process.env.ORIGEM_TESTE || 'https://prime-acai-gestao.pages.dev').replace(/\/+$/, '')

if (!base) {
  console.log('\n  Base não configurada: preencha VITE_NEON_URL no .env.')
  console.log('  Sem isso o app usa os dados de exemplo e não há o que testar.\n')
  process.exit(0)
}

const { auth: authBase, data: dataBase } = derivarEnderecos(base)

if (!emailTeste || !senhaTeste) {
  console.log('\n  Falta a conta de teste. Com o RLS restrito (neon/00_banco_neon.sql),')
  console.log('  o papel `anonymous` não lê nada — é preciso estar logado.')
  console.log('\n  Preencha no .env:')
  console.log('    VITE_TESTE_EMAIL=voce@exemplo.com')
  console.log('    VITE_TESTE_SENHA=sua-senha')
  console.log('\n  Use uma conta que já exista no seu projeto.\n')
  process.exit(0)
}

/**
 * Entra e devolve o JWT de acesso.
 *
 * O Managed Better Auth devolve a sessão (com o `token`, que é um token de
 * sessão OPACO — não um JWT) em `POST /sign-in/email`. O Data API recusa:
 *
 *   `missing authentication credentials: required authorization bearer token
 *    in JWT format`
 *
 * Quem devolve o JWT é o `GET /get-session`, no header `set-auth-jwt` — é o que
 * o SDK do navegador faz a cada carregamento. É esse JWT que vai como
 * `Authorization: Bearer ...` e promove a requisição para `authenticated`.
 */
async function entrar() {
  const r = await fetch(`${authBase}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGEM },
    body: JSON.stringify({ email: emailTeste, password: senhaTeste }),
  })

  const json = await r.json().catch(() => null)

  if (!r.ok) {
    throw new Error(json?.message || json?.error || `HTTP ${r.status}`)
  }

  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const sess = await fetch(`${authBase}/get-session`, { headers: { Origin: ORIGEM, cookie } })
  const jwt = sess.headers.get('set-auth-jwt')

  if (!jwt) throw new Error('o get-session não devolveu o JWT (header set-auth-jwt)')

  return jwt
}

const token = await entrar().catch((e) => {
  console.log(`\n  Não foi possível entrar como ${emailTeste}: ${e.message}`)
  console.log('  Confira o e-mail/senha em VITE_TESTE_EMAIL e VITE_TESTE_SENHA.\n')
  process.exit(1)
})

if (!token) {
  console.log('\n  O login respondeu, mas sem token de sessão. Verifique se o Neon Auth está habilitado.\n')
  process.exit(1)
}

const H = { Authorization: `Bearer ${token}`, Origin: ORIGEM }
const JSONH = { 'Content-Type': 'application/json', Prefer: 'return=representation', Origin: ORIGEM }

async function req(caminho, init = {}) {
  const r = await fetch(dataBase + caminho, {
    ...init,
    headers: { ...H, ...(init.headers || {}) },
  })
  const texto = await r.text()
  let json = null
  try {
    json = JSON.parse(texto)
  } catch {
    /* resposta sem corpo */
  }
  return { status: r.status, json, texto }
}

async function contar(tabela) {
  const r = await fetch(`${dataBase}/${tabela}?select=id&limit=1`, {
    headers: { ...H, Prefer: 'count=exact' },
  })
  return Number((r.headers.get('content-range') || '').split('/')[1] ?? -1)
}

// -------------------------------------------------------------- relatório --
let falhas = 0
const secao = (t) => console.log(`\n${t}`)
const ok = (rotulo, condicao, detalhe = '') => {
  if (!condicao) falhas++
  console.log(`  ${condicao ? 'OK   ' : 'FALHA'} ${rotulo.padEnd(32)} ${detalhe}`)
}

// ------------------------------------------------------------------ testes --
console.log(`\nTestando a base real: ${base}`)

secao('0) Sem sessão, o Data API não entrega nada')
const semToken = await fetch(`${dataBase}/produtos?select=id&limit=1`)
ok(
  'anonymous bloqueado em produtos',
  semToken.status !== 200,
  `HTTP ${semToken.status} (o Data API pede o JWT: "required authorization bearer token")`,
)

secao('1) Leitura — as mesmas consultas que o app faz')
const leituras = [
  ['produtos', '/produtos?select=codigo,nome,categoria,quantidade,minimo,unidade,custo,preco&ativo=eq.true&order=nome'],
  ['vendas do dia', '/vendas?select=codigo,status,pagamento,total,criado_em,estornada_em,clientes(nome),itens_venda(count)&order=criado_em.desc&limit=100'],
  ['vendas recentes', '/vendas?select=codigo,status,pagamento,total,criado_em,estornada_em,clientes(nome),itens_venda(count)&order=criado_em.desc&limit=8'],
  ['clientes (vw_clientes_resumo)', '/vw_clientes_resumo?select=codigo,nome,telefone,email,desde,tier,pedidos,total,ultima_compra&order=total.desc'],
  ['lancamentos', '/lancamentos?select=id,data,descricao,categoria,tipo,valor,forma&order=data.desc&limit=60'],
  ['fluxo mensal (view)', '/vw_fluxo_mensal?select=mes,entradas,saidas&order=mes.asc&limit=6'],
  ['faturamento diario (view)', '/vw_faturamento_diario?select=dia,total&order=dia.asc'],
  ['vendas por categoria (view)', '/vw_vendas_por_categoria?select=categoria,total&order=total.desc'],
  ['resumo (view)', '/vw_resumo?select=*'],
]
for (const [nome, caminho] of leituras) {
  const r = await req(caminho)
  const n = Array.isArray(r.json) ? r.json.length : 0
  ok(nome, r.status === 200 && n > 0, `HTTP ${r.status} · ${n} linha(s)`)
}

secao('2) Relacionamentos embutidos')
const emb = await req('/vendas?select=codigo,clientes(nome),itens_venda(count)&limit=3')
const amostra = emb.json?.[0]
ok('clientes(nome)', typeof amostra?.clientes?.nome === 'string', JSON.stringify(amostra?.clientes))
ok('itens_venda(count)', typeof amostra?.itens_venda?.[0]?.count === 'number', JSON.stringify(amostra?.itens_venda))

secao('3) Contagens antes da escrita')
const antes = {}
for (const t of ['clientes', 'vendas', 'itens_venda']) antes[t] = await contar(t)
console.log(`  clientes=${antes.clientes}  vendas=${antes.vendas}  itens_venda=${antes.itens_venda}`)

secao('4) Escrita — cliente (direto) e venda (só pela RPC)')
let clienteId = null

const erro = (r) =>
  String(r.json?.message ?? r.json?.hint ?? r.texto ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 90)

/** Id que não existe em lugar nenhum, para testar sem tocar em dado real. */
const NAO_EXISTE = '00000000-0000-0000-0000-000000000000'

try {
  // limpa restos de uma execução anterior interrompida
  await req('/clientes?codigo=eq.C-TESTE-001', { method: 'DELETE' })

  const insC = await req('/clientes', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({
      codigo: 'C-TESTE-001',
      nome: 'Cliente Teste (pode apagar)',
      telefone: '(00) 00000-0000',
      tier: 'Novo',
    }),
  })
  clienteId = insC.json?.[0]?.id
  ok('INSERT cliente', insC.status === 201, `HTTP ${insC.status} id=${clienteId?.slice(0, 8)}`)

  const upC = await req(`/clientes?id=eq.${clienteId}`, {
    method: 'PATCH',
    headers: JSONH,
    body: JSON.stringify({ nome: 'Cliente Teste ATUALIZADO', tier: 'VIP' }),
  })
  ok(
    'UPDATE cliente',
    upC.status === 200 && upC.json?.[0]?.tier === 'VIP',
    `HTTP ${upC.status} nome="${upC.json?.[0]?.nome}" tier=${upC.json?.[0]?.tier}`,
  )

  // --- a venda passou a ser só pela RPC (migração 09) ----------------------
  const insV = await req('/vendas', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({ codigo: '#TESTE-01', status: 'Concluída', pagamento: 'Pix', total: 42.9 }),
  })
  ok('INSERT direto em vendas é negado', insV.status === 403, `HTTP ${insV.status} · ${erro(insV)}`)

  const insI = await req('/itens_venda', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({
      venda_id: NAO_EXISTE,
      descricao: 'Açaí 500ml',
      quantidade: 2,
      preco_unitario: 21.45,
    }),
  })
  ok('INSERT direto em itens_venda é negado', insI.status === 403, `HTTP ${insI.status} · ${erro(insI)}`)

  const upV = await req(`/vendas?id=eq.${NAO_EXISTE}`, {
    method: 'PATCH',
    headers: JSONH,
    body: JSON.stringify({ status: 'Cancelada' }),
  })
  ok('UPDATE direto em vendas é negado', upV.status === 403, `HTTP ${upV.status} · ${erro(upV)}`)

  const delV = await req(`/vendas?id=eq.${NAO_EXISTE}`, { method: 'DELETE', headers: JSONH })
  ok('DELETE direto em vendas é negado', delV.status === 403, `HTTP ${delV.status} · ${erro(delV)}`)

  // A RPC é a porta que sobrou. Chamada de propósito com produto inexistente:
  // prova que a função existe E que o papel `authenticated` pode executá-la,
  // sem gravar nada — a exceção desfaz a transação inteira dela.
  //
  // `p_codigo` vai EXPLÍCITO de propósito. A RPC gera o código com `nextval`
  // ANTES de validar os itens, e `nextval` não volta atrás no rollback: sem um
  // código aqui, cada tentativa desta sonda queimaria um número de pedido de
  // verdade e abriria buraco na numeração.
  const rpc = await req('/rpc/registrar_venda', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({
      p_itens: [{ produto_id: NAO_EXISTE, quantidade: 1 }],
      p_chave: 'testar-base-nao-grava',
      p_pagamento: 'Pix',
      p_status: 'Concluída',
      p_codigo: '#TESTE-BASE-NAO-GRAVA',
    }),
  })
  ok(
    'RPC registrar_venda alcançável',
    rpc.status === 400 && /produto|encontrado/i.test(erro(rpc)),
    `HTTP ${rpc.status} · ${erro(rpc)}`,
  )

  const proximo = await req('/rpc/proximo_codigo_venda', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({}),
  })
  ok(
    'RPC proximo_codigo_venda alcançável',
    proximo.status === 200 && /^#\d+$/.test(String(proximo.json)),
    `HTTP ${proximo.status} · ${proximo.status === 200 ? proximo.json : erro(proximo)}`,
  )

  // O estorno (migração 11) também precisa estar no cache do Data API — foi
  // exatamente aí que a P3 tropeçou com `proximo_codigo_venda`. A sonda chama a
  // função com um pedido que não existe: se o banco responder com uma mensagem
  // de NEGÓCIO (permissão ou pedido não encontrado), a função está alcançável e
  // autorizada pelo banco; 404 significaria "função fora do schema cache".
  // Nada é gravado: os dois caminhos terminam em exceção, que desfaz a transação.
  const estorno = await req('/rpc/estornar_venda', {
    method: 'POST',
    headers: JSONH,
    body: JSON.stringify({ p_venda_id: NAO_EXISTE, p_motivo: 'testar-base: sonda, não grava' }),
  })
  // Dois desfechos provam o alcance, e ambos dependem de QUEM é a conta:
  //   • conta sem `vendas.editar`  -> HTTP 403 (PostgREST traduz o 42501 do banco);
  //   • conta com a permissão      -> HTTP 400 "Pedido não encontrado".
  // O que NÃO pode acontecer é 404 ("Could not find the function"): aí a função
  // existe no banco mas não no cache do Data API.
  const estornoAlcancavel =
    (estorno.status === 403 && /permiss/i.test(erro(estorno))) ||
    (estorno.status === 400 && /encontrado/i.test(erro(estorno)))

  ok(
    'RPC estornar_venda alcançável',
    estornoAlcancavel,
    `HTTP ${estorno.status} · ${erro(estorno)}`,
  )

  const semVenda = await req('/vendas?select=codigo&codigo=eq.%23TESTE-01')
  ok(
    'nenhuma venda de teste ficou na base',
    Array.isArray(semVenda.json) && semVenda.json.length === 0,
    `${semVenda.json?.length ?? '?'} linha(s) com #TESTE-01`,
  )

  const semChave = await req('/vendas?select=codigo&chave_idempotencia=eq.testar-base-nao-grava')
  ok(
    'a RPC recusada não gravou nada',
    Array.isArray(semChave.json) && semChave.json.length === 0,
    `${semChave.json?.length ?? '?'} linha(s) com a chave do teste`,
  )

  const lerVenda = await req('/vendas?select=codigo,status,total&order=criado_em.desc&limit=1')
  ok(
    'a leitura de vendas continua liberada',
    lerVenda.status === 200 && lerVenda.json?.length === 1,
    `HTTP ${lerVenda.status} · pedido ${lerVenda.json?.[0]?.codigo}`,
  )

  const view = await req(`/vw_clientes_resumo?select=nome,tier,pedidos,total&codigo=eq.C-TESTE-001`)
  const cl = view.json?.[0]
  ok(
    'A view reflete o cadastro novo',
    cl?.nome === 'Cliente Teste ATUALIZADO' && cl?.tier === 'VIP',
    `nome="${cl?.nome}" tier=${cl?.tier} pedidos=${cl?.pedidos}`,
  )

  const resumo = await req('/vw_resumo?select=vendas_hoje,total_clientes')
  ok(
    'vw_resumo reage na hora',
    resumo.status === 200,
    `vendas_hoje=${resumo.json?.[0]?.vendas_hoje} clientes=${resumo.json?.[0]?.total_clientes}`,
  )
} catch (e) {
  falhas++
  console.log(`  FALHA exceção inesperada -> ${String(e).slice(0, 200)}`)
}

secao('5) Limpeza')
const delC = await req(`/clientes?id=eq.${clienteId}`, { method: 'DELETE', headers: JSONH })
ok('DELETE cliente', delC.status === 200, `HTTP ${delC.status} removidos=${delC.json?.length ?? 0}`)

secao('6) Contagens depois da limpeza')
const depois = {}
for (const t of ['clientes', 'vendas', 'itens_venda']) depois[t] = await contar(t)
console.log(`  clientes=${depois.clientes}  vendas=${depois.vendas}  itens_venda=${depois.itens_venda}`)
ok(
  'base voltou ao estado anterior',
  ['clientes', 'vendas', 'itens_venda'].every((t) => antes[t] === depois[t]),
  `${antes.clientes}/${antes.vendas}/${antes.itens_venda} -> ${depois.clientes}/${depois.vendas}/${depois.itens_venda}`,
)

console.log(falhas === 0 ? '\n  Tudo certo.\n' : `\n  ${falhas} teste(s) falharam.\n`)
process.exit(falhas === 0 ? 0 : 1)
