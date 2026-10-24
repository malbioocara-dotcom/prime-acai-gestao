import { describe, it, expect, beforeEach, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  chamadas: [],
  linhas: { tipos_venda: [], formas_pagamento: [], categorias_tipos_venda: [] },
  resposta: null,
}))

vi.mock('login-projetos/neon', () => {
  const from = (tabela) => {
    const consulta = { tabela, filtros: [] }
    estado.chamadas.push(consulta)
    const query = {
      select: (colunas) => {
        consulta.colunas = colunas
        return query
      },
      order: (coluna) => {
        consulta.ordem = coluna
        return query
      },
      eq: (coluna, valor) => {
        consulta.filtros.push([coluna, valor])
        return query
      },
      insert: (registro) => {
        consulta.operacao = 'insert'
        consulta.registro = registro
        return query
      },
      update: (registro) => {
        consulta.operacao = 'update'
        consulta.registro = registro
        return query
      },
      single: async () => ({ data: estado.resposta, error: null }),
      maybeSingle: async () => ({ data: estado.resposta, error: null }),
      then: (resolve, reject) => {
        let linhas = estado.linhas[tabela] ?? []
        if (consulta.filtros.some(([coluna, valor]) =>
          coluna === 'ativo' && valor === true)) {
          linhas = linhas.filter((linha) => linha.ativo)
        }
        return Promise.resolve({ data: linhas, error: null }).then(resolve, reject)
      },
    }
    return query
  }

  return { neonConfigurado: true, neon: { from } }
})

const {
  alterarFormaPagamentoAtivo,
  alterarTipoVendaAtivo,
  listarFormasPagamento,
  listarCategoriasTipoVenda,
  salvarCategoriaTipoVenda,
  alterarCategoriaTipoVendaAtiva,
  listarTiposVenda,
  salvarFormaPagamento,
  salvarTipoVenda,
} = await import('../src/services/config-vendas.js')

beforeEach(() => {
  estado.chamadas = []
  estado.linhas = { tipos_venda: [], formas_pagamento: [], categorias_tipos_venda: [] }
  estado.resposta = null
})

