/**
 * Verificação da venda transacional (migrações 08, 09, 10 e 11) contra a base REAL.
 *
 * Uso:
 *   node neon/verificar-vendas.mjs
 *
 * Precisa do `DATABASE_URL` no `.env` (a mesma string que o `aplicar.mjs` usa).
 *
 * Por que existe: o `npm run validar:migracoes` prova a regra num Postgres em
 * memória; este prova que a venda está de pé NA PRODUÇÃO — com o cadastro de
 * verdade (o self-service a R$ 69,90/kg), com o livro-razão de verdade e com os
 * perfis de verdade (o caixa que vende, quem tem `vendas.editar` que estorna, e
 * o perfil sem permissão que não estorna).
 *
 * NADA é gravado:
 *   • tudo acontece dentro de uma transação que termina em ROLLBACK;
 *   • toda venda de teste usa código próprio (`#VERIF-P3-…`) em vez de deixar o
 *     banco numerar — `nextval` NÃO volta atrás no rollback, e não se gasta
 *     número de pedido de verdade à toa;
 *   • depois do rollback, uma conexão nova confere que as contagens e o saldo
 *     do produto voltaram ao que eram antes.
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
const brl = (v) => `R$ ${n(v).toFixed(2).replace('.', ',')}`

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

/** Vira o usuário indicado (precisa estar dentro de uma transação). */
async function como(c, uid, fn) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated' }),
  ])
  return fn()
}

/**
 * Tenta algo que deve falhar. Usa SAVEPOINT (e não `begin`/`rollback`) porque a
 * verificação inteira vive dentro de uma transação — um `rollback` aqui
 * desfaria tudo o que já foi medido, e um `begin` aninhado só produz aviso.
 */
async function tentarFalha(c, uid, sql, params) {
  await c.query('savepoint tentativa')
  try {
    if (uid) await como(c, uid, () => c.query(sql, params))
    else await c.query(sql, params)
    await c.query('release savepoint tentativa')
    return null
  } catch (e) {
    await c.query('rollback to savepoint tentativa')
    return e.message
  }
}

const venda = (c, uid, itens, chave, codigo, extra = {}) =>
  como(c, uid, () =>
    um(
      c,
      `select * from public.registrar_venda(
         $1::jsonb, $2, $3::uuid, $4, $5, $6
       )`,
      [
        JSON.stringify(itens),
        chave,
        extra.clienteId ?? null,
        extra.pagamento ?? 'Pix',
        extra.status ?? 'Concluída',
        codigo,
      ],
    ),
  )

/** Roda uma seção numa transação desfeita no fim, sem deixar um erro
 *  inesperado derrubar o resto da verificação. */
async function secao(nome, corpo) {
  await c.query('begin')
  try {
    await corpo()
  } catch (e) {
    falhas++
    console.log(`  FALHA ${nome} — exceção: ${String(e.message).slice(0, 120)}`)
  } finally {
    await c.query('rollback')
  }
}

/* ------------------------------------------------------------------ dados -- */

const c = await abrir()

const admin = (await um(c, `select id from public.profiles where role = 'admin' order by created_at limit 1`))?.id
const perfis = (await c.query(`select id, role, full_name from public.profiles order by created_at`)).rows

const selfService = await um(
  c,
  `select id, codigo, nome, preco, metodo_peso
     from public.produtos
    where ativo and tipo_venda = 'peso'
    order by codigo
    limit 1`,
)

const porUnidade = await um(
  c,
  `select p.id, p.codigo, p.nome, p.preco, p.unidade
     from public.produtos p
    where p.ativo and p.tipo_venda = 'unidade'
      and p.controla_estoque and p.metodo_estoque = 'movimentacoes'
    order by p.codigo
    limit 1`,
)

console.log(`\nVerificando a venda transacional na base real: ${url().split('@')[1]?.split('/')[0] ?? ''}`)

/* --------------------------------------------------------- estado inicial -- */

titulo('Estado inicial (o que a verificação promete devolver intacto)')

const antes = {
  vendas: n((await um(c, `select count(*)::int as n from public.vendas`)).n),
  itens: n((await um(c, `select count(*)::int as n from public.itens_venda`)).n),
  movimentos: n((await um(c, `select count(*)::int as n from public.movimentacoes_estoque`)).n),
  saldoSelfService: selfService ? n((await um(c, `select public.saldo_estoque($1) as s`, [selfService.id])).s) : null,
}
console.log(
  `  vendas=${antes.vendas}  itens=${antes.itens}  movimentos=${antes.movimentos}` +
    (selfService ? `  saldo(${selfService.codigo})=${antes.saldoSelfService} kg` : ''),
)

