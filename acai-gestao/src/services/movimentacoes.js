import { carregar, gravar } from './base.js'
import {
  dadosTesteHabilitados,
  movimentacoesEstoqueTeste,
  saldosEstoqueTeste,
} from '../demo-test-data.js'

/**
 * Livro-razão do estoque.
 *
 * O saldo de um item NÃO é um campo que se digita: ele é a soma dos movimentos
 * (migração 06). Cada movimento tira uma quantidade de um LOCAL e põe em outro
 * — é o par origem/destino que diz o que aconteceu, e não uma etiqueta solta.
 *
 *   compra      fornecedor -> estoque
 *   uso no buffet  estoque  -> buffet
 *   sobra          buffet   -> estoque
 *   perda          estoque  -> perda
 *   venda          estoque  -> cliente
 *
 * Quem escreve é o RPC `registrar_movimentacao` (migração 07): ele confere
 * permissão, carimba o usuário da sessão e move o saldo na mesma transação. O
 * navegador não insere no livro-razão — não tem GRANT para isso.
 */

/** Locais do estoque. Espelha o CHECK de `movimentacoes_estoque` (migração 06). */
export const LOCAIS = {
  abertura: 'Abertura (saldo inicial)',
  contagem: 'Contagem física',
  fornecedor: 'Fornecedor (fora da loja)',
  estoque_geral: 'Estoque geral',
  estoque: 'Estoque da loja',
  buffet: 'Buffet (preparo em uso)',
  sobra: 'Sobra reaproveitável',
  perda: 'Perda / descarte',
  cliente: 'Cliente (venda)',
}

/**
 * Os locais que a movimentação comum aceita. 'abertura' e 'contagem' ficam de
 * fora de propósito: elas são contagem física, e entram por `ajustarSaldo`.
 */
export const LOCAIS_MOVIMENTO = ['fornecedor', 'estoque', 'buffet', 'sobra', 'perda', 'cliente']
export const LOCAIS_MOVIMENTO_LOCAL = [...LOCAIS_MOVIMENTO, 'estoque_geral']

/**
 * Atalhos do dia a dia. `origem`/`destino` são o que vai para o banco; o rótulo
 * é o que o operador lê. "Outro" deixa escolher os dois na mão.
 */
export const OPERACOES = [
  { valor: 'compra', rotulo: 'Compra — entra no estoque', origem: 'fornecedor', destino: 'estoque' },
  { valor: 'compra_geral', rotulo: 'Entrada — estoque geral', origem: 'fornecedor', destino: 'estoque_geral' },
  { valor: 'geral_loja', rotulo: 'Transferência — geral para loja', origem: 'estoque_geral', destino: 'estoque' },
  { valor: 'loja_geral', rotulo: 'Transferência — loja para geral', origem: 'estoque', destino: 'estoque_geral' },
  { valor: 'buffet', rotulo: 'Preparo — do estoque para o buffet', origem: 'estoque', destino: 'buffet' },
  { valor: 'sobra', rotulo: 'Sobra — do buffet de volta ao estoque', origem: 'buffet', destino: 'estoque' },
  { valor: 'perda', rotulo: 'Perda — descarte', origem: 'estoque', destino: 'perda' },
  { valor: 'devolucao', rotulo: 'Devolução — volta para o fornecedor', origem: 'estoque', destino: 'fornecedor' },
  { valor: 'venda', rotulo: 'Venda avulsa — sai para o cliente', origem: 'estoque', destino: 'cliente' },
  { valor: 'outro', rotulo: 'Outro (escolho origem e destino)', origem: '', destino: '' },
]

/** Locais do ajuste por contagem física. */
export const LOCAIS_CONTAGEM = ['contagem', 'abertura']

/** Descobre origem/destino a partir do atalho escolhido. */
export function locaisDaOperacao(valorOperacao) {
  const op = OPERACOES.find((o) => o.valor === valorOperacao)
  return op ? { origem: op.origem, destino: op.destino } : { origem: '', destino: '' }
}

