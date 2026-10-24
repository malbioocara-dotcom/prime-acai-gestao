import { describe, expect, it, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: true,
  neon: {},
}))

const dados = await import('../src/data.js')

describe('dados iniciais com Neon configurado', () => {
  it('não expõe registros de demonstração enquanto os dados reais carregam', () => {
    expect(dados.vendas).toEqual([])
    expect(dados.produtos).toEqual([])
    expect(dados.recipientes).toEqual([])
    expect(dados.lancamentos).toEqual([])
    expect(dados.clientes).toEqual([])
  })

  it('usa valores neutros nos indicadores e séries', () => {
    expect(dados.resumo.faturamentoMes).toBe(0)
    expect(dados.resumo.vendasHoje).toBe(0)
    expect(dados.faturamento7Dias).toEqual({ labels: [], valores: [] })
    expect(dados.vendasPorCategoria).toEqual({ labels: [], valores: [] })
    expect(dados.fluxoMensal).toEqual({ labels: [], entradas: [], saidas: [] })
    expect(dados.comparativoMensal.entradasAnterior).toBe(0)
  })
})
