// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  tipos: [
    { id: 'tipo-balcao', codigo: 'balcao', nome: 'Balcão', categoria: 'balcao', ativo: true },
    { id: 'tipo-delivery', codigo: 'delivery_proprio', nome: 'Delivery próprio', categoria: 'delivery', ativo: true },
    { id: 'tipo-app', codigo: 'aplicativo', nome: 'Aplicativo', categoria: 'aplicativo', ativo: true },
  ],
  pagamentos: [
    { id: 'pag-pix', nome: 'PIX', categoria: 'pix', ativo: true },
    { id: 'pag-dinheiro', nome: 'Dinheiro', categoria: 'dinheiro', ativo: true },
  ],
}))

vi.mock('../src/services/base.js', () => ({
  hoje: () => '2026-10-20',
  observar: () => () => {},
}))
vi.mock('../src/services/clientes.js', () => ({
  listarClientes: async () => ({ dados: [], origem: 'exemplo' }),
}))
vi.mock('../src/services/produtos.js', () => ({
  listarProdutos: async () => ({
    dados: [{ id: 'prod-1', nome: 'Açaí 300ml', preco: 12, tipoVenda: 'unidade' }],
    origem: 'exemplo',
  }),
}))
vi.mock('../src/services/recipientes.js', () => ({
  listarRecipientes: async () => ({ dados: [], origem: 'exemplo' }),
}))
vi.mock('../src/services/config-vendas.js', () => ({
  listarTiposVenda: async () => ({ dados: fixture.tipos, origem: 'exemplo' }),
  listarFormasPagamento: async () => ({ dados: fixture.pagamentos, origem: 'exemplo' }),
}))
vi.mock('../src/services/resumo.js', () => ({
  carregarResumo: async () => ({ dados: {}, origem: 'exemplo' }),
}))
vi.mock('../src/services/vendas.js', () => ({
  estornarVenda: vi.fn(),
  LIMITE_DIA: 300,
  listarVendas: async () => ({ dados: [], origem: 'exemplo' }),
  proximoCodigoVenda: async () => '#1',
  registrarVenda: vi.fn(),
}))
vi.mock('../src/services/permissoes.js', () => ({
  pode: () => true,
}))

const { vendasPage } = await import('../src/pages/vendas.js')

let root
let desmontar

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = vendasPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
})

afterEach(() => {
  desmontar?.()
  document.body.innerHTML = ''
  document.body.classList.remove('sem-scroll')
  vi.restoreAllMocks()
})

describe('formulário de venda por canal e forma de pagamento', () => {
  it('mostra campos de delivery, aplicativo e troco apenas quando aplicáveis', async () => {
    root.querySelector('[data-acao="nova-venda"]').click()
    await tick()
    const modal = document.querySelector('.modal')
    expect(modal).toBeTruthy()

    const tipo = modal.querySelector('[name="tipoVendaId"]')
    const forma = modal.querySelector('[name="formaPagamentoId"]')
    const endereco = modal.querySelector('[data-campo="enderecoEntrega"]')
    const plataforma = modal.querySelector('[data-campo="plataforma"]')
    const dinheiro = modal.querySelector('[data-campo="valorRecebido"]')

    expect(endereco.hidden).toBe(true)
    expect(plataforma.hidden).toBe(true)
    expect(dinheiro.hidden).toBe(true)

    tipo.value = 'tipo-delivery'
    tipo.dispatchEvent(new Event('change', { bubbles: true }))
    expect(endereco.hidden).toBe(false)
    expect(plataforma.hidden).toBe(true)

    tipo.value = 'tipo-app'
    tipo.dispatchEvent(new Event('change', { bubbles: true }))
    expect(endereco.hidden).toBe(false)
    expect(plataforma.hidden).toBe(false)

    forma.value = 'pag-dinheiro'
    forma.dispatchEvent(new Event('change', { bubbles: true }))
    expect(dinheiro.hidden).toBe(false)
  })
})
