// Testes das regras puras de validação.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { config, configurarLogin } from '../src/config.js'
import { checarSenha, emailValido, mensagemDeErro, rotuloPapel, senhaForte, senhaMinima } from '../src/validacao.js'

describe('checarSenha / senhaForte', () => {
  test('lista as três regras e marca o que falta', () => {
    const regras = checarSenha('abc')
    assert.equal(regras.length, 3)
    assert.equal(regras[0].ok, false) // curta
    assert.equal(regras[1].ok, true) // tem letra
    assert.equal(regras[2].ok, false) // sem número
    assert.equal(senhaForte('abc'), false)
  })

  test('aceita uma senha que cumpre tudo', () => {
    assert.equal(senhaForte('acai2024'), true)
    assert.equal(checarSenha('acai2024').every((r) => r.ok), true)
  })

  test('respeita o tamanho mínimo configurado', () => {
    assert.equal(senhaMinima(), 8)
    assert.equal(senhaForte('acai2024'), true)

    configurarLogin({ senhaMinima: 12 })
    assert.equal(senhaMinima(), 12)
    assert.equal(senhaForte('acai2024'), false)
    assert.match(checarSenha('acai2024')[0].texto, /12 caracteres/)

    configurarLogin({ senhaMinima: 8 })
  })

  test('não quebra com entrada vazia ou nula', () => {
    assert.equal(senhaForte(''), false)
    assert.equal(senhaForte(null), false)
    assert.equal(senhaForte(undefined), false)
  })
})

describe('emailValido', () => {
  test('aceita e-mails plausíveis', () => {
    assert.equal(emailValido('a@b.com'), true)
    assert.equal(emailValido('  maria.souza+loja@exemplo.com.br  '), true)
  })

  test('recusa o que não é e-mail', () => {
    assert.equal(emailValido('sem-arroba'), false)
    assert.equal(emailValido('a@b'), false)
    assert.equal(emailValido('a@b.c'), false)
    assert.equal(emailValido(''), false)
    assert.equal(emailValido(null), false)
  })
})

describe('rotuloPapel', () => {
  test('traduz os papéis e mantém o original quando desconhecido', () => {
    assert.equal(rotuloPapel('admin'), 'Administrador')
    assert.equal(rotuloPapel('cashier'), 'Caixa')
    assert.equal(rotuloPapel('inventado'), 'inventado')
  })
})

describe('mensagemDeErro', () => {
  test('traduz códigos do Better Auth (maiúsculos)', () => {
    assert.equal(mensagemDeErro({ code: 'INVALID_EMAIL_OR_PASSWORD' }), 'E-mail ou senha incorretos.')
  })

  test('traduz códigos do Supabase (minúsculos) por compatibilidade', () => {
    assert.equal(mensagemDeErro({ code: 'invalid_credentials' }), 'E-mail ou senha incorretos.')
    assert.equal(mensagemDeErro({ code: 'INVALID_CREDENTIALS' }), 'E-mail ou senha incorretos.')
  })

  test('reconhece falha de rede', () => {
    assert.match(mensagemDeErro({ status: 0 }), /servidor/i)
    assert.match(mensagemDeErro({ message: 'Failed to fetch' }), /servidor/i)
  })

  test('cai na mensagem genérica para o resto (não vaza o erro cru)', () => {
    assert.equal(mensagemDeErro({ code: 'ALGO_INTERNO', message: 'stack trace secreta' }), 'Não foi possível concluir a operação. Tente de novo.')
    assert.equal(mensagemDeErro(null), 'Não foi possível concluir a operação. Tente de novo.')
  })
})
