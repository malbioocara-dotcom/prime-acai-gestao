import { carregar, gravar } from './base.js'
import {
  categoriasTipoVendaTeste,
  dadosTesteHabilitados,
  formasPagamentoTeste,
  tiposVendaTeste,
} from '../demo-test-data.js'

const TIPOS_BASE = [
  { id: 'tipo-balcao', codigo: 'balcao', nome: 'Balcão', categoria: 'balcao', ativo: true },
  {
    id: 'tipo-delivery',
    codigo: 'delivery_proprio',
    nome: 'Delivery próprio',
    categoria: 'delivery',
    ativo: true,
  },
  {
    id: 'tipo-aplicativo',
    codigo: 'aplicativo',
    nome: 'Aplicativo',
    categoria: 'aplicativo',
    ativo: true,
  },
]

const PAGAMENTOS_BASE = [
  { id: 'pag-dinheiro', codigo: 'dinheiro', nome: 'Dinheiro', categoria: 'dinheiro', ativo: true },
  { id: 'pag-pix', codigo: 'pix', nome: 'PIX', categoria: 'pix', ativo: true },
  { id: 'pag-debito', codigo: 'debito', nome: 'Cartão de débito', categoria: 'debito', ativo: true },
  { id: 'pag-credito', codigo: 'credito', nome: 'Cartão de crédito', categoria: 'credito', ativo: true },
  { id: 'pag-outros', codigo: 'outros', nome: 'Outras formas', categoria: 'outros', ativo: true },
]

const CATEGORIAS_TIPO_VENDA_BASE = [
  { id: 'categoria-tipo-balcao', codigo: 'balcao', nome: 'Balcão', ativo: true },
  { id: 'categoria-tipo-delivery', codigo: 'delivery', nome: 'Delivery', ativo: true },
  { id: 'categoria-tipo-aplicativo', codigo: 'aplicativo', nome: 'Aplicativo', ativo: true },
  { id: 'categoria-tipo-personalizado', codigo: 'personalizado', nome: 'Personalizado', ativo: true },
]

const TIPOS_EXEMPLO = [...TIPOS_BASE, ...(dadosTesteHabilitados ? tiposVendaTeste : [])]
const PAGAMENTOS_EXEMPLO = [...PAGAMENTOS_BASE, ...(dadosTesteHabilitados ? formasPagamentoTeste : [])]
const CATEGORIAS_TIPO_VENDA_EXEMPLO = [
  ...CATEGORIAS_TIPO_VENDA_BASE,
  ...(dadosTesteHabilitados ? categoriasTipoVendaTeste : []),
]

const COLUNAS = 'id, codigo, nome, categoria, ativo'
const COLUNAS_CATEGORIA_TIPO_VENDA = 'id, codigo, nome, descricao, ativo, criado_em, atualizado_em'

