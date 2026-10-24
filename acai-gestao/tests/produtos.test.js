import { describe, it, expect, vi } from 'vitest'

// O serviço depende de `base.js`, que importa o SDK do Neon. O mock mantém o
// teste em Node puro — nada aqui fala com a rede.
vi.mock('login-projetos/neon', () => ({
  neonConfigurado: true,
  neon: { from: () => ({ select: () => ({ order: () => ({ data: [], error: null }) }) }) },
}))

const {
  TIPOS_VENDA,
  METODOS_ESTOQUE,
  normalizarProduto,
  precoComUnidade,
  proximoCodigoProduto,
  rotuloPreco,
  unidadeDeVenda,
} = await import('../src/services/produtos.js')

const base = {
  codigo: 'ss1',
  nome: '  Açaí self-service  ',
  categoria: 'Açaí',
  tipoVenda: 'peso',
  metodoPeso: 'bruto_tara',
  preco: 69.9,
  unidade: 'un', // de propósito errado: produto por peso tem de virar kg
  controlaEstoque: 'true',
  metodoEstoque: 'movimentacoes',
  ativo: 'true',
}

describe('unidadeDeVenda', () => {
  it('deriva a unidade do tipo de venda', () => {
    expect(unidadeDeVenda('peso')).toBe('kg')
    expect(unidadeDeVenda('receita')).toBe('porção')
    expect(unidadeDeVenda('unidade')).toBe('un')
  })

  it('o rótulo do preço acompanha o tipo', () => {
    expect(rotuloPreco('peso')).toBe('Preço por kg')
    expect(rotuloPreco('unidade')).toBe('Preço por un')
  })
})

describe('normalizarProduto', () => {
  it('aceita o Açaí self-service a R$ 69,90/kg', () => {
    const r = normalizarProduto(base)

    expect(r.codigo).toBe('SS1') // código em maiúsculas
    expect(r.nome).toBe('Açaí self-service') // espaços das pontas fora
    expect(r.tipo_venda).toBe('peso')
    expect(r.metodo_peso).toBe('bruto_tara')
    expect(r.unidade).toBe('kg') // forçado pelo tipo
    expect(r.preco).toBe(69.9)
    expect(r.ativo).toBe(true)
    expect(r.descricao).toBeNull() // vazio vira NULL, não ''
  })

  it('produto por peso SEM método escolhido assume bruto_tara (o banco exige um método)', () => {
    const r = normalizarProduto({ ...base, metodoPeso: '' })
    expect(r.metodo_peso).toBe('bruto_tara')
  })

  it('nunca grava o método balanca, que nao e executavel neste sistema', () => {
    const r = normalizarProduto({ ...base, metodoPeso: 'balanca' })
    expect(r.metodo_peso).toBe('bruto_tara')
  })

  it('produto fora do tipo peso sai SEM método de peso', () => {
    const r = normalizarProduto({ ...base, tipoVenda: 'unidade', metodoPeso: 'liquido', unidade: 'un' })
    expect(r.tipo_venda).toBe('unidade')
    expect(r.metodo_peso).toBeNull()
    expect(r.unidade).toBe('un')
  })

  it('tipo desconhecido cai para unidade', () => {
    expect(normalizarProduto({ ...base, tipoVenda: 'inventado' }).tipo_venda).toBe('unidade')
  })

  it('sem controle de estoque o método de controle vira nenhum', () => {
    const r = normalizarProduto({ ...base, controlaEstoque: 'false', metodoEstoque: 'fechamento' })
    expect(r.controla_estoque).toBe(false)
    expect(r.metodo_estoque).toBe('nenhum')
  })

  it('situacao inativa chega como texto do select e vira booleano de verdade', () => {
    // Boolean('false') seria true: este e o erro que a conversao evita.
    expect(normalizarProduto({ ...base, ativo: 'false' }).ativo).toBe(false)
    expect(normalizarProduto({ ...base, ativo: 'true' }).ativo).toBe(true)
  })

  it('exige codigo, nome e categoria', () => {
    expect(() => normalizarProduto({ ...base, codigo: '  ' })).toThrow(/código/i)
    expect(() => normalizarProduto({ ...base, nome: '' })).toThrow(/nome/i)
    expect(() => normalizarProduto({ ...base, categoria: '' })).toThrow(/categoria/i)
  })

  it('recusa preco, custo e minimo negativos', () => {
    expect(() => normalizarProduto({ ...base, preco: -1 })).toThrow(/preço/i)
    expect(() => normalizarProduto({ ...base, preco: 10, custo: -1 })).toThrow(/custo/i)
    expect(() => normalizarProduto({ ...base, preco: 10, minimo: -1 })).toThrow(/reposição/i)
  })

  it('as chaves de tipo e método são as mesmas que o banco aceita', () => {
    expect(Object.keys(TIPOS_VENDA).sort()).toEqual(['peso', 'receita', 'unidade'])
    expect(Object.keys(METODOS_ESTOQUE).sort()).toEqual(['fechamento', 'movimentacoes', 'nenhum'])
  })
})

describe('proximoCodigoProduto', () => {
  it('segue a numeração existente', () => {
    expect(proximoCodigoProduto([{ id: 'P001' }, { id: 'P010' }])).toBe('P011')
    expect(proximoCodigoProduto([])).toBe('P001')
  })
})

describe('precoComUnidade', () => {
  it('só marca unidade quando ela muda (kg, porção) e não repete "un"', () => {
    expect(precoComUnidade({ tipoVenda: 'peso' })).toBe('kg')
    expect(precoComUnidade({ tipoVenda: 'receita' })).toBe('porção')
    expect(precoComUnidade({ tipoVenda: 'unidade' })).toBeNull()
  })
})
