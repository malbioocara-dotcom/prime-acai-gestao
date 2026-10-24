/**
 * Aplicador de migrations do Neon.
 *
 * Roda os arquivos `neon/NN_*.sql` em ordem, um por transação. A migração 12
 * (dados de estudo) exige seleção explícita. Se um arquivo falhar, ele é
 * revertido e o script para — os anteriores ficam aplicados.
 * Reversões também exigem seleção explícita pelo prefixo `reverter_NN`.
 *
 * Uso:
 *   $env:DATABASE_URL="postgresql://usuario:senha@host/banco?sslmode=require"
 *   node neon/aplicar.mjs            # aplica migrações, exceto dados de estudo
 *   node neon/aplicar.mjs 01         # aplica só os arquivos que começam com "01"
 *   node neon/aplicar.mjs 12         # aplica explicitamente dados de estudo
 *   node neon/aplicar.mjs reverter_04 # aplica a reversão da migração 04
 *
 * A string de conexão é SEGREDO: passe por variável de ambiente (ou pelo
 * `DATABASE_URL` do .env), nunca comite. A URL usada pelo app no navegador
 * (`VITE_NEON_URL`) é pública e diferente desta.
 */

import { readFileSync, readdirSync } from 'node:fs'
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

const url = process.env.DATABASE_URL || lerEnv().DATABASE_URL

if (!url) {
  console.error('\n  Falta a string de conexão. Defina DATABASE_URL no ambiente (ou no .env).\n')
  process.exit(1)
}

const filtro = process.argv[2] || ''
const pasta = join(raiz, 'neon')
const filtroReversao = filtro.startsWith('reverter_')
const arquivoDadosEstudo = '12_vendas_17_19_out.sql'

if (filtroReversao && !/^reverter_\d{2}$/.test(filtro)) {
  console.error('\n  Para reverter, informe um prefixo como "reverter_04".\n')
  process.exit(1)
}

const arquivos = readdirSync(pasta)
  .filter((nome) =>
    filtroReversao
      ? nome.startsWith(filtro) && /^reverter_\d+_.*\.sql$/i.test(nome)
      : /^\d+_.*\.sql$/i.test(nome),
  )
  .filter((nome) => nome.startsWith(filtro))
  .filter((nome) =>
    nome !== arquivoDadosEstudo || filtro === '12' || filtro.startsWith('12_'),
  )
  .sort()

if (arquivos.length === 0) {
  console.log(`\n  Nenhum arquivo em neon/ casa com o filtro "${filtro}".\n`)
  process.exit(1)
}

const apenas = (url) => url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')
console.log(`\n  Aplicando em: ${apenas(url)}`)
console.log(`  Arquivos: ${arquivos.join(', ')}\n`)

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

let falhou = false

for (const nome of arquivos) {
  const sql = readFileSync(join(pasta, nome), 'utf8')
  process.stdout.write(`  ${nome.padEnd(32)} `)
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('commit')
    console.log('OK')
  } catch (erro) {
    await client.query('rollback').catch(() => {})
    console.log('FALHA')
    console.error(`\n  ${erro.message}\n`)
    falhou = true
    break
  }
}

await client.end()

console.log(falhou ? '\n  Migration interrompida.\n' : '\n  Migrations aplicadas.\n')
process.exit(falhou ? 1 : 0)
