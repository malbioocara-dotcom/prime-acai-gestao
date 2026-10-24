/**
 * Validador das migrações — roda tudo num Postgres EM MEMÓRIA, sem tocar em
 * produção e sem precisar de string de conexão.
 *
 * Por que existe: o `aplicar.mjs` só diz "OK/FALHA" ao rodar contra o banco de
 * verdade — e o banco de verdade é o pior lugar para descobrir um erro de
 * migração. Aqui a cadeia `neon/NN_*.sql` inteira é aplicada na mesma ordem do
 * `aplicar.mjs` (descoberta automática dos arquivos, uma transação por arquivo)
 * e depois os comportamentos são exercitados de fato.
 *
 * Foi este harness que pegou, na fase 1, um defeito real: as colunas
 * `profiles.email/username/aprovado_em/last_login_at` não nasciam em nenhuma
 * migração, então um banco novo quebrava na `03` com
 * `record "new" has no field "aprovado_em"`.
 *
 * O que ele confere:
 *   - a cadeia de migrações aplica sem erro;
 *   - as constraints de tipo de venda x método de peso;
 *   - recipientes/tara, o teto de tara e o histórico gravado por trigger;
 *   - a conta do peso feita pelo próprio banco (R$ 31,46);
 *   - se o RLS realmente barra ações sem permissão e perfis inativos (e não só
 *     se a tela esconde o botão);
 *   - se as migrações `reverter_*` desfazem mesmo o que prometem.
 *
 * Uso:  npm run validar:migracoes
 *
 * Dependência: `@electric-sql/pglite` (devDependency, gratuita, roda local).
 * Ela NÃO vai para o bundle nem para produção — só este script usa.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const PASTA = dirname(fileURLToPath(import.meta.url))

const ORG = 'b0000000-0000-4000-8000-000000000001'
const ORG2 = 'b0000000-0000-4000-8000-000000000002'
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const CASHIER = 'a0000000-0000-4000-8000-000000000002'
const MANAGER = 'a0000000-0000-4000-8000-000000000003'
const ADMIN2 = 'a0000000-0000-4000-8000-000000000004'

let falhas = 0
const log = (texto = '') => console.log(texto)

const podeFalhar = (nome, detalhe) => {
  falhas++
  log(`  FALHA ${nome}: ${detalhe}`)
}
const ok = (nome, extra = '') => log(`  ok    ${nome}${extra ? ` — ${extra}` : ''}`)

const db = new PGlite()
const um = async (sql) => (await db.query(sql)).rows[0]
const contar = async (sql) => Number((await um(sql)).n)

/** Espera que o SQL FALHE (constraint, RLS, unicidade) com o erro esperado. */
async function deveFalhar(nome, sql, trechoEsperado) {
  try {
    await db.exec(sql)
    podeFalhar(nome, 'não deu erro, mas deveria')
  } catch (e) {
    if (trechoEsperado && !new RegExp(trechoEsperado, 'i').test(e.message)) {
      podeFalhar(nome, `erro inesperado: ${e.message}`)
    } else {
      ok(nome)
    }
  }
}

async function devePassar(nome, sql) {
  try {
    await db.exec(sql)
    ok(nome)
  } catch (e) {
    podeFalhar(nome, e.message)
  }
}

/* ------------------------------------------------------ ambiente Neon ------ */

/**
 * O Neon não é um Postgres puro: o app conta com `auth.uid()` e com os papéis
 * `anonymous`/`authenticated`. Em produção `auth.uid()` é uma função C da
 * extensão `pg_session_jwt` que lê o claim `sub` do JWT da sessão; o
 * PostgREST expõe esse JWT como `request.jwt.claims`. É isso que o stub
 * reproduz — e é por isso que os testes abaixo autenticam por
 * `request.jwt.claims` e não por `request.jwt.claim.sub`.
 */
await db.exec(`
  create role anonymous;
  create role authenticated;
  create schema if not exists auth;
  create schema if not exists neon_auth;
  create table if not exists neon_auth.user (id uuid primary key, email text);

  create or replace function auth.uid() returns uuid
  language sql stable
  as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $$;
`)

/**
 * `create extension "pgcrypto"` não existe no PGlite. No Postgres 13+ o
 * `gen_random_uuid()` já é nativo (conferido neste harness), então a linha é
 * dispensável aqui; em produção ela continua valendo e é exercitada pelo
 * `aplicar.mjs`.
 */
const dispensarPgcrypto = (sql) => sql.replace(/create extension if not exists "pgcrypto";/i, '-- pgcrypto dispensado no harness')

async function aplicar(nome) {
  let sql
  try {
    sql = dispensarPgcrypto(readFileSync(join(PASTA, nome), 'utf8'))
  } catch {
    falhas++
    log(`  FALTA ${nome}`)
    return
  }
  try {
    await db.exec('begin')
    await db.exec(sql)
    await db.exec('commit')
    log(`  ok    ${nome}`)
  } catch (erro) {
    await db.exec('rollback').catch(() => {})
    podeFalhar(nome, erro.message)
  }
}

/* ----------------------------------------------- autenticar como usuário --- */

async function autenticar(uid) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: uid, role: 'authenticated' }),
  ])
}

/** Lê como o usuário (com RLS ligado, no papel `authenticated`). */
async function leComo(uid, sql) {
  await autenticar(uid)
  await db.exec('set role authenticated')
  try {
    return { erro: null, ...(await um(sql)) }
  } catch (e) {
    return { erro: e }
  } finally {
    await db.exec('reset role')
  }
}

/** Escreve como o usuário; devolve quantas linhas foram realmente afetadas. */
async function escreveComo(uid, sql) {
  await autenticar(uid)
  await db.exec('set role authenticated')
  try {
    const r = await db.query(sql)
    return { erro: null, afetados: r.affectedRows ?? 0 }
  } catch (e) {
    return { erro: e, afetados: 0 }
  } finally {
    await db.exec('reset role')
  }
}

/** Chama um RPC como o usuário — é por aqui que o navegador escreve estoque. */
async function rpcComo(uid, sql) {
  await autenticar(uid)
  await db.exec('set role authenticated')
  try {
    const r = await db.query(sql)
    return { erro: null, linhas: r.rows }
  } catch (e) {
    return { erro: e, linhas: [] }
  } finally {
    await db.exec('reset role')
  }
}

/** Chama uma RPC dentro de um SAVEPOINT para poder testar e reverter a venda inteira. */
async function rpcComoEmSavepoint(uid, sql) {
  await db.exec('savepoint rpc_teste')
  await autenticar(uid)
  await db.exec('set role authenticated')
  try {
    const resultado = await db.query(sql)
    await db.exec('reset role')
    await db.exec('release savepoint rpc_teste')
    return { erro: null, linhas: resultado.rows }
  } catch (erro) {
    await db.exec('rollback to savepoint rpc_teste')
    await db.exec('reset role')
    await db.exec('release savepoint rpc_teste')
    return { erro, linhas: [] }
  }
}

const saldoDe = async (codigo) =>
  Number((await um(`select public.saldo_estoque((select id from public.produtos where codigo = '${codigo}')) as s`)).s)

/* ------------------------------------------------------------- o roteiro ---- */

log('\n== Aplicando as migrações (mesma ordem do aplicar.mjs) ==')
const migracoes = readdirSync(PASTA)
  .filter((nome) => /^\d+_.*\.sql$/i.test(nome))
  .sort()
if (migracoes.length === 0) {
  console.error('\n  Nenhum arquivo NN_*.sql encontrado em neon/.\n')
  process.exit(1)
}
for (const arquivo of migracoes) await aplicar(arquivo)

// Passo manual do projeto (não casa com `NN_*.sql`, então o aplicar.mjs não o
// pega): a versão de garantir_perfil() que lê e-mail e convite.
await aplicar('garantir_perfil_novo.sql')

log('\n== Postgres de teste ==')
log(`  ${(await um('select version() as v')).v.slice(0, 40)}...`)

/* ---------------------------------------------- dados de apoio (sem RLS) --- */

await db.exec(`
  insert into public.organizations (id, nome) values ('${ORG}', 'Loja de Teste');
  insert into neon_auth.user (id, email) values
    ('${ADMIN}',   'admin@teste.local'),
    ('${CASHIER}', 'caixa@teste.local'),
    ('${MANAGER}', 'gerente@teste.local');
  insert into public.profiles (id, full_name, organization_id, role) values
    ('${ADMIN}',   'Admin de Teste',   '${ORG}', 'admin'),
    ('${CASHIER}', 'Caixa de Teste',   '${ORG}', 'cashier'),
    ('${MANAGER}', 'Gerente de Teste', '${ORG}', 'manager');
`)
{
  const tipos = await contar(
    `select count(*)::int as n from public.tipos_venda where organization_id = '${ORG}'`,
  )
  const formas = await contar(
    `select count(*)::int as n from public.formas_pagamento where organization_id = '${ORG}'`,
  )
  if (tipos === 3 && formas === 5) ok('a nova organização recebe os tipos e formas de pagamento padrão')
  else podeFalhar('catálogos por organização', `${tipos} tipos e ${formas} formas`)
}

log('\n== Constraint: tipo de venda x método de peso ==')
await deveFalhar(
  'produto por peso SEM método de peso é recusado',
  `insert into public.produtos (codigo, nome, categoria, tipo_venda) values ('X1','X','Y','peso')`,
  'produtos_metodo_peso_coerente',
)
await deveFalhar(
  'produto por unidade COM método de peso é recusado',
  `insert into public.produtos (codigo, nome, categoria, tipo_venda, metodo_peso)
   values ('X2','X','Y','unidade','bruto_tara')`,
  'produtos_metodo_peso_coerente',
)
await deveFalhar(
  'tipo de venda inventado é recusado',
  `insert into public.produtos (codigo, nome, categoria, tipo_venda) values ('X3','X','Y','por-hora')`,
  'produtos_tipo_venda_valido',
)
await devePassar(
  'Açaí self-service a R$ 69,90/kg é aceito',
  `insert into public.produtos (codigo, nome, categoria, tipo_venda, metodo_peso, unidade, preco)
   values ('SS1','Açaí self-service','Açaí','peso','bruto_tara','kg',69.90)`,
)

{
  const p = await um(
    `select tipo_venda, metodo_peso, unidade, preco, controla_estoque, metodo_estoque, ativo
       from public.produtos where codigo = 'SS1'`,
  )
  const esperado =
    p.tipo_venda === 'peso' &&
    p.metodo_peso === 'bruto_tara' &&
    p.unidade === 'kg' &&
    Number(p.preco) === 69.9 &&
    p.controla_estoque === true &&
    p.metodo_estoque === 'movimentacoes' &&
    p.ativo === true

  // Os campos que a migração NÃO mandou preencher assumem o padrão do banco.
  if (esperado) ok('Açaí self-service: peso, bruto_tara, kg, R$ 69,90, estoque por movimentação, ativo')
  else podeFalhar('registro do self-service', JSON.stringify(p))
}

