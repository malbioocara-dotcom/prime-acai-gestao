/**
 * A tela de Estoque montada de verdade no DOM, em modo demonstração
 * (`neonConfigurado: false`): sem rede, com dados de exemplo e permissões
 * liberadas. É o que prova que o cadastro novo — tipo de venda, recipientes e
 * tara — monta, desenha e abre os formulários.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

const { estoquePage } = await import('../src/pages/estoque.js')

let avisos = []

beforeEach(() => {
  document.body.innerHTML = ''
  avisos = []
  vi.spyOn(console, 'warn').mockImplementation((...args) => avisos.push(args.join(' ')))
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

const linhasDe = (root, id) => root.querySelectorAll(`#${id} tbody tr`)

/** Espera o ciclo de microtarefas (as consultas caem aqui no modo demo). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('tela de Estoque — produtos', () => {
  it('lista os itens com o tipo de venda e a situação', () => {
    const root = montar()

    expect(linhasDe(root, 'tabela-estoque')).toHaveLength(10)
    expect(root.textContent).toContain('Açaí tradicional 300ml')
    expect(root.textContent).toContain('Por unidade')
    expect(root.textContent).toContain('Repor') // P003, abaixo do minimo
  })

  it('os indicadores contam só item ativo e com ponto de reposição definido', () => {
    const root = montar()

    const kpi = (nome) => root.querySelector(`[data-kpi="${nome}"] .stat__value`).textContent
    expect(kpi('itensCadastrados')).toBe('10')
    // P003 (22<30), P005 (9<15), P007 (6<12) e P010 (250<400)
    expect(kpi('abaixoMinimo')).toBe('4')
  })

  it('a busca filtra as linhas', () => {
    const root = montar()
    const input = root.querySelector('#busca-estoque')

    input.value = 'granola'
    input.dispatchEvent(new Event('input'))

    expect(linhasDe(root, 'tabela-estoque')).toHaveLength(1)
    expect(root.querySelector('#contagem-estoque').textContent).toBe('1 de 10 itens')
  })

  it('o formulário de novo item traz os campos do cadastro por tipo de venda', async () => {
    const root = montar()
    root.querySelector('[data-acao="novo-produto"]').click()
    await tick()

    const campo = (nome) => document.querySelector(`#campo-${nome}`)
    expect(campo('categoria').tagName).toBe('SELECT')
    expect([...campo('categoria').options].map((opcao) => opcao.textContent)).toContain('Açaí')
    for (const nome of [
      'codigo',
      'nome',
      'descricao',
      'categoria',
      'tipoVenda',
      'metodoPeso',
      'preco',
      'unidade',
      'controlaEstoque',
      'metodoEstoque',
      'quantidade',
      'minimo',
      'custo',
      'ativo',
    ]) {
      expect(campo(nome), `campo ${nome} ausente`).toBeTruthy()
    }

    // O tipo de venda oferece as três formas, incluindo por peso.
    const tipos = [...campo('tipoVenda').options].map((o) => o.value)
    expect(tipos).toEqual(['unidade', 'peso', 'receita'])

    // Só os métodos de peso executáveis — a balança integrada fica de fora.
    const metodos = [...campo('metodoPeso').options].map((o) => o.value)
    expect(metodos).toEqual(['liquido', 'bruto_tara'])

    // Código sugerido na sequência do que já existe.
    expect(campo('codigo').value).toBe('P011')
  }, 15000)
})

describe('tela de Estoque — livro-razão do saldo', () => {
  const campo = (nome) => document.querySelector(`#campo-${nome}`)
  const submeter = async () => {
    document.querySelector('.modal__form').dispatchEvent(new Event('submit'))
    await tick()
    await tick()
  }

  it('cada item oferece movimentar, contar e ver o histórico', () => {
    const root = montar()

    expect(linhasDe(root, 'tabela-estoque').length).toBeGreaterThan(0)
    expect(root.querySelector('[data-acao="movimentar-produto"]')).toBeTruthy()
    expect(root.querySelector('[data-acao="contar-produto"]')).toBeTruthy()
    expect(root.querySelector('[data-acao="historico-movimentacoes"]')).toBeTruthy()
  })

  it('o formulário de movimentação pede origem, destino, quantidade e motivo', () => {
    const root = montar()
    root.querySelector('[data-acao="movimentar-produto"]').click()

    for (const nome of ['operacao', 'origem', 'destino', 'quantidade', 'motivo']) {
      expect(campo(nome), `campo ${nome} ausente`).toBeTruthy()
    }

    // Já vem no atalho mais comum da loja: compra (fornecedor → estoque).
    expect(campo('operacao').value).toBe('compra')
    expect(campo('origem').value).toBe('fornecedor')
    expect(campo('destino').value).toBe('estoque')
  })

  it('a contagem já vem com o saldo que o sistema diz', () => {
    const root = montar()
    root.querySelector('[data-acao="contar-produto"]').click()

    // P001 tem 86 no cadastro de exemplo.
    expect(campo('contado').value).toBe('86')
    expect(campo('local').value).toBe('contagem')
  })

  it('movimentar em modo demonstração move o saldo na tela e avisa', async () => {
    const root = montar()
    root.querySelector('[data-acao="movimentar-produto"]').click()

    campo('quantidade').value = '10'
    campo('motivo').value = 'Compra de teste'
    await submeter()

    // 86 + 10 (fornecedor → estoque).
    expect(root.textContent).toContain('96 un')
    expect(document.querySelector('.toast')?.textContent ?? '').toMatch(/nesta sessão/i)
  })

  it('a contagem registra a diferença, não o total', async () => {
    const root = montar()
    root.querySelector('[data-acao="contar-produto"]').click()

    campo('contado').value = '90'
    campo('motivo').value = 'Conferência'
    campo('local').value = 'abertura'
    await submeter()

    expect(root.textContent).toContain('90 un')
  })

  it('o Histórico de movimentação abre o painel (no modo demonstração avisa que depende do banco)', async () => {
    const root = montar()
    const painel = root.querySelector('#card-movimentacoes')

    expect(painel.hidden).toBe(true)

    root.querySelector('[data-acao="historico-movimentacoes"]').click()
    await tick()

    expect(painel.hidden).toBe(false)
    expect(painel.textContent).toMatch(/livro-razão|banco/i)

    painel.querySelector('[data-acao="fechar-movimentacoes"]').click()
    expect(painel.hidden).toBe(true)
  })
})

describe('tela de Estoque — recipientes e tara', () => {
  it('lista recipientes com a tara e a situação', () => {
    const root = montar()

    expect(linhasDe(root, 'tabela-recipientes')).toHaveLength(5)
    expect(root.textContent).toContain('Copo 500ml com tampa')
    expect(root.textContent).toContain('16 g')
    expect(root.textContent).toContain('Inativo') // a tigela fora de uso
  })

  it('com permissão de editar, o botão Editar aparece', () => {
    const root = montar()

    expect(root.querySelector('[data-acao="editar-recipiente"]')).toBeTruthy()
  })

  it('o botão Histórico tem ícone de verdade (não ficou um <i> vazio)', () => {
    const root = montar()

    const botao = root.querySelector('[data-acao="historico-recipiente"]')
    expect(botao.querySelector('svg')).toBeTruthy()
    expect(avisos.join('\n')).not.toMatch(/not found/i)
  })

  it('o formulário de recipiente pede a tara em gramas', () => {
    const root = montar()
    root.querySelector('[data-acao="novo-recipiente"]').click()

    expect(document.querySelector('#campo-nome')).toBeTruthy()
    const tara = document.querySelector('#campo-tara')
    expect(tara).toBeTruthy()
    expect(tara.closest('.campo').textContent).toMatch(/gramas/i)
  })

  it('Histórico abre o painel (no modo demonstração avisa que depende do banco)', async () => {
    const root = montar()
    const painel = root.querySelector('#card-historico')

    expect(painel.hidden).toBe(true)

    root.querySelector('[data-acao="historico-recipiente"]').click()
    await tick()

    expect(painel.hidden).toBe(false)
    expect(painel.textContent).toContain('Copo')
    expect(painel.textContent).toMatch(/banco/i)

    painel.querySelector('[data-acao="fechar-historico"]').click()
    expect(painel.hidden).toBe(true)
  })
})