if (!admin) {
  console.log('\n  Não há perfil admin na base: não dá para simular a sessão. Abortando.\n')
  process.exit(1)
}

/*
 * O código é escolhido por nós de propósito: `nextval` não volta no rollback.
 * A sequência de verdade é CONFERIDA logo abaixo, sem consumir nada.
 */
const seq = await um(c, `select last_value, is_called from public.vendas_codigo_seq`)
const maiorCodigo = n(
  (
    await um(
      c,
      `select max(nullif(regexp_replace(codigo, '\\D', '', 'g'), '')::bigint) as m from public.vendas`,
    )
  ).m,
)
ok(
  'a sequência do pedido está no lugar (e adiante do maior código)',
  n(seq.last_value) >= maiorCodigo,
  `sequência=${seq.last_value} (is_called=${seq.is_called}) · maior código da base=#${maiorCodigo}`,
)

/* ------------------------------------------------------------- a venda --- */

titulo('A venda por peso: 480 g brutos − 30 g de tara = 450 g')

if (!selfService) {
  console.log('  (não há produto por peso ativo nesta base — seção pulada)')
} else {
  await secao('venda por peso', async () => {
    // Quem dá entrada no estoque é quem pode (`estoque.criar`); quem vende é o
    // caixa. São permissões diferentes — e é bom que o teste use as duas.
    const uidEstoque = admin
    const uid = perfis.find((p) => p.role === 'cashier')?.id ?? admin

    // A entrada é feita na mesma transação: a venda precisa de saldo para sair.
    await como(c, uidEstoque, () =>
      um(c, `select * from public.registrar_movimentacao($1, 5, 'fornecedor', 'estoque', $2)`, [
        selfService.id,
        'Verificação P3: entrada para a venda de teste',
      ]),
    )

    const v1 = await venda(
      c,
      uid,
      [
        {
          produto_id: selfService.id,
          metodo_peso: 'bruto_tara',
          peso_bruto_g: 480,
          tara_g: 30,
        },
      ],
      'verif-p3-1',
      '#VERIF-P3-1',
    )

    ok(
      `450 g × ${brl(selfService.preco)}/kg = ${brl(31.46)}`,
      n(v1.total) === 31.46,
      `total devolvido = ${brl(v1.total)}`,
    )

    const item = await como(c, uid, () =>
      um(
        c,
        `select i.id, i.descricao, i.quantidade, i.preco_unitario, i.total,
                i.peso_bruto_g, i.tara_g, i.peso_liquido_g, i.metodo_peso, i.produto_id
           from public.itens_venda i
          where i.venda_id = $1`,
        [v1.id],
      ),
    )

    ok('o item guarda o peso bruto lido', n(item.peso_bruto_g) === 480, `${item.peso_bruto_g} g`)
    ok('o item guarda a tara aplicada', n(item.tara_g) === 30, `${item.tara_g} g`)
    ok('o item guarda o líquido que o cliente pagou', n(item.peso_liquido_g) === 450, `${item.peso_liquido_g} g`)
    ok(
      'a quantidade do item É o líquido em quilos',
      n(item.quantidade) === 0.45,
      `${item.quantidade} kg`,
    )
    ok(
      'a venda guardou a cópia do preço do cadastro',
      n(item.preco_unitario) === n(selfService.preco),
      `${brl(item.preco_unitario)}/kg (cadastro: ${brl(selfService.preco)}/kg)`,
    )
    ok(
      'o total da linha é o total do pedido (2 casas)',
      n(item.total) === 31.46 && n(v1.total) === 31.46,
      `linha ${brl(item.total)} · pedido ${brl(v1.total)}`,
    )
    ok('o item aponta para o produto e copiou a descrição', item.produto_id === selfService.id, item.descricao)

    const mov = await como(c, uid, () =>
      um(
        c,
        `select m.origem, m.destino, m.quantidade, m.motivo, m.usuario_id, m.item_venda_id
           from public.movimentacoes_estoque m
          where m.item_venda_id = $1`,
        [item.id],
      ),
    )
    ok(
      'o estoque baixou: estoque → cliente, com autor e vínculo com a linha',
      mov?.origem === 'estoque' && mov?.destino === 'cliente' && n(mov?.quantidade) === 0.45,
      `${mov?.origem} → ${mov?.destino} · ${mov?.quantidade} kg · autor ${String(mov?.usuario_id).slice(0, 8)}`,
    )
    ok('o movimento aponta para a linha da venda', mov?.item_venda_id === item.id)
    ok('a venda registrou quantos itens baixaram', n(v1.movimentos) === 1, `${v1.movimentos} movimento(s)`)

    const saldo = n((await como(c, uid, () => um(c, `select public.saldo_estoque($1) as s`, [selfService.id]))).s)
    ok(
      'o saldo derivado do livro-razão bate: 5 − 0,450 = 4,550 kg',
      Math.abs(saldo - 4.55) < 1e-9,
      `saldo = ${saldo} kg`,
    )

    /* ------------------------------------------------------- idempotência -- */

    const v2 = await venda(
      c,
      uid,
      [{ produto_id: selfService.id, metodo_peso: 'bruto_tara', peso_bruto_g: 480, tara_g: 30 }],
      'verif-p3-1',
      '#VERIF-P3-1B',
    )
    ok(
      'repetir a MESMA chave devolve a mesma venda',
      v2.id === v1.id && v2.ja_existia === true,
      `ja_existia=${v2.ja_existia}`,
    )

    const movimentosAgora = n(
      (
        await como(c, uid, () =>
          um(c, `select count(*)::int as n from public.movimentacoes_estoque where item_venda_id = $1`, [item.id]),
        )
      ).n,
    )
    const saldo2 = n((await como(c, uid, () => um(c, `select public.saldo_estoque($1) as s`, [selfService.id]))).s)
    ok('e não baixou o estoque de novo', movimentosAgora === 1 && saldo2 === saldo, `movimentos=${movimentosAgora} saldo=${saldo2}`)

    const v3 = await venda(
      c,
      uid,
      [{ produto_id: selfService.id, metodo_peso: 'bruto_tara', peso_bruto_g: 480, tara_g: 30 }],
      'verif-p3-2',
      '#VERIF-P3-2',
    )
    ok('chave NOVA é venda nova (duas compras iguais = dois pedidos)', v3.id !== v1.id && v3.ja_existia === false)

    /* -------------------------------------------- o preço não vem da tela -- */

    const v4 = await venda(
      c,
      uid,
      [
        {
          produto_id: selfService.id,
          metodo_peso: 'bruto_tara',
          peso_bruto_g: 480,
          tara_g: 30,
          // Lixo de propósito: preço e quantidade mandados pelo navegador não valem.
          preco_unitario: 1,
          quantidade: 99,
          total: 0,
        },
      ],
      'verif-p3-3',
      '#VERIF-P3-3',
    )
    const item4 = await como(c, uid, () =>
      um(c, `select quantidade, preco_unitario, total from public.itens_venda where venda_id = $1`, [v4.id]),
    )
    ok(
      'preço e quantidade mandados pelo navegador são ignorados',
      n(v4.total) === 31.46 && n(item4.quantidade) === 0.45 && n(item4.preco_unitario) === n(selfService.preco),
      `total=${brl(v4.total)} quantidade=${item4.quantidade} preço=${brl(item4.preco_unitario)}`,
    )

    /* ------------------------------------------------------------ recusas -- */

    const semPeso = await tentarFalha(
      c,
      uid,
      `select * from public.registrar_venda($1::jsonb, $2, null, 'Pix', 'Concluída', $3)`,
      [JSON.stringify([{ produto_id: selfService.id, metodo_peso: 'bruto_tara', tara_g: 30 }]), 'verif-p3-recusa-1', '#VERIF-P3-R1'],
    )
    ok('peso por peso sem o peso bruto é recusado', /peso bruto/i.test(semPeso ?? ''), String(semPeso).slice(0, 70))

    const taraMaior = await tentarFalha(
      c,
      uid,
      `select * from public.registrar_venda($1::jsonb, $2, null, 'Pix', 'Concluída', $3)`,
      [
        JSON.stringify([{ produto_id: selfService.id, metodo_peso: 'bruto_tara', peso_bruto_g: 20, tara_g: 30 }]),
        'verif-p3-recusa-2',
        '#VERIF-P3-R2',
      ],
    )
    ok('tara maior que o bruto é recusada', /tara/i.test(taraMaior ?? ''), String(taraMaior).slice(0, 70))

    const balanca = await tentarFalha(
      c,
      uid,
      `select * from public.registrar_venda($1::jsonb, $2, null, 'Pix', 'Concluída', $3)`,
      [
        JSON.stringify([{ produto_id: selfService.id, metodo_peso: 'balanca', peso_liquido_g: 450 }]),
        'verif-p3-recusa-3',
        '#VERIF-P3-R3',
      ],
    )
    ok('balança integrada é recusada com aviso claro', /balan/i.test(balanca ?? ''), String(balanca).slice(0, 70))

    const pedidoRepetido = await tentarFalha(
      c,
      uid,
      `select * from public.registrar_venda($1::jsonb, $2, null, 'Pix', 'Concluída', $3)`,
      [
        JSON.stringify([{ produto_id: selfService.id, metodo_peso: 'liquido', peso_liquido_g: 450 }]),
        'verif-p3-recusa-4',
        '#VERIF-P3-1', // já usado acima
      ],
    )
    ok('código de pedido repetido é recusado', /já existe/i.test(pedidoRepetido ?? ''), String(pedidoRepetido).slice(0, 70))

    const semEstoque = await tentarFalha(
      c,
      uid,
      `select * from public.registrar_venda($1::jsonb, $2, null, 'Pix', 'Concluída', $3)`,
      [
        JSON.stringify([{ produto_id: selfService.id, metodo_peso: 'liquido', peso_liquido_g: 900000 }]),
        'verif-p3-recusa-5',
        '#VERIF-P3-R5',
      ],
    )
    ok('peso acima do saldo derruba a venda inteira', /saldo/i.test(semEstoque ?? ''), String(semEstoque).slice(0, 80))

    /* ---------------------------------- o peso já líquido não desconta tara -- */

    const v5 = await venda(
      c,
      uid,
      [{ produto_id: selfService.id, metodo_peso: 'liquido', peso_liquido_g: 450 }],
      'verif-p3-4',
      '#VERIF-P3-4',
    )
    const item5 = await como(c, uid, () =>
      um(c, `select peso_bruto_g, tara_g, peso_liquido_g, quantidade, total from public.itens_venda where venda_id = $1`, [v5.id]),
    )
    ok(
      'peso já líquido: bruto e tara ficam nulos e o total é o mesmo',
      item5.peso_bruto_g === null &&
        item5.tara_g === null &&
        n(item5.peso_liquido_g) === 450 &&
        n(v5.total) === 31.46,
      `bruto=${item5.peso_bruto_g} tara=${item5.tara_g} total=${brl(v5.total)}`,
    )

    /* ------------------------------------------------------ cancelada ------- */

    const v6 = await venda(
      c,
      uid,
      [{ produto_id: selfService.id, metodo_peso: 'liquido', peso_liquido_g: 450 }],
      'verif-p3-5',
      '#VERIF-P3-5',
      { status: 'Cancelada' },
    )
    const mov6 = n(
      (
        await como(c, uid, () =>
          um(c, `select count(*)::int as n from public.movimentacoes_estoque where item_venda_id in
                  (select id from public.itens_venda where venda_id = $1)`, [v6.id]),
        )
      ).n,
    )
    ok('venda cancelada entra no histórico SEM baixar estoque', n(v6.total) === 31.46 && mov6 === 0, `movimentos=${mov6}`)
  })

  /* ----------------------------------------------------------- unidade ---- */

  titulo('A venda por unidade continua igual')

  if (!porUnidade) {
    console.log('  (não há produto por unidade com estoque por movimentação — seção pulada)')
  } else {
      await secao('venda por unidade', async () => {
        const uidEstoque = admin
        const uid = perfis.find((p) => p.role === 'cashier')?.id ?? admin

        await como(c, uidEstoque, () =>
          um(c, `select * from public.registrar_movimentacao($1, 10, 'fornecedor', 'estoque', $2)`, [
            porUnidade.id,
            'Verificação P3: entrada para a venda por unidade',
          ]),
        )

        const antesUn = n((await como(c, uid, () => um(c, `select public.saldo_estoque($1) as s`, [porUnidade.id]))).s)

        const v = await venda(c, uid, [{ produto_id: porUnidade.id, quantidade: 3 }], 'verif-p3-unid', '#VERIF-P3-U1')

        const item = await como(c, uid, () =>
          um(c, `select quantidade, preco_unitario, total, peso_bruto_g from public.itens_venda where venda_id = $1`, [v.id]),
        )
        const depoisUn = n((await como(c, uid, () => um(c, `select public.saldo_estoque($1) as s`, [porUnidade.id]))).s)

        ok(
          `3 × ${brl(porUnidade.preco)} = ${brl(n(porUnidade.preco) * 3)}`,
          n(v.total) === Number((n(porUnidade.preco) * 3).toFixed(2)),
          `total = ${brl(v.total)}`,
        )
        ok('a linha por unidade não tem peso nenhum', item.peso_bruto_g === null && n(item.quantidade) === 3)
        ok(
          `e baixou 3 ${porUnidade.unidade} do estoque`,
          Math.abs(antesUn - depoisUn - 3) < 1e-9,
          `${antesUn} → ${depoisUn} ${porUnidade.unidade}`,
        )
      })
  }
}

