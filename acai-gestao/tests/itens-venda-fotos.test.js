// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { itensHtml, iniciarItens } from '../src/itens-venda.js'

const tick = async () => new Promise((resolve) => setTimeout(resolve, 0))

describe('fotos dos produtos no PDV', () => {
  it('carrega sob demanda a foto do produto selecionado e preserva o fallback', async () => {
    const campo = {
      nome: 'itens',
      obrigatorio: true,
      produtos: [
        { uuid: 'produto-1', id: 'P001', nome: 'Açaí', preco: 69.9, tipoVenda: 'peso', imagemPath: 'produto-1' },
        { uuid: 'produto-2', id: 'P002', nome: 'Banana', preco: 4, tipoVenda: 'unidade' },
      ],
      recipientes: [],
      carregarImagem: vi.fn(async () => 'blob:imagem-produto'),
    }
    document.body.innerHTML = `<div class="modal">${itensHtml(campo, [])}</div>`
    const overlay = document.querySelector('.modal')
    iniciarItens({ overlay, campo })

    const select = overlay.querySelector('[data-item-produto]')
    expect(overlay.querySelector('[data-item-foto] img')).toBeNull()
    select.value = 'produto-1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(campo.carregarImagem).toHaveBeenCalledWith('produto-1')
    expect(overlay.querySelector('[data-item-foto] img').getAttribute('src'))
      .toBe('blob:imagem-produto')

    select.value = 'produto-2'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(overlay.querySelector('[data-item-foto] img')).toBeNull()
  })
})
