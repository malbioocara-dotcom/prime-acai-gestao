import { faturamento7Dias, vendasPorCategoria } from '../data.js'
import { carregar } from './base.js'

/** Faturamento diário dos últimos dias, para o gráfico de linha. */
export function carregarFaturamentoDiario() {
  return carregar({
    nome: 'faturamento diário',
    exemplo: faturamento7Dias,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('vw_faturamento_diario')
        .select('dia, total')
        .order('dia', { ascending: true })

      if (error) throw error

      const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
      const ultimos = data.slice(-7)

      return {
        labels: ultimos.map((linha) => dia.format(new Date(`${linha.dia}T00:00:00`))),
        valores: ultimos.map((linha) => Number(linha.total)),
      }
    },
  })
}

/** Faturamento por categoria de produto, para o gráfico de rosca. */
export function carregarVendasPorCategoria() {
  return carregar({
    nome: 'vendas por categoria',
    exemplo: vendasPorCategoria,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('vw_vendas_por_categoria')
        .select('categoria, total')
        .order('total', { ascending: false })

      if (error) throw error

      return {
        labels: data.map((linha) => linha.categoria),
        valores: data.map((linha) => Number(linha.total)),
      }
    },
  })
}