/* ---------------------------------------------------------------- estorno -- */

titulo('O estorno: devolve o estoque, deixa o rastro e não devolve duas vezes')

if (!selfService) {
  console.log('  (não há produto por peso ativo nesta base — seção pulada)')
} else {
  await secao('estorno', async () => {
    const uidEstoque = admin
    const uidVenda = perfis.find((p) => p.role === 'cashier')?.id ?? admin

    // Quem estorna é quem tem `vendas.editar` no banco — a permissão, não o papel.
    const podemEstornar = []
    for (const p of perfis) {
      const temPoder = (await como(c, p.id, () => um(c, `select public.pode('vendas','editar') as p`))).p
      if (temPoder) podemEstornar.push(p.id)
    }
    const uidEstorno = podemEstornar[0]
    const semPermissao = perfis.find((p) => !podemEstornar.includes(p.id))

    ok(
      'há quem possa estornar (vendas.editar)',
      Boolean(uidEstorno),
      perfis
        .filter((p) => podemEstornar.includes(p.id))
        .map((p) => `${p.full_name ?? p.role} (${p.role})`)
        .join(', '),
    )

    if (!uidEstorno) return

    // Entrada de estoque, venda e estorno — tudo na mesma transação desfeita.
    await como(c, uidEstoque, () =>
      um(c, `select * from public.registrar_movimentacao($1, 10, 'fornecedor', 'estoque', $2)`, [
        selfService.id,
        'Verificação P4: entrada para o estorno',
      ]),
    )

    const saldoAntes = n(
      (await como(c, uidEstoque, () => um(c, `select public.saldo_estoque($1) as s`, [selfService.id]))).s,
    )

    const v = await venda(
      c,
      uidVenda,
      [{ produto_id: selfService.id, peso_bruto_g: 480, tara_g: 30 }],
      'verif-p4-venda',
      '#VERIF-P4-E1',
    )

    const movOriginal = await um(
      c,
      `select id from public.movimentacoes_estoque where venda_id = $1 and estorno_de_id is null`,
      [v.id],
    )
    const saldoDepoisDaVenda = n(
      (await como(c, uidEstoque, () => um(c, `select public.saldo_estoque($1) as s`, [selfService.id]))).s,
    )

    ok(
      'a venda tirou 0,450 kg do estoque',
      Math.abs(saldoAntes - saldoDepoisDaVenda - 0.45) < 1e-9,
      `${saldoAntes} → ${saldoDepoisDaVenda} kg`,
    )

    const e = await como(c, uidEstorno, () =>
      um(c, `select * from public.estornar_venda($1, $2)`, [v.id, 'Verificação P4: cliente desistiu']),
    )

    ok(
      'o estorno cancela o pedido e devolve os movimentos',
      e.status === 'Cancelada' && e.ja_estornada === false && n(e.movimentos) === 1,
      `status=${e.status} movimentos=${e.movimentos}`,
    )

    const saldoDepoisDoEstorno = n(
      (await como(c, uidEstoque, () => um(c, `select public.saldo_estoque($1) as s`, [selfService.id]))).s,
    )
    ok(
      'e o estoque volta ao que era',
      Math.abs(saldoDepoisDoEstorno - saldoAntes) < 1e-9,
      `${saldoDepoisDaVenda} → ${saldoDepoisDoEstorno} kg`,
    )

    const inverso = await um(
      c,
      `select origem, destino, quantidade, estorno_de_id, usuario_id, motivo
         from public.movimentacoes_estoque
        where venda_id = $1 and estorno_de_id is not null`,
      [v.id],
    )
    ok(
      'o inverso é cliente → estoque, ligado ao movimento original',
      inverso?.origem === 'cliente' &&
        inverso?.destino === 'estoque' &&
        Math.abs(n(inverso?.quantidade) - 0.45) < 1e-9 &&
        inverso?.estorno_de_id === movOriginal.id &&
        inverso?.usuario_id === uidEstorno &&
        /Estorno #VERIF-P4-E1/.test(inverso?.motivo ?? ''),
      `${inverso?.origem} → ${inverso?.destino} · ${n(inverso?.quantidade)} kg · motivo com o pedido`,
    )

    const rastro = await um(
      c,
      `select status, estornada_em, estornada_por from public.vendas where id = $1`,
      [v.id],
    )
    ok(
      'a venda guarda que foi estornada, por quem e quando',
      rastro.status === 'Cancelada' && Boolean(rastro.estornada_em) && rastro.estornada_por === uidEstorno,
    )

    const deNovo = await como(c, uidEstorno, () =>
      um(c, `select * from public.estornar_venda($1, $2)`, [v.id, 'Verificação P4: repetido']),
    )
    const saldoAposRepetir = n(
      (await como(c, uidEstoque, () => um(c, `select public.saldo_estoque($1) as s`, [selfService.id]))).s,
    )
    ok(
      'repetir o estorno não devolve estoque de novo',
      deNovo.ja_estornada === true &&
        n(deNovo.movimentos) === 0 &&
        Math.abs(saldoAposRepetir - saldoAntes) < 1e-9,
      `ja_estornada=${deNovo.ja_estornada} · saldo=${saldoAposRepetir} kg`,
    )

    if (semPermissao) {
      const erro = await tentarFalha(c, semPermissao.id, `select * from public.estornar_venda($1, $2)`, [
        v.id,
        'tentativa sem permissão',
      ])
      ok(
        `sem vendas.editar o banco recusa o estorno (${semPermissao.full_name ?? semPermissao.role})`,
        /permiss/i.test(erro ?? ''),
        String(erro).slice(0, 70),
      )
    } else {
      console.log('  (todos os perfis desta base podem estornar — a recusa por permissão não foi exercitada)')
    }

    // Numa venda NOVA (ainda não estornada), o motivo em branco é recusado.
    const v2 = await venda(
      c,
      uidVenda,
      [{ produto_id: selfService.id, peso_bruto_g: 500, tara_g: 0 }],
      'verif-p4-venda2',
      '#VERIF-P4-E2',
    )
    const semMotivo = await tentarFalha(c, uidEstorno, `select * from public.estornar_venda($1, $2)`, [
      v2.id,
      '   ',
    ])
    ok('motivo em branco é recusado no estorno', /motivo/i.test(semMotivo ?? ''), String(semMotivo).slice(0, 60))
  })
}

