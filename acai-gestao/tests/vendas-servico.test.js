import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * O contrato entre a tela e a RPC `registrar_venda_completa` (migração 18).
 *
 * Três coisas que este teste prende, e que quebram em silêncio se mudarem:
 *
 *   • os nomes dos parâmetros. O Data API casa por NOME: renomear `p_chave` na
 *     função e esquecer o serviço não dá erro de compilação — dá erro em
 *     produção, na hora da venda. Aqui a assinatura é lida do próprio SQL.
 *   • o preço NÃO sobe. Quem decide o preço é `produtos.preco`, no banco. Se
 *     alguém reintroduzir um preço no corpo da requisição, este teste cai.
 *   • o que a tela recebe de volta (total do banco, `ja_existia`, movimentos).
 */

const estado = vi.hoisted(() => ({
  rpc: [],
  resposta: { data: [], error: null },
  consultas: [],
  linhas: [],
}))

vi.mock('login-projetos/neon', () => {
  // Encadeamento mínimo do construtor de consultas, só para registrar o que a
  // tela pediu: tabela, filtros, ordem e limite.
  const consulta = (tabela) => {
    const registro = { tabela, filtros: [], ordem: null, limite: null }
    estado.consultas.push(registro)

    const q = {
      select: () => q,
      gte: (coluna, valor) => {
        registro.filtros.push(['gte', coluna, valor])
        return q
      },
      lt: (coluna, valor) => {
        registro.filtros.push(['lt', coluna, valor])
        return q
      },
      order: (coluna, opcoes) => {
        registro.ordem = [coluna, opcoes]
        return q
      },
      limit: (n) => {
        registro.limite = n
        return Promise.resolve({ data: estado.linhas, error: null })
      },
    }
    return q
  }

  return {
    neonConfigurado: true,
    neon: {
      from: consulta,
      rpc: async (nome, params) => {
        estado.rpc.push({ nome, params })
        return estado.resposta
      },
    },
  }
})

const { estornarVenda, listarVendas, registrarVenda, proximoCodigoVenda } = await import(
  '../src/services/vendas.js'
)

const sql18 = readFileSync(new URL('../neon/18_canais_pagamentos_vendas.sql', import.meta.url), 'utf8')
const sql11 = readFileSync(new URL('../neon/11_estorno.sql', import.meta.url), 'utf8')

/** Os `p_*` que a função declara, lidos da migração. */
function parametrosDe(nome, sql = sql18) {
  const trecho = new RegExp(`function public\\.${nome}\\(([\\s\\S]*?)\\)\\s*\\nreturns`).exec(sql)
  return [...trecho[1].matchAll(/p_[a-z_]+/g)].map((m) => m[0]).sort()
}

const respostaDaVenda = (extra = {}) => ({
  data: [
    {
      id: 'venda-1',
      codigo: '#9390',
      total: 31.46,
      total_cobrado: 31.46,
      status: 'Concluída',
      pagamento: 'Pix',
      forma_pagamento: 'PIX',
      tipo_venda: 'Balcão',
      criado_em: '2026-10-19T12:30:00.000Z',
      ja_existia: false,
      itens: 1,
      movimentos: 1,
      troco: 0,
      comissao_estimada: 0,
      valor_liquido_estimado: 31.46,
      ...extra,
    },
  ],
  error: null,
})

/** Uma venda por peso: 480 g de peso bruto menos 30 g de tara. */
const vendaDePeso = {
  codigo: '',
  chave: 'chave-1',
  clienteId: '',
  clienteNome: '',
  tipoVendaId: 'tipo-balcao',
  tipoVendaNome: 'Balcão',
  formaPagamentoId: 'pag-pix',
  formaPagamentoNome: 'PIX',
  formaPagamentoCategoria: 'pix',
  status: 'Concluída',
  pagamento: 'Pix',
  itens: [
    {
      produtoId: 'ss1',
      descricao: 'Açaí self-service',
      metodoPeso: 'bruto_tara',
      pesoBrutoGramas: 480,
      taraGramas: 30,
      pesoLiquidoGramas: 450,
      recipienteId: null,
      // Só para a tela: não pode aparecer no corpo da requisição.
      precoUnitario: 69.9,
    },
  ],
}

