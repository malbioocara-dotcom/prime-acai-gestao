/**
 * Integração com o pacote `Login_projetos`.
 *
 * Este teste protege o objetivo do refactor: o login é UMA coisa só (o pacote),
 * consumida por este app — sem cópias paralelas, e com a marca da Prime Açaí
 * aplicada por `configurarLogin()`.
 *
 * Se um dia as telas de login voltarem a ser copiadas para dentro do app, ou o
 * `dedupe` sair do vite.config.js e o pacote passar a ser carregado duas vezes,
 * é aqui que isso aparece.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as pacote from 'login-projetos'
import { loginProjetosConfig } from '../src/login-config.js'

const caminhoNoApp = (relativo) => fileURLToPath(new URL(`../${relativo}`, import.meta.url))

beforeAll(() => {
  // É exatamente o que o `main.js` faz no boot do app.
  pacote.configurarLogin(loginProjetosConfig)
})

describe('marca da Prime Açaí nas telas do pacote', () => {
  it('a tela de login monta com o nome e o texto do app', () => {
    const { html } = pacote.loginPage()

    expect(html).toContain('Prime Açaí')
    expect(html).toContain('data-lucide="store"')
    expect(html).toContain('Use o e-mail cadastrado na Prime Açaí.')
    // Não pode sobrar o padrão genérico do pacote.
    expect(html).not.toContain('Meu Sistema')
  })

  it('a tela de login aponta para as rotas do app', () => {
    const { html } = pacote.loginPage()

    expect(html).toContain('href="#/recuperar-senha"')
    expect(html).toContain('href="#/cadastro"')
  })

  it('o cadastro destaca o papel padrão e volta para o login', () => {
    const { html } = pacote.cadastroPage()

    expect(html).toContain('<strong>Caixa</strong>')
    expect(html).toContain('href="#/login"')
  })

  it('desabilita cadastro e recuperação nas telas e no mapa de rotas', () => {
    pacote.configurarLogin({
      funcionalidades: { cadastro: false, recuperacaoSenha: false },
    })

    const html = pacote.loginPage().html
    const rotas = pacote.telasAuth()

    expect(html).not.toContain('href="#/cadastro"')
    expect(html).not.toContain('href="#/recuperar-senha"')
    expect(rotas['/cadastro']).toBeUndefined()
    expect(rotas['/recuperar-senha']).toBeUndefined()
    expect(pacote.ehRotaAuth('/cadastro')).toBe(false)

    pacote.configurarLogin({
      funcionalidades: { cadastro: true, recuperacaoSenha: true },
    })
  })
})

describe('fonte única da verdade', () => {
  it('o barrel e os subcaminhos apontam para o MESMO estado e a MESMA config', async () => {
    const sessaoViaSubcaminho = await import('login-projetos/sessao')
    const configViaSubcaminho = await import('login-projetos/config')

    // Se o pacote for resolvido/carregado duas vezes (ex.: sem o `dedupe`),
    // estes objetos deixam de ser idênticos — e o app ficaria com duas sessões
    // diferentes: uma escrita pelo `main.js`, outra lida pelos serviços.
    expect(sessaoViaSubcaminho.estadoSessao).toBe(pacote.estadoSessao)
    expect(configViaSubcaminho.config).toBe(pacote.config)
  })

  it('as telas de login não existem mais dentro do app (nada duplicado)', () => {
    const duplicados = [
      'src/auth-ui.js',
      'src/sessao.js',
      'src/lib/neon.js',
      'src/services/auth.js',
      'src/pages/login.js',
      'src/pages/cadastro.js',
      'src/pages/recuperar-senha.js',
      'src/pages/redefinir-senha.js',
      'src/styles/auth.css',
    ]

    for (const arquivo of duplicados) {
      expect(existsSync(caminhoNoApp(arquivo)), `${arquivo} deveria ter sido removido`).toBe(false)
    }
  })
})