/* ----------------------------------------------------------- permissões --- */

titulo('Permissão: quem vende e quem não vende')

await secao('permissões', async () => {
  const avaliacoes = []

  for (const p of perfis) {
    const pode = (await como(c, p.id, () => um(c, `select public.pode('vendas','criar') as p`))).p
    avaliacoes.push({ perfil: p, pode })
  }

  const quemPode = avaliacoes
    .filter((a) => a.pode)
    .map((a) => `${a.perfil.full_name ?? a.perfil.id} (${a.perfil.role})`)
  const quemNao = avaliacoes.filter((a) => !a.pode)

  ok('há ao menos um perfil autorizado a vender', quemPode.length > 0, quemPode.join(', '))

  if (quemNao.length === 0) {
    console.log('  (todos os perfis desta base podem vender — a recusa por permissão não foi exercitada)')
  } else {
    const alvo = quemNao[0].perfil
    const erro = await tentarFalha(
      c,
      alvo.id,
      `select * from public.registrar_venda($1::jsonb, $2, null, 'Pix', 'Concluída', $3)`,
      [
        JSON.stringify([{ produto_id: (selfService ?? porUnidade).id, quantidade: 1 }]),
        'verif-p3-sem-permissao',
        '#VERIF-P3-SP',
      ],
    )
    ok(
      `sem permissão de vender, a RPC recusa (${alvo.full_name ?? alvo.role})`,
      /permiss/i.test(erro ?? ''),
      String(erro).slice(0, 80),
    )
  }

  // O caixa LÊ as vendas (é o que o dashboard faz).
  const caixa = perfis.find((p) => p.role === 'cashier') ?? perfis[0]
  const lidas = n((await como(c, caixa.id, () => um(c, `select count(*)::int as n from public.vendas`))).n)
  ok(`o perfil ${caixa.role} lê as vendas (dashboard)`, lidas > 0, `${lidas} venda(s) visíveis`)
})

