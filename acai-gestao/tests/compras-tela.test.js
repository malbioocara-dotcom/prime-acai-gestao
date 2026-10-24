/**
 * A tela de Compras montada de verdade no DOM, em modo demonstração
 * (`neonConfigurado: false`): sem rede, com os produtos de exemplo e permissões
 * liberadas. Prova que a página monta, lista produtos, adiciona item e salva.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

const { comprasPage, fornecedoresPage } = await import('../src/pages/compras.js')
const { criarFornecedor, registrarCompra } = await import('../src/services/compras.js')

let root
let desmontar

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = comprasPage()
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

const linhasDe = (id) => root.querySelectorAll(`#${id} tbody tr`)

describe('tela de Compras', () => {
  it('abre na lista de compras com o botão de nova compra e a aba de fornecedores', () => {
    expect(root.querySelector('.page-title')).toBeNull()
    expect(root.querySelector('.page-subtitle').textContent)
      .toBe('Registre a compra, receba a mercadoria e dê entrada no estoque com custo e validade.')
    expect([...root.querySelectorAll('.compras-tab')].map((aba) => aba.textContent.trim()))
      .toEqual(['Compra', 'Fornecedores'])
    expect(root.querySelector('[data-painel="compra"]').hidden).toBe(false)
    expect(root.querySelector('[data-painel="compra"] .card__title')).toBeNull()
    expect(root.querySelector('[data-painel="compra"] .card__desc').textContent)
      .toBe('Consulte as compras registradas, acompanhe o recebimento e veja o histórico.')
    expect(root.querySelector('[data-painel="nova"]').hidden).toBe(true)
    expect(root.querySelector('[data-painel="fornecedores"]')).toBeTruthy()
    expect(root.querySelector('[data-acao="nova-compra"]').textContent).toContain('Nova compra')
    expect(root.querySelector('[data-acao="nova-compra"]').classList.contains('btn--primary')).toBe(true)
    expect(root.querySelector('[data-kpi="comprasPendentes"]')).toBeTruthy()
    expect(root.querySelector('[data-kpi="comprasValorPendente"]')).toBeTruthy()
  })

  it('abre Fornecedores diretamente na listagem, sem exibir a tela de compras', async () => {
    desmontar?.()
    const pagina = fornecedoresPage()
    root.innerHTML = pagina.html
    desmontar = pagina.mount(root)
    await tick()

    expect(root.querySelector('[data-painel="fornecedores"]').hidden).toBe(false)
    expect(root.querySelector('[data-tab="fornecedores"]').getAttribute('aria-selected')).toBe('true')
    expect(root.querySelector('.page-head').hidden).toBe(true)
    expect(root.querySelector('.grid--stats').hidden).toBe(true)
    expect(root.querySelector('[data-painel="compra"]').hidden).toBe(true)
    expect(root.querySelector('[data-painel="nova"]').hidden).toBe(true)
  })

  it('abre o formulário pelo botão Nova compra e permite voltar à listagem', () => {
    root.querySelector('[data-acao="nova-compra"]').click()
    expect(root.querySelector('[data-painel="nova"]').hidden).toBe(false)
    expect(root.querySelector('[data-painel="compra"]').hidden).toBe(true)

    root.querySelector('[data-acao="voltar-compras"]').click()
    expect(root.querySelector('[data-painel="compra"]').hidden).toBe(false)
    expect(root.querySelector('[data-painel="nova"]').hidden).toBe(true)
    expect(root.querySelector('[data-tab="compra"]').getAttribute('aria-selected')).toBe('true')
  })

  it('só indica que o número da nota é opcional quando a compra é sem nota fiscal', () => {
    const tipoDocumento = root.querySelector('#compra-documento')
    const numeroNota = root.querySelector('#compra-nota')
    const ajuda = root.querySelector('#compra-nota-ajuda')

    expect(tipoDocumento.value).toBe('sem_nota')
    expect(numeroNota.placeholder).toBe('Opcional para compra sem nota')
    expect(ajuda.textContent).toBe('Deixe em branco somente quando a compra for sem nota fiscal.')

    tipoDocumento.value = 'com_nota'
    tipoDocumento.dispatchEvent(new Event('change'))

    expect(numeroNota.placeholder).toBe('Informe o número da nota fiscal')
    expect(ajuda.textContent).toBe('Obrigatório para compras com nota fiscal.')

    tipoDocumento.value = 'sem_nota'
    tipoDocumento.dispatchEvent(new Event('change'))
    expect(numeroNota.placeholder).toBe('Opcional para compra sem nota')
  })

  it('carrega os produtos de exemplo no seletor de item', () => {
    const select = root.querySelector('#item-produto')
    expect(select.disabled).toBe(false)
    expect([...select.options].some((o) => o.value === 'P001')).toBe(true)
    expect([...select.options].some((o) => o.value === 'P005')).toBe(true)
  })

  it('formata CPF/CNPJ e limita telefone e WhatsApp ao número brasileiro', () => {
    root.querySelector('[data-tab="fornecedores"]').click()
    root.querySelector('[data-acao="novo-fornecedor"]').click()

    const modal = document.querySelector('.modal')
    const documento = modal.querySelector('[name="cnpj"]')
    const telefone = modal.querySelector('[name="telefone"]')
    const whatsapp = modal.querySelector('[name="whatsapp"]')
    const rotuloDocumento = documento.closest('.campo').querySelector('.campo__label')

    expect(modal.textContent).toContain('Nome / Razão Social')
    expect([...modal.querySelectorAll('.campo__label')].map((label) => label.textContent.trim()))
      .toEqual(['Nome / Razão Social *', 'CPF ou CNPJ', 'Telefone', 'WhatsApp', 'E-mail', 'Observações'])

    documento.value = '52998224725'
    documento.dispatchEvent(new Event('input'))
    expect(documento.value).toBe('529.982.247-25')
    expect(rotuloDocumento.textContent).toBe('CPF')

    documento.value = '11222333000181'
    documento.dispatchEvent(new Event('input'))
    expect(documento.value).toBe('11.222.333/0001-81')
    expect(rotuloDocumento.textContent).toBe('CNPJ')

    telefone.value = '11987654321'
    telefone.dispatchEvent(new Event('input'))
    whatsapp.value = '1133334444'
    whatsapp.dispatchEvent(new Event('input'))
    expect(telefone.value).toBe('(11) 98765-4321')
    expect(whatsapp.value).toBe('(11) 3333-4444')
    expect(telefone.maxLength).toBe(15)
    expect(whatsapp.maxLength).toBe(15)

    telefone.value = '119876543210'
    telefone.dispatchEvent(new Event('input'))
    documento.value = '112223330001819'
    documento.dispatchEvent(new Event('input'))
    expect(telefone.value.replace(/\D/g, '')).toHaveLength(11)
    expect(documento.value.replace(/\D/g, '')).toHaveLength(14)
  })

  it('salva o fornecedor com CPF, telefone e WhatsApp formatados', async () => {
    root.querySelector('[data-tab="fornecedores"]').click()
    root.querySelector('[data-acao="novo-fornecedor"]').click()

    const modal = document.querySelector('.modal')
    modal.querySelector('[name="nome"]').value = 'Fornecedor de teste'
    modal.querySelector('[name="cnpj"]').value = '52998224725'
    modal.querySelector('[name="telefone"]').value = '1133334444'
    modal.querySelector('[name="whatsapp"]').value = '11987654321'
    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()

    expect(document.querySelector('.modal')).toBeNull()
    expect(root.querySelector('#tabela-fornecedores').textContent).toContain('529.982.247-25')
    expect(root.querySelector('#tabela-fornecedores').textContent).toContain('(11) 3333-4444')
    expect(root.querySelector('#tabela-fornecedores').textContent).toContain('WhatsApp: (11) 98765-4321')
    expect(document.querySelector('#toasts').textContent).toContain('apenas nesta sessão')
    expect(document.querySelector('#toasts').textContent).toContain('Neon não está configurado')
  })

  it('valida documento e limites de dígitos também no serviço de fornecedores', () => {
    expect(() => criarFornecedor({ nome: 'Fornecedor', cnpj: '11111111111' }))
      .toThrow('Informe um CPF válido com 11 dígitos ou um CNPJ válido com 14 dígitos.')
    expect(() => criarFornecedor({ nome: 'Fornecedor', telefone: '119876543210' }))
      .toThrow('O telefone deve conter DDD e 10 ou 11 dígitos.')
    expect(() => criarFornecedor({ nome: 'Fornecedor', whatsapp: '119876543210' }))
      .toThrow('O WhatsApp deve conter DDD e 10 ou 11 dígitos.')
  })

  it('mantém o nome do fornecedor na compra de demonstração e usa fallback só sem vínculo', async () => {
    const itens = [{
      produtoId: 'P001',
      nome: 'Açaí tradicional',
      unidadeCompra: 'un',
      fatorConversao: 1,
      quantidadeSolicitada: 1,
      custoUnitario: 10,
    }]
    const comFornecedor = await registrarCompra({
      fornecedorId: 'fornecedor-1',
      fornecedorNome: 'Fornecedor selecionado',
      itens,
    })
    const semFornecedor = await registrarCompra({ itens })

    expect(comFornecedor.dados.fornecedorNome).toBe('Fornecedor selecionado')
    expect(semFornecedor.dados.fornecedorNome).toBe('Sem fornecedor')
    expect(comFornecedor.dados.itens[0].unidadeCompra).toBe('UN')
  })

  it('adiciona um item com conversão e calcula o total', () => {
    const produto = root.querySelector('#item-produto')
    produto.value = 'P001'
    produto.dispatchEvent(new Event('change'))

    root.querySelector('#item-unidade').value = 'cx'
    root.querySelector('#item-unidade').dispatchEvent(new Event('input'))
    expect(root.querySelector('#item-unidade').value).toBe('CX')
    root.querySelector('#item-fator').value = '12'
    root.querySelector('#item-qtd').value = '2'
    root.querySelector('#item-custo').value = '10,00'
    root.querySelector('#item-adicionar').click()

    expect(linhasDe('tabela-itens-novos')).toHaveLength(1)
    expect(root.querySelector('#tabela-itens-novos').textContent).toContain('2 CX')
    expect(root.querySelector('#tabela-itens-novos').textContent).toContain('24 un')
    expect(root.querySelector('#novo-resumo').textContent).toContain('20,00')
  })

  it('salva o rascunho e mostra a compra no histórico', async () => {
    root.querySelector('[data-acao="nova-compra"]').click()
    const produto = root.querySelector('#item-produto')
    produto.value = 'P001'
    produto.dispatchEvent(new Event('change'))
    root.querySelector('#item-qtd').value = '1'
    root.querySelector('#item-custo').value = '10,00'
    root.querySelector('#item-adicionar').click()

    root.querySelector('#compra-salvar-rascunho').click()
    await tick()
    await tick()

    expect(root.querySelector('[data-painel="compra"]').hidden).toBe(false)
    expect(root.querySelector('[data-painel="nova"]').hidden).toBe(true)
    expect(linhasDe('tabela-historico')).toHaveLength(1)
    expect(root.querySelector('#tabela-historico').textContent).toContain('C-')
  })
})
