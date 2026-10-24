import { produtos as exemplo } from '../data.js'
import { METODOS_PESO, METODOS_PESO_ATIVOS } from '../peso.js'
import { carregar, gravar, neon, neonConfigurado, paraBooleano } from './base.js'
import { prepararImagemProduto } from './imagens-produtos.js'

/**
 * Cadastro de produtos e insumos.
 *
 * O item é vendido de três formas, e isso muda o resto do cadastro:
 *
 *   unidade  — preço fixo por peça (copo, pote, garrafa).
 *   peso     — o cliente monta e paga por quilo; `preco` é o preço do QUILO.
 *   receita  — preço fechado de uma receita ou porção montada.
 *
 * A unidade de venda NÃO é uma coluna: ela é derivada do tipo (ver
 * `unidadeDeVenda`) — assim não existem duas colunas que possam divergir.
 * `produtos.unidade` continua sendo a unidade de ESTOQUE (como o item é
 * contado), que pode ser outra coisa: uma receita tem estoque em 'un' e preço
 * por 'porção'. A mesma regra está documentada na migração 04.
 */

/** Como o item é vendido. As chaves são as gravadas em `produtos.tipo_venda`. */
export const TIPOS_VENDA = {
  unidade: 'Por unidade',
  peso: 'Por peso (kg)',
  receita: 'Por receita / porção',
}

/** Explicação curta de cada tipo, mostrada no cadastro. */
export const TIPO_VENDA_AJUDA = {
  unidade: 'Preço fixo por peça: copo, pote, garrafa.',
  peso: 'O cliente monta e paga por quilo — self-service.',
  receita: 'Preço fechado de uma receita ou porção montada.',
}

/**
 * Unidade em que o PREÇO é cobrado. Espelha `public.unidade_de_venda()` —
 * se uma mudar, a outra precisa mudar junto (há teste para isso).
 */
export function unidadeDeVenda(tipoVenda) {
  if (tipoVenda === 'peso') return 'kg'
  if (tipoVenda === 'receita') return 'porção'
  return 'un'
}

/** Rótulo do campo de preço, que muda com o tipo de venda. */
export const rotuloPreco = (tipoVenda) => `Preço por ${unidadeDeVenda(tipoVenda)}`

/** Como o saldo é controlado. Chaves iguais às de `produtos.metodo_estoque`. */
export const METODOS_ESTOQUE = {
  movimentacoes: 'Só por movimentação registrada',
  fechamento: 'Conferência no fechamento do buffet',
  nenhum: 'Sem controle de estoque',
}

/** Rótulo curto da unidade de venda, para a tabela do Estoque. */
export const precoComUnidade = (produto) =>
  produto.tipoVenda === 'unidade' ? null : unidadeDeVenda(produto.tipoVenda)

const CAMPOS = [
  'id',
  'codigo',
  'nome',
  'descricao',
  'categoria',
  'quantidade',
  'minimo',
  'unidade',
  'custo',
  'preco',
  'ativo',
  'tipo_venda',
  'controla_estoque',
  'metodo_estoque',
  'metodo_peso',
].join(', ')

/**
 * Converte a linha do banco para o formato que as telas usam.
 * `uuid` é a chave real do banco; `id` é o código legível (P001).
 */
const paraApp = (linha) => ({
  uuid: linha.id,
  id: linha.codigo,
  nome: linha.nome,
  descricao: linha.descricao ?? '',
  categoria: linha.categoria,
  quantidade: Number(linha.quantidade),
  minimo: Number(linha.minimo),
  unidade: linha.unidade,
  unidadeVenda: unidadeDeVenda(linha.tipo_venda),
  custo: Number(linha.custo),
  preco: Number(linha.preco),
  tipoVenda: linha.tipo_venda,
  metodoPeso: linha.metodo_peso,
  controlaEstoque: linha.controla_estoque,
  metodoEstoque: linha.metodo_estoque,
  ativo: linha.ativo,
})

/**
 * Lista os itens do estoque.
 *
 * Por padrão só os ATIVOS — é o que o cadastro de itens de venda e a tela de
 * Vendas usam. A tela de Estoque pede `incluirInativos: true` para poder
 * reativar o que foi desligado.
 */
export function listarProdutos({ incluirInativos = false } = {}) {
  return carregar({
    nome: 'produtos',
    exemplo: incluirInativos ? exemplo : exemplo.filter((p) => p.ativo),
    consulta: async (neon) => {
      let consulta = neon.from('produtos').select(CAMPOS).order('nome')
      if (!incluirInativos) consulta = consulta.eq('ativo', true)

      const { data, error } = await consulta
      if (error) throw error
      return data.map(paraApp)
    },
  })
}

/** Sugere o próximo código livre a partir dos já cadastrados (P001, P002...). */
export function proximoCodigoProduto(lista) {
  const maior = lista.reduce((acc, p) => {
    const n = Number(String(p.id).replace(/\D/g, ''))
    return Number.isFinite(n) && n > acc ? n : acc
  }, 0)

  return `P${String(maior + 1).padStart(3, '0')}`
}

/* ------------------------------------------------------------ normalizar -- */