log('\n== Fotos de produto: armazenamento binário e salvamento atômico ==')
{
  const assinaturaPng = '89504e470d0a1a0a00000000'
  const registroNovo = JSON.stringify({
    codigo: 'IMG-ATOMIC',
    nome: 'Produto com foto',
    descricao: '',
    categoria: 'Teste',
    minimo: 2,
    unidade: 'un',
    custo: 3,
    preco: 7,
    ativo: true,
    tipo_venda: 'unidade',
    controla_estoque: true,
    metodo_estoque: 'movimentacoes',
    metodo_peso: null,
  })

  await autenticar(ADMIN)
  await db.exec('set role authenticated')
  let produtoImagem = null
  try {
    produtoImagem = await um(
      `select (public.salvar_produto_com_imagem('${registroNovo}'::jsonb, 'image/png',
              decode('${assinaturaPng}', 'hex'), false)).id as id`,
    )
  } catch (erro) {
    podeFalhar('salvar produto e imagem pela RPC', erro.message)
  } finally {
    await db.exec('reset role')
  }

  if (produtoImagem?.id) {
    const salvo = await um(
      `select p.codigo, p.quantidade, i.mime, i.caminho, octet_length(i.conteudo) as bytes
         from public.produtos p join public.imagens_produtos i on i.produto_id = p.id
        where p.id = '${produtoImagem.id}'`,
    )
    if (
      salvo.codigo === 'IMG-ATOMIC' &&
      Number(salvo.quantidade) === 0 &&
      salvo.mime === 'image/png' &&
      salvo.caminho === `produtos/${produtoImagem.id}` &&
      Number(salvo.bytes) === 12
    ) {
      ok('produto e imagem persistem juntos em bytea, com caminho estável e saldo inicial zero')
    } else {
      podeFalhar('imagem persistida', JSON.stringify(salvo))
    }

    await db.exec(`
      insert into public.user_permissions (user_id, permission_id, allowed)
      select '${CASHIER}', id, false from public.permissions
       where module_key = 'estoque' and action_key = 'consultar'
      on conflict (user_id, permission_id) do update set allowed = false
    `)
    const caixaLeFoto = await leComo(
      CASHIER,
      `select count(*)::int as n from public.imagens_produtos where produto_id = '${produtoImagem.id}'`,
    )
    await db.exec(`delete from public.user_permissions where user_id = '${CASHIER}'`)
    if (!caixaLeFoto.erro && caixaLeFoto.n === 1) ok('caixa acessa fotos do PDV sem permissão de consulta ao estoque')
    else podeFalhar('leitura de foto no PDV', caixaLeFoto.erro?.message ?? JSON.stringify(caixaLeFoto))

    const registroEdicao = JSON.stringify({
      id: produtoImagem.id,
      codigo: 'IMG-ATOMIC',
      nome: 'Produto com foto revisado',
      descricao: '',
      categoria: 'Teste',
      quantidade: 999,
      minimo: 2,
      unidade: 'un',
      custo: 4,
      preco: 8,
      ativo: true,
      tipo_venda: 'unidade',
      controla_estoque: true,
      metodo_estoque: 'movimentacoes',
      metodo_peso: null,
    })
    await autenticar(ADMIN)
    await db.exec('set role authenticated')
    try {
      await um(
        `select public.salvar_produto_com_imagem('${registroEdicao}'::jsonb, 'image/png',
                decode('89504e470d0a1a0a0000000000000000', 'hex'), false)`,
      )
      await um(
        `select public.salvar_produto_com_imagem('${registroEdicao}'::jsonb, null, null, true)`,
      )
    } catch (erro) {
      podeFalhar('substituir e remover imagem', erro.message)
    } finally {
      await db.exec('reset role')
    }

    const aposEdicao = await um(
      `select p.nome, p.quantidade, (select count(*) from public.imagens_produtos i
          where i.produto_id = p.id)::int as imagens
         from public.produtos p where p.id = '${produtoImagem.id}'`,
    )
    if (aposEdicao.nome === 'Produto com foto revisado' && Number(aposEdicao.quantidade) === 0 && aposEdicao.imagens === 0) {
      ok('substituição/removal mantém o saldo do livro-razão e remove só a foto do produto')
    } else {
      podeFalhar('preservação de saldo ao editar foto', JSON.stringify(aposEdicao))
    }
  }

  await deveFalhar(
    'assinatura de arquivo incompatível com PNG é recusada no banco',
    `insert into public.imagens_produtos (produto_id, mime, conteudo)
     select id, 'image/png', decode('ffd8ffe00000000000000000', 'hex')
       from public.produtos where codigo = 'IMG-ATOMIC'`,
    'check constraint|violates check',
  )
  const caixaImagem = await escreveComo(
    CASHIER,
    `select public.salvar_produto_com_imagem(
      '{"codigo":"IMG-NEGADO","nome":"Sem permissão","categoria":"Teste","tipo_venda":"unidade"}'::jsonb,
      'image/png', decode('${assinaturaPng}', 'hex'), false)`,
  )
  if (caixaImagem.erro && /row-level security/i.test(caixaImagem.erro.message)) {
    ok('o caixa não cria produto/foto sem permissão (RLS aplicado à RPC)')
  } else {
    podeFalhar('RLS da foto de produto', caixaImagem.erro?.message ?? 'a chamada passou')
  }
}

log('\n== A conta do peso, feita pelo próprio banco ==')
{
  const { total } = await um('select round(0.450 * 69.90, 2) as total')
  if (Number(total) === 31.46) ok('round(0,450 kg x R$ 69,90) = R$ 31,46 (bate com o app)')
  else podeFalhar('conta do peso no banco', `deu ${total}, esperado 31.46`)
}

log('\n== Recipientes e tara ==')
await devePassar(
  "cadastrar 'Copo 500ml com tampa' com tara de 16 g",
  `insert into public.recipientes (organization_id, nome, tara_g) values ('${ORG}','Copo 500ml com tampa',16)`,
)
await deveFalhar(
  'tara negativa é recusada',
  `insert into public.recipientes (organization_id, nome, tara_g) values ('${ORG}','Copo negativo',-1)`,
  'tara_g',
)
await deveFalhar(
  'tara acima de 5 kg é recusada',
  `insert into public.recipientes (organization_id, nome, tara_g) values ('${ORG}','Bandeja errada',5001)`,
  'recipientes_tara_maxima',
)
await deveFalhar(
  'nome repetido entre recipientes ATIVOS é recusado',
  `insert into public.recipientes (organization_id, nome, tara_g) values ('${ORG}','copo 500ML COM TAMPA',18)`,
  'recipientes_nome_ativo_idx|duplicate key',
)

log('\n== Histórico de tara: gravado por trigger ==')
{
  const antes = await contar('select count(*)::int as n from public.recipientes_historico')
  await db.exec(`update public.recipientes set tara_g = 18 where nome = 'Copo 500ml com tampa'`)
  const depois = await contar('select count(*)::int as n from public.recipientes_historico')

  if (depois === antes + 1) ok('mudar a tara criou UMA linha de histórico')
  else podeFalhar('histórico de tara', `antes ${antes}, depois ${depois}`)

  const h = await um(
    `select tara_g_anterior, tara_g_novo from public.recipientes_historico order by alterado_em desc limit 1`,
  )
  if (Number(h.tara_g_anterior) === 16 && Number(h.tara_g_novo) === 18) {
    ok('o histórico guarda de quanto para quanto (16 g -> 18 g)')
  } else {
    podeFalhar('conteúdo do histórico', JSON.stringify(h))
  }

  // Regravar a mesma tara não deve poluir o histórico.
  await db.exec(`update public.recipientes set tara_g = 18 where nome = 'Copo 500ml com tampa'`)
  const semMudanca = await contar('select count(*)::int as n from public.recipientes_historico')
  if (semMudanca === depois) ok('salvar sem mudar a tara não cria histórico')
  else podeFalhar('histórico sem mudança', `virou ${semMudanca}`)
}

log('\n== RLS de produtos: quem pode o quê ==')
{
  const adminLe = await leComo(ADMIN, 'select count(*)::int as n from public.produtos')
  if (!adminLe.erro && adminLe.n >= 10) ok(`admin lê os produtos (${adminLe.n})`)
  else podeFalhar('leitura do admin', adminLe.erro?.message ?? JSON.stringify(adminLe))

  const caixaLe = await leComo(CASHIER, 'select count(*)::int as n from public.produtos')
  if (!caixaLe.erro && caixaLe.n >= 10) ok(`caixa (cashier) continua LENDO os produtos (${caixaLe.n})`)
  else podeFalhar('leitura do caixa', caixaLe.erro?.message ?? JSON.stringify(caixaLe))

  const adminCria = await escreveComo(
    ADMIN,
    `insert into public.produtos (codigo,nome,categoria,tipo_venda,metodo_peso,unidade,preco)
     values ('RLS1','Produto do admin','Teste','peso','liquido','kg',10)`,
  )
  if (!adminCria.erro && adminCria.afetados === 1) ok('admin CRIA produto')
  else podeFalhar('criação pelo admin', adminCria.erro?.message ?? `afetados ${adminCria.afetados}`)

  const gerenteCria = await escreveComo(
    MANAGER,
    `insert into public.produtos (codigo,nome,categoria) values ('RLS3','Produto do gerente','Teste')`,
  )
  if (!gerenteCria.erro && gerenteCria.afetados === 1) ok('gerente CRIA produto')
  else podeFalhar('criação pelo gerente', gerenteCria.erro?.message ?? `afetados ${gerenteCria.afetados}`)

  const caixaCria = await escreveComo(
    CASHIER,
    `insert into public.produtos (codigo,nome,categoria) values ('RLS2','Produto do caixa','Teste')`,
  )
  if (caixaCria.erro && /row-level security/i.test(caixaCria.erro.message)) {
    ok('caixa NÃO cria produto (barrado pelo RLS, não pela tela)')
  } else {
    podeFalhar('barreira de escrita do caixa', caixaCria.erro ? caixaCria.erro.message : 'o insert passou!')
  }

  // Em UPDATE/DELETE o RLS FILTRA a linha em silêncio: não dá erro, apenas 0
  // linhas afetadas. A prova de que o caixa não apaga é o registro continuar lá.
  const caixaApaga = await escreveComo(CASHIER, `delete from public.produtos where codigo = 'SS1'`)
  const caixaEdita = await escreveComo(CASHIER, `update public.produtos set preco = 1 where codigo = 'SS1'`)
  const ss1 = await um(`select count(*)::int as n, max(preco) as preco from public.produtos where codigo = 'SS1'`)

  if (!caixaApaga.erro && caixaApaga.afetados === 0 && Number(ss1.n) === 1) {
    ok('caixa NÃO apaga produto (0 linhas afetadas e o item continua no estoque)')
  } else {
    podeFalhar('exclusão pelo caixa', caixaApaga.erro?.message ?? `afetados ${caixaApaga.afetados}, restam ${ss1.n}`)
  }

  if (!caixaEdita.erro && caixaEdita.afetados === 0 && Number(ss1.preco) === 69.9) {
    ok('caixa NÃO altera preço (o preço continua R$ 69,90)')
  } else {
    podeFalhar('edição pelo caixa', caixaEdita.erro?.message ?? `afetados ${caixaEdita.afetados}, preço ${ss1.preco}`)
  }

  const adminEdita = await escreveComo(ADMIN, `update public.produtos set preco = 71.9 where codigo = 'SS1'`)
  if (!adminEdita.erro && adminEdita.afetados === 1) ok('admin altera o produto')
  else podeFalhar('edição pelo admin', adminEdita.erro?.message ?? `afetados ${adminEdita.afetados}`)

  // Recipiente: leitura liberada para a organização, escrita só com permissão.
  const caixaLeRec = await leComo(CASHIER, 'select count(*)::int as n from public.recipientes')
  if (!caixaLeRec.erro && caixaLeRec.n >= 1) ok('caixa lê recipientes (precisa para escolher na venda)')
  else podeFalhar('leitura de recipientes pelo caixa', caixaLeRec.erro?.message ?? JSON.stringify(caixaLeRec))

  const caixaCriaRec = await escreveComo(CASHIER, `insert into public.recipientes (nome, tara_g) values ('Copo do caixa', 10)`)
  if (caixaCriaRec.erro && /row-level security/i.test(caixaCriaRec.erro.message)) {
    ok('caixa NÃO cadastra recipiente')
  } else {
    podeFalhar('cadastro de recipiente pelo caixa', caixaCriaRec.erro ? caixaCriaRec.erro.message : 'o insert passou!')
  }

  const adminCriaRec = await escreveComo(ADMIN, `insert into public.recipientes (nome, tara_g) values ('Pote 1 litro', 25)`)
  if (!adminCriaRec.erro && adminCriaRec.afetados === 1) ok('admin cadastra recipiente')
  else podeFalhar('cadastro de recipiente pelo admin', adminCriaRec.erro?.message ?? `afetados ${adminCriaRec.afetados}`)
}