const optionalNumber = (valor) => (valor == null ? null : Number(valor))
const novaChave = () => globalThis.crypto?.randomUUID?.() ?? `mov-${Date.now()}-${Math.random().toString(16).slice(2)}`

const paraMovimentacao = (linha) => ({
  uuid: linha.id,
  produtoId: linha.produto_id ?? null,
  quantidade: Number(linha.quantidade),
  origem: linha.origem,
  destino: linha.destino,
  motivo: linha.motivo ?? '',
  saldo: optionalNumber(linha.saldo),
  quando: linha.criado_em,
  quem: linha.quem?.full_name ?? linha.quem?.nome ?? null,
  vendaId: linha.venda_id ?? null,
})

/**
 * Registra um movimento.
 *
 * A validação de verdade é do banco (a RPC recusa quantidade <= 0, motivo em
 * branco, origem igual ao destino e saída maior que o saldo). Aqui só se evita
 * a viagem inútil e a mensagem técnica.
 */
export function registrarMovimentacao({
  produtoId,
  quantidade,
  origem,
  destino,
  motivo,
  chaveIdempotencia,
} = {}) {
  const texto = String(motivo ?? '').trim()
  const qtd = Number(quantidade)

  if (!produtoId) throw new Error('Escolha o item que vai ser movimentado.')
  if (!LOCAIS_MOVIMENTO_LOCAL.includes(origem) || !LOCAIS_MOVIMENTO_LOCAL.includes(destino)) {
    throw new Error('Escolha a origem e o destino da movimentação.')
  }
  if (origem === destino) throw new Error('A origem e o destino precisam ser diferentes.')
  if (!Number.isFinite(qtd) || qtd <= 0) throw new Error('A quantidade precisa ser maior que zero.')
  if (!texto) throw new Error('Informe o motivo da movimentação.')

  return gravar({
    nome: 'movimentação de estoque',
    registro: { produtoId, quantidade: qtd, origem, destino, motivo: texto },
    escrever: async (neon) => {
      if (['estoque', 'estoque_geral'].includes(origem) &&
          ['estoque', 'estoque_geral'].includes(destino)) {
        const { data, error } = await neon.rpc('transferir_estoque_local', {
          p_produto_id: produtoId,
          p_qtd: qtd,
          p_origem: origem === 'estoque_geral' ? 'geral' : 'loja',
          p_destino: destino === 'estoque_geral' ? 'geral' : 'loja',
          p_motivo: texto,
          p_chave_idempotencia: chaveIdempotencia || novaChave(),
        })
        if (error) throw error
        const transferencia = Array.isArray(data) ? data[0] : data
        if (!transferencia) throw new Error('O banco não confirmou a transferência. Tente novamente.')
        return {
          ...paraMovimentacao({
            ...transferencia,
            id: transferencia.movimentacao_id,
            origem: origem === 'estoque_geral' ? 'estoque_geral' : 'estoque',
            destino: destino === 'estoque_geral' ? 'estoque_geral' : 'estoque',
            saldo: transferencia.saldo_loja,
          }),
          saldoGeral: Number(transferencia.saldo_geral),
          saldoLoja: Number(transferencia.saldo_loja),
          transferenciaId: transferencia.id,
        }
      }

      const usaLocalGeral = origem === 'estoque_geral' || destino === 'estoque_geral'
      const { data, error } = await neon.rpc(
        usaLocalGeral ? 'registrar_movimentacao_local' : 'registrar_movimentacao',
        usaLocalGeral
          ? {
              p_produto_id: produtoId,
              p_qtd: qtd,
              p_origem: origem,
              p_destino: destino,
              p_motivo: texto,
            }
          : {
        p_produto_id: produtoId,
        p_qtd: qtd,
        p_origem: origem,
        p_destino: destino,
        p_motivo: texto,
            },
      )

      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não confirmou a movimentação. Tente de novo.')
      return {
        ...paraMovimentacao({ ...linha, saldo: linha.saldo_loja ?? linha.saldo }),
        saldoGeral: optionalNumber(linha.saldo_geral),
        saldoLoja: optionalNumber(linha.saldo_loja ?? linha.saldo),
      }
    },
  })
}

