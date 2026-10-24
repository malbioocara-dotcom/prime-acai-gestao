import { describe, it, expect } from 'vitest'
import { emailValido, checarSenha, senhaForte } from 'login-projetos/validacao'

describe('emailValido', () => {
  it('aceita e-mail valido', () => {
    expect(emailValido('malbioocara@gmail.com')).toBe(true)
    expect(emailValido('a@b.co')).toBe(true)
  })
  it('rejeita e-mail invalido', () => {
    expect(emailValido('')).toBe(false)
    expect(emailValido('sem-arroba')).toBe(false)
    expect(emailValido('a@b')).toBe(false)
    expect(emailValido('a@.com')).toBe(false)
  })
})

describe('checarSenha', () => {
  it('senha forte passa todas as regras', () => {
    const r = checarSenha('Senha123')
    expect(r.every((x) => x.ok)).toBe(true)
  })
  it('senha curta falha', () => {
    const r = checarSenha('Ab1')
    expect(r[0].ok).toBe(false)
  })
  it('senha sem numero falha', () => {
    const r = checarSenha('Senhaaaaa')
    expect(r[2].ok).toBe(false)
  })
  it('senha sem letra falha', () => {
    const r = checarSenha('12345678')
    expect(r[1].ok).toBe(false)
  })
})

describe('senhaForte', () => {
  it('true para senha valida', () => {
    expect(senhaForte('Senha123')).toBe(true)
  })
  it('false para senha invalida', () => {
    expect(senhaForte('123')).toBe(false)
  })
})