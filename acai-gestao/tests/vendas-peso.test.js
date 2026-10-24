// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * A venda por peso, do teclado do balcão até o que sobe para o banco.
 *
 * Em modo demonstração (`neonConfigurado: false`) o formulário monta de
 * verdade, os campos de peso aparecem e desaparecem conforme o produto e o
 * método escolhidos, a prévia do total é a mesma conta de `peso.js` — e, no
 * fim, é o que o serviço mandaria que está sob teste: o peso LIDO, sem preço.
 */

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

const { abrirFormulario } = await import('../src/formulario.js')
const { vendasPage } = await import('../src/pages/vendas.js')
const { formatBRL } = await import('../src/ui.js')
const { hoje } = await import('../src/services/base.js')
const { somarDias } = await import('../src/datas.js')

// `formatBRL` usa o espaço do `Intl` (não é o espaço que se digita), então as
// comparações de texto montam o esperado com a mesma função em vez de literal.
const brl = (valor) => formatBRL(valor)

/* --------------------------------------------------------------- cenário -- */

const SS1 = {
  uuid: 'ss1',
  id: 'P011',
  nome: 'Açaí self-service',
  tipoVenda: 'peso',
  metodoPeso: 'bruto_tara',
  preco: 69.9,
  unidadeVenda: 'kg',
}

const P001 = {
  uuid: 'p1',
  id: 'P001',
  nome: 'Açaí tradicional 300ml',
  tipoVenda: 'unidade',
  metodoPeso: null,
  preco: 15.9,
  unidadeVenda: 'un',
}

const RECIPIENTES = [
  { uuid: 'r300', nome: 'Copo 300ml', tara: 12, ativo: true },
  { uuid: 'r500', nome: 'Copo 500ml', tara: 16, ativo: true },
]

let salvo = null

function abrir() {
  salvo = null
  abrirFormulario({
    titulo: 'Nova venda',
    campos: [
      { nome: 'codigo', label: 'Pedido', tipo: 'texto' },
      {
        nome: 'itens',
        label: 'Itens do pedido',
        tipo: 'itens',
        obrigatorio: true,
        produtos: [SS1, P001],
        recipientes: RECIPIENTES,
      },
    ],
    valores: {},
    textoBotao: 'Registrar venda',
    aoSalvar: async (valores) => {
      salvo = valores
      return 'ok'
    },
  })
}

const linha = (n = 0) => document.querySelectorAll('[data-item]')[n]
const el = (n, atributo) => linha(n).querySelector(`[${atributo}]`)
const todas = (seletor) => [...document.querySelectorAll(seletor)]

