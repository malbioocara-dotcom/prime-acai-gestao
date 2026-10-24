import { carregar, gravar, paraBooleano } from './base.js'
import { categoriasProdutoTeste, dadosTesteHabilitados } from '../demo-test-data.js'

const CATEGORIAS_BASE = [
  { id: 'categoria-acai', nome: 'Açaí', descricao: '', ativo: true, criado_em: null, atualizado_em: null },
  { id: 'categoria-adicionais', nome: 'Adicionais', descricao: '', ativo: true, criado_em: null, atualizado_em: null },
  { id: 'categoria-frutas', nome: 'Frutas', descricao: '', ativo: true, criado_em: null, atualizado_em: null },
  { id: 'categoria-embalagens', nome: 'Embalagens', descricao: '', ativo: true, criado_em: null, atualizado_em: null },
]
const CATEGORIAS_EXEMPLO = [
  ...CATEGORIAS_BASE,
  ...(dadosTesteHabilitados ? categoriasProdutoTeste : []),
]

const COLUNAS = 'id, nome, descricao, ativo, criado_em, atualizado_em'

export function normalizarNomeCategoria(valor) {
  return String(valor ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

export function listarCategorias({ somenteAtivas = false } = {}) {
  return carregar({
    nome: 'categorias de produtos',
    exemplo: somenteAtivas ? CATEGORIAS_EXEMPLO.filter((item) => item.ativo) : CATEGORIAS_EXEMPLO,
    consulta: async (neon) => {
      let consulta = neon.from('categorias_produtos').select(COLUNAS).order('nome')
      if (somenteAtivas) consulta = consulta.eq('ativo', true)

      const { data, error } = await consulta
      if (error) throw error
      return data ?? []
    },
  })
}

export async function salvarCategoria(valores = {}) {
  const nome = String(valores.nome ?? '').trim().replace(/\s+/g, ' ')
  const descricao = String(valores.descricao ?? '').trim() || null
  if (!nome) throw new Error('Informe o nome da categoria.')
  if (nome.length > 80) throw new Error('O nome da categoria deve ter até 80 caracteres.')
  if (descricao && descricao.length > 500) throw new Error('A descrição deve ter até 500 caracteres.')

  const { dados: existentes } = await listarCategorias()
  const chaveNome = normalizarNomeCategoria(nome)
  if (existentes.some((item) => item.id !== valores.id && normalizarNomeCategoria(item.nome) === chaveNome)) {
    throw new Error('Já existe uma categoria com esse nome.')
  }

  const registro = {
    nome,
    descricao,
    ativo: valores.ativo === undefined ? true : valores.ativo === true || valores.ativo === 'true',
  }

  try {
    return await gravar({
      nome: 'categoria de produto',
      registro: { ...registro, ...(valores.id ? { id: valores.id } : {}) },
      escrever: async (neon) => {
        const alvo = valores.id
          ? neon.from('categorias_produtos').update(registro).eq('id', valores.id)
          : neon.from('categorias_produtos').insert(registro)
        const { data, error } = await alvo.select(COLUNAS).single()
        if (error) throw error
        return data
      },
    })
  } catch (erro) {
    if (erro?.code === '23505' || /duplicate key|unique constraint/i.test(erro?.message ?? '')) {
      throw new Error('Já existe uma categoria com esse nome.')
    }
    throw erro
  }
}

export function alterarCategoriaAtiva({ id, ativo }) {
  const ativa = paraBooleano(ativo, false)
  return gravar({
    nome: 'categoria de produto',
    registro: { id, ativo: ativa },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('categorias_produtos')
        .update({ ativo: ativa })
        .eq('id', id)
        .select(COLUNAS)
        .single()
      if (error) throw error
      return data
    },
  })
}