describe('cadastros de venda e pagamento', () => {
  it('lista categorias da organização e permite filtrar somente as ativas', async () => {
    estado.linhas.categorias_tipos_venda = [
      { id: 'cat-a', codigo: 'balcao', nome: 'Balcão', ativo: true },
      { id: 'cat-b', codigo: 'retirada', nome: 'Retirada', ativo: false },
    ]

    expect((await listarCategoriasTipoVenda()).dados).toHaveLength(2)
    await listarCategoriasTipoVenda({ somenteAtivas: true })

    expect(estado.chamadas.filter(({ tabela }) => tabela === 'categorias_tipos_venda')).toHaveLength(2)
    expect(estado.chamadas.at(-1).filtros).toEqual([['ativo', true]])
  })

  it('salva categoria de tipo de venda com código estável e impede duplicidade normalizada', async () => {
    estado.resposta = {
      id: 'categoria-1',
      codigo: 'retirada_local',
      nome: 'Retirada local',
      ativo: true,
    }
    await salvarCategoriaTipoVenda({ nome: 'Retirada local' })
    expect(estado.chamadas.find(({ operacao }) => operacao === 'insert')).toMatchObject({
      tabela: 'categorias_tipos_venda',
      registro: { codigo: 'retirada_local', nome: 'Retirada local', ativo: true },
    })

    estado.linhas.categorias_tipos_venda = [
      { id: 'categoria-1', codigo: 'retirada_local', nome: 'Retirada local', ativo: true },
    ]
    await expect(salvarCategoriaTipoVenda({ nome: '  RETIRADA   local ' }))
      .rejects.toThrow('Já existe uma categoria com esse nome ou código.')
  })

  it('inativa categorias de tipos sem exclusão física', async () => {
    estado.resposta = { id: 'categoria-1', ativo: false }
    await alterarCategoriaTipoVendaAtiva({ id: 'categoria-1', ativo: false })
    expect(estado.chamadas.find(({ operacao }) => operacao === 'update')).toMatchObject({
      tabela: 'categorias_tipos_venda',
      registro: { ativo: false },
    })
  })

  it('consulta catálogos ativos e inclui os inativos quando a configuração precisa gerenciá-los', async () => {
    estado.linhas.tipos_venda = [{ id: 'tipo-1', ativo: true }]
    await listarTiposVenda({ somenteAtivos: true })
    await listarFormasPagamento()

    expect(estado.chamadas.find(({ tabela }) => tabela === 'tipos_venda')).toMatchObject({
      tabela: 'tipos_venda',
      filtros: [['ativo', true]],
      ordem: 'nome',
    })
    expect(estado.chamadas.find(({ tabela }) => tabela === 'formas_pagamento')).toMatchObject({
      tabela: 'formas_pagamento',
      filtros: [],
      ordem: 'nome',
    })
  })

  it('remove duplicidades por nome normalizado ou código sem ocultar itens da mesma categoria', async () => {
    estado.linhas.tipos_venda = [
      { id: 'tipo-inativo', codigo: 'balcao', nome: 'Balcão', ativo: false },
      { id: 'tipo-ativo', codigo: 'BALCAO', nome: '  Balcão  ', ativo: true },
      { id: 'tipo-delivery-1', codigo: 'delivery_proprio', nome: 'Delivery próprio', categoria: 'delivery', ativo: true },
      { id: 'tipo-delivery-2', codigo: 'entrega', nome: 'Entrega', categoria: 'delivery', ativo: true },
      { id: 'tipo-delivery', codigo: 'delivery', nome: 'Delivery', categoria: 'delivery', ativo: true },
      { id: 'tipo-personalizado-1', codigo: 'retirada', nome: 'Retirada', categoria: 'personalizado', ativo: true },
      { id: 'tipo-personalizado-2', codigo: 'agendado', nome: 'Agendado', categoria: 'personalizado', ativo: true },
    ]
    estado.linhas.formas_pagamento = [
      { id: 'pag-pix', codigo: 'pix', nome: 'PIX', ativo: true },
      { id: 'pag-pix-duplicado', codigo: 'pix-2', nome: ' pix ', ativo: true },
      { id: 'pag-debito-1', codigo: 'debito', nome: 'Cartão de débito', categoria: 'debito', ativo: true },
      { id: 'pag-debito-2', codigo: 'cartao_debito', nome: 'Débito', categoria: 'debito', ativo: true },
      { id: 'pag-outros-1', codigo: 'voucher', nome: 'Voucher', categoria: 'outros', ativo: true },
      { id: 'pag-outros-2', codigo: 'vale', nome: 'Vale-refeição', categoria: 'outros', ativo: true },
    ]

    const tipos = await listarTiposVenda()
    const pagamentos = await listarFormasPagamento()

    expect(tipos.dados.map(({ id }) => id).sort()).toEqual([
      'tipo-ativo',
      'tipo-delivery',
      'tipo-delivery-1',
      'tipo-delivery-2',
      'tipo-personalizado-1',
      'tipo-personalizado-2',
    ])
    expect(pagamentos.dados.map(({ id }) => id).sort()).toEqual([
      'pag-debito-1',
      'pag-debito-2',
      'pag-outros-1',
      'pag-outros-2',
      'pag-pix',
    ])
  })

  it('cria um tipo personalizado com código estável derivado do nome', async () => {
    estado.resposta = { id: 'tipo-1', codigo: 'retirada_no_local', nome: 'Retirada no local' }
    await salvarTipoVenda({ nome: 'Retirada no local', categoria: 'personalizado' })

    expect(estado.chamadas.find(({ operacao }) => operacao === 'insert')).toMatchObject({
      tabela: 'tipos_venda',
      operacao: 'insert',
      registro: {
        codigo: 'retirada_no_local',
        nome: 'Retirada no local',
        categoria: 'personalizado',
        ativo: true,
      },
    })
  })

  it('edita um método já existente sem trocar seu código histórico', async () => {
    estado.resposta = { id: 'pag-1', codigo: 'pix', nome: 'PIX Loja' }
    await salvarFormaPagamento({
      id: 'pag-1',
      codigo: 'pix',
      nome: 'PIX Loja',
      categoria: 'pix',
      ativo: true,
    })

    expect(estado.chamadas.find(({ operacao }) => operacao === 'update')).toMatchObject({
      tabela: 'formas_pagamento',
      operacao: 'update',
      registro: { codigo: 'pix', nome: 'PIX Loja' },
    })
  })

  it('bloqueia um novo cadastro com nome equivalente após normalização', async () => {
    estado.linhas.formas_pagamento = [
      { id: 'pag-pix', codigo: 'pix', nome: 'PIX', ativo: true },
    ]

    await expect(salvarFormaPagamento({
      nome: '  pix  ',
      categoria: 'pix',
    })).rejects.toThrow('Já existe um cadastro com esse nome ou código.')
    expect(estado.chamadas.some(({ operacao }) => operacao === 'insert')).toBe(false)
  })

  it('permite novo cadastro com nome próprio na mesma categoria padrão', async () => {
    estado.linhas.tipos_venda = [
      { id: 'tipo-app', codigo: 'aplicativo', nome: 'Aplicativo', categoria: 'aplicativo', ativo: true },
    ]
    estado.resposta = {
      id: 'tipo-ifood',
      codigo: 'ifood',
      nome: 'iFood',
      categoria: 'aplicativo',
      ativo: true,
    }

    await expect(salvarTipoVenda({
      nome: 'iFood',
      categoria: 'aplicativo',
    })).resolves.toMatchObject({ dados: { nome: 'iFood' } })
    expect(estado.chamadas.find(({ operacao }) => operacao === 'insert')).toMatchObject({
      registro: { nome: 'iFood', categoria: 'aplicativo' },
    })
  })

  it('inativa em vez de excluir um registro potencialmente usado em vendas', async () => {
    estado.resposta = { id: 'tipo-1', ativo: false }
    await alterarTipoVendaAtivo({ id: 'tipo-1', ativo: false })
    estado.resposta = { id: 'pag-1', ativo: false }
    await alterarFormaPagamentoAtivo({ id: 'pag-1', ativo: false })

    expect(estado.chamadas.map(({ tabela, operacao, registro }) => [tabela, operacao, registro]))
      .toEqual([
        ['tipos_venda', 'update', { ativo: false }],
        ['formas_pagamento', 'update', { ativo: false }],
      ])
  })
})