log('\n== Categorias de produtos: unicidade e isolamento por organização ==')
{
  const nome = 'Categoria RLS Única'
  const criacao = await escreveComo(
    ADMIN,
    `insert into public.categorias_produtos (nome, descricao)
     values ('${nome}', 'Categoria de validação')`,
  )
  if (!criacao.erro && criacao.afetados === 1) ok('admin cadastra categoria')
  else podeFalhar('cadastro de categoria pelo admin', criacao.erro?.message ?? `afetados ${criacao.afetados}`)

  await deveFalhar(
    'categoria duplicada por caixa e espaços é recusada',
    `insert into public.categorias_produtos (organization_id, nome)
     values ('${ORG}', '  categoria   rls única  ')`,
    'categorias_produtos_nome_org_idx|duplicate key',
  )

  const caixaCriaCategoria = await escreveComo(
    CASHIER,
    `insert into public.categorias_produtos (nome) values ('Categoria do caixa')`,
  )
  if (caixaCriaCategoria.erro && /row-level security/i.test(caixaCriaCategoria.erro.message)) {
    ok('caixa não cadastra categoria sem permissão')
  } else {
    podeFalhar('barreira de escrita de categorias', caixaCriaCategoria.erro?.message ?? 'o insert passou')
  }

  const caixaLeCategorias = await leComo(CASHIER, 'select count(*)::int as n from public.categorias_produtos')
  if (!caixaLeCategorias.erro && caixaLeCategorias.n > 0) ok('caixa consulta categorias no contexto autorizado')
  else podeFalhar('consulta de categorias pelo caixa', caixaLeCategorias.erro?.message ?? JSON.stringify(caixaLeCategorias))

  await db.exec(`
    insert into public.organizations (id, nome) values ('${ORG2}', 'Segunda Loja');
    insert into neon_auth.user (id, email) values ('${ADMIN2}', 'admin2@teste.local');
    insert into public.profiles (id, full_name, organization_id, role)
      values ('${ADMIN2}', 'Admin da Segunda Loja', '${ORG2}', 'admin');
  `)
  const categoriaLegadaOrg2 = await leComo(
    ADMIN2,
    `select count(*)::int as n from public.categorias_produtos c
      where c.organization_id = '${ORG2}'
        and exists (
          select 1 from public.produtos p
           where lower(regexp_replace(btrim(p.categoria), '[[:space:]]+', ' ', 'g')) =
                 lower(regexp_replace(btrim(c.nome), '[[:space:]]+', ' ', 'g'))
        )`,
  )
  if (!categoriaLegadaOrg2.erro && categoriaLegadaOrg2.n > 0) {
    ok('nova organização recebe categorias já usadas pelos produtos')
  } else {
    podeFalhar('seed de categorias na nova organização', categoriaLegadaOrg2.erro?.message ?? JSON.stringify(categoriaLegadaOrg2))
  }
  const categoriaOrg2 = await escreveComo(
    ADMIN2,
    `insert into public.categorias_produtos (nome) values ('Categoria exclusiva da loja 2')`,
  )
  const leituraOrg1 = await leComo(
    ADMIN,
    `select count(*)::int as n from public.categorias_produtos
      where nome = 'Categoria exclusiva da loja 2'`,
  )
  if (!categoriaOrg2.erro && categoriaOrg2.afetados === 1 && !leituraOrg1.erro && leituraOrg1.n === 0) {
    ok('categorias de uma loja não aparecem para outra organização')
  } else {
    podeFalhar(
      'isolamento entre lojas',
      categoriaOrg2.erro?.message ?? leituraOrg1.erro?.message ?? `criação ${categoriaOrg2.afetados}, visíveis ${leituraOrg1.n}`,
    )
  }
}

log('\n== RLS de clientes e financeiro + perfil inativo ==')
{
  const cliente = await um(
    `insert into public.clientes (codigo, nome)
     values ('RLS-CLIENTE-17', 'Cliente de teste RLS') returning id`,
  )
  await db.exec(
    `insert into public.lancamentos (descricao, categoria, tipo, valor)
     values ('Lançamento de teste RLS', 'Teste', 'saida', 10)`,
  )

  const caixaLeClientes = await leComo(CASHIER, 'select count(*)::int as n from public.clientes')
  if (!caixaLeClientes.erro && caixaLeClientes.n > 0) ok('caixa consulta clientes (clientes.consultar)')
  else podeFalhar('consulta de clientes pelo caixa', caixaLeClientes.erro?.message ?? JSON.stringify(caixaLeClientes))

  const caixaCriaCliente = await escreveComo(
    CASHIER,
    `insert into public.clientes (codigo, nome) values ('RLS-CAIXA-17', 'Cliente do caixa')`,
  )
  if (!caixaCriaCliente.erro && caixaCriaCliente.afetados === 1) ok('caixa cadastra cliente (clientes.criar)')
  else podeFalhar('criação de cliente pelo caixa', caixaCriaCliente.erro?.message ?? `afetados ${caixaCriaCliente.afetados}`)

  const caixaEditaCliente = await escreveComo(
    CASHIER,
    `update public.clientes set nome = 'Alteração indevida' where id = '${cliente.id}'`,
  )
  const caixaApagaCliente = await escreveComo(
    CASHIER,
    `delete from public.clientes where id = '${cliente.id}'`,
  )
  if (!caixaEditaCliente.erro && caixaEditaCliente.afetados === 0 &&
      !caixaApagaCliente.erro && caixaApagaCliente.afetados === 0) {
    ok('caixa não edita nem exclui clientes sem permissão')
  } else {
    podeFalhar(
      'edição/exclusão de cliente pelo caixa',
      caixaEditaCliente.erro?.message ?? caixaApagaCliente.erro?.message ??
        `update ${caixaEditaCliente.afetados}, delete ${caixaApagaCliente.afetados}`,
    )
  }

  await db.exec(
    `insert into public.user_permissions (user_id, permission_id, allowed)
     select '${CASHIER}', id, false from public.permissions
      where module_key = 'clientes' and action_key = 'criar'
     on conflict (user_id, permission_id) do update set allowed = false`,
  )
  const caixaNegado = await escreveComo(
    CASHIER,
    `insert into public.clientes (codigo, nome) values ('RLS-NEGADO-17', 'Cliente negado')`,
  )
  await db.exec(`delete from public.user_permissions where user_id = '${CASHIER}'`)
  if (caixaNegado.erro && /row-level security/i.test(caixaNegado.erro.message)) {
    ok('negação individual de clientes.criar vence a permissão do perfil')
  } else {
    podeFalhar('negação individual de clientes', caixaNegado.erro?.message ?? 'o insert passou')
  }

  const caixaLeFinanceiro = await leComo(CASHIER, 'select count(*)::int as n from public.lancamentos')
  if (!caixaLeFinanceiro.erro && caixaLeFinanceiro.n === 0) {
    ok('caixa não consulta lançamentos financeiros')
  } else {
    podeFalhar('consulta financeira pelo caixa', caixaLeFinanceiro.erro?.message ?? `visíveis ${caixaLeFinanceiro.n}`)
  }

  const caixaCriaLancamento = await escreveComo(
    CASHIER,
    `insert into public.lancamentos (descricao, categoria, tipo, valor)
     values ('Lançamento não autorizado', 'Teste', 'saida', 1)`,
  )
  if (caixaCriaLancamento.erro && /row-level security/i.test(caixaCriaLancamento.erro.message)) {
    ok('caixa não cria lançamentos financeiros')
  } else {
    podeFalhar('criação financeira pelo caixa', caixaCriaLancamento.erro?.message ?? 'o insert passou')
  }

  const gerenteLeFinanceiro = await leComo(MANAGER, 'select count(*)::int as n from public.lancamentos')
  const gerenteCriaLancamento = await escreveComo(
    MANAGER,
    `insert into public.lancamentos (descricao, categoria, tipo, valor)
     values ('Lançamento do gerente', 'Teste', 'saida', 2)`,
  )
  if (!gerenteLeFinanceiro.erro && gerenteLeFinanceiro.n > 0 &&
      !gerenteCriaLancamento.erro && gerenteCriaLancamento.afetados === 1) {
    ok('gerente consulta e registra lançamentos financeiros')
  } else {
    podeFalhar(
      'permissão financeira do gerente',
      gerenteLeFinanceiro.erro?.message ?? gerenteCriaLancamento.erro?.message ??
        `leitura ${gerenteLeFinanceiro.n}, escrita ${gerenteCriaLancamento.afetados}`,
    )
  }

  await db.exec(`update public.profiles set is_active = false where id = '${ADMIN}'`)
  const adminInativoPode = await leComo(ADMIN, `select public.pode('estoque', 'consultar') as permitido`)
  const adminInativoOrg = await leComo(ADMIN, 'select public.minha_organizacao() as id')
  const adminInativoClientes = await leComo(ADMIN, 'select count(*)::int as n from public.clientes')
  const adminInativoFinanceiro = await leComo(ADMIN, 'select count(*)::int as n from public.lancamentos')
  await db.exec(`update public.profiles set is_active = true where id = '${ADMIN}'`)
  if (!adminInativoPode.erro && adminInativoPode.permitido === false &&
      !adminInativoOrg.erro && adminInativoOrg.id == null &&
      !adminInativoClientes.erro && adminInativoClientes.n === 0 &&
      !adminInativoFinanceiro.erro && adminInativoFinanceiro.n === 0) {
    ok('sessão ainda válida de perfil inativo não mantém permissões, organização nem dados')
  } else {
    podeFalhar(
      'bloqueio de perfil inativo',
      adminInativoPode.erro?.message ?? adminInativoOrg.erro?.message ??
        adminInativoClientes.erro?.message ?? adminInativoFinanceiro.erro?.message ??
        `pode=${adminInativoPode.permitido}, organização=${adminInativoOrg.id}, ` +
        `clientes=${adminInativoClientes.n}, financeiro=${adminInativoFinanceiro.n}`,
    )
  }
}