/* ------------------------------------------------- a porta única (09) ----- */

titulo('A porta única: escrita direta negada, RPC liberada')

await secao('porta única', async () => {
  const uid = perfis.find((p) => p.role === 'cashier')?.id ?? admin

  const insert = await tentarFalha(
    c,
    uid,
    `insert into public.vendas (codigo, status, pagamento, total) values ('#VERIF-P3-DIRETO', 'Concluída', 'Pix', 1)`,
  )
  ok('INSERT direto em vendas é negado', /permission denied/i.test(insert ?? ''), String(insert).slice(0, 60))

  const update = await tentarFalha(c, uid, `update public.vendas set status = 'Cancelada' where codigo = '#9332'`)
  ok('UPDATE direto em vendas é negado', /permission denied/i.test(update ?? ''), String(update).slice(0, 60))

  const del = await tentarFalha(c, uid, `delete from public.itens_venda where venda_id is null`)
  ok('DELETE direto em itens_venda é negado', /permission denied/i.test(del ?? ''), String(del).slice(0, 60))

  const leitura = n((await como(c, uid, () => um(c, `select count(*)::int as n from public.vendas`))).n)
  ok('a leitura continua liberada (RLS por permissão)', leitura > 0, `${leitura} venda(s)`)
})

/* ------------------------------------------- nada ficou para trás ---------- */

