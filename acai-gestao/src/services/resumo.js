import { resumo as exemplo } from '../data.js'
import { carregar } from './base.js'

/**
 * Números do topo das telas, vindos da view vw_resumo.
 *
 * Os campos de variação (`*Delta`) não existem na view: comparar com o período
 * anterior exigiria consultas extras. Quando ausentes, o cartão simplesmente
 * não mostra a etiqueta de variação — melhor do que exibir um número falso.
 */
export function carregarResumo() {
  return carregar({
    nome: 'resumo',
    exemplo,
    consulta: async (neon) => {
      const { data, error } = await neon.from('vw_resumo').select('*').single()

      if (error) throw error

      return {
        faturamentoMes: Number(data.faturamento_mes),
        faturamentoHoje: Number(data.faturamento_hoje),
        vendasHoje: Number(data.vendas_hoje),
        cancelamentos: Number(data.cancelamentos_hoje),
        ticketMedio: Number(data.ticket_medio),
        clientesAtivos: Number(data.total_clientes),
        novosClientes: Number(data.novos_clientes),
        clientesVip: Number(data.clientes_vip),
        valorEstoque: Number(data.valor_estoque),
        itensAbaixoMinimo: Number(data.itens_abaixo_minimo),
      }
    },
  })
}
