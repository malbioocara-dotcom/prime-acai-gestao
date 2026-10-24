// Testes da configuração central — sem dependências externas (node:test).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  config,
  configurarLogin,
  ehRotaAuthConfigurada,
  funcionalidadeAuthHabilitada,
  rotaAuthHabilitada,
  texto,
} from '../src/config.js'

describe('config', () => {
  test('traz padrões sensatos', () => {
    assert.equal(typeof config.marca.nome, 'string')
    assert.ok(config.marca.nome.length > 0)
    assert.equal(typeof config.rotas.login, 'string')
    assert.ok(config.rotas.login.startsWith('/'))
    assert.equal(config.senhaMinima, 8)
    assert.equal(config.rpcPerfil, 'garantir_perfil')
    assert.equal(config.tabelaPerfis, 'profiles')
    assert.equal(typeof config.cadastroPublico, 'boolean')
    assert.equal(config.provedor.nome, 'neon')
    assert.equal(config.funcionalidades.recuperacaoSenha, true)
  })

  test('configurarLogin troca só o que foi passado', () => {
    const antesDica = config.textos.redefinirDica

    configurarLogin({ marca: { nome: 'Açaí Top' } })

    assert.equal(config.marca.nome, 'Açaí Top')
    // não passado -> continua no padrão
    assert.equal(config.senhaMinima, 8)
    assert.equal(config.textos.redefinirDica, antesDica)

    configurarLogin({ marca: { nome: 'Meu Sistema' } })
  })

  test('mescla em profundidade, sem apagar o resto do objeto', () => {
    configurarLogin({ rotas: { login: '/entrar' } })

    assert.equal(config.rotas.login, '/entrar')
    // as outras rotas continuam existindo
    assert.equal(config.rotas.redefinir, '/redefinir-senha')

    configurarLogin({ rotas: { login: '/login' } })
  })

  test('preserva a referência do objeto (quem já importou vê o valor novo)', () => {
    const referenciaMarca = config.marca
    const referenciaPapeis = config.papeis

    configurarLogin({ marca: { nome: 'Outro Nome' }, papeis: { cashier: 'Operador' } })

    assert.equal(config.marca, referenciaMarca, 'marca deve ser o MESMO objeto')
    assert.equal(config.papeis, referenciaPapeis, 'papeis deve ser o MESMO objeto')
    assert.equal(config.papeis.cashier, 'Operador')

    configurarLogin({ marca: { nome: 'Meu Sistema' }, papeis: { cashier: 'Caixa' } })
  })

  test('aceita valor simples além de objeto', () => {
    configurarLogin({ senhaMinima: 12, cadastroPublico: false })
    assert.equal(config.senhaMinima, 12)
    assert.equal(config.cadastroPublico, false)

    configurarLogin({ senhaMinima: 8, cadastroPublico: true })
  })

  test('configura funcionalidades, provedor e destino de logout', () => {
    const cliente = { auth: {} }
    configurarLogin({
      funcionalidades: { cadastro: false, recuperacaoSenha: false },
      provedor: { nome: 'adaptador-teste', cliente },
      rotas: { depoisDoLogout: '/sair' },
      urlAplicacao: 'https://app.example.test',
    })

    assert.equal(funcionalidadeAuthHabilitada('cadastro'), false)
    assert.equal(funcionalidadeAuthHabilitada('recuperacaoSenha'), false)
    assert.equal(rotaAuthHabilitada('/cadastro'), false)
    assert.equal(rotaAuthHabilitada('/recuperar-senha'), false)
    assert.equal(rotaAuthHabilitada('/login'), true)
    assert.equal(ehRotaAuthConfigurada('/cadastro'), true)
    assert.equal(ehRotaAuthConfigurada('/acesso-negado'), false)
    assert.equal(config.provedor.cliente, cliente)
    assert.equal(config.rotas.depoisDoLogout, '/sair')
    assert.equal(config.urlAplicacao, 'https://app.example.test')

    configurarLogin({
      funcionalidades: { cadastro: true, recuperacaoSenha: true },
      provedor: { nome: 'neon', cliente: null, redefinirSenha: null },
      rotas: { depoisDoLogout: '/login' },
      urlAplicacao: '',
    })
  })
})

describe('texto', () => {
  test('interpola {marca} e {papel}', () => {
    configurarLogin({ marca: { nome: 'Doce Vida' }, papeis: { cashier: 'Atendente' } })

    assert.equal(texto('loginDica'), 'Use o e-mail cadastrado em Doce Vida.')
    assert.match(texto('cadastroRodape'), /Atendente/)
    assert.ok(!texto('cadastroRodape').includes('{'))

    configurarLogin({ marca: { nome: 'Meu Sistema' }, papeis: { cashier: 'Caixa' } })
  })

  test('deixa a variável desconhecida intacta e não quebra com chave inexistente', () => {
    assert.equal(texto('loginTitulo', { marca: 'X' }), config.textos.loginTitulo)
    assert.equal(texto('naoExiste'), '')
  })
})