beforeEach(() => {
  estado.rpc = []
  estado.resposta = respostaDaVenda()
})

describe('registrarVenda — o contrato com o banco', () => {
  it('chama a RPC com exatamente os parâmetros que a função declara', async () => {
    await registrarVenda(vendaDePeso)

    expect(estado.rpc).toHaveLength(1)
    expect(estado.rpc[0].nome).toBe('registrar_venda_completa')
    expect(Object.keys(estado.rpc[0].params).sort()).toEqual(
      parametrosDe('registrar_venda_completa', sql18),
    )
  })

  it('a linha por peso manda bruto, tara, líquido e recipiente — nunca o preço', async () => {
    await registrarVenda(vendaDePeso)

    expect(estado.rpc[0].params.p_itens).toEqual([
      {
        produto_id: 'ss1',
        metodo_peso: 'bruto_tara',
        peso_bruto_g: 480,
        tara_g: 30,
        peso_liquido_g: 450,
        recipiente_id: null,
      },
    ])

    const corpo = JSON.stringify(estado.rpc[0].params)
    expect(corpo).not.toMatch(/preco|preço/)
    expect(corpo).not.toMatch(/descricao/) // a descrição é copiada do cadastro pelo banco
  })

  it('a linha por unidade manda só produto e quantidade', async () => {
    await registrarVenda({
      ...vendaDePeso,
      itens: [
        { produtoId: 'p1', descricao: 'Açaí 300ml', quantidade: 3, precoUnitario: 15.9 },
      ],
    })

    expect(estado.rpc[0].params.p_itens).toEqual([{ produto_id: 'p1', quantidade: 3 }])
  })

  it('pedido em branco vira null: quem numera é a sequência do banco', async () => {
    await registrarVenda(vendaDePeso)
    expect(estado.rpc[0].params.p_codigo).toBe(null)

    estado.rpc = []
    await registrarVenda({ ...vendaDePeso, codigo: '  #1234  ' })
    expect(estado.rpc[0].params.p_codigo).toBe('#1234')
  })

  it('a chave de idempotência sobe como veio (é ela que impede a venda dupla)', async () => {
    await registrarVenda(vendaDePeso)
    await registrarVenda({ ...vendaDePeso, chave: 'chave-2' })

    expect(estado.rpc.map((c) => c.params.p_chave)).toEqual(['chave-1', 'chave-2'])
  })

  it('sem cliente cadastrado: cliente vazio vira null (Consumidor)', async () => {
    await registrarVenda(vendaDePeso)
    expect(estado.rpc[0].params.p_cliente_id).toBe(null)

    estado.rpc = []
    await registrarVenda({ ...vendaDePeso, clienteId: 'c1' })
    expect(estado.rpc[0].params.p_cliente_id).toBe('c1')
  })

  it('a tela recebe o total do banco, o pedido e quantos itens baixaram', async () => {
    const { dados, origem } = await registrarVenda(vendaDePeso)

    expect(origem).toBe('neon')
    expect(dados).toMatchObject({
      uuid: 'venda-1',
      id: '#9390',
      total: 31.46,
      status: 'Concluída',
      pagamento: 'PIX',
      tipoVenda: 'Balcão',
      movimentos: 1,
      jaExistia: false,
    })
  })

  it('envia canal, pagamento e dados de delivery/app como metadata da transação', async () => {
    await registrarVenda({
      ...vendaDePeso,
      tipoVendaId: 'tipo-app',
      tipoVendaNome: 'Aplicativo',
      formaPagamentoId: 'pag-dinheiro',
      formaPagamentoNome: 'Dinheiro',
      formaPagamentoCategoria: 'dinheiro',
      enderecoEntrega: 'Rua A, 10',
      taxaEntrega: 4,
      plataforma: 'iFood',
      pedidoExterno: 'EXT-123',
      comissaoPercentual: 12,
      taxaAplicativo: 1.5,
      valorRecebido: 40,
    })

    expect(estado.rpc[0].params).toMatchObject({
      p_tipo_venda_id: 'tipo-app',
      p_forma_pagamento_id: 'pag-dinheiro',
      p_endereco_entrega: 'Rua A, 10',
      p_taxa_entrega: 4,
      p_plataforma: 'iFood',
      p_pedido_externo: 'EXT-123',
      p_comissao_percentual: 12,
      p_taxa_aplicativo: 1.5,
      p_valor_recebido: 40,
    })
  })

  it('quando a chave já tinha sido usada, a tela sabe que nada foi duplicado', async () => {
    estado.resposta = respostaDaVenda({ ja_existia: true, itens: 1, movimentos: 1 })

    const { dados } = await registrarVenda(vendaDePeso)
    expect(dados.jaExistia).toBe(true)
  })

  it('erro do banco sobe inteiro (é a mensagem em português que o operador lê)', async () => {
    estado.resposta = {
      data: null,
      error: { message: 'Saldo insuficiente para "Açaí self-service": tem 0,100 kg.' },
    }

    await expect(registrarVenda(vendaDePeso)).rejects.toThrow(/Saldo insuficiente/)
  })

  it('o próximo código do pedido quem responde é o banco (não o navegador)', async () => {
    estado.resposta = { data: '#9390', error: null }

    const codigo = await proximoCodigoVenda()

    expect(estado.rpc[0].nome).toBe('proximo_codigo_venda')
    expect(codigo).toBe('#9390')
  })
})

