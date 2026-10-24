import { describe, it, expect } from 'vitest'
import {
  METODOS_PESO,
  METODOS_PESO_ATIVOS,
  TARA_MAXIMA_G,
  calcularPesoLiquido,
  calcularTotalPeso,
  calcularVendaPorPeso,
  formatPeso,
  paraCentavos,
  paraGramas,
} from '../src/peso.js'

/**
 * O caso 2 da especificação, escrito como teste:
 *   480 g de peso bruto, tara de 30 g, R$ 69,90/kg  ->  R$ 31,46
 */
describe('calcularVendaPorPeso', () => {
  it('450 g liquidos com tara de 30 g sobre 480 g brutos da R$ 31,46', () => {
    const r = calcularVendaPorPeso({
      metodo: METODOS_PESO.BRUTO_TARA,
      pesoBrutoGramas: 480,
      taraGramas: 30,
      precoPorKg: 69.9,
    })

    expect(r.ok).toBe(true)
    expect(r.liquidoGramas).toBe(450)
    expect(r.brutoGramas).toBe(480)
    expect(r.taraGramas).toBe(30)
    expect(r.centavos).toBe(3146)
    expect(r.total).toBe(31.46)
  })

  it('mostra por que a conta NAO pode ser em ponto flutuante', () => {
    // 350 g a R$ 39,90/kg. A conta "natural" (gramas/1000 * preco) erra o
    // centavo; a conta em inteiros (centavos x gramas / 1000) acerta.
    // Escolhido por busca entre pesos e precos reais — nao e caso inventado.
    const gramas = 350
    const precoPorKg = 39.9

    const ingenuo = Math.round((gramas / 1000) * precoPorKg * 100) / 100
    expect(ingenuo).toBe(13.96) // um centavo a menos do que o correto

    const certo = calcularTotalPeso({ liquidoGramas: gramas, precoPorKg })
    expect(certo.centavos).toBe(1397)
    expect(certo.total).toBe(13.97)

    // E o caso da especificacao (450 g a R$ 69,90/kg) os dois acertam — o que
    // mostra que testar so esse caso NAO prova que a conta esta certa.
    expect(Math.round((450 / 1000) * 69.9 * 100) / 100).toBe(31.46)
  })

  it('no metodo de peso liquido a tara NAO e descontada de novo', () => {
    const r = calcularVendaPorPeso({
      metodo: METODOS_PESO.LIQUIDO,
      pesoLiquidoGramas: 450,
      taraGramas: 30,
      precoPorKg: 69.9,
    })

    expect(r.ok).toBe(true)
    expect(r.liquidoGramas).toBe(450)
    expect(r.total).toBe(31.46)
    // Nao foram usados: nao podem virar coluna preenchida na venda.
    expect(r.brutoGramas).toBeNull()
    expect(r.taraGramas).toBeNull()
  })

  it('recusa tara maior que o peso bruto', () => {
    const r = calcularPesoLiquido({
      metodo: METODOS_PESO.BRUTO_TARA,
      pesoBrutoGramas: 20,
      taraGramas: 30,
    })

    expect(r.ok).toBe(false)
    expect(r.erro).toMatch(/tara/i)
  })

  it('recusa peso zero ou negativo', () => {
    expect(
      calcularPesoLiquido({ metodo: METODOS_PESO.LIQUIDO, pesoLiquidoGramas: 0 }).ok,
    ).toBe(false)
    expect(
      calcularPesoLiquido({ metodo: METODOS_PESO.LIQUIDO, pesoLiquidoGramas: -50 }).ok,
    ).toBe(false)
    expect(
      calcularPesoLiquido({ metodo: METODOS_PESO.BRUTO_TARA, pesoBrutoGramas: -480, taraGramas: 30 })
        .ok,
    ).toBe(false)
  })

  it('recusa tara negativa', () => {
    const r = calcularPesoLiquido({
      metodo: METODOS_PESO.BRUTO_TARA,
      pesoBrutoGramas: 480,
      taraGramas: -30,
    })
    expect(r.ok).toBe(false)
  })

  it('recusa tara acima do teto de sanidade', () => {
    const r = calcularPesoLiquido({
      metodo: METODOS_PESO.BRUTO_TARA,
      pesoBrutoGramas: TARA_MAXIMA_G + 100,
      taraGramas: TARA_MAXIMA_G + 1,
    })
    expect(r.ok).toBe(false)
    expect(r.erro).toMatch(String(TARA_MAXIMA_G))
  })

  it('a balanca integrada existe no dominio mas nao e executada', () => {
    const r = calcularPesoLiquido({ metodo: METODOS_PESO.BALANCA, pesoLiquidoGramas: 450 })
    expect(r.ok).toBe(false)
    expect(r.erro).toMatch(/balan/i)

    // E a interface nunca oferece este metodo.
    expect(METODOS_PESO_ATIVOS).not.toContain(METODOS_PESO.BALANCA)
    expect(METODOS_PESO_ATIVOS).toHaveLength(2)
  })

  it('leva o peso liquido em quilos com 3 casas (o que vai para itens_venda)', () => {
    const r = calcularVendaPorPeso({
      metodo: METODOS_PESO.BRUTO_TARA,
      pesoBrutoGramas: 480,
      taraGramas: 30,
      precoPorKg: 69.9,
    })
    expect(r.liquidoQuilos).toBe(0.45)
  })
})

describe('calcularTotalPeso', () => {
  it('1 kg a R$ 69,90 da R$ 69,90', () => {
    expect(calcularTotalPeso({ liquidoGramas: 1000, precoPorKg: 69.9 }).centavos).toBe(6990)
  })

  it('arredonda para 2 casas no fim da conta', () => {
    // 250 g a R$ 12,35/kg = 308,75 centavos -> 309 centavos = R$ 3,09
    const r = calcularTotalPeso({ liquidoGramas: 250, precoPorKg: 12.35 })
    expect(r.centavos).toBe(309)
    expect(r.total).toBe(3.09)
  })

  it('preco negativo e invalido', () => {
    expect(calcularTotalPeso({ liquidoGramas: 450, precoPorKg: -1 }).ok).toBe(false)
  })
})

describe('paraCentavos / paraGramas', () => {
  it('paraCentavos aceita virgula brasileira', () => {
    expect(paraCentavos(69.9)).toBe(6990)
    expect(paraCentavos('69,90')).toBe(6990)
    expect(paraCentavos('69.90')).toBe(6990)
  })

  it('paraGramas recusa texto, vazio e negativo', () => {
    expect(paraGramas(480)).toBe(480)
    expect(paraGramas('480')).toBe(480)
    expect(paraGramas('-5')).toBeNaN()
    expect(paraGramas('abc')).toBeNaN()
    expect(paraGramas('')).toBeNaN()
    expect(paraGramas(null)).toBeNaN()
  })
})

describe('formatPeso', () => {
  it('usa gramas abaixo de 1 kg e quilos a partir de 1 kg', () => {
    expect(formatPeso(30)).toBe('30 g')
    expect(formatPeso(1200)).toBe('1,2 kg')
    expect(formatPeso(null)).toBe('—')
  })
})