function normalizarChave(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

function deduplicarCatalogo(registros) {
  const ordenados = [...registros].sort((a, b) => {
    if (Boolean(a.ativo) !== Boolean(b.ativo)) return Number(b.ativo) - Number(a.ativo)
    return String(a.id ?? '').localeCompare(String(b.id ?? ''), 'pt-BR')
  })
  const codigos = new Set()
  const nomes = new Set()
  const unicos = []

  for (const registro of ordenados) {
    const codigo = normalizarChave(registro.codigo)
    const nome = normalizarChave(registro.nome)
    const duplicado = (codigo && codigos.has(codigo)) || (nome && nomes.has(nome))

    if (!duplicado) unicos.push(registro)
    if (codigo) codigos.add(codigo)
    if (nome) nomes.add(nome)
  }

  return unicos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

async function catalogo({ tabela, nome, exemplos, somenteAtivos = false }) {
  const resultado = await carregar({
    nome,
    exemplo: somenteAtivos ? exemplos.filter((item) => item.ativo) : exemplos,
    consulta: async (neon) => {
      let consulta = neon.from(tabela).select(COLUNAS).order('nome')
      if (somenteAtivos) consulta = consulta.eq('ativo', true)

      const { data, error } = await consulta
      if (error) throw error
      return data ?? []
    },
  })

  return { ...resultado, dados: deduplicarCatalogo(resultado.dados) }
}

export const listarTiposVenda = ({ somenteAtivos = false } = {}) =>
  catalogo({
    tabela: 'tipos_venda',
    nome: 'tipos de venda',
    exemplos: TIPOS_EXEMPLO,
    somenteAtivos,
  })

export const listarFormasPagamento = ({ somenteAtivos = false } = {}) =>
  catalogo({
    tabela: 'formas_pagamento',
    nome: 'formas de pagamento',
    exemplos: PAGAMENTOS_EXEMPLO,
    somenteAtivos,
  })

export const listarCategoriasTipoVenda = ({ somenteAtivas = false } = {}) =>
  carregar({
    nome: 'categorias de tipos de venda',
    exemplo: somenteAtivas
      ? CATEGORIAS_TIPO_VENDA_EXEMPLO.filter((item) => item.ativo)
      : CATEGORIAS_TIPO_VENDA_EXEMPLO,
    consulta: async (neon) => {
      let consulta = neon.from('categorias_tipos_venda').select(COLUNAS_CATEGORIA_TIPO_VENDA).order('nome')
      if (somenteAtivas) consulta = consulta.eq('ativo', true)
      const { data, error } = await consulta
      if (error) throw error
      return data ?? []
    },
  })

function codigoDa(nome) {
  const codigo = String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)

  if (!codigo) throw new Error('Informe um nome válido.')
  return codigo
}

export async function salvarCategoriaTipoVenda(valores) {
  const nome = String(valores.nome ?? '').trim().replace(/\s+/g, ' ')
  if (!nome) throw new Error('Informe o nome da categoria.')
  const codigo = valores.codigo || codigoDa(nome)
  const registro = {
    codigo,
    nome,
    descricao: String(valores.descricao ?? '').trim() || null,
    ativo: valores.ativo === undefined
      ? true
      : valores.ativo === true || valores.ativo === 'true',
  }
  const { dados: existentes } = await listarCategoriasTipoVenda()
  const duplicado = existentes.some((item) =>
    item.id !== valores.id &&
    (normalizarChave(item.codigo) === normalizarChave(codigo) ||
      normalizarChave(item.nome) === normalizarChave(nome)),
  )
  if (duplicado) throw new Error('Já existe uma categoria com esse nome ou código.')

  return gravar({
    nome: 'categoria de tipo de venda',
    registro,
    escrever: async (neon) => {
      const alvo = valores.id
        ? neon.from('categorias_tipos_venda').update(registro).eq('id', valores.id)
        : neon.from('categorias_tipos_venda').insert(registro)
      const { data, error } = await alvo.select(COLUNAS_CATEGORIA_TIPO_VENDA).single()
      if (error) throw error
      return data
    },
  })
}

export function alterarCategoriaTipoVendaAtiva({ id, ativo }) {
  const registro = { ativo: Boolean(ativo) }
  return gravar({
    nome: 'categoria de tipo de venda',
    registro: { id, ...registro },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('categorias_tipos_venda')
        .update(registro)
        .eq('id', id)
        .select(COLUNAS_CATEGORIA_TIPO_VENDA)
        .single()
      if (error) throw error
      return data
    },
  })
}

async function salvar({ tabela, nomeTabela, exemplos, valores }) {
  const nome = String(valores.nome ?? '').trim()
  if (!nome) throw new Error('Informe o nome.')

  const registro = {
    codigo: valores.codigo || codigoDa(nome),
    nome,
    categoria: valores.categoria,
    ativo: valores.ativo !== false,
  }

  const { dados: existentes } = await catalogo({
    tabela,
    nome: nomeTabela,
    exemplos,
  })
  const codigoNormalizado = normalizarChave(registro.codigo)
  const nomeNormalizado = normalizarChave(registro.nome)
  const duplicado = existentes.some((item) =>
    item.id !== valores.id &&
    (normalizarChave(item.codigo) === codigoNormalizado ||
      normalizarChave(item.nome) === nomeNormalizado),
  )
  if (duplicado) throw new Error('Já existe um cadastro com esse nome ou código.')

  return gravar({
    nome: nomeTabela,
    registro,
    escrever: async (neon) => {
      const alvo = valores.id
        ? neon.from(tabela).update(registro).eq('id', valores.id)
        : neon.from(tabela).insert(registro)
      const { data, error } = await alvo.select(COLUNAS).single()
      if (error) throw error
      return data
    },
  })
}

export const salvarTipoVenda = (valores) =>
  salvar({
    tabela: 'tipos_venda',
    nomeTabela: 'tipos de venda',
    exemplos: TIPOS_EXEMPLO,
    valores,
  })

export const salvarFormaPagamento = (valores) =>
  salvar({
    tabela: 'formas_pagamento',
    nomeTabela: 'formas de pagamento',
    exemplos: PAGAMENTOS_EXEMPLO,
    valores,
  })

function alterarAtivo({ tabela, nome, id, ativo }) {
  const registro = { ativo: Boolean(ativo) }
  return gravar({
    nome,
    registro: { id, ...registro },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from(tabela)
        .update(registro)
        .eq('id', id)
        .select(COLUNAS)
        .single()
      if (error) throw error
      return data
    },
  })
}

export const alterarTipoVendaAtivo = ({ id, ativo }) =>
  alterarAtivo({ tabela: 'tipos_venda', nome: 'tipo de venda', id, ativo })

export const alterarFormaPagamentoAtivo = ({ id, ativo }) =>
  alterarAtivo({ tabela: 'formas_pagamento', nome: 'forma de pagamento', id, ativo })
