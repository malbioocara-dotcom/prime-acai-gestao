/**
 * Teste de integração das peças de UI: monta o HTML de verdade e confere que a
 * marca configurada aparece, que o texto é escapado e que as rotas respeitam a
 * configuração.
 *
 * Precisa do `lucide` instalado (é uma peerDependency). Sem ele, o teste é
 * PULADO — assim `npm test` também passa num clone limpo.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { config, configurarLogin } from '../src/config.js'

let authUi = null
try {
  authUi = await import('../src/auth-ui.js')
} catch {
  authUi = null
}

const semLucide = authUi === null ? 'instale as peerDependencies (lucide) para rodar' : false

describe('layoutAuth', { skip: semLucide }, () => {
  test('usa a marca configurada no painel lateral', () => {
    configurarLogin({
      marca: {
        nome: 'Doce Vida',
        assinatura: 'Sorveteria',
        icone: 'ice-cream-cone',
        chamada: 'Tudo sob controle.',
        pontos: ['Vendas', 'Estoque'],
      },
    })

    const html = authUi.layoutAuth({ titulo: 'Entrar', conteudo: '<p>oi</p>' })

    assert.match(html, /<strong>Doce Vida<\/strong>/)
    assert.match(html, /<small>Sorveteria<\/small>/)
    assert.match(html, /data-lucide="ice-cream-cone"/)
    assert.match(html, /Tudo sob controle\./)
    assert.match(html, /<li><i data-lucide="check"><\/i> Vendas<\/li>/)
    assert.match(html, /<h1>Entrar<\/h1>/)

    configurarLogin({
      marca: {
        nome: 'Meu Sistema',
        assinatura: 'Gestão',
        icone: 'store',
        chamada: 'A gestão do seu negócio em um só lugar.',
        pontos: ['Pedidos e status em tempo real', 'Estoque com ponto de reposição', 'Caixa e margem do mês'],
      },
    })
  })

  test('escapa o nome da marca (não injeta HTML)', () => {
    configurarLogin({ marca: { nome: '<script>alert(1)</script>' } })

    const html = authUi.layoutAuth({ titulo: 'Entrar', conteudo: '' })

    assert.ok(!html.includes('<script>alert(1)</script>'))
    assert.match(html, /&lt;script&gt;/)

    configurarLogin({ marca: { nome: 'Meu Sistema' } })
  })

  test('omite o subtítulo quando não há', () => {
    const html = authUi.layoutAuth({ titulo: 'Entrar', conteudo: '' })
    assert.ok(!html.includes('<p></p>'))
  })
})

describe('campoAuth', { skip: semLucide }, () => {
  test('monta input com nome, tipo, ícone e botão de olho', () => {
    const html = authUi.campoAuth({
      nome: 'senha',
      label: 'Senha',
      tipo: 'password',
      icone: 'lock',
      olho: true,
      autocomplete: 'current-password',
    })

    assert.match(html, /id="auth-senha"/)
    assert.match(html, /name="senha"/)
    assert.match(html, /type="password"/)
    assert.match(html, /data-lucide="lock"/)
    assert.match(html, /data-olho="senha"/)
    assert.match(html, /autocomplete="current-password"/)
  })

  test('destaca os campos obrigatórios', () => {
    const html = authUi.campoAuth({ nome: 'email', label: 'E-mail', icone: 'mail', obrigatorio: false })
    assert.ok(!html.includes('required'))
    assert.match(html, /aria-describedby="erro-email"/)
  })
})

describe('regrasSenha', { skip: semLucide }, () => {
  test('marca as regras já cumpridas', () => {
    const html = authUi.regrasSenha([
      { ok: true, texto: 'Pelo menos 8 caracteres' },
      { ok: false, texto: 'Pelo menos um número' },
    ])

    assert.match(html, /data-regra="0" class="is-ok"/)
    assert.match(html, /data-regra="1">/)
  })
})

describe('config.marca padrão', { skip: semLucide }, () => {
  test('tem um ícone válido por padrão', () => {
    assert.equal(typeof config.marca.icone, 'string')
    assert.ok(config.marca.icone.length > 0)
  })
})