const numero = (valor) => {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

/**
 * Converte o que veio do formulário no que o banco aceita.
 *
 * Aqui a regra do banco é respeitada ANTES de tentar gravar — em especial o
 * bicondicional `(tipo_venda = 'peso') = (metodo_peso is not null)`: produto
 * por peso sempre sai com método, e qualquer outro sai sem. Depender do `check`
 * do banco daria um erro técnico na cara do usuário; aqui a mensagem é clara.
 *
 * @returns {object} registro com os nomes de coluna do banco
 */
export function normalizarProduto(valores = {}) {
  const tipoVenda = TIPOS_VENDA[valores.tipoVenda] ? valores.tipoVenda : 'unidade'

  // Método de peso só existe em produto por peso, e nunca o 'balanca' — que
  // está no domínio do banco mas não é executável neste sistema.
  const metodoPeso =
    tipoVenda === 'peso'
      ? METODOS_PESO_ATIVOS.includes(valores.metodoPeso)
        ? valores.metodoPeso
        : METODOS_PESO.BRUTO_TARA
      : null

  const controlaEstoque = paraBooleano(valores.controlaEstoque, true)

  const registro = {
    codigo: String(valores.codigo ?? '').trim().toUpperCase(),
    nome: String(valores.nome ?? '').trim(),
    descricao: String(valores.descricao ?? '').trim() || null,
    categoria: String(valores.categoria ?? '').trim(),
    // Produto por peso é contado e vendido em quilo: não faz sentido um
    // self-service com estoque em 'un'.
    unidade: tipoVenda === 'peso' ? 'kg' : valores.unidade || 'un',
    tipo_venda: tipoVenda,
    metodo_peso: metodoPeso,
    controla_estoque: controlaEstoque,
    metodo_estoque: !controlaEstoque
      ? 'nenhum'
      : METODOS_ESTOQUE[valores.metodoEstoque]
        ? valores.metodoEstoque
        : 'movimentacoes',
    minimo: numero(valores.minimo),
    custo: numero(valores.custo),
    preco: numero(valores.preco),
    ativo: paraBooleano(valores.ativo, true),
  }

  if (!registro.codigo) throw new Error('Informe o código do item.')
  if (!registro.nome) throw new Error('Informe o nome do item.')
  if (!registro.categoria) throw new Error('Informe a categoria do item.')
  if (registro.preco < 0) throw new Error('O preço de venda não pode ser negativo.')
  if (registro.custo < 0) throw new Error('O custo não pode ser negativo.')
  if (registro.minimo < 0) throw new Error('O ponto de reposição não pode ser negativo.')

  return registro
}

/** Monta o registro no formato da tela (usado quando não há Neon). */
const comoApp = (registro, quantidade) => ({
  uuid: null,
  id: registro.codigo,
  nome: registro.nome,
  descricao: registro.descricao ?? '',
  categoria: registro.categoria,
  quantidade,
  minimo: registro.minimo,
  unidade: registro.unidade,
  unidadeVenda: unidadeDeVenda(registro.tipo_venda),
  custo: registro.custo,
  preco: registro.preco,
  tipoVenda: registro.tipo_venda,
  metodoPeso: registro.metodo_peso,
  controlaEstoque: registro.controla_estoque,
  metodoEstoque: registro.metodo_estoque,
  ativo: registro.ativo,
})

/* --------------------------------------------------------------- escrever -- */

/** Grava um item novo de estoque. */
export function criarProduto(valores) {
  const registro = normalizarProduto(valores)

  // O item NASCE com saldo zero. Desde a migração 06 o saldo é derivado do
  // livro-razão e o banco sobrescreve qualquer número que venha daqui — então
  // o "saldo inicial" do formulário é registrado como contagem de abertura
  // (`ajustar_saldo`), com autor e data, e não digitado na criação.
  return gravar({
    nome: 'produto',
    // Sem Neon a linha vive só em memória: já precisa no formato da tela.
    registro: comoApp(registro, 0),
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('produtos')
        .insert({ ...registro, quantidade: 0 })
        .select(CAMPOS)
        .single()

      if (error) throw error
      return paraApp(data)
    },
  })
}

/**
 * Altera um item existente.
 *
 * `quantidade` NÃO é alterada aqui de propósito: saldo é movimentação, não
 * digitação de cadastro. O valor recebido em `valores.quantidade` serve só
 * para o registro em memória quando o Neon não está configurado.
 */
export function atualizarProduto(uuid, valores) {
  const registro = normalizarProduto(valores)

  return gravar({
    nome: 'produto',
    registro: { ...comoApp(registro, Math.max(0, numero(valores.quantidade))), uuid },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('produtos')
        .update(registro)
        .eq('id', uuid)
        .select(CAMPOS)
        .single()

      if (error) throw error
      return paraApp(data)
    },
  })
}

/**
 * Grava produto e imagem na mesma transação do banco.
 *
 * A RPC deixa preço, cadastro e foto atômicos; a quantidade existente nunca é
 * atualizada aqui, pois o saldo continua sendo responsabilidade do livro-razão.
 */
export async function salvarProdutoComImagem(uuid, valores, { arquivo = null, remover = false } = {}) {
  if (!neonConfigurado) throw new Error('Configure o Neon antes de salvar uma foto de produto.')
  if (!arquivo && !remover) throw new Error('Selecione uma imagem ou solicite sua remoção.')

  const registro = normalizarProduto(valores)
  const imagem = arquivo ? await prepararImagemProduto(arquivo) : null
  const produto = uuid ? { ...registro, id: uuid } : registro

  const { data, error } = await neon.rpc('salvar_produto_com_imagem', {
    p_produto: produto,
    p_mime: imagem?.mime ?? null,
    p_conteudo: imagem?.hexadecimal ?? null,
    p_remover_imagem: remover,
  })

  if (error) throw error

  const linha = Array.isArray(data) ? data[0] : data
  if (!linha?.id) throw new Error('O banco não confirmou o salvamento do produto com a imagem.')

  return { dados: paraApp(linha), origem: 'neon' }
}
