import { describe, it, expect, beforeEach } from 'vitest'
import { estadoSessao } from 'login-projetos/sessao'
import { chave, pode, podeAcessar, ehAdmin } from '../src/services/permissoes.js'

describe('permissoes', () => {
  beforeEach(() => {
    estadoSessao.permissoes = new Set()
    estadoSessao.perfil = null
  })

  it('chave monta modulo.acao', () => {
    expect(chave('vendas', 'criar')).toBe('vendas.criar')
  })

  it('pode retorna false sem permissao', () => {
    expect(pode('vendas', 'criar')).toBe(false)
  })

  it('pode retorna true com permissao', () => {
    estadoSessao.permissoes.add('vendas.criar')
    expect(pode('vendas', 'criar')).toBe(true)
  })

  it('podeAcessar usa acao ver', () => {
    estadoSessao.permissoes.add('dashboard.ver')
    expect(podeAcessar('dashboard')).toBe(true)
    expect(podeAcessar('financeiro')).toBe(false)
  })

  it('ehAdmin verifica papel admin', () => {
    estadoSessao.perfil = { papel: 'admin' }
    expect(ehAdmin()).toBe(true)
    estadoSessao.perfil = { papel: 'cashier' }
    expect(ehAdmin()).toBe(false)
  })
})