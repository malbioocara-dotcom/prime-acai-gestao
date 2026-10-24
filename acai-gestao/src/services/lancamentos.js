import { comparativoMensal as comparativoExemplo, lancamentos as exemplo } from '../data.js'
import { carregar, gravar, hoje } from './base.js'

/** Converte a linha do banco para o formato que a tela usa. */
const paraApp = (linha) => ({
  id: linha.id.slice(0, 8).toUpperCase(),
  data: linha.data,
  descricao: linha.descricao,
  categoria: linha.categoria,
  tipo: linha.tipo,
  valor: Number(linha.valor),
  forma: linha.forma ?? '—',
})

export function listarLancamentos(limite = 60) {
  return carregar({
    nome: 'lançamentos',
    exemplo,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('lancamentos')
        .select('id, data, descricao, categoria, tipo, valor, forma')
        .order('data', { ascending: false })
        .limit(limite)

      if (error) throw error
      return data.map(paraApp)
    },
  })
}

/** Grava um lançamento de caixa (entrada ou saída). */
export function criarLancamento(valores) {
  const registro = {
    descricao: valores.descricao.trim(),
    categoria: valores.categoria.trim(),
    tipo: valores.tipo,
    valor: Number(valores.valor),
    forma: valores.forma.trim() || null,
    data: valores.data || hoje(),
  }

  return gravar({
    nome: 'lançamento',
    // Sem Neon, o id vira algo legível e improvável de repetir na sessão.
    registro: {
      id: `L-${String(Date.now()).slice(-4)}`,
      data: registro.data,
      descricao: registro.descricao,
      categoria: registro.categoria,
      tipo: registro.tipo,
      valor: registro.valor,
      forma: registro.forma ?? '—',
    },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('lancamentos')
        .insert(registro)
        .select('id, data, descricao, categoria, tipo, valor, forma')
        .single()

      if (error) throw error
      return paraApp(data)
    },
  })
}

/** Entradas e saídas por mês, para o gráfico de barras. */
export function carregarFluxoMensal() {
  return carregar({
    nome: 'fluxo mensal',
    exemplo: { labels: ['Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out'], entradas: [38200, 41500, 39800, 44300, 46900, 48750], saidas: [26100, 28400, 27900, 29800, 31200, 32150] },
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('vw_fluxo_mensal')
        .select('mes, entradas, saidas')
        .order('mes', { ascending: true })
        .limit(6)

      if (error) throw error

      const mes = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
      return {
        labels: data.map((linha) => mes.format(new Date(`${linha.mes}T00:00:00`)).replace('.', '')),
        entradas: data.map((linha) => Number(linha.entradas)),
        saidas: data.map((linha) => Number(linha.saidas)),
      }
    },
  })
}

/** Primeiro dia do mês passado, no formato 'AAAA-MM-DD'. */
function mesAnterior() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * Entradas do mesmo trecho do mês passado, para a etiqueta de variação do
 * cartão "Entradas do mês".
 *
 * Devolve só a referência. O valor do mês em curso continua vindo de
 * `vw_fluxo_mensal`, que é a mesma fonte do Dashboard — assim os dois nunca
 * discordam, nem quando esta consulta falha.
 *
 * Isso não sai de `vw_fluxo_mensal`: lá o mês em curso aparece pela metade, ao
 * lado de meses inteiros, e a comparação acusaria uma queda que não existe.
 */
export function carregarComparativoMensal() {
  return carregar({
    nome: 'comparativo mensal',
    exemplo: comparativoExemplo,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('vw_fluxo_mesmo_periodo')
        .select('entradas')
        .eq('mes', mesAnterior())
        .maybeSingle()

      if (error) throw error

      // Sem linha para o mês passado não há com o que comparar — e aí a
      // etiqueta some, em vez de inventar um número.
      return { entradasAnterior: data ? Number(data.entradas) : null }
    },
  })
}
