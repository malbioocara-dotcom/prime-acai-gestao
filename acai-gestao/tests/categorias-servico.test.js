import { beforeEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  registros: [],
  gravacao: null,
}))

vi.mock('../src/services/base.js', () => ({
  carregar: async ({ exemplo }) => ({ dados: estado.registros.length ? estado.registros : exemplo, origem: 'neon' }),
  paraBooleano: (valor, padrao = true) => {
    if (valor === false || valor === 'false' || valor === 0 || valor === '0') return false
    if (valor === true || valor === 'true' || valor === 1 || valor === '1') return true
    return padrao
  },
  gravar: async ({ registro }) => {
    if (estado.gravacao) return estado.gravacao(registro)
    const id = registro.id ?? 'categoria-nova'
    const indice = estado.registros.findIndex((item) => item.id === id)
    const dados = {
      ...(indice >= 0 ? estado.registros[indice] : {}),
      ...registro,
      id,
      criado_em: estado.registros[indice]?.criado_em ?? '2025-01-01T00:00:00Z',
      atualizado_em: '2025-01-02T00:00:00Z',
    }
    if (indice < 0) estado.registros.push(dados)
    else estado.registros.splice(indice, 1, dados)
    return { dados, origem: 'neon' }
  },
}))

const {
  alterarCategoriaAtiva,
  listarCategorias,
  normalizarNomeCategoria,
  salvarCategoria,
} = await import('../src/services/categorias.js')

beforeEach(() => {
  estado.registros = []
  estado.gravacao = null
})

describe('serviço de categorias de produtos', () => {
  it('normaliza caixa e espaços excedentes', () => {
    expect(normalizarNomeCategoria('  Frutas   Frescas ')).toBe('frutas frescas')
  })

  it('impede duplicidade por nome normalizado, mas permite editar o mesmo registro', async () => {
    estado.registros = [{ id: 'categoria-1', nome: 'Açaí', descricao: null, ativo: true }]

    await expect(salvarCategoria({ nome: '  aÇAÍ ' }))
      .rejects.toThrow('Já existe uma categoria com esse nome.')
    await expect(salvarCategoria({ id: 'categoria-1', nome: '  aÇAÍ ' }))
      .resolves.toMatchObject({ dados: { id: 'categoria-1', nome: 'aÇAÍ' } })
  })

  it('valida campos e normaliza o status antes de persistir', async () => {
    await expect(salvarCategoria({ nome: '  ' })).rejects.toThrow('Informe o nome da categoria.')
    await expect(salvarCategoria({ nome: 'Bebidas', ativo: 'false' }))
      .resolves.toMatchObject({ dados: { nome: 'Bebidas', ativo: false } })
    expect((await listarCategorias()).dados).toHaveLength(1)
  })

  it('altera o status sem excluir a categoria', async () => {
    estado.registros = [{ id: 'categoria-1', nome: 'Açaí', descricao: null, ativo: true }]

    await alterarCategoriaAtiva({ id: 'categoria-1', ativo: 'false' })

    expect((await listarCategorias()).dados).toMatchObject([
      { id: 'categoria-1', nome: 'Açaí', ativo: false },
    ])
  })
})