/* ------------------------------------------------------------- o estorno -- */

/**
 * O contrato entre a tela e a RPC `estornar_venda` (migração 11).
 *
 * Mesma armadilha da venda: o Data API casa os parâmetros por NOME. Renomear
 * `p_motivo` na função e esquecer o serviço não quebra nada em compilação — só
 * o estorno em produção. Por isso a assinatura é lida do próprio SQL.
 */
describe('estornarVenda — o contrato com a RPC do estorno (migração 11)', () => {
  const respostaDoEstorno = (extra = {}) => ({
    data: [
      {
        venda_id: 'venda-1',
        codigo: '#9390',
        status: 'Cancelada',
        total: 31.46,
        movimentos: 1,
        ja_estornada: false,
        estornada_em: '2026-10-19T18:00:00.000Z',
        ...extra,
      },
    ],
    error: null,
  })

  it('chama a RPC com exatamente os parâmetros que a função declara', async () => {
    estado.resposta = respostaDoEstorno()

    await estornarVenda({ vendaId: 'venda-1', codigo: '#9390', motivo: 'Cliente desistiu' })

    expect(estado.rpc).toHaveLength(1)
    expect(estado.rpc[0].nome).toBe('estornar_venda')
    expect(Object.keys(estado.rpc[0].params).sort()).toEqual(parametrosDe('estornar_venda', sql11))
    expect(estado.rpc[0].params).toMatchObject({
      p_venda_id: 'venda-1',
      p_motivo: 'Cliente desistiu',
    })
  })

  it('a tela recebe o pedido cancelado e quantos movimentos voltaram', async () => {
    estado.resposta = respostaDoEstorno()

    const { dados, origem } = await estornarVenda({
      vendaId: 'venda-1',
      codigo: '#9390',
      motivo: 'Cliente desistiu',
    })

    expect(origem).toBe('neon')
    expect(dados).toMatchObject({
      id: '#9390',
      status: 'Cancelada',
      movimentos: 1,
      jaEstornada: false,
      estornadaEm: '2026-10-19T18:00:00.000Z',
    })
  })

  it('repetir um estorno já feito não conta como devolução nova', async () => {
    estado.resposta = respostaDoEstorno({ ja_estornada: true, movimentos: 0 })

    const { dados } = await estornarVenda({ vendaId: 'venda-1', codigo: '#9390', motivo: 'x' })

    expect(dados.jaEstornada).toBe(true)
    expect(dados.movimentos).toBe(0)
  })

  it('erro do banco sobe inteiro (é a mensagem em português que a tela mostra)', async () => {
    estado.resposta = {
      data: null,
      error: { message: 'Sua conta não tem permissão para estornar venda.' },
    }

    await expect(
      estornarVenda({ vendaId: 'venda-1', codigo: '#9390', motivo: 'x' }),
    ).rejects.toThrow(/não tem permissão para estornar/)
  })
})

