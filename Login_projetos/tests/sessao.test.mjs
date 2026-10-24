// Testes do estado de sessão e do escape de HTML.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { esc } from '../src/ui.js'
import { estadoSessao, iniciais, logado } from '../src/sessao.js'

describe('estadoSessao / logado', () => {
  test('começa deslogado e carregando', () => {
    assert.equal(estadoSessao.usuario, null)
    assert.equal(estadoSessao.perfil, null)
    assert.equal(estadoSessao.carregando, true)
    assert.equal(logado(), false)
  })

  test('só considera logado com sessão E perfil ativo', () => {
    estadoSessao.usuario = { id: 'u1' }
    assert.equal(logado(), false, 'sem perfil não está logado')

    estadoSessao.perfil = { ativo: false }
    assert.equal(logado(), false, 'perfil inativo não conta')

    estadoSessao.perfil = { ativo: true }
    assert.equal(logado(), true)

    estadoSessao.usuario = null
    estadoSessao.perfil = null
  })
})

describe('iniciais', () => {
  test('monta as iniciais do avatar', () => {
    assert.equal(iniciais('Maria Souza'), 'MS')
    assert.equal(iniciais('Maria'), 'MA')
    assert.equal(iniciais('  Ana  Paula  Lima '), 'AL')
    assert.equal(iniciais(''), '?')
    assert.equal(iniciais(null), '?')
  })
})

describe('esc', () => {
  test('escapa os caracteres perigosos de HTML', () => {
    assert.equal(esc('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    assert.equal(esc("O'Reilly & cia"), 'O&#39;Reilly &amp; cia')
    assert.equal(esc(42), '42')
  })
})
