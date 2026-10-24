// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

const { configProdutosPage, configVendasPage } = await import('../src/pages/config-vendas.js')

let root
let desmontar

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = configVendasPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
  await tick()
})

afterEach(() => {
  desmontar?.()
  document.body.innerHTML = ''
  document.body.classList.remove('sem-scroll')
  vi.restoreAllMocks()
})

describe('configuração de tipos de venda e pagamentos', () => {
  it('exibe um cadastro por vez e alterna pelo submenu de Vendas', () => {
    const abaTipos = root.querySelector('[data-aba-vendas="tipo"]')
    const abaPagamentos = root.querySelector('[data-aba-vendas="pagamento"]')
    const abaCategoriasTipo = root.querySelector('[data-aba-vendas="categoriaTipo"]')
    const painelTipos = root.querySelector('[data-painel-vendas="tipo"]')
    const painelPagamentos = root.querySelector('[data-painel-vendas="pagamento"]')

    expect(abaTipos.textContent).toContain('Tipos de venda')
    expect(abaPagamentos.textContent).toContain('Formas de pagamento')
    expect(abaCategoriasTipo.textContent).toContain('Categorias de tipos')
    expect([...root.querySelectorAll('[data-aba-vendas]')].map((aba) => aba.dataset.abaVendas))
      .toEqual(['tipo', 'categoriaTipo', 'pagamento'])
    expect(painelTipos.hidden).toBe(false)
    expect(root.querySelector('[data-painel-vendas="categoria"]')).toBeNull()
    expect(painelPagamentos.hidden).toBe(true)

    abaCategoriasTipo.click()
    expect(root.querySelector('[data-painel-vendas="categoriaTipo"]').hidden).toBe(false)
    expect(root.querySelector('[data-painel-vendas="tipo"]').hidden).toBe(true)

    abaPagamentos.click()

    expect(abaPagamentos.getAttribute('aria-selected')).toBe('true')
    expect(painelTipos.hidden).toBe(true)
    expect(painelPagamentos.hidden).toBe(false)
  })

  it('não repete o título do cadastro dentro do painel selecionado', () => {
    expect(root.querySelectorAll('.config-vendas__painel h2')).toHaveLength(0)
    expect(root.querySelector('[data-painel-vendas="tipo"]')
      .getAttribute('aria-labelledby')).toBe('aba-vendas-tipo')
    expect(root.querySelector('[data-painel-vendas="pagamento"]')
      .getAttribute('aria-labelledby')).toBe('aba-vendas-pagamento')
    expect(root.querySelector('[data-painel-vendas="categoriaTipo"]')
      .getAttribute('aria-labelledby')).toBe('aba-vendas-categoria-tipo')
  })

  it('mostra os canais e as formas iniciais no modo demonstração', () => {
    expect(root.textContent).toContain('Balcão')
    expect(root.textContent).toContain('Delivery próprio')
    expect(root.textContent).toContain('Aplicativo')
    expect(root.textContent).toContain('Cartão de crédito')
    expect(root.textContent).toContain('PIX')
  })

  it('filtra o catálogo por pesquisa', () => {
    const busca = root.querySelector('[data-busca="tipo"]')
    busca.value = 'delivery'
    busca.dispatchEvent(new Event('input', { bubbles: true }))

    expect(root.querySelector('[data-linhas="tipo"]').textContent).toContain('Delivery próprio')
    expect(root.querySelector('[data-linhas="tipo"]').textContent).not.toContain('Aplicativo')
  })

  it('lista, pesquisa e cadastra categorias na seção de Produtos', async () => {
    desmontar()
    const pagina = configProdutosPage()
    root.innerHTML = pagina.html
    desmontar = pagina.mount(root)
    await tick()

    expect(root.querySelector('[data-linhas="categoria"]').textContent).toContain('Açaí')
    expect(root.querySelector('[data-painel-vendas="categoria"]')
      .getAttribute('aria-labelledby')).toBe('btn-produtos')
    expect(root.querySelector('[data-aba-vendas]')).toBeNull()

    const busca = root.querySelector('[data-busca="categoria"]')
    busca.value = 'frutas'
    busca.dispatchEvent(new Event('input', { bubbles: true }))
    expect(root.querySelector('[data-linhas="categoria"]').textContent).toContain('Frutas')
    expect(root.querySelector('[data-linhas="categoria"]').textContent).not.toContain('Embalagens')

    busca.value = ''
    busca.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector('[data-novo="categoria"]').click()
    const modal = document.querySelector('.modal')
    modal.querySelector('[name="nome"]').value = 'Picolés'
    modal.querySelector('[name="descricao"]').value = 'Produtos congelados'
    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()

    expect(document.querySelector('.modal')).toBeNull()
    expect(root.querySelector('[data-linhas="categoria"]').textContent).toContain('Picolés')

    const linha = [...root.querySelectorAll('[data-linhas="categoria"] tr')]
      .find((registro) => registro.textContent.includes('Picolés'))
    linha.querySelector('[data-editar="categoria"]').click()
    const modalEdicao = document.querySelector('.modal')
    modalEdicao.querySelector('[name="descricao"]').value = 'Linha de congelados'
    modalEdicao.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()

    const linhaEditada = [...root.querySelectorAll('[data-linhas="categoria"] tr')]
      .find((registro) => registro.textContent.includes('Picolés'))
    expect(linhaEditada.textContent).toContain('Linha de congelados')
    linhaEditada.querySelector('[data-alternar="categoria"]').click()
    await tick()
    const linhaInativa = [...root.querySelectorAll('[data-linhas="categoria"] tr')]
      .find((registro) => registro.textContent.includes('Picolés'))
    expect(linhaInativa.textContent).toContain('Inativa')
  })

  it('permite cadastrar um tipo personalizado sem apagar os padrões', async () => {
    root.querySelector('[data-novo="tipo"]').click()
    const modal = document.querySelector('.modal')
    modal.querySelector('[name="nome"]').value = 'Retirada no local'
    modal.querySelector('[name="categoria"]').value = 'personalizado'
    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()

    expect(document.querySelector('.modal')).toBeNull()
    expect(root.querySelector('[data-linhas="tipo"]').textContent).toContain('Retirada no local')
    expect(root.querySelector('[data-linhas="tipo"]').textContent).toContain('Delivery próprio')
  })

  it('permite cadastrar uma categoria e selecioná-la em um novo tipo de venda', async () => {
    root.querySelector('[data-aba-vendas="categoriaTipo"]').click()
    root.querySelector('[data-novo="categoriaTipo"]').click()
    const modalCategoria = document.querySelector('.modal')
    modalCategoria.querySelector('[name="nome"]').value = 'Retirada agendada'
    modalCategoria.querySelector('[name="descricao"]').value = 'Pedidos com horário marcado'
    modalCategoria.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()

    expect(root.querySelector('[data-linhas="categoriaTipo"]').textContent).toContain('Retirada agendada')

    root.querySelector('[data-aba-vendas="tipo"]').click()
    root.querySelector('[data-novo="tipo"]').click()
    const modalTipo = document.querySelector('.modal')
    expect([...modalTipo.querySelector('[name="categoria"]').options].map((option) => option.value))
      .toContain('retirada_agendada')
    modalTipo.querySelector('[name="nome"]').value = 'Agendamento'
    modalTipo.querySelector('[name="categoria"]').value = 'retirada_agendada'
    modalTipo.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()

    const linha = [...root.querySelectorAll('[data-linhas="tipo"] tr')]
      .find((registro) => registro.textContent.includes('Agendamento'))
    expect(linha.textContent).toContain('Retirada agendada')
  })
})
