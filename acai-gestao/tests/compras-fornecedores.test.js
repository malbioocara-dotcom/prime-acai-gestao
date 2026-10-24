import { afterEach, describe, expect, it, vi } from 'vitest'

const { neonMock } = vi.hoisted(() => ({
  neonMock: { from: vi.fn() },
}))

vi.mock('../src/services/base.js', () => ({
  carregar: async ({ consulta, exemplo }) => ({
    dados: consulta ? await consulta(neonMock) : exemplo,
    origem: 'neon',
  }),
  gravar: async ({ escrever }) => ({
    dados: await escrever(neonMock),
    origem: 'neon',
  }),
}))

const { criarFornecedor, listarCompras } = await import('../src/services/compras.js')

let respostasPorTabela = {}
const selecoes = []
const escritas = []

neonMock.from.mockImplementation((tabela) => {
  const lista = respostasPorTabela[tabela]
  const resposta = Array.isArray(lista) ? lista.shift() : lista ?? { data: [], error: null }
  const consulta = {
    select(campos) {
      selecoes.push({ tabela, campos })
      return this
    },
    insert(registro) {
      escritas.push({ tabela, operacao: 'insert', registro })
      return this
    },
    update(registro) {
      escritas.push({ tabela, operacao: 'update', registro })
      return this
    },
    eq() { return this },
    gte() { return this },
    lte() { return this },
    in() { return this },
    order() { return this },
    limit() { return this },
    single() {
      return Promise.resolve(resposta)
    },
    then(resolve, reject) {
      return Promise.resolve(resposta).then(resolve, reject)
    },
  }
  return consulta
})

afterEach(() => {
  respostasPorTabela = {}
  selecoes.length = 0
  escritas.length = 0
  neonMock.from.mockClear()
})

describe('fornecedores no histórico de compras', () => {
  it('grava os demais campos quando o WhatsApp ainda não existe no banco', async () => {
    respostasPorTabela = {
      fornecedores: [
        {
          data: null,
          error: { code: '42703', message: 'column fornecedores.whatsapp does not exist' },
        },
        {
          data: {
            id: 'fornecedor-1',
            nome: 'Fornecedor novo',
            cnpj: null,
            telefone: null,
            email: null,
            observacoes: '',
            ativo: true,
          },
          error: null,
        },
      ],
    }

    const { dados, origem } = await criarFornecedor({ nome: 'Fornecedor novo' })

    expect(origem).toBe('neon')
    expect(dados.nome).toBe('Fornecedor novo')
    expect(escritas).toHaveLength(2)
    expect(escritas[0].registro).toHaveProperty('whatsapp', null)
    expect(escritas[1].registro).not.toHaveProperty('whatsapp')
    expect(selecoes[0].campos).toContain('whatsapp')
    expect(selecoes[1].campos).not.toContain('whatsapp')
  })

  it('recusa salvar WhatsApp e informa que a migração 23 precisa ser aplicada', async () => {
    respostasPorTabela = {
      fornecedores: [{
        data: null,
        error: {
          code: 'PGRST204',
          message: "Could not find the 'whatsapp' column of 'fornecedores' in the schema cache",
        },
      }],
    }

    await expect(criarFornecedor({
      nome: 'Fornecedor com WhatsApp',
      whatsapp: '(11) 98765-4321',
    })).rejects.toThrow('neon/23_whatsapp_fornecedores.sql')
    expect(escritas).toHaveLength(1)
  })

  it('mantém o nome do fornecedor quando o banco ainda não tem a coluna WhatsApp', async () => {
    respostasPorTabela = {
      compras: {
        data: [{
          id: 'compra-1',
          fornecedor_id: 'fornecedor-1',
          data_compra: '2026-10-23',
          criado_em: '2026-10-23T10:00:00Z',
        }],
        error: null,
      },
      compras_itens: [{ data: [], error: null }],
      fornecedores: [
        {
          data: null,
          error: {
            code: '42703',
            message: 'column fornecedores.whatsapp does not exist',
          },
        },
        {
          data: [{
            id: 'fornecedor-1',
            nome: 'Fornecedor correto',
            cnpj: '',
            telefone: '',
            email: '',
            observacoes: '',
            ativo: true,
          }],
          error: null,
        },
      ],
    }

    const { dados } = await listarCompras()

    expect(dados[0].fornecedorNome).toBe('Fornecedor correto')
    expect(dados[0].fornecedorId).toBe('fornecedor-1')
    expect(selecoes.filter(({ tabela }) => tabela === 'fornecedores')).toHaveLength(2)
    expect(selecoes.at(-1).campos).not.toContain('whatsapp')
  })

  it('propaga outros erros de leitura em vez de exibir falso “Sem fornecedor”', async () => {
    respostasPorTabela = {
      compras: {
        data: [{
          id: 'compra-1',
          fornecedor_id: 'fornecedor-1',
          data_compra: '2026-10-23',
        }],
        error: null,
      },
      compras_itens: [{ data: [], error: null }],
      fornecedores: [{
        data: null,
        error: { code: '42501', message: 'permission denied' },
      }],
    }

    await expect(listarCompras()).rejects.toMatchObject({ code: '42501' })
    expect(selecoes.filter(({ tabela }) => tabela === 'fornecedores')).toHaveLength(1)
  })
})