function escolher(n, uuid) {
  const select = el(n, 'data-item-produto')
  select.value = uuid
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function trocar(elemento, valor) {
  elemento.value = valor
  elemento.dispatchEvent(new Event('change', { bubbles: true }))
}

function digitar(elemento, valor) {
  elemento.value = valor
  elemento.dispatchEvent(new Event('input', { bubbles: true }))
}

const enviar = () =>
  document.querySelector('.modal__form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  )

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.classList.remove('sem-scroll')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/* ------------------------------------------------------- campos por tipo -- */

describe('itens da venda — o formulário muda com o produto', () => {
  it('produto por unidade pede quantidade e não mostra a balança', () => {
    abrir()
    escolher(0, 'p1')

    expect(el(0, 'data-item-peso').hidden).toBe(true)
    expect(el(0, 'data-item-qtd').hidden).toBe(false)
    expect(el(0, 'data-item-qtd').value).toBe('1')
  })

  it('produto por peso abre a balança, esconde a quantidade e usa o método do cadastro', () => {
    abrir()
    escolher(0, 'ss1')

    expect(el(0, 'data-item-peso').hidden).toBe(false)
    expect(el(0, 'data-item-qtd').hidden).toBe(true)
    expect(el(0, 'data-item-metodo').value).toBe('bruto_tara')
    expect(el(0, 'data-item-campo-bruto').hidden).toBe(false)
    expect(el(0, 'data-item-campo-recipiente').hidden).toBe(false)
    expect(el(0, 'data-item-campo-tara').hidden).toBe(false)
    expect(el(0, 'data-item-campo-liquido').hidden).toBe(true)
  })

  it('recém-aberta, a linha já nasce escondida (nenhum produto escolhido)', () => {
    abrir()
    expect(el(0, 'data-item-peso').hidden).toBe(true)
  })
})

/* --------------------------------------------------------------- a conta -- */

describe('itens da venda — a prévia do peso', () => {
  it('480 g brutos − 30 g de tara = 450 g = R$ 31,46, antes de salvar', () => {
    abrir()
    escolher(0, 'ss1')
    digitar(el(0, 'data-item-bruto'), '480')
    digitar(el(0, 'data-item-tara'), '30')

    expect(el(0, 'data-item-leitura').textContent).toBe(`450 g × ${brl(69.9)}/kg`)
    expect(el(0, 'data-item-sub').textContent).toBe(brl(31.46))
    expect(document.querySelector('[data-itens-total]').textContent).toBe(brl(31.46))
  })

  it('escolher o recipiente do cadastro traz a tara dele e trava o campo', () => {
    abrir()
    escolher(0, 'ss1')

    const recipiente = el(0, 'data-item-recipiente')
    trocar(recipiente, 'r500')

    expect(el(0, 'data-item-tara').value).toBe('16')
    expect(el(0, 'data-item-tara').disabled).toBe(true)

    // 480 − 16 = 464 g
    digitar(el(0, 'data-item-bruto'), '480')
    expect(el(0, 'data-item-sub').textContent).toBe(brl(32.43))

    // voltando para "digitar a tara", o campo volta a aceitar digitação
    trocar(recipiente, '')
    expect(el(0, 'data-item-tara').disabled).toBe(false)
  })

  it('peso já líquido: um campo só, e a tara não é descontada de novo', () => {
    abrir()
    escolher(0, 'ss1')
    trocar(el(0, 'data-item-metodo'), 'liquido')

    expect(el(0, 'data-item-campo-liquido').hidden).toBe(false)
    expect(el(0, 'data-item-campo-bruto').hidden).toBe(true)
    expect(el(0, 'data-item-campo-recipiente').hidden).toBe(true)
    expect(el(0, 'data-item-campo-tara').hidden).toBe(true)

    digitar(el(0, 'data-item-tara'), '30') // sobra de uma escolha anterior
    digitar(el(0, 'data-item-liquido'), '450')

    expect(el(0, 'data-item-sub').textContent).toBe(brl(31.46))
  })

  it('duas linhas somam no total do pedido', () => {
    abrir()
    document.querySelector('[data-itens-add]').click()

    escolher(0, 'ss1')
    digitar(el(0, 'data-item-bruto'), '480')
    digitar(el(0, 'data-item-tara'), '30')

    escolher(1, 'p1')
    digitar(el(1, 'data-item-qtd'), '2')

    // R$ 31,46 + (2 × R$ 15,90)
    expect(document.querySelector('[data-itens-total]').textContent).toBe(brl(63.26))
    expect(todas('[data-item]')).toHaveLength(2)
  })

  it('a última linha não some: ela é limpa', () => {
    abrir()
    escolher(0, 'ss1')
    digitar(el(0, 'data-item-bruto'), '480')

    document.querySelector('[data-item-remover]').click()

    expect(todas('[data-item]')).toHaveLength(1)
    expect(el(0, 'data-item-produto').value).toBe('')
    expect(el(0, 'data-item-bruto').value).toBe('')
    expect(el(0, 'data-item-peso').hidden).toBe(true)
  })
})

/* --------------------------------------------------- o que sobe (e o que não) */

describe('itens da venda — o que vai para o serviço', () => {
  it('manda o peso lido e o recipiente; o preço não sai da tela', async () => {
    abrir()
    escolher(0, 'ss1')
    trocar(el(0, 'data-item-recipiente'), 'r500')
    digitar(el(0, 'data-item-bruto'), '480')

    await enviar()

    expect(salvo.itens).toEqual([
      {
        produtoId: 'ss1',
        descricao: 'Açaí self-service',
        metodoPeso: 'bruto_tara',
        pesoBrutoGramas: 480,
        taraGramas: 16,
        pesoLiquidoGramas: 464,
        recipienteId: 'r500',
        precoUnitario: 69.9,
      },
    ])
  })

  it('no peso já líquido não há recipiente nem tara para gravar', async () => {
    abrir()
    escolher(0, 'ss1')
    trocar(el(0, 'data-item-metodo'), 'liquido')
    digitar(el(0, 'data-item-liquido'), '450')

    await enviar()

    expect(salvo.itens[0]).toMatchObject({
      metodoPeso: 'liquido',
      pesoBrutoGramas: null,
      taraGramas: null,
      pesoLiquidoGramas: 450,
      recipienteId: null,
    })
  })

  it('a venda por unidade continua igual: quantidade e preço do item', async () => {
    abrir()
    escolher(0, 'p1')
    digitar(el(0, 'data-item-qtd'), '3')

    await enviar()

    expect(salvo.itens).toEqual([
      { produtoId: 'p1', descricao: 'Açaí tradicional 300ml', quantidade: 3, precoUnitario: 15.9 },
    ])
  })
})

/* -------------------------------------------------------------- recusas -- */

describe('itens da venda — o que é recusado na tela', () => {
  it('tara maior que o peso bruto', async () => {
    abrir()
    escolher(0, 'ss1')
    digitar(el(0, 'data-item-bruto'), '20')
    digitar(el(0, 'data-item-tara'), '30')

    await enviar()

    expect(salvo).toBe(null)
    expect(document.querySelector('[data-campo="itens"] [data-erro]').textContent).toMatch(
      /tara não pode ser maior que o peso bruto/i,
    )
  })

  it('tara acima do teto de 5 kg', async () => {
    abrir()
    escolher(0, 'ss1')
    digitar(el(0, 'data-item-bruto'), '9000')
    digitar(el(0, 'data-item-tara'), '6000')

    await enviar()

    expect(salvo).toBe(null)
    expect(document.querySelector('[data-campo="itens"] [data-erro]').textContent).toMatch(
      /não pode passar de 5000/i,
    )
  })

  it('item por peso sem peso nenhum', async () => {
    abrir()
    escolher(0, 'ss1')

    await enviar()

    expect(salvo).toBe(null)
    expect(document.querySelector('[data-campo="itens"] [data-erro]').textContent).toMatch(
      /peso bruto/i,
    )
  })

  it('venda sem item', async () => {
    abrir()
    await enviar()

    expect(salvo).toBe(null)
    expect(document.querySelector('[data-campo="itens"] [data-erro]').textContent).toMatch(
      /pelo menos um item/i,
    )
  })

  it('quantidade zero na venda por unidade', async () => {
    abrir()
    escolher(0, 'p1')
    digitar(el(0, 'data-item-qtd'), '0')

    await enviar()

    expect(salvo).toBe(null)
    expect(document.querySelector('[data-campo="itens"] [data-erro]').textContent).toMatch(
      /maior que zero/i,
    )
  })
})

/* -------------------------------------------------------------- a tela -- */

describe('a tela de Vendas em modo demonstração', () => {
  function montar() {
    const pagina = vendasPage()
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    root.innerHTML = pagina.html
    pagina.mount(root)
    return root
  }

  it('registra uma venda e o pedido aparece na lista', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = montar()
    const antes = root.querySelectorAll('#tabela-vendas tbody tr').length

    root.querySelector('[data-acao="nova-venda"]').click()
    await tick()

    // Sem Neon, o valor da opção é o código do cadastro (P001) — antes desta
    // fase saía `value="undefined"` em todas elas.
    const select = document.querySelector('[data-item-produto]')
    expect(select.options[1].value).toBe('P001')

    escolher(0, 'P001')
    digitar(document.querySelector('[data-item-qtd]'), '2')

    document.querySelector('.modal__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await tick()

    expect(root.querySelectorAll('#tabela-vendas tbody tr')).toHaveLength(antes + 1)
    expect(document.querySelector('.toast')?.textContent ?? '').toMatch(/só nesta sessão/i)
  })

  it('estorna um pedido: pede o motivo, avisa e a linha vira "Estornada"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = montar()
    // Espera a primeira carga terminar, para o estorno mexer na lista já cheia.
    await tick()

    const botao = root.querySelector('[data-acao="estornar-venda"]')
    expect(botao).toBeTruthy()
    botao.click()

    // A janela pede o motivo — sem ele o banco (e a tela) recusam.
    const motivo = document.querySelector('#campo-motivo')
    expect(motivo).toBeTruthy()

    await enviar()
    expect(document.querySelector('.modal')).toBeTruthy()
    expect(document.querySelector('[data-campo="motivo"] [data-erro]').textContent).toMatch(
      /obrigat/i,
    )

    digitar(motivo, 'Cliente desistiu da compra')
    await enviar()
    await tick()

    expect(document.querySelector('.toast')?.textContent ?? '').toMatch(/só nesta sessão/i)
    expect(document.querySelector('.modal')).toBe(null)
    expect(root.querySelector('#tabela-vendas tbody').textContent).toMatch(/Estornada/)
  })

  it('navega pelos dias: ontem, com o rótulo certo e sem ir para o futuro', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = montar()
    await tick()

    const campo = root.querySelector('#dia-vendas')
    const anterior = root.querySelector('[data-dia="-1"]')
    const proximo = root.querySelector('[data-dia="1"]')
    const botaoHoje = root.querySelector('[data-acao="dia-hoje"]')
    const contagem = root.querySelector('#contagem-vendas')

    // Abre em hoje, e "próximo dia" não leva a lugar nenhum (não há pedido futuro).
    expect(campo.value).toBe(hoje())
    expect(campo.max).toBe(hoje())
    expect(proximo.disabled).toBe(true)
    expect(botaoHoje.disabled).toBe(true)
    expect(contagem.textContent).toMatch(/^hoje ·/)
    // Um dia comum não é cortado pelo teto da consulta.
    expect(contagem.textContent).not.toMatch(/mais recentes/)

    anterior.click()
    await tick()

    expect(campo.value).toBe(somarDias(hoje(), -1))
    expect(contagem.textContent).toMatch(/^ontem ·/)
    expect(proximo.disabled).toBe(false)
    expect(botaoHoje.disabled).toBe(false)

    // O atalho "Hoje" volta — e volta porque o dia é de verdade hoje, não
    // porque a tela fingiu.
    botaoHoje.click()
    await tick()

    expect(campo.value).toBe(hoje())
    expect(contagem.textContent).toMatch(/^hoje ·/)
  })
})