log('\n== P2 · Saldos iniciais: o que já existia entrou no livro ==')
{
  const divergentes = await contar(
    `select count(*)::int as n from public.produtos p
      where p.quantidade is distinct from public.saldo_estoque(p.id)`,
  )
  if (divergentes === 0) ok('o saldo do cache bate com o livro-razão em TODOS os itens')
  else podeFalhar('cache x livro-razão', `${divergentes} item(ns) divergindo`)

  const aberturas = await contar(
    `select count(*)::int as n from public.movimentacoes_estoque
      where origem = 'abertura' and destino = 'estoque'`,
  )
  const comSaldo = await contar(`select count(*)::int as n from public.produtos where quantidade <> 0`)
  if (aberturas > 0 && aberturas === comSaldo) {
    ok(`os ${aberturas} itens que já tinham saldo ganharam abertura no livro-razão`)
  } else {
    podeFalhar('saldos iniciais', `aberturas ${aberturas}, itens com saldo ${comSaldo}`)
  }
}

log('\n== P2 · Compra pela RPC (o caminho do navegador) ==')
{
  const antes = await saldoDe('P008')
  const r = await rpcComo(
    ADMIN,
    `select * from public.registrar_movimentacao(
       (select id from public.produtos where codigo = 'P008'),
       10, 'fornecedor', 'estoque', 'Compra de 10 kg de banana')`,
  )
  if (r.erro) podeFalhar('compra de 10 kg', r.erro.message)
  else if (Number(r.linhas[0].saldo) === antes + 10) ok(`banana: ${antes} -> ${antes + 10} kg`)
  else podeFalhar('saldo depois da compra', `veio ${r.linhas[0].saldo}, esperado ${antes + 10}`)

  const doCache = Number(
    (await um(`select quantidade from public.produtos where codigo = 'P008'`)).quantidade,
  )
  if (doCache === antes + 10) ok('o cache `produtos.quantidade` acompanhou o movimento')
  else podeFalhar('cache após a compra', `cache ${doCache}, livro ${antes + 10}`)

  // Sem sessão não há movimento: `usuario_id` não pode ser inventado. O claim
  // é de sessão, então precisa ser limpo de propósito aqui.
  await db.query(`select set_config('request.jwt.claims', '', false)`)
  const semSessao = await db
    .query(
      `select * from public.registrar_movimentacao(
         (select id from public.produtos where codigo = 'P008'),
         1, 'fornecedor', 'estoque', 'teste')`,
    )
    .then(() => null)
    .catch((e) => e.message)
  if (semSessao && /sess/i.test(semSessao)) ok('sem sessão, a RPC recusa (não carimba usuário falso)')
  else podeFalhar('RPC sem sessão', semSessao ?? 'passou!')
}

log('\n== P2 · Estoque geral e transferências ==')
{
  await db.exec('begin')
  const produto = `(select id from public.produtos where codigo = 'P008')`
  const lojaAntes = await saldoDe('P008')
  const saldosAntes = await rpcComoEmSavepoint(
    ADMIN,
    `select * from public.listar_saldos_estoque_locais() where produto_id = ${produto}`,
  )
  const geralAntes = Number(saldosAntes.linhas[0]?.saldo_geral ?? 0)
  const entrada = await rpcComoEmSavepoint(
    ADMIN,
    `select * from public.registrar_movimentacao_local(
       ${produto}, 10, 'fornecedor', 'estoque_geral', 'Entrada no estoque geral')`,
  )

  if (!saldosAntes.erro && !entrada.erro &&
      Number(entrada.linhas[0]?.saldo_geral) === geralAntes + 10 &&
      Number(entrada.linhas[0]?.saldo_loja) === lojaAntes) {
    ok('RPC autenticada consulta os saldos e recebe mercadoria no estoque geral')
  } else {
    podeFalhar(
      'entrada no estoque geral',
      saldosAntes.erro?.message ?? entrada.erro?.message ??
        `geral ${entrada.linhas[0]?.saldo_geral}, loja ${entrada.linhas[0]?.saldo_loja}`,
    )
  }

  const chave = 'teste-transferencia-estoque-geral-22'
  const transferenciaSql = `select * from public.transferir_estoque_local(
    ${produto}, 3, 'geral', 'loja', 'Reposição de teste', '${chave}')`
  const transferencia = await rpcComoEmSavepoint(ADMIN, transferenciaSql)
  const repeticao = await rpcComoEmSavepoint(ADMIN, transferenciaSql)
  const saldosDepois = await rpcComoEmSavepoint(
    ADMIN,
    `select * from public.listar_saldos_estoque_locais() where produto_id = ${produto}`,
  )

  if (!transferencia.erro && !repeticao.erro &&
      transferencia.linhas[0]?.id === repeticao.linhas[0]?.id &&
      transferencia.linhas[0]?.movimentacao_id === repeticao.linhas[0]?.movimentacao_id &&
      Number(saldosDepois.linhas[0]?.saldo_geral) === geralAntes + 7 &&
      Number(saldosDepois.linhas[0]?.saldo_loja) === lojaAntes + 3) {
    ok('transferência geral → loja altera os dois saldos uma única vez, mesmo repetida')
  } else {
    podeFalhar(
      'transferência idempotente',
      transferencia.erro?.message ?? repeticao.erro?.message ?? saldosDepois.erro?.message ??
        `geral ${saldosDepois.linhas[0]?.saldo_geral}, loja ${saldosDepois.linhas[0]?.saldo_loja}`,
    )
  }

  const saldoInsuficiente = await rpcComoEmSavepoint(
    ADMIN,
    `select * from public.transferir_estoque_local(
       ${produto}, 999, 'geral', 'loja', 'Teste de saldo insuficiente', 'teste-saldo-insuficiente')`,
  )
  if (saldoInsuficiente.erro && /saldo insuficiente/i.test(saldoInsuficiente.erro.message)) {
    ok('transferência acima do saldo geral é recusada')
  } else {
    podeFalhar('transferência sem saldo', saldoInsuficiente.erro?.message ?? 'a RPC deixou passar!')
  }

  const caixaTransfere = await rpcComoEmSavepoint(
    CASHIER,
    `select * from public.transferir_estoque_local(
       ${produto}, 1, 'geral', 'loja', 'Tentativa do caixa', 'teste-caixa-transferencia')`,
  )
  if (caixaTransfere.erro && /permiss/i.test(caixaTransfere.erro.message)) {
    ok('caixa não consegue transferir estoque')
  } else {
    podeFalhar('permissão do caixa para transferir', caixaTransfere.erro?.message ?? 'a RPC deixou passar!')
  }
  await db.exec('rollback')
}

log('\n== P2 · Saldo não se edita: só se movimenta ==')
{
  // O caso perigoso: um UPDATE no produto (trocar o preço, por exemplo) não
  // pode zerar nem sobrescrever o saldo.
  const antes = await saldoDe('P008')
  const escreveu = await escreveComo(
    ADMIN,
    `update public.produtos set preco = preco + 1, quantidade = 999 where codigo = 'P008'`,
  )
  const depois = await saldoDe('P008')
  const cache = Number((await um(`select quantidade from public.produtos where codigo = 'P008'`)).quantidade)

  if (!escreveu.erro && depois === antes && cache === antes) {
    ok(`UPDATE pedindo 999 no saldo foi ignorado: continua ${antes} kg (livro manda)`)
  } else {
    podeFalhar('saldo digitado à mão', `livro ${depois}, cache ${cache}, esperado ${antes}`)
  }

  // Saída maior que o saldo: recusada, e sem deixar saldo negativo.
  const exagero = await rpcComo(
    ADMIN,
    `select * from public.registrar_movimentacao(
       (select id from public.produtos where codigo = 'P010'),
       999999, 'estoque', 'perda', 'teste de saldo insuficiente')`,
  )
  const saldoColher = await saldoDe('P010')
  if (exagero.erro && /saldo insuficiente/i.test(exagero.erro.message) && saldoColher > 0) {
    ok('saída maior que o saldo é recusada, com mensagem em português')
  } else {
    podeFalhar('saída maior que o saldo', exagero.erro?.message ?? `saldo ficou ${saldoColher}`)
  }

  // O operador de caixa não movimenta estoque — pelo banco, não pela tela.
  const caixaMove = await rpcComo(
    CASHIER,
    `select * from public.registrar_movimentacao(
       (select id from public.produtos where codigo = 'P008'),
       1, 'fornecedor', 'estoque', 'tentativa do caixa')`,
  )
  if (caixaMove.erro && /permiss/i.test(caixaMove.erro.message)) ok('caixa NÃO movimenta estoque')
  else podeFalhar('permissão do caixa para movimentar', caixaMove.erro?.message ?? 'a RPC deixou passar!')

  const gerenteMove = await rpcComo(
    MANAGER,
    `select * from public.registrar_movimentacao(
       (select id from public.produtos where codigo = 'P008'),
       2, 'fornecedor', 'estoque', 'Compra conferida pelo gerente')`,
  )
  if (!gerenteMove.erro) ok('gerente movimenta estoque')
  else podeFalhar('movimento do gerente', gerenteMove.erro.message)

  // Motivo em branco é recusado: movimento sem motivo não se audita.
  const semMotivo = await rpcComo(
    ADMIN,
    `select * from public.registrar_movimentacao(
       (select id from public.produtos where codigo = 'P008'),
       1, 'fornecedor', 'estoque', '   ')`,
  )
  if (semMotivo.erro && /motivo/i.test(semMotivo.erro.message)) ok('movimento sem motivo é recusado')
  else podeFalhar('motivo vazio', semMotivo.erro?.message ?? 'a RPC deixou passar!')

  // Origem igual ao destino não é movimento.
  const mesma = await rpcComo(
    ADMIN,
    `select * from public.registrar_movimentacao(
       (select id from public.produtos where codigo = 'P008'),
       1, 'estoque', 'estoque', 'teste')`,
  )
  if (mesma.erro) ok('origem igual ao destino é recusada')
  else podeFalhar('origem = destino', 'a RPC deixou passar!')

  // 'abertura'/'contagem' não entram pela porta do dia a dia.
  const abertura = await rpcComo(
    ADMIN,
    `select * from public.registrar_movimentacao(
       (select id from public.produtos where codigo = 'P008'),
       1, 'abertura', 'estoque', 'tentativa de forjar abertura')`,
  )
  if (abertura.erro) ok('não dá para forjar um saldo de abertura pela movimentação comum')
  else podeFalhar('abertura pela RPC comum', 'a RPC deixou passar!')
}