await c.end()
const nova = await conectar()

titulo('Depois do rollback: a base está como estava')

const depois = {
  vendas: n((await um(nova, `select count(*)::int as n from public.vendas`)).n),
  itens: n((await um(nova, `select count(*)::int as n from public.itens_venda`)).n),
  movimentos: n((await um(nova, `select count(*)::int as n from public.movimentacoes_estoque`)).n),
  saldoSelfService: selfService
    ? n((await um(nova, `select public.saldo_estoque($1) as s`, [selfService.id])).s)
    : null,
}
console.log(
  `  vendas=${depois.vendas}  itens=${depois.itens}  movimentos=${depois.movimentos}` +
    (selfService ? `  saldo(${selfService.codigo})=${depois.saldoSelfService} kg` : ''),
)

ok(
  'nenhuma venda, item ou movimento sobrou',
  antes.vendas === depois.vendas && antes.itens === depois.itens && antes.movimentos === depois.movimentos,
  `${antes.vendas}/${antes.itens}/${antes.movimentos} → ${depois.vendas}/${depois.itens}/${depois.movimentos}`,
)
ok(
  'o saldo do produto voltou ao que era',
  antes.saldoSelfService === depois.saldoSelfService,
  `${antes.saldoSelfService} → ${depois.saldoSelfService} kg`,
)

const restos = await um(
  nova,
  `select count(*)::int as n from public.vendas where codigo like '#VERIF-P%' or chave_idempotencia like 'verif-p%'`,
)
ok('nenhum código/chave da verificação ficou gravado', n(restos.n) === 0, `${restos.n} linha(s)`)

const avisos = await um(
  nova,
  `select count(*)::int as n from public.notifications where tipo = 'venda_estornada'`,
)
ok('nenhuma notificação de estorno ficou gravada', n(avisos.n) === 0, `${avisos.n} linha(s)`)

const seqDepois = await um(nova, `select last_value from public.vendas_codigo_seq`)
ok(
  'a sequência de pedidos não andou',
  n(seqDepois.last_value) === n(seq.last_value),
  `${seq.last_value} → ${seqDepois.last_value}`,
)

await nova.end()

console.log(falhas === 0 ? '\n  Tudo certo.\n' : `\n  ${falhas} verificação(ões) falharam.\n`)
process.exit(falhas === 0 ? 0 : 1)
