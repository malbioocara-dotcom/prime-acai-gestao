import { describe, it, expect, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: true,
  neon: { from: () => ({ select: () => ({ order: () => ({ data: [], error: null }) }) }) },
}))

const { validarRecipiente } = await import('../src/services/recipientes.js')
const { TARA_MAXIMA_G } = await import('../src/peso.js')

describe('validarRecipiente', () => {
  it('aceita um recipiente normal', () => {
    const r = validarRecipiente({ nome: '  Copo 500ml com tampa ', tara: 16 })
    expect(r.ok).toBe(true)
    expect(r.valor).toEqual({ nome: 'Copo 500ml com tampa', tara_g: 16 })
  })

  it('aceita tara zero (embalagem sem peso relevante)', () => {
    expect(validarRecipiente({ nome: 'Sacola', tara: 0 }).ok).toBe(true)
  })

  it('aceita tara como texto brasileiro', () => {
    expect(validarRecipiente({ nome: 'Bandeja', tara: '180' }).valor.tara_g).toBe(180)
  })

  it('exige identificação', () => {
    expect(validarRecipiente({ nome: '   ', tara: 10 }).ok).toBe(false)
    expect(validarRecipiente({ tara: 10 }).ok).toBe(false)
  })

  it('limita a identificação a 80 caracteres', () => {
    expect(validarRecipiente({ nome: 'x'.repeat(81), tara: 10 }).ok).toBe(false)
    expect(validarRecipiente({ nome: 'x'.repeat(80), tara: 10 }).ok).toBe(true)
  })

  it('recusa tara negativa ou não numérica', () => {
    expect(validarRecipiente({ nome: 'Copo', tara: -1 }).ok).toBe(false)
    expect(validarRecipiente({ nome: 'Copo', tara: 'abc' }).ok).toBe(false)
    expect(validarRecipiente({ nome: 'Copo' }).ok).toBe(false)
  })

  it('recusa tara acima do teto de sanidade', () => {
    expect(validarRecipiente({ nome: 'Copo', tara: TARA_MAXIMA_G }).ok).toBe(true)
    expect(validarRecipiente({ nome: 'Copo', tara: TARA_MAXIMA_G + 1 }).ok).toBe(false)
  })
})