log('\n== P2 · Livro-razão é imutável ==')
{
  const alvo = `(select id from public.movimentacoes_estoque order by criado_em limit 1)`
  const alterou = await db.query(`update public.movimentacoes_estoque set quantidade = 1 where id = ${alvo}`).then(() => null).catch((e) => e.message)
  const apagou = await db.query(`delete from public.movimentacoes_estoque where id = ${alvo}`).then(() => null).catch((e) => e.message)

  if (alterou && /não pode ser alterada/i.test(alterou)) ok('UPDATE em movimento é recusado')
  else podeFalhar('update no livro', alterou ?? 'passou!')

  if (apagou && /não pode ser alterada/i.test(apagou)) ok('DELETE em movimento é recusado')
  else podeFalhar('delete no livro', apagou ?? 'passou!')

  const quantos = await contar(`select count(*)::int as n from public.movimentacoes_estoque`)
  if (quantos > 0) ok(`o livro continua inteiro (${quantos} movimentos)`)
  else podeFalhar('livro após tentativas', 'os movimentos sumiram')
}

log('\n== P2 · Nem o caixa lê o livro por outro caminho ==')
{
  const caixaLe = await leComo(CASHIER, `select count(*)::int as n from public.movimentacoes_estoque`)
  if (!caixaLe.erro && caixaLe.n > 0) ok(`caixa lê o histórico de estoque (${caixaLe.n} movimentos)`)
  else podeFalhar('leitura do livro pelo caixa', caixaLe.erro?.message ?? JSON.stringify(caixaLe))

  const caixaInsere = await escreveComo(
    CASHIER,
    `insert into public.movimentacoes_estoque (produto_id, quantidade, origem, destino, motivo)
     values ((select id from public.produtos where codigo = 'P008'), 5, 'fornecedor', 'estoque', 'direto')`,
  )
  if (caixaInsere.erro) ok('INSERT direto no livro é negado (só a RPC escreve)')
  else podeFalhar('insert direto no livro', 'passou!')
}

log('\n== P2 · Contagem física registra só a diferença ==')
{
  const antes = await saldoDe('P008')
  const ajuste = await rpcComo(
    ADMIN,
    `select * from public.ajustar_saldo(
       (select id from public.produtos where codigo = 'P008'), ${antes + 3}, 'Contagem física de teste', 'contagem')`,
  )
  if (!ajuste.erro && Number(ajuste.linhas[0].saldo) === antes + 3) {
    ok(`contagem: ${antes} -> ${antes + 3} kg (registrou a diferença, não o total)`)
  } else {
    podeFalhar('ajuste por contagem', ajuste.erro?.message ?? JSON.stringify(ajuste.linhas[0]))
  }

  const movimentosAntes = await contar(`select count(*)::int as n from public.movimentacoes_estoque`)
  const repetido = await rpcComo(
    ADMIN,
    `select * from public.ajustar_saldo(
       (select id from public.produtos where codigo = 'P008'), ${antes + 3}, 'Contagem repetida', 'contagem')`,
  )
  const movimentosDepois = await contar(`select count(*)::int as n from public.movimentacoes_estoque`)
  if (!repetido.erro && movimentosDepois === movimentosAntes) {
    ok('contar o mesmo valor de novo não cria movimento nenhum')
  } else {
    podeFalhar('contagem repetida', repetido.erro?.message ?? `movimentos ${movimentosAntes} -> ${movimentosDepois}`)
  }
}

log('\n== P2 · Dedução dupla é impossível por construção ==')
{
  // Um item de venda gera no máximo UM movimento: é o índice único que garante.
  const item = await um(`select i.id, i.venda_id from public.itens_venda i limit 1`)
  const produto = await um(`select id from public.produtos where codigo = 'P008'`)
  const org = (await um(`select id from public.organizations limit 1`)).id

  await devePassar(
    'primeiro movimento do item de venda',
    `insert into public.movimentacoes_estoque
       (organization_id, produto_id, quantidade, origem, destino, motivo, venda_id, item_venda_id)
     values ('${org}', '${produto.id}', 1, 'estoque', 'cliente', 'Venda', '${item.venda_id}', '${item.id}')`,
  )
  await deveFalhar(
    'segundo movimento do MESMO item de venda',
    `insert into public.movimentacoes_estoque
       (organization_id, produto_id, quantidade, origem, destino, motivo, venda_id, item_venda_id)
     values ('${org}', '${produto.id}', 1, 'estoque', 'cliente', 'Venda de novo', '${item.venda_id}', '${item.id}')`,
    'mov_estoque_item_venda_unico|duplicate key',
  )
  await deveFalhar(
    'movimento de venda sem venda',
    `insert into public.movimentacoes_estoque
       (organization_id, produto_id, quantidade, origem, destino, motivo, item_venda_id)
     values ('${org}', '${produto.id}', 1, 'estoque', 'cliente', 'Venda', '${item.id}')`,
    'movimentacoes_item_exige_venda',
  )
}

