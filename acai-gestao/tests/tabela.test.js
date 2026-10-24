// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { tabela, atualizarTabela } from '../src/ui.js'

const colunas = [
  { key: 'acoes', label: 'Ações', align: 'left', render: () => '<button data-acao="x">x</button>' },
  { key: 'nome', label: 'Usuário', render: (u) => `${u.nome}` },
]

describe('tabela / atualizarTabela', () => {
  it('tabela() gera exatamente um .table-wrap com a tabela dentro', () => {
    const root = document.createElement('div')
    root.innerHTML = tabela({ colunas, linhas: [], id: 'tabela-usuarios' })

    expect(root.querySelectorAll('.table-wrap')).toHaveLength(1)
    expect(root.querySelectorAll('#tabela-usuarios')).toHaveLength(1)
    // a tabela precisa estar DENTRO do wrapper (não o contrário)
    expect(root.querySelector('.table-wrap #tabela-usuarios')).not.toBeNull()
  })

  it('atualizarTabela repetido não aninha wrappers nem acumula linhas (regressão)', () => {
    const root = document.createElement('div')
    root.innerHTML = tabela({ colunas, linhas: [], id: 'tabela-usuarios' })

    for (let i = 0; i < 5; i++) {
      atualizarTabela(root, 'tabela-usuarios', colunas, [{ nome: `Usuario ${i}` }])
    }

    // Antes da correção o render() trocava a <table> pelo wrapper inteiro,
    // empilhando .table-wrap a cada atualização. Agora nunca passa de 1.
    expect(root.querySelectorAll('.table-wrap')).toHaveLength(1)
    expect(root.querySelectorAll('#tabela-usuarios')).toHaveLength(1)
    expect(root.querySelectorAll('#tabela-usuarios tbody tr')).toHaveLength(1)
    expect(root.querySelector('#tabela-usuarios tbody').textContent).toContain('Usuario 4')
  })

  it('cabeçalho reflete todas as colunas, inclusive Ações', () => {
    const root = document.createElement('div')
    root.innerHTML = tabela({ colunas, linhas: [], id: 't' })

    const ths = [...root.querySelectorAll('#t thead th')].map((th) => th.textContent)
    expect(ths).toEqual(['Ações', 'Usuário'])
  })

  it('lista vazia mostra a linha de "nenhum registro" com colspan correto', () => {
    const root = document.createElement('div')
    root.innerHTML = tabela({ colunas, linhas: [], id: 't' })

    const vazio = root.querySelector('#t tbody .table__vazio')
    expect(vazio).not.toBeNull()
    expect(vazio.getAttribute('colspan')).toBe(String(colunas.length))
  })
})
