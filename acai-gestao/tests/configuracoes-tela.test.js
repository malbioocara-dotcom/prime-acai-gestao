// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/formulario.js', () => ({
  campoHtml: (campo) => `<div><label>${campo.label}<input class="campo__input" name="${campo.nome}" /></label></div>`,
  confirmar: vi.fn(),
}))

vi.mock('../src/icons.js', () => ({ renderIcons: vi.fn() }))
vi.mock('login-projetos/sessao', () => ({ estadoSessao: { perfil: { papel: 'admin' } } }))
vi.mock('login-projetos/auth', () => ({ emailValido: () => true }))
vi.mock('../src/services/base.js', () => ({ neonConfigurado: false }))
vi.mock('../src/services/empresa.js', () => ({
  FUSOS: [],
  PREFERENCIAS_PADRAO: {},
  UFS: [],
  apenasDigitos: (valor) => String(valor).replace(/\D/g, ''),
  carregarEmpresa: vi.fn(),
  carregarLogo: vi.fn(),
  cepValido: () => true,
  cnpjValido: () => true,
  mascaraCep: (valor) => valor,
  mascaraCnpj: (valor) => valor,
  mascaraTelefone: (valor) => valor,
  mensagemDoErro: (erro) => erro.message,
  removerLogo: vi.fn(),
  salvarEmpresa: vi.fn(),
  salvarLogo: vi.fn(),
  telefoneValido: () => true,
  urlDaLogo: () => null,
  validarLogo: vi.fn(),
}))
vi.mock('../src/ui.js', () => ({
  esc: (valor) => String(valor ?? ''),
  toast: vi.fn(),
}))
vi.mock('../src/pages/usuarios.js', () => ({
  usuariosPage: () => ({ html: '<p>Usuários carregados</p>', mount: vi.fn() }),
}))
vi.mock('../src/pages/permissoes.js', () => ({
  permissoesPage: () => ({ html: '<p>Permissões carregadas</p>', mount: vi.fn() }),
}))
vi.mock('../src/pages/config-vendas.js', () => ({
  configVendasPage: () => ({ html: '<p>Vendas carregadas</p>', mount: vi.fn() }),
  configProdutosPage: () => ({ html: '<p>Categorias carregadas</p>', mount: vi.fn() }),
}))

const { configuracoesPage } = await import('../src/pages/configuracoes.js')

describe('navegação das configurações', () => {
  it('abre a seção inicial e alterna painéis mantendo o estado acessível', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)

    expect(root.querySelector('#painel-empresa').hidden).toBe(false)
    expect(root.querySelector('#btn-empresa').getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('#painel-vendas').hidden).toBe(true)

    root.querySelector('#btn-vendas').click()
    await Promise.resolve()

    expect(root.querySelector('#painel-vendas').hidden).toBe(false)
    expect(root.querySelector('#btn-vendas').getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('#painel-empresa').hidden).toBe(true)
    expect(root.querySelector('#painel-vendas').textContent).toContain('Vendas carregadas')

    root.querySelector('#btn-usuarios').click()
    expect(root.querySelector('#painel-usuarios').hidden).toBe(false)
    expect(root.querySelector('#btn-usuarios').getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('#painel-vendas').hidden).toBe(true)

    desmontar()
    document.body.innerHTML = ''
  })

  it('mostra Produtos antes de Vendas e carrega as categorias nessa seção', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)
    const botoes = [...root.querySelectorAll('[data-painel]')]

    expect(botoes.map((botao) => botao.dataset.painel).slice(-2)).toEqual(['produtos', 'vendas'])

    root.querySelector('#btn-produtos').click()
    expect(root.querySelector('#painel-produtos').hidden).toBe(false)
    expect(root.querySelector('#painel-produtos').textContent).toContain('Categorias carregadas')
    expect(root.querySelector('#painel-vendas').hidden).toBe(true)

    desmontar()
    document.body.innerHTML = ''
  })
})