log('\n== P3 · Venda por peso: conta, movimentos e idempotência ==')
{
  // O bloco de RLS acima mudou o preço do self-service para R$ 71,90 de
  // propósito. Devolver para R$ 69,90 é o primeiro passo — e já serve de prova
  // de que a venda lê o CADASTRO, não o corpo da requisição.
  await escreveComo(ADMIN, `update public.produtos set preco = 69.90 where codigo = 'SS1'`)

  const ss1 = (await um(`select id from public.produtos where codigo = 'SS1'`)).id
  const p001 = (await um(`select id from public.produtos where codigo = 'P001'`)).id

  await rpcComo(
    ADMIN,
    `select * from public.ajustar_saldo('${ss1}', 5, 'Saldo inicial do teste da P3', 'abertura')`,
  )
  const saldoInicial = await saldoDe('SS1')

  const vender = (chave, itens, extra = '') =>
    rpcComo(
      CASHIER,
      `select * from public.registrar_venda('${JSON.stringify(itens)}'::jsonb, '${chave}'${extra})`,
    )

  const vendasAntes = await contar('select count(*)::int as n from public.vendas')
  const movAntes = await contar('select count(*)::int as n from public.movimentacoes_estoque')

  /* ------------------------------------------- 480 g brutos - 30 g de tara -- */
  const r1 = await vender('p3-teste-1', [{ produto_id: ss1, peso_bruto_g: 480, tara_g: 30 }])
  const v1 = r1.linhas[0] ?? {}

  if (r1.erro) podeFalhar('venda por peso (480 g - 30 g)', `${r1.erro.message} || ${r1.erro.where ?? ''} || ${r1.erro.context ?? ''}`)
  else if (Number(v1.total) === 31.46) ok('480 g - 30 g = 450 g = R$ 31,46', `pedido ${v1.codigo}`)
  else podeFalhar('conta da venda por peso', `total ${v1.total}, esperado 31.46`)

  const item1 = await um(`select * from public.itens_venda where venda_id = '${v1.id}'`)
  const item1Ok =
    item1 &&
    Number(item1.quantidade) === 0.45 &&
    Number(item1.preco_unitario) === 69.9 &&
    item1.peso_bruto_g === 480 &&
    item1.tara_g === 30 &&
    item1.peso_liquido_g === 450 &&
    item1.metodo_peso === 'bruto_tara' &&
    Number(item1.total) === 31.46

  if (item1Ok) ok('o item guarda bruto, tara, líquido, preço do quilo e total da linha')
  else podeFalhar('dados do item por peso', JSON.stringify(item1))

  const mov1 = await um(
    `select m.* from public.movimentacoes_estoque m where m.venda_id = '${v1.id}'`,
  )
  const mov1Ok =
    mov1 &&
    mov1.origem === 'estoque' &&
    mov1.destino === 'cliente' &&
    Number(mov1.quantidade) === 0.45 &&
    mov1.item_venda_id === item1.id &&
    mov1.usuario_id === CASHIER &&
    /Venda/.test(mov1.motivo)

  if (mov1Ok) ok('a venda tirou 0,450 kg do estoque (estoque -> cliente), com autor')
  else podeFalhar('movimento da venda', JSON.stringify(mov1))

  if ((await saldoDe('SS1')) === saldoInicial - 0.45) ok(`saldo: ${saldoInicial} kg -> ${saldoInicial - 0.45} kg`)
  else podeFalhar('saldo depois da venda', `${await saldoDe('SS1')} kg`)

  /* ------------------------------------------------------------- idempotência */
  const r2 = await vender('p3-teste-1', [{ produto_id: ss1, peso_bruto_g: 480, tara_g: 30 }])
  const v2 = r2.linhas[0] ?? {}
  const vendasDepois = await contar('select count(*)::int as n from public.vendas')
  const movDepois = await contar('select count(*)::int as n from public.movimentacoes_estoque')

  if (!r2.erro && v2.ja_existia === true && v2.id === v1.id && v2.codigo === v1.codigo) {
    ok('repetir a MESMA chave devolve a mesma venda (ja_existia)')
  } else {
    podeFalhar('idempotência por chave', JSON.stringify(v2))
  }
  if (vendasDepois === vendasAntes + 1 && movDepois === movAntes + 1) {
    ok('e não criou venda nem movimento a mais')
  } else {
    podeFalhar('nada duplicado', `vendas ${vendasAntes}->${vendasDepois}, movimentos ${movAntes}->${movDepois}`)
  }
  if ((await saldoDe('SS1')) === saldoInicial - 0.45) ok('estoque continua baixado UMA vez só')
  else podeFalhar('estoque baixado duas vezes', `${await saldoDe('SS1')} kg`)

  /* ------------------------------------- mesma compra de novo, chave nova -- */
  const r3 = await vender('p3-teste-2', [{ produto_id: ss1, peso_bruto_g: 480, tara_g: 30 }])
  const v3 = r3.linhas[0] ?? {}
  if (!r3.erro && v3.ja_existia === false && v3.id !== v1.id && Number(v3.total) === 31.46) {
    ok('chave nova = venda nova (duas compras iguais são duas vendas)')
  } else {
    podeFalhar('venda nova com chave nova', JSON.stringify(v3))
  }
  if ((await saldoDe('SS1')) === saldoInicial - 0.9) ok('e o estoque baixou de novo (0,900 kg no total)')
  else podeFalhar('segundo baixamento', `${await saldoDe('SS1')} kg`)

  /* --------------------------------------- preço não vem do corpo da requisição */
  const r4 = await vender('p3-teste-3', [
    { produto_id: ss1, peso_bruto_g: 1000, tara_g: 0, preco_unitario: 0.01 },
  ])
  const item4 = await um(`select preco_unitario, total from public.itens_venda where venda_id = '${r4.linhas[0]?.id}'`)
  if (Number(item4?.preco_unitario) === 69.9 && Number(item4?.total) === 69.9) {
    ok('preço mandado pelo navegador é ignorado: vale o cadastro (R$ 69,90/kg)')
  } else {
    podeFalhar('preço do cadastro', JSON.stringify(item4))
  }

  /* ------------------------------------------------------- peso líquido direto */
  const r5 = await vender('p3-teste-4', [
    { produto_id: ss1, metodo_peso: 'liquido', peso_liquido_g: 450 },
  ])
  const item5 = await um(`select * from public.itens_venda where venda_id = '${r5.linhas[0]?.id}'`)
  const item5Ok =
    item5 &&
    item5.metodo_peso === 'liquido' &&
    item5.peso_bruto_g === null &&
    item5.tara_g === null &&
    item5.peso_liquido_g === 450 &&
    Number(item5.total) === 31.46
  if (item5Ok) ok('peso já líquido: NÃO se desconta tara de novo (bruto e tara ficam nulos)')
  else podeFalhar('peso líquido informado', JSON.stringify(item5))

  /* ------------------------------------------------------------- as recusas -- */
  const recusa = async (nome, itens, trecho, chave) => {
    const r = await vender(chave, itens)
    if (r.erro && new RegExp(trecho, 'i').test(r.erro.message)) ok(nome)
    else podeFalhar(nome, r.erro?.message ?? 'passou, e não deveria')
  }

  await recusa(
    'tara maior que o peso bruto é recusada',
    [{ produto_id: ss1, peso_bruto_g: 20, tara_g: 30 }],
    'tara.*maior que o peso bruto',
    'p3-recusa-1',
  )
  await recusa(
    'tara acima de 5 kg é recusada',
    [{ produto_id: ss1, peso_bruto_g: 9000, tara_g: 6000 }],
    'não pode passar de 5000',
    'p3-recusa-2',
  )
  await recusa(
    'peso líquido zero é recusado',
    [{ produto_id: ss1, peso_bruto_g: 30, tara_g: 30 }],
    'ficou zero',
    'p3-recusa-3',
  )
  await recusa(
    'item por peso sem peso nenhum é recusado',
    [{ produto_id: ss1 }],
    'peso bruto',
    'p3-recusa-4',
  )
  await recusa(
    'item por peso sem tara (e sem recipiente) é recusado',
    [{ produto_id: ss1, peso_bruto_g: 480 }],
    'tara',
    'p3-recusa-5',
  )
  await recusa(
    'peso em item que não é por peso é recusado',
    [{ produto_id: p001, metodo_peso: 'bruto_tara', peso_bruto_g: 480, tara_g: 30 }],
    'não é vendido por peso',
    'p3-recusa-6',
  )
  await recusa('venda sem item é recusada', [], 'pelo menos um item', 'p3-recusa-7')
  await recusa(
    'produto inexistente é recusado',
    [{ produto_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', quantidade: 1 }],
    'não encontrado',
    'p3-recusa-8',
  )

  /* ----------------------------------------- a venda inteira ou nada dela --- */
  const vendasAntesDaFalha = await contar('select count(*)::int as n from public.vendas')
  const itensAntesDaFalha = await contar('select count(*)::int as n from public.itens_venda')
  const saldoAntesDaFalha = await saldoDe('SS1')

  // Dois itens: o segundo pede 100 kg que não existem. A venda tem de sumir
  // inteira — nada de venda pela metade nem de item sem movimento.
  const rFalha = await vender('p3-falha-estoque', [
    { produto_id: ss1, peso_bruto_g: 1000, tara_g: 0 },
    { produto_id: ss1, peso_bruto_g: 100000, tara_g: 0 },
  ])

  if (rFalha.erro && /Saldo insuficiente/i.test(rFalha.erro.message)) ok('falta de saldo recusa a venda inteira')
  else podeFalhar('falta de saldo', rFalha.erro?.message ?? 'a venda passou')

  const vendasDepoisDaFalha = await contar('select count(*)::int as n from public.vendas')
  const itensDepoisDaFalha = await contar('select count(*)::int as n from public.itens_venda')

  if (
    vendasDepoisDaFalha === vendasAntesDaFalha &&
    itensDepoisDaFalha === itensAntesDaFalha &&
    (await saldoDe('SS1')) === saldoAntesDaFalha
  ) {
    ok('e não sobrou venda, item nem movimento (transação de verdade)')
  } else {
    podeFalhar(
      'venda pela metade',
      `vendas ${vendasAntesDaFalha}->${vendasDepoisDaFalha}, itens ${itensAntesDaFalha}->${itensDepoisDaFalha}, saldo ${await saldoDe('SS1')}`,
    )
  }

  /* ------------------------------------------------ venda por unidade ---- */
  const r6 = await vender('p3-teste-5', [{ produto_id: p001, quantidade: 3 }])
  const v6 = r6.linhas[0] ?? {}
  const item6 = await um(`select * from public.itens_venda where venda_id = '${v6.id}'`)
  const mov6 = await um(`select * from public.movimentacoes_estoque where venda_id = '${v6.id}'`)

  if (Number(v6.total) === 47.7 && Number(item6?.quantidade) === 3 && item6?.metodo_peso === null) {
    ok('venda por unidade continua igual: 3 x R$ 15,90 = R$ 47,70')
  } else {
    podeFalhar('venda por unidade', `total ${v6.total}, item ${JSON.stringify(item6)}`)
  }
  if (Number(mov6?.quantidade) === 3 && mov6?.destino === 'cliente') ok('e baixou 3 un do estoque')
  else podeFalhar('movimento da venda por unidade', JSON.stringify(mov6))

  /* --------------------------------------------- total é a soma das linhas -- */
  await rpcComo(
    ADMIN,
    `select * from public.ajustar_saldo('${p001}', 50, 'Saldo para o teste de soma', 'abertura')`,
  )
  const r7 = await vender('p3-teste-6', [
    { produto_id: p001, quantidade: 1 },
    { produto_id: p001, quantidade: 2 },
  ])
  const v7 = r7.linhas[0] ?? {}
  if (Number(v7.total) === 47.7 && v7.itens === 2) ok('total do pedido = soma das linhas (2 itens, R$ 47,70)')
  else podeFalhar('soma das linhas', `total ${v7.total}, itens ${v7.itens}`)

  /* ------------------------------------------------- venda cancelada não baixa */
  const saldoAntesCancelada = await saldoDe('SS1')
  const r8 = await vender(
    'p3-teste-7',
    [{ produto_id: ss1, peso_bruto_g: 1000, tara_g: 0 }],
    `, null, 'Pix', 'Cancelada'`,
  )
  const mov8 = await um(`select count(*)::int as n from public.movimentacoes_estoque where venda_id = '${r8.linhas[0]?.id}'`)
  if (!r8.erro && Number(mov8.n) === 0 && (await saldoDe('SS1')) === saldoAntesCancelada) {
    ok('venda com status Cancelada entra no histórico sem tirar estoque')
  } else {
    podeFalhar('venda cancelada', r8.erro?.message ?? `${mov8.n} movimento(s)`)
  }

  /* ------------------------------------------- não dá para escrever na mão -- */
  const insertDireto = await escreveComo(
    CASHIER,
    `insert into public.vendas (codigo, status, pagamento, total) values ('#NA-MAO', 'Concluída', 'Pix', 1)`,
  )
  if (insertDireto.erro && /permission denied/i.test(insertDireto.erro.message)) {
    ok('INSERT direto em vendas é negado: a única porta é a RPC')
  } else {
    podeFalhar('escrita direta na venda', insertDireto.erro?.message ?? 'o insert passou!')
  }

  const caixaLendo = await leComo(CASHIER, 'select count(*)::int as n from public.vendas')
  if (!caixaLendo.erro && caixaLendo.n > 0) ok(`caixa continua LENDO as vendas (${caixaLendo.n})`)
  else podeFalhar('leitura de vendas pelo caixa', caixaLendo.erro?.message ?? JSON.stringify(caixaLendo))

  // O RLS de vendas agora é por permissão: tirar `vendas.criar` do gerente tira
  // a venda dele, mesmo com o papel de gerente no perfil.
  await db.query(
    `insert into public.user_permissions (user_id, permission_id, allowed)
     select '${MANAGER}', id, false from public.permissions
      where module_key = 'vendas' and action_key = 'criar'
     on conflict (user_id, permission_id) do update set allowed = false`,
  )
  const gerenteNegado = await rpcComo(
    MANAGER,
    `select * from public.registrar_venda('[{"produto_id":"${p001}","quantidade":1}]'::jsonb, 'p3-negado')`,
  )
  if (gerenteNegado.erro && /não tem permissão para registrar venda/i.test(gerenteNegado.erro.message)) {
    ok('negação individual de vendas.criar vence o papel (gerente não vende)')
  } else {
    podeFalhar('negação individual', gerenteNegado.erro?.message ?? 'a venda passou')
  }
  await db.query(`delete from public.user_permissions where user_id = '${MANAGER}'`)

  /* ----------------------------------- o banco recusa item incoerente na mão */
  await deveFalhar(
    'item por peso com líquido que não bate com bruto - tara é recusado',
    `insert into public.itens_venda
       (venda_id, produto_id, descricao, quantidade, preco_unitario, metodo_peso, peso_bruto_g, tara_g, peso_liquido_g)
     values ('${v1.id}', '${ss1}', 'na mão', 0.45, 69.9, 'bruto_tara', 480, 30, 500)`,
    'itens_venda_bruto_menos_tara',
  )
  await deveFalhar(
    'quantidade que não é o líquido em quilos é recusada',
    `insert into public.itens_venda
       (venda_id, produto_id, descricao, quantidade, preco_unitario, metodo_peso, peso_liquido_g)
     values ('${v1.id}', '${ss1}', 'na mão', 2, 69.9, 'bruto_tara', 450)`,
    'itens_venda_bruto_menos_tara|itens_venda_quantidade_e_o_liquido',
  )

  /* ------------------------------------------------- código do pedido (10) --- */
  const anunciado = (await leComo(CASHIER, `select public.proximo_codigo_venda() as c`)).c
  const anunciadoDeNovo = (await leComo(CASHIER, `select public.proximo_codigo_venda() as c`)).c
  const maiorCodigoAgora = Number(
    (
      await um(
        `select max((substring(codigo from 2))::bigint) as m from public.vendas where codigo ~ '^#[0-9]+$'`,
      )
    ).m,
  )

  if (anunciado === `#${maiorCodigoAgora + 1}` && anunciadoDeNovo === anunciado) {
    ok(`o banco anuncia o próximo pedido (${anunciado}) sem consumir o número`)
  } else {
    podeFalhar('próximo código anunciado', `${anunciado} / ${anunciadoDeNovo} (último #${maiorCodigoAgora})`)
  }

  const r9 = await vender('p3-codigo-1', [{ produto_id: p001, quantidade: 1 }])
  const v9 = r9.linhas[0] ?? {}
  if (!r9.erro && v9.codigo === anunciado && Number(v9.itens) === 1) {
    ok(`e a venda sem código digitado sai com ele (${v9.codigo})`)
  } else {
    podeFalhar('numeração pelo banco', r9.erro?.message ?? `saiu ${v9.codigo}, anunciado ${anunciado}`)
  }

  // Número queimado: `nextval` entregue a uma transação que não gravou nada.
  // Reaplicar a 10 tem de recolocar a sequência no maior código gravado (o que
  // mantém a numeração sem buraco e sem risco de repetir código).
  await db.query(`select nextval('public.vendas_codigo_seq')`)
  await aplicar('10_codigo_do_pedido.sql')
  const depoisDoBuraco = (await leComo(CASHIER, `select public.proximo_codigo_venda() as c`)).c
  const maiorDepoisDoBuraco = Number(
    (
      await um(
        `select max((substring(codigo from 2))::bigint) as m from public.vendas where codigo ~ '^#[0-9]+$'`,
      )
    ).m,
  )

  if (depoisDoBuraco === `#${maiorDepoisDoBuraco + 1}`) {
    ok('número queimado em transação desfeita não abre buraco na numeração')
  } else {
    podeFalhar('buraco na numeração', `anunciado ${depoisDoBuraco}, maior #${maiorDepoisDoBuraco}`)
  }

  /* ------------------------------------------------------------- persistência */
  // A venda da P3 continua inteira depois de tudo (é leitura, mas é a prova de
  // que nada do que rodou acima a desfez).
  const persistiu = await um(`select total, status from public.vendas where id = '${v1.id}'`)
  const itemPersistiu = await um(`select peso_liquido_g from public.itens_venda where venda_id = '${v1.id}'`)
  if (Number(persistiu?.total) === 31.46 && persistiu?.status === 'Concluída' && itemPersistiu?.peso_liquido_g === 450) {
    ok('a venda da P3 continua inteira no fim do roteiro (450 g, R$ 31,46)')
  } else {
    podeFalhar('persistência da venda', JSON.stringify({ persistiu, itemPersistiu }))
  }
}

log('\n== P4 · Estorno: devolve o estoque e deixa o rastro ==')
{
  const ss1 = (await um(`select id from public.produtos where codigo = 'SS1'`)).id

  const venderP4 = (chave, itens, codigo) =>
    rpcComo(
      CASHIER,
      `select * from public.registrar_venda('${JSON.stringify(itens)}'::jsonb, '${chave}', null, 'Pix', 'Concluída', '${codigo}')`,
    )

  const estornar = (uid, vendaId, motivo) =>
    rpcComo(
      uid,
      `select * from public.estornar_venda('${vendaId}', ${motivo === null ? 'null' : `'${motivo}'`})`,
    )

  const recusa = async (nome, uid, vendaId, motivo, trecho) => {
    const rr = await estornar(uid, vendaId, motivo)
    if (rr.erro && new RegExp(trecho, 'i').test(rr.erro.message)) ok(nome)
    else podeFalhar(nome, rr.erro?.message ?? 'passou, e não deveria')
  }

  await rpcComo(ADMIN, `select * from public.ajustar_saldo('${ss1}', 10, 'Saldo para o estorno', 'abertura')`)
  const saldoAntes = await saldoDe('SS1')

  /* -------------------------------- canais e formas: pedido completo ------ */
  {
    const tipoDelivery = (await um(
      `select id from public.tipos_venda where organization_id = '${ORG}' and codigo = 'delivery_proprio'`,
    )).id
    const tipoApp = (await um(
      `select id from public.tipos_venda where organization_id = '${ORG}' and codigo = 'aplicativo'`,
    )).id
    const dinheiro = (await um(
      `select id from public.formas_pagamento where organization_id = '${ORG}' and codigo = 'dinheiro'`,
    )).id
    const pix = (await um(
      `select id from public.formas_pagamento where organization_id = '${ORG}' and codigo = 'pix'`,
    )).id

    const itens = JSON.stringify([{ produto_id: ss1, peso_bruto_g: 480, tara_g: 30 }])
    const idempotente = (taxa) =>
      `select * from public.registrar_venda_completa(
        '${itens}'::jsonb, 'canal-delivery-teste', null, '${tipoDelivery}', '${dinheiro}',
        'Concluída', '#CANAL1', 'Rua do Teste, 10', ${taxa}, null, null, 0, 0, 40
      )`

    await db.exec('begin')
    const primeira = await rpcComoEmSavepoint(CASHIER, idempotente(2))
    const repetida = await rpcComoEmSavepoint(CASHIER, idempotente(99))
    const delivery = primeira.linhas[0] ?? {}
    const repeticao = repetida.linhas[0] ?? {}
    const qtdMovimentos = delivery.id
      ? await contar(`select count(*)::int as n from public.movimentacoes_estoque where venda_id = '${delivery.id}'`)
      : 0

    if (
      !primeira.erro &&
      !repetida.erro &&
      delivery.tipo_venda === 'Delivery próprio' &&
      delivery.forma_pagamento === 'Dinheiro' &&
      Number(delivery.total_cobrado) === 33.46 &&
      Number(delivery.troco) === 6.54
    ) ok('delivery + dinheiro cobra taxa e calcula troco pelo total final')
    else podeFalhar('delivery + dinheiro', primeira.erro?.message ?? JSON.stringify(delivery))

    if (repeticao.ja_existia === true && repeticao.id === delivery.id && Number(repeticao.total_cobrado) === 33.46 && qtdMovimentos === 1) {
      ok('repetir a chave mantém os detalhes originais e não duplica a baixa de estoque')
    } else podeFalhar('idempotência dos detalhes', JSON.stringify({ repeticao, qtdMovimentos }))

    const valorInsuficiente = await rpcComoEmSavepoint(
      CASHIER,
      `select * from public.registrar_venda_completa(
        '${itens}'::jsonb, 'canal-dinheiro-insuficiente', null, '${tipoDelivery}', '${dinheiro}',
        'Concluída', '#CANAL3', 'Rua do Teste, 10', 2, null, null, 0, 0, 10
      )`,
    )
    if (valorInsuficiente.erro && /menor que o total/i.test(valorInsuficiente.erro.message)) {
      ok('pagamento em dinheiro abaixo do total é recusado')
    } else podeFalhar('validação do valor recebido', valorInsuficiente.erro?.message ?? 'venda abaixo do total passou')

    const deliverySemEndereco = await rpcComoEmSavepoint(
      CASHIER,
      `select * from public.registrar_venda_completa(
        '${itens}'::jsonb, 'canal-delivery-sem-endereco', null, '${tipoDelivery}', '${pix}',
        'Concluída', '#CANAL4', null, 0, null, null, 0, 0, null
      )`,
    )
    if (deliverySemEndereco.erro && /endereço de entrega/i.test(deliverySemEndereco.erro.message)) {
      ok('delivery sem endereço é recusado antes de movimentar o estoque')
    } else podeFalhar('validação do endereço', deliverySemEndereco.erro?.message ?? 'delivery sem endereço passou')

    const app = await rpcComoEmSavepoint(
      CASHIER,
      `select * from public.registrar_venda_completa(
        '${itens}'::jsonb, 'canal-app-teste', null, '${tipoApp}', '${pix}',
        'Concluída', '#CANAL2', null, 3, 'iFood', 'EXT-42', 10, 1.5, null
      )`,
    )
    const linhaApp = app.linhas[0] ?? {}
    if (
      !app.erro &&
      linhaApp.tipo_venda === 'Aplicativo' &&
      Number(linhaApp.total_cobrado) === 34.46 &&
      Number(linhaApp.comissao_estimada) === 3.45 &&
      Number(linhaApp.valor_liquido_estimado) === 29.51
    ) ok('aplicativo calcula total, comissão e líquido estimado')
    else podeFalhar('aplicativo e taxas', app.erro?.message ?? JSON.stringify(linhaApp))

    const appSemPlataforma = await rpcComoEmSavepoint(
      CASHIER,
      `select * from public.registrar_venda_completa(
        '${itens}'::jsonb, 'canal-app-sem-plataforma', null, '${tipoApp}', '${pix}',
        'Concluída', '#CANAL5', null, 0, null, null, 0, 0, null
      )`,
    )
    if (appSemPlataforma.erro && /aplicativo da venda/i.test(appSemPlataforma.erro.message)) {
      ok('venda por aplicativo sem plataforma é recusada')
    } else podeFalhar('validação de plataforma', appSemPlataforma.erro?.message ?? 'venda sem plataforma passou')

    const semPermissao = await escreveComo(
      CASHIER,
      `update public.tipos_venda set nome = 'Alteração não autorizada' where id = '${tipoDelivery}'`,
    )
    if (!semPermissao.erro && semPermissao.afetados === 0) {
      ok('operador não pode alterar os cadastros de venda')
    } else podeFalhar('permissão do catálogo', semPermissao.erro?.message ?? `${semPermissao.afetados} linhas alteradas`)

    await db.exec('rollback')
  }

  const venda = (await venderP4('p4-teste-1', [{ produto_id: ss1, peso_bruto_g: 480, tara_g: 30 }], '#P4EST1')).linhas[0]
  const movOriginal = await um(`select * from public.movimentacoes_estoque where venda_id = '${venda.id}'`)

  if (Number(venda.total) === 31.46 && (await saldoDe('SS1')) === saldoAntes - 0.45) {
    ok(`venda de 450 g tirada do estoque (${saldoAntes} -> ${await saldoDe('SS1')} kg)`)
  } else {
    podeFalhar('venda antes do estorno', `${venda.total} / ${await saldoDe('SS1')} kg`)
  }

  /* --------------------------------------------------------- o estorno ---- */
  // Quem estorna é o gerente: `vendas.editar` é dele, não do caixa.
  const r = await estornar(MANAGER, venda.id, 'Cliente desistiu da compra')
  const e = r.linhas[0] ?? {}

  if (r.erro) podeFalhar('estorno', r.erro.message)
  else if (e.status === 'Cancelada' && e.ja_estornada === false && e.movimentos === 1) {
    ok('o pedido foi cancelado e devolveu 1 movimento')
  } else {
    podeFalhar('resultado do estorno', JSON.stringify(e))
  }

  if ((await saldoDe('SS1')) === saldoAntes) ok(`e o estoque voltou (${await saldoDe('SS1')} kg)`)
  else podeFalhar('estoque depois do estorno', await saldoDe('SS1'))

  const inverso = await um(
    `select * from public.movimentacoes_estoque where venda_id = '${venda.id}' and estorno_de_id is not null`,
  )
  const inversoOk =
    inverso &&
    inverso.origem === 'cliente' &&
    inverso.destino === 'estoque' &&
    Number(inverso.quantidade) === 0.45 &&
    inverso.estorno_de_id === movOriginal.id &&
    inverso.usuario_id === MANAGER &&
    /Estorno #P4EST1/.test(inverso.motivo) &&
    /Cliente desistiu/.test(inverso.motivo)

  if (inversoOk) ok('o inverso é cliente -> estoque, com autor, motivo e vínculo com o original')
  else podeFalhar('movimento inverso', JSON.stringify(inverso))

  const cache = await um(
    `select quantidade, public.saldo_estoque(id) as do_livro from public.produtos where id = '${ss1}'`,
  )
  if (Number(cache.quantidade) === Number(cache.do_livro)) ok('o cache do produto voltou a bater com o livro-razão')
  else podeFalhar('cache x livro', JSON.stringify(cache))

  const vendaDepois = await um(
    `select status, estornada_em, estornada_por from public.vendas where id = '${venda.id}'`,
  )
  if (vendaDepois.status === 'Cancelada' && vendaDepois.estornada_em && vendaDepois.estornada_por === MANAGER) {
    ok('a venda guarda que foi estornada, por quem e quando')
  } else {
    podeFalhar('rastro na venda', JSON.stringify(vendaDepois))
  }

  const avisos = await contar(
    `select count(*)::int as n from public.notifications where tipo = 'venda_estornada'`,
  )
  const aviso = await um(
    `select titulo, mensagem, link, recipient_role from public.notifications where tipo = 'venda_estornada' order by criado_em desc limit 1`,
  )
  if (avisos === 1 && aviso?.recipient_role === 'admin' && /P4EST1/.test(aviso.mensagem)) {
    ok('quem administra é avisado UMA vez (sem duplicidade)')
  } else {
    podeFalhar('notificação do estorno', `${avisos} — ${JSON.stringify(aviso)}`)
  }

  /* ------------------------------------------------ não devolve duas vezes -- */
  const r2 = await estornar(MANAGER, venda.id, 'Cliente desistiu da compra')
  const e2 = r2.linhas[0] ?? {}
  if (!r2.erro && e2.ja_estornada === true && e2.movimentos === 0) {
    ok('estornar de novo devolve o mesmo resultado, sem novo movimento')
  } else {
    podeFalhar('segundo estorno', r2.erro?.message ?? JSON.stringify(e2))
  }

  if ((await saldoDe('SS1')) === saldoAntes) ok('e o estoque continua devolvido UMA vez só')
  else podeFalhar('estoque devolvido duas vezes', await saldoDe('SS1'))

  // A garantia não é só da função: o índice único recusa um segundo inverso do
  // MESMO movimento mesmo escrito na mão, direto na tabela.
  await deveFalhar(
    'um movimento não se estorna duas vezes (índice único no banco)',
    `insert into public.movimentacoes_estoque
       (organization_id, produto_id, quantidade, origem, destino, motivo, venda_id, usuario_id, estorno_de_id)
     values ('${ORG}', '${ss1}', 0.45, 'cliente', 'estoque', 'na mão', '${venda.id}', '${MANAGER}', '${movOriginal.id}')`,
    'mov_estoque_estorno_unico',
  )

  /* ------------------------------------------------------------ as recusas -- */
  const venda2 = (await venderP4('p4-teste-2', [{ produto_id: ss1, peso_bruto_g: 1000, tara_g: 0 }], '#P4EST2')).linhas[0]

  await recusa(
    'o caixa não estorna (vendas.editar é de quem altera pedido)',
    CASHIER,
    venda2.id,
    'tentativa do caixa',
    'não tem permissão para estornar',
  )
  await recusa('motivo em branco é recusado', MANAGER, venda2.id, '', 'Informe o motivo do estorno')
  await recusa('motivo nulo é recusado', MANAGER, venda2.id, null, 'Informe o motivo do estorno')
  await recusa(
    'pedido inexistente é recusado',
    MANAGER,
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'x',
    'Pedido não encontrado',
  )

  // Estorno pelo administrador (a outra permissão que autoriza) e o rastro do
  // caixa continua valendo: a venda2 volta a devolver o estoque.
  const saldo2Antes = await saldoDe('SS1')
  const r3 = await estornar(ADMIN, venda2.id, 'Pedido lançado em duplicidade')
  const e3 = r3.linhas[0] ?? {}
  if (!r3.erro && e3.status === 'Cancelada' && e3.movimentos === 1 && (await saldoDe('SS1')) === saldo2Antes + 1) {
    ok('o administrador também estorna: 1,000 kg devolvido')
  } else {
    podeFalhar('estorno pelo administrador', r3.erro?.message ?? JSON.stringify(e3))
  }

  /* ---------------------------------------- venda que nasceu cancelada ---- */
  const venda3 = (
    await rpcComo(
      CASHIER,
      `select * from public.registrar_venda('[{"produto_id":"${ss1}","peso_bruto_g":1000,"tara_g":0}]'::jsonb, 'p4-teste-3', null, 'Pix', 'Cancelada', '#P4EST3')`,
    )
  ).linhas[0]
  await recusa('venda que nasceu cancelada não tem o que estornar', MANAGER, venda3.id, 'x', 'já está cancelado')
}

log('\n== Mesmo nome depois de desativar: pode ==')
await devePassar(
  'desativar "Copo 500ml com tampa" e cadastrar outro com o mesmo nome',
  `update public.recipientes set ativo = false where nome = 'Copo 500ml com tampa';
   insert into public.recipientes (organization_id, nome, tara_g) values ('${ORG}','Copo 500ml com tampa',20)`,
)

log('\n== O seed da 00 se recusa a apagar uma base com dados ==')
{
  const antes = await contar(`select count(*)::int as n from public.vendas`)
  let abortou = null
  try {
    await db.exec('begin')
    await db.exec(dispensarPgcrypto(readFileSync(join(PASTA, '00_banco_neon.sql'), 'utf8')))
    await db.exec('commit')
  } catch (e) {
    abortou = e.message
    await db.exec('rollback').catch(() => {})
  }
  const depois = await contar(`select count(*)::int as n from public.vendas`)
  if (abortou && /Seed abortado/.test(abortou)) ok('rodar a 00 de novo aborta o seed', abortou.slice(0, 58))
  else podeFalhar('rodar a 00 de novo aborta o seed', abortou ?? 'não abortou: o seed apagaria os dados')
  if (depois === antes) ok('e as vendas continuam todas lá', `${depois} vendas`)
  else podeFalhar('e as vendas continuam todas lá', `${depois} vendas (antes ${antes})`)
}

log('\n== Reversão ==')
for (const arquivo of readdirSync(PASTA)
  .filter((nome) => /^reverter_.*\.sql$/i.test(nome))
  .sort()
  .reverse()) {
  try {
    await db.exec('begin')
    await db.exec(readFileSync(join(PASTA, arquivo), 'utf8'))
    await db.exec('commit')
    log(`  ok    ${arquivo}`)
  } catch (e) {
    await db.exec('rollback').catch(() => {})
    podeFalhar(arquivo, e.message)
  }
}
{
  const sobrou = await contar(
    `select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='produtos'
        and column_name in ('descricao','tipo_venda','controla_estoque','metodo_estoque','metodo_peso')`,
  )
  const tabelas = await um(
    `select to_regclass('public.recipientes') as a,
            to_regclass('public.recipientes_historico') as b,
            to_regclass('public.movimentacoes_estoque') as c,
            to_regclass('public.imagens_produtos') as d`,
  )
  const sobraFuncao = await contar(
    `select count(*)::int as n from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('saldo_estoque', 'registrar_movimentacao', 'ajustar_saldo',
                        'registrar_venda', 'numero_do_item', 'inteiro_do_item',
                        'proximo_codigo_venda', 'estornar_venda')`,
  )
  const colunasVenda = await contar(
    `select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='itens_venda'
        and column_name in ('total','metodo_peso','peso_bruto_g','tara_g','peso_liquido_g','recipiente_id')`,
  )
  const colunasVendaTabela = await contar(
    `select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='vendas'
        and column_name in ('chave_idempotencia','usuario_id','estornada_em','estornada_por')`,
  )
  const sequencia = await um(`select to_regclass('public.vendas_codigo_seq') as seq`)
  const gatilhos = await contar(
    `select count(*)::int as n from pg_trigger
      where tgrelid = 'public.produtos'::regclass and not tgisinternal`,
  )
  const imagemRpc = await contar(
    `select count(*)::int as n from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname = 'salvar_produto_com_imagem'`,
  )

  if (
    sobrou === 0 &&
    !tabelas.a && !tabelas.b && !tabelas.c &&
    Boolean(tabelas.d) &&
    imagemRpc === 0 &&
    sobraFuncao === 0 &&
    gatilhos === 0 &&
    colunasVenda === 0 &&
    colunasVendaTabela === 0 &&
    !sequencia.seq
  ) {
    ok('os reverters removeram a RPC e preservaram a tabela de imagens para evitar perda de arquivos')
  } else {
    podeFalhar(
      'reversão incompleta',
      `colunas ${sobrou}, tabelas ${JSON.stringify(tabelas)}, RPC imagem ${imagemRpc}, funções ${sobraFuncao}, gatilhos ${gatilhos}, ` +
        `colunas de item ${colunasVenda}, colunas de venda ${colunasVendaTabela}, sequência ${sequencia.seq}`,
    )
  }
}

log('')
log(falhas === 0 ? '== TUDO OK ==' : `== ${falhas} FALHA(S) ==`)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
