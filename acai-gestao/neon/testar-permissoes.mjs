/**
 * Teste E2E do módulo de permissões — pelo caminho REAL do navegador.
 *
 * O Managed Better Auth guarda a sessão num cookie opaco e devolve o JWT no
 * header `set-auth-jwt` da resposta de `get-session`. É esse JWT que o SDK manda
 * no `Authorization` para o Data API. Este script replica exatamente isso:
 *
 *   1. cadastra um usuário descartável (signup) e guarda o cookie;
 *   2. chama `get-session` e lê o JWT do header `set-auth-jwt`;
 *   3. usa o JWT no Data API para conferir o que ele pode e o que NÃO pode.
 *
 * Uso:
 *   node neon/testar-permissoes.mjs
 *
 * O e-mail e o UID do usuário criado são impressos no fim (para apagar com
 * `neon neon-auth user delete <user-id>`).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
  console.log(`  ${cond ? 'OK   ' : 'FALHA'} ${rotulo.padEnd(46)} ${detalhe}`)
}

const stamp = Date.now()
const email = `e2e.${stamp}@primeacai.local`
const senha = `Teste!${stamp}`

console.log(`\nAuth:  ${authBase}\nData:  ${dataBase}\nUser:  ${email}\n`)

const H = { 'Content-Type': 'application/json', Origin: ORIGEM }

// 1) cadastro + cookie de sessão
const sign = await fetch(`${authBase}/sign-up/email`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ email, password: senha, name: 'E2E Permissões', callbackURL: `${ORIGEM}/` }),
})
const signJson = await sign.json().catch(() => null)
ok('sign-up', sign.ok, `HTTP ${sign.status} ${signJson?.message ?? ''}`)
const uid = signJson?.user?.id
const cookie = (sign.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

// 2) JWT do header set-auth-jwt
const sess = await fetch(`${authBase}/get-session`, { headers: { Origin: ORIGEM, cookie } })
const jwt = sess.headers.get('set-auth-jwt')
ok('get-session devolve set-auth-jwt', Boolean(jwt && jwt.split('.').length === 3), jwt ? `${jwt.slice(0, 24)}…` : 'sem JWT')
if (!jwt) { console.log('\n  Sem JWT; abortando.\n'); process.exit(1) }

const req = async (caminho, init = {}) => {
  const r = await fetch(dataBase + caminho, { ...init, headers: { Authorization: `Bearer ${jwt}`, ...(init.headers || {}) } })
  const texto = await r.text()
  let json = null
  try { json = JSON.parse(texto) } catch { /* vazio */ }
  return { status: r.status, json, texto }
}
const rpc = (fn, body = {}) =>
  req(`/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// 3) cria o perfil (como o app faz ao abrir)
console.log('\n1) Sessão e perfil')
const perfil = await rpc('garantir_perfil')
ok('garantir_perfil() cria o perfil', perfil.status === 200, `HTTP ${perfil.status} ${String(perfil.texto).slice(0, 80)}`)
ok('perfil nasceu como cashier', perfil.json?.role === 'cashier', `role=${perfil.json?.role}`)

// 4) permissões efetivas do caixa
console.log('\n2) Permissões do operador de caixa')
const minhas = await rpc('minhas_permissoes')
const lista = Array.isArray(minhas.json) ? minhas.json.map((x) => `${x.modulo}.${x.acao}`) : []
ok('minhas_permissoes() responde', minhas.status === 200 && lista.length > 0, `HTTP ${minhas.status} · ${lista.length} permissões`)
ok('tem vendas.criar', lista.includes('vendas.criar'), '')
ok('tem dashboard.ver', lista.includes('dashboard.ver'), '')
ok('NÃO tem financeiro', !lista.some((m) => m.startsWith('financeiro.')), lista.filter((m) => m.startsWith('financeiro')).join(',') || 'nenhuma')
ok('NÃO tem usuarios', !lista.some((m) => m.startsWith('usuarios.')), '')
ok('NÃO tem permissoes', !lista.some((m) => m.startsWith('permissoes.')), '')

// 5) pode() pelo servidor
console.log('\n3) pode() pelo servidor')
const p1 = await rpc('pode', { p_modulo: 'vendas', p_acao: 'criar' })
const p2 = await rpc('pode', { p_modulo: 'financeiro', p_acao: 'ver' })
ok('pode(vendas,criar) = true', p1.json === true, JSON.stringify(p1.json))
ok('pode(financeiro,ver) = false', p2.json === false, JSON.stringify(p2.json))

// 6) catálogo liberado, dados sensíveis bloqueados
console.log('\n4) Leitura direta')
const roles = await req('/roles?select=name&order=name')
ok('lê o catálogo de perfis', roles.status === 200 && (roles.json || []).length === 3, `HTTP ${roles.status}`)
const up = await req('/user_permissions?select=*')
ok('NÃO lê user_permissions', up.status !== 200, `HTTP ${up.status}`)
const inv = await req('/invites?select=*')
ok('NÃO lê invites', inv.status !== 200, `HTTP ${inv.status}`)
const aud = await req('/audit_logs?select=*')
ok('NÃO lê audit_logs', aud.status !== 200, `HTTP ${aud.status}`)

// 7) escrita direta proibida
console.log('\n5) Escrita direta proibida')
const ins = await req('/permissions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ module_key: 'hack', action_key: 'x' }) })
ok('NÃO insere em permissions', ins.status >= 400, `HTTP ${ins.status}`)

// 8) RPCs administrativas negadas ao caixa
console.log('\n6) Administração bloqueada')
const conv = await rpc('convidar_usuario', { p_email: 'x@y.com', p_nome: 'X', p_role: 'admin' })
ok('convidar_usuario bloqueado', conv.status >= 400, `HTTP ${conv.status} ${conv.json?.message?.slice(0, 50) ?? ''}`)
const lst = await rpc('listar_usuarios')
ok('listar_usuarios bloqueado', lst.status >= 400, `HTTP ${lst.status}`)
const dp = await rpc('definir_permissao_usuario', { alvo: uid, p_modulo: 'usuarios', p_acao: 'ver', p_permitido: true })
ok('definir_permissao_usuario bloqueado', dp.status >= 400, `HTTP ${dp.status}`)

// 9) RLS: só o próprio perfil
console.log('\n7) RLS')
const pr = await req('/profiles?select=id,role,is_active&order=created_at')
ok('só vê o próprio perfil', pr.status === 200 && (pr.json || []).length === 1, `HTTP ${pr.status} · ${(pr.json || []).length} linha(s)`)

console.log(`\n  EMAIL=${email}`)
console.log(`  UID=${uid ?? ''}`)
console.log(falhas === 0 ? '\n  Tudo certo.\n' : `\n  ${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
