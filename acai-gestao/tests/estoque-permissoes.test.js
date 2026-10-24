/**
 * A tela de Estoque vista por quem NÃO pode cadastrar nem editar no módulo —
 * o caso do operador de caixa (só `ver` e `consultar`).
 *
 * O que está em jogo: a tara entra na conta da venda por peso, então editar
 * recipiente é escrita, não leitura. O banco recusa (`estoque.editar` no RLS);
 * a tela não pode oferecer o botão. Movimentar/Contar/Editar somem, o
 * Histórico (leitura) fica.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

vi.mock('../src/services/permissoes.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    pode: (modulo, acao) => !(modulo === 'estoque' && (acao === 'criar' || acao === 'editar')),
  }
})

const { estoquePage } = await import('../src/pages/estoque.js')

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Monta a página num #app limpo, como o roteador faz. */
function montar() {
  const pagina = estoquePage()
  document.body.innerHTML = '<div id="app"></div>'
  const root = document.querySelector('#app')
  root.innerHTML = pagina.html
  pagina.mount(root)
  return root
}

describe('tela de Estoque — perfil sem permissão de escrita', () => {
  it('não oferece os botões de criar (produto e recipiente)', () => {
    const root = montar()

    expect(root.querySelector('[data-acao="novo-produto"]')).toBeNull()
    expect(root.querySelector('[data-acao="novo-recipiente"]')).toBeNull()
  })

  it('nas linhas de produto mostra só o Histórico', () => {
    const root = montar()
    const linha = root.querySelector('#tabela-estoque tbody tr')

    const acoes = [...linha.querySelectorAll('button')].map((b) => b.dataset.acao)
    expect(acoes).toEqual(['historico-movimentacoes'])
  })

  it('nas linhas de recipiente mostra só o Histórico da tara', () => {
    const root = montar()
    const linha = root.querySelector('#tabela-recipientes tbody tr')

    const acoes = [...linha.querySelectorAll('button')].map((b) => b.dataset.acao)
    expect(acoes).toEqual(['historico-recipiente'])
  })

  it('o Histórico de movimentação continua abrindo', async () => {
    const root = montar()
    const painel = root.querySelector('#card-movimentacoes')

    expect(painel.hidden).toBe(true)

    root.querySelector('[data-acao="historico-movimentacoes"]').click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(painel.hidden).toBe(false)
  })
})