/* ------------------------------------------------------------ o dia ------- */

/**
 * A lista de pedidos de UM dia (o filtro que a tela de Vendas oferece).
 *
 * O que este teste prende é o recorte: "o dia 12" tem de ser meia-noite LOCAL
 * até a meia-noite local seguinte. Se alguém voltar a montar o intervalo com
 * `setHours(0,0,0,0)` no fuso errado, ou com `toISOString()` antes da hora, a
 * venda da noite some da lista — e some em silêncio.
 */
describe('listarVendas — o dia é o dia do operador', () => {
  it('consulta da meia-noite local à meia-noite do dia seguinte', async () => {
    estado.consultas = []
    estado.linhas = []

    await listarVendas({ dia: '2026-10-12' })

    const [consulta] = estado.consultas
    expect(consulta.tabela).toBe('vendas')
    expect(consulta.ordem).toEqual(['criado_em', { ascending: false }])
    expect(consulta.limite).toBe(300)
    expect(consulta.filtros).toEqual([
      ['gte', 'criado_em', new Date('2026-10-12T00:00:00').toISOString()],
      ['lt', 'criado_em', new Date('2026-10-13T00:00:00').toISOString()],
    ])
  })

  it('sem dia informado, mostra o de hoje', async () => {
    estado.consultas = []
    estado.linhas = []

    await listarVendas()

    const inicio = new Date(estado.consultas[0].filtros[0][2])
    const agora = new Date()
    expect([inicio.getFullYear(), inicio.getMonth(), inicio.getDate()]).toEqual([
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
    ])
    expect([inicio.getHours(), inicio.getMinutes()]).toEqual([0, 0])
  })

  it('dia impossível (31 de fevereiro) cai em hoje em vez de consultar lixo', async () => {
    estado.consultas = []
    estado.linhas = []

    await listarVendas({ dia: '2026-02-31' })

    const inicio = new Date(estado.consultas[0].filtros[0][2])
    const agora = new Date()
    expect(inicio.getDate()).toBe(agora.getDate())
    expect(inicio.getMonth()).toBe(agora.getMonth())
  })

  it('devolve o pedido com o rastro do estorno e os itens contados', async () => {
    estado.consultas = []
    estado.linhas = [
      {
        id: 'uuid-1',
        codigo: '#9390',
        total: '31.46',
        status: 'Cancelada',
        pagamento: 'Pix',
        criado_em: '2026-10-19T15:00:00.000Z',
        estornada_em: '2026-10-19T18:00:00.000Z',
        clientes: null,
        itens_venda: [{ count: 1 }],
      },
    ]

    const { dados, origem } = await listarVendas({ dia: '2026-10-19' })

    expect(origem).toBe('neon')
    expect(dados[0]).toMatchObject({
      uuid: 'uuid-1',
      id: '#9390',
      cliente: 'Consumidor',
      itens: 1,
      total: 31.46,
      estornadaEm: '2026-10-19T18:00:00.000Z',
    })
  })
})
