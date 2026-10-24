/**
 * Integração de verdade: o registro de rotas do app aponta para as telas do
 * pacote `Login_projetos`, e as telas montam no DOM com a marca da Prime Açaí.
 *
 * Aqui não testamos o pacote isolado (ele tem os próprios testes em
 * `Login_projetos/tests`). O que este arquivo cobre é a EMENDA que o refactor
 * criou: `src/routes.js` -> `login-projetos/pages/*` -> `mount(root)`.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { configurarLogin } from 'login-projetos'
import { loginProjetosConfig } from '../src/login-config.js'
import { createRouter } from '../src/router.js'
import { routes } from '../src/routes.js'
import { renderShell } from '../src/layout/shell.js'

beforeAll(() => {
  // É exatamente o que o `main.js` faz no boot do app.
  configurarLogin(loginProjetosConfig)
})

const rota = (caminho) => routes.find((r) => r.path === caminho)

/** Monta a página da rota num #app limpo, como o roteador faz. */
function montar(caminho) {
  const pagina = rota(caminho).page()
  document.body.innerHTML = '<div id="app"></div>'
  const root = document.querySelector('#app')
  root.innerHTML = pagina.html
  pagina.mount(root)
  return root
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('o app registra as telas do pacote', () => {
  it('separa Cadastros no menu e mantém Clientes, Fornecedores e Produtos nessa ordem', () => {
    const html = renderShell(routes)
    const caminhos = [...html.matchAll(/data-route="([^"]+)"/g)].map(([, caminho]) => caminho)
    const rotulos = caminhos.map((caminho) => rota(caminho).label)

    expect(rotulos).toEqual([
      'Dashboard',
      'Vendas',
      'Estoque',
      'Compras',
      'Clientes',
      'Fornecedores',
      'Produtos',
      'Financeiro',
    ])
    expect(routes.find((r) => r.path === '/clientes').group).toBe('Cadastros')
    expect(routes.find((r) => r.path === '/fornecedores').group).toBe('Cadastros')
    expect(routes.find((r) => r.path === '/produtos').group).toBe('Cadastros')
  })

  it('as quatro telas de autenticação estão registradas como públicas', () => {
    for (const caminho of ['/login', '/cadastro', '/recuperar-senha', '/redefinir-senha']) {
      const r = rota(caminho)
      expect(r, `rota ${caminho} ausente em src/routes.js`).toBeTruthy()
      expect(r.publica, `${caminho} deveria ser publica`).toBe(true)
      expect(typeof r.page, `${caminho}.page deveria ser uma fábrica`).toBe('function')
    }
  })

  it('a redefinição de senha continua permitida COM sessão (link do e-mail)', () => {
    // Sem esta exceção o guarda expulsaria quem chega logado pelo link.
    expect(rota('/redefinir-senha').permiteLogado).toBe(true)
  })

  it('reconhece a rota de redefinição quando o link contém o token na query', () => {
    const router = createRouter({ routes, raiz: document.body, shells: {} })

    expect(router.match('/redefinir-senha?token=token-de-teste')).toBe(rota('/redefinir-senha'))
  })
})

describe('tela de login montada pelo app', () => {
  it('renderiza o formulário com a marca e as rotas do app', () => {
    const root = montar('/login')

    expect(root.querySelector('.auth')).toBeTruthy()
    expect(root.textContent).toContain('Prime Açaí')
    expect(root.textContent).toContain('Use o e-mail cadastrado na Prime Açaí.')

    expect(root.querySelector('#auth-email')).toBeTruthy()
    expect(root.querySelector('#auth-senha')).toBeTruthy()
    expect(root.querySelector('#btn-login')).toBeTruthy()

    expect(root.querySelector('a[href="#/recuperar-senha"]')).toBeTruthy()
    expect(root.querySelector('a[href="#/cadastro"]')).toBeTruthy()
  })

  it('o botão de olho alterna o type da senha sem apagar o valor digitado', () => {
    const root = montar('/login')
    const senha = root.querySelector('#auth-senha')

    senha.value = 'minha-senha'
    expect(senha.type).toBe('password')

    root.querySelector('[data-olho="senha"]').click()
    expect(senha.type).toBe('text')
    expect(senha.value).toBe('minha-senha')

    root.querySelector('[data-olho="senha"]').click()
    expect(senha.type).toBe('password')
    expect(senha.value).toBe('minha-senha')
  })

  it('e-mail inválido mostra o erro do campo e não chama o backend', () => {
    const root = montar('/login')
    const form = root.querySelector('#form-login')

    form.elements.email.value = 'nao-e-email'
    form.elements.senha.value = 'seja-o-que-for'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    const erro = root.querySelector('#erro-email')
    expect(erro.hidden).toBe(false)
    expect(erro.textContent).toMatch(/inválido/i)

    // O botão segue livre (não ficou em "Carregando…"), ou seja, nada foi enviado.
    expect(root.querySelector('#btn-login').disabled).toBe(false)
  })
})
