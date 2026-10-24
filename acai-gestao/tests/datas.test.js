import { describe, it, expect } from 'vitest'
import { diaValido, limitesDoDia, rotuloDia, somarDias } from '../src/datas.js'

/**
 * O dia do operador: `AAAA-MM-DD` no fuso LOCAL, nunca UTC.
 *
 * É a peça que a navegação de dias da tela de Vendas usa. O erro clássico aqui
 * é converter para `toISOString()` cedo demais: às 21h de Fortaleza (UTC−3) o
 * "dia UTC" já é o seguinte, e a venda da noite cairia no dia errado.
 */

describe('datas — o dia do operador', () => {
  it('soma e subtrai dias virando mês e ano', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01')
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31')
    expect(somarDias('2026-10-19', 0)).toBe('2026-10-19')
    expect(somarDias('2026-10-19', 7)).toBe('2026-10-26')
  })

  it('respeita o 29 de fevereiro', () => {
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29')
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01')
    expect(somarDias('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('recusa data que não existe, mesmo com o formato certo', () => {
    expect(diaValido('2026-10-19')).toBe(true)
    expect(diaValido('2028-02-29')).toBe(true)

    expect(diaValido('2026-02-31')).toBe(false)
    expect(diaValido('2026-13-01')).toBe(false)
    expect(diaValido('19/10/2026')).toBe(false)
    expect(diaValido('')).toBe(false)
    expect(diaValido(null)).toBe(false)
    expect(diaValido(undefined)).toBe(false)
  })

  it('o intervalo vai da meia-noite LOCAL à meia-noite do dia seguinte', () => {
    const { inicio, fim } = limitesDoDia('2026-10-19')
    const a = new Date(inicio)
    const b = new Date(fim)

    // Meia-noite no relógio do operador — não 00:00 UTC (que aqui seria 21h).
    expect([a.getHours(), a.getMinutes(), a.getSeconds()]).toEqual([0, 0, 0])
    expect([b.getHours(), b.getMinutes(), b.getSeconds()]).toEqual([0, 0, 0])
    expect([a.getFullYear(), a.getMonth() + 1, a.getDate()]).toEqual([2026, 10, 19])
    expect([b.getFullYear(), b.getMonth() + 1, b.getDate()]).toEqual([2026, 10, 20])
    expect(a.getTime()).toBeLessThan(b.getTime())
  })

  it('o intervalo de 31 de dezembro termina no ano seguinte', () => {
    const { inicio, fim } = limitesDoDia('2026-12-31')
    expect(new Date(inicio).getFullYear()).toBe(2026)
    expect(new Date(fim).getFullYear()).toBe(2027)
    expect(new Date(fim).getMonth()).toBe(0)
    expect(new Date(fim).getDate()).toBe(1)
  })

  it('o rótulo diz hoje e ontem sem inventar', () => {
    expect(rotuloDia('2026-10-19', '2026-10-19')).toBe('hoje')
    expect(rotuloDia('2026-10-18', '2026-10-19')).toBe('ontem')
    expect(rotuloDia('2026-10-01', '2026-10-19')).toBe('01/10/2026')
    expect(rotuloDia('2025-12-31', '2026-01-01')).toBe('ontem')
  })
})
