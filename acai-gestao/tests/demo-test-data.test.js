import { describe, expect, it, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({ neonConfigurado: false, neon: {} }))

const {
  categoriasProdutoTeste,
  categoriasTipoVendaTeste,
  formasPagamentoTeste,
  movimentacoesEstoqueTeste,
  produtosTeste,
  saldosEstoqueTeste,
  tiposVendaTeste,
} = await import('../src/demo-test-data.js')

describe('dados fictícios das novas telas', () => {
  it('identifica os registros de teste e cobre catálogos ativos e inativos', () => {
    for (const registro of [
      ...categoriasProdutoTeste,
      ...categoriasTipoVendaTeste,
      ...formasPagamentoTeste,
      ...tiposVendaTeste,
      ...produtosTeste,
    ]) {
      expect(`${registro.nome} ${registro.descricao ?? ''}`).toContain('TESTE')
    }

    expect(categoriasProdutoTeste.some((categoria) => categoria.ativo)).toBe(true)
    expect(categoriasProdutoTeste.some((categoria) => !categoria.ativo)).toBe(true)
    expect(categoriasTipoVendaTeste.some((categoria) => categoria.ativo)).toBe(true)
    expect(categoriasTipoVendaTeste.some((categoria) => !categoria.ativo)).toBe(true)
    expect(tiposVendaTeste.some((tipo) => !tipo.ativo)).toBe(true)
  })

  it('cobre unidade, peso, receita e movimentos entre os dois locais', () => {
    expect(produtosTeste.map((produto) => produto.tipoVenda)).toEqual([
      'peso',
      'receita',
      'unidade',
    ])
    expect(produtosTeste[0]).toMatchObject({
      unidade: 'kg',
      metodoPeso: 'bruto_tara',
      preco: 69.9,
      ativo: true,
    })
    expect(saldosEstoqueTeste.some((saldo) => saldo.geral > 0 && saldo.loja > 0)).toBe(true)
    expect(
      movimentacoesEstoqueTeste.some(
        (movimento) =>
          movimento.origem === 'estoque_geral' && movimento.destino === 'estoque',
      ),
    ).toBe(true)
  })
})