export function listarSaldosEstoqueLocais() {
  return carregar({
    nome: 'saldos por local de estoque',
    exemplo: dadosTesteHabilitados ? saldosEstoqueTeste : [],
    consulta: async (neon) => {
      const { data, error } = await neon.rpc('listar_saldos_estoque_locais')
      if (error) throw error
      return (data ?? []).map((linha) => ({
        produtoId: linha.produto_id,
        geral: Number(linha.saldo_geral),
        loja: Number(linha.saldo_loja),
      }))
    },
  })
}

/**
 * Contagem física: informa o saldo CONTADO e o banco registra só a diferença.
 *
 * É assim que um item entra no sistema com o saldo real ("abertura") ou é
 * conferido depois ("contagem"). Contar de novo o mesmo número não cria
 * movimento nenhum.
 */
export function ajustarSaldo({ produtoId, contado, motivo, local = 'contagem' } = {}) {
  const texto = String(motivo ?? '').trim()
  const numero = Number(contado)

  if (!produtoId) throw new Error('Escolha o item que vai ser conferido.')
  if (!LOCAIS_CONTAGEM.includes(local)) throw new Error('Escolha se é saldo inicial ou contagem.')
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error('O saldo contado precisa ser um número, sem negativo.')
  }
  if (!texto) throw new Error('Informe o motivo do ajuste.')

  return gravar({
    nome: 'ajuste de saldo',
    registro: { produtoId, contado: numero, motivo: texto, local, saldo: numero },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('ajustar_saldo', {
        p_produto_id: produtoId,
        p_contado: numero,
        p_motivo: texto,
        p_local: local,
      })

      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não confirmou o ajuste. Tente de novo.')

      return {
        saldoAnterior: Number(linha.saldo_anterior),
        saldo: Number(linha.saldo),
        movimentacaoId: linha.movimentacao_id ?? null,
      }
    },
  })
}

/**
 * Histórico do livro-razão, do mais recente para o mais antigo.
 *
 * O autor vem por embed em `profiles` (via a FK `usuario_id`). Se o cache de
 * schema do Data API ainda não conhecer o relacionamento, a consulta inteira
 * falharia — por isso existe a versão sem o autor como plano B, igual ao
 * histórico de recipientes.
 */
export function listarMovimentacoes(produtoId, { limite = 40 } = {}) {
  const COM_AUTOR =
    'id, produto_id, quantidade, origem, destino, motivo, venda_id, criado_em, quem:profiles(full_name)'
  const SEM_AUTOR = 'id, produto_id, quantidade, origem, destino, motivo, venda_id, criado_em'

  return carregar({
    nome: 'movimentações de estoque',
    exemplo: dadosTesteHabilitados
      ? movimentacoesEstoqueTeste
          .filter((movimento) => !produtoId || movimento.produtoId === produtoId)
          .slice(0, limite)
      : [],
    consulta: async (neon) => {
      const montar = (campos) => {
        let consulta = neon.from('movimentacoes_estoque').select(campos)
        if (produtoId) consulta = consulta.eq('produto_id', produtoId)
        return consulta.order('criado_em', { ascending: false }).limit(limite)
      }

      const comAutor = await montar(COM_AUTOR)
      if (!comAutor.error) return comAutor.data.map(paraMovimentacao)

      const semAutor = await montar(SEM_AUTOR)
      if (semAutor.error) throw semAutor.error
      return semAutor.data.map(paraMovimentacao)
    },
  })
}
