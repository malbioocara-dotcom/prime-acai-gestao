import Chart from 'chart.js/auto'
import {
  comparativoMensal as comparativoExemplo,
  fluxoMensal as fluxoExemplo,
  lancamentos as lancamentosExemplo,
} from '../data.js'
import { abrirFormulario } from '../formulario.js'
import { observar, hoje } from '../services/base.js'
import {
  carregarComparativoMensal,
  carregarFluxoMensal,
  criarLancamento,
  listarLancamentos,
} from '../services/lancamentos.js'
import {
  atualizarKpi,
  atualizarTabela,
  badge,
  botaoPrimario,
  cardHead,
  esc,
  formatBRL,
  formatData,
  statCard,
  tabela,
  toolbar,
} from '../ui.js'

const colunas = [
  {
    key: 'descricao',
    label: 'Lançamento',
    render: (l) => `
      <span class="cell-main">${esc(l.descricao)}</span>
      <span class="cell-sub mono">${esc(l.id)}</span>
    `,
  },
  { key: 'data', label: 'Data', render: (l) => `<span class="muted">${formatData(l.data)}</span>` },
  { key: 'categoria', label: 'Categoria', render: (l) => esc(l.categoria) },
  { key: 'forma', label: 'Forma', render: (l) => `<span class="muted">${esc(l.forma)}</span>` },
  {
    key: 'tipo',
    label: 'Tipo',
    render: (l) =>
      badge(l.tipo === 'entrada' ? 'Entrada' : 'Saída', l.tipo === 'entrada' ? 'success' : 'danger'),
  },
  {
    key: 'valor',
    label: 'Valor',
    align: 'right',
    render: (l) =>
      `<strong class="${l.tipo === 'entrada' ? 'valor--entrada' : 'valor--saida'}">
         ${l.tipo === 'entrada' ? '+' : '−'} ${formatBRL(l.valor)}
       </strong>`,
  },
]

const filtrar = (dados, termo) => {
  const busca = termo.trim().toLowerCase()
  if (!busca) return dados
  return dados.filter((l) =>
    [l.id, l.descricao, l.categoria, l.forma, l.tipo].join(' ').toLowerCase().includes(busca),
  )
}

/** Indicadores do mês mais recente presente na série. */
function indicadores(fluxo) {
  const ultimo = fluxo.entradas.length - 1
  const entradas = fluxo.entradas[ultimo] ?? 0
  const saidas = fluxo.saidas[ultimo] ?? 0
  const resultado = entradas - saidas

  return {
    entradas,
    saidas,
    resultado,
    margem: entradas ? (resultado / entradas) * 100 : 0,
  }
}

/**
 * Variação do cartão "Entradas do mês": mês em curso contra o mesmo trecho do
 * mês passado. Comparar com o mês anterior inteiro acusaria uma queda falsa,
 * porque o mês em curso ainda está pela metade.
 */
function deltaEntradas({ entradas, entradasAnterior }) {
  if (!entradasAnterior) return undefined
  return ((entradas - entradasAnterior) / entradasAnterior) * 100
}

export function financeiroPage() {
  const inicial = indicadores(fluxoExemplo)

  return {
    html: `
      <section class="grid grid--stats">
        ${statCard({
          kpi: 'entradas',
          label: 'Entradas do mês',
          valor: formatBRL(inicial.entradas),
          delta: deltaEntradas(comparativoExemplo),
          icon: 'arrow-up-right',
          hint: 'Total recebido no mês',
        })}
        ${statCard({
          kpi: 'saidas',
          label: 'Saídas do mês',
          valor: formatBRL(inicial.saidas),
          icon: 'arrow-down-right',
          hint: 'Custos e despesas pagos',
        })}
        ${statCard({
          kpi: 'resultado',
          label: 'Resultado do mês',
          valor: formatBRL(inicial.resultado),
          icon: 'circle-dollar-sign',
          hint: 'Entradas menos saídas',
        })}
        ${statCard({
          kpi: 'margem',
          label: 'Margem',
          valor: `${inicial.margem.toFixed(1).replace('.', ',')}%`,
          icon: 'chart-line',
          hint: 'Sobre o faturamento',
        })}
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Entradas x Saídas',
          descricao: 'Comparativo dos últimos meses',
        })}
        <div class="chart chart--bar"><canvas id="grafico-fluxo"></canvas></div>
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Lançamentos',
          descricao: 'Movimentações recentes do caixa',
          acoes: botaoPrimario({ label: 'Novo lançamento', icon: 'plus', acao: 'novo-lancamento' }),
        })}
        ${toolbar({ buscaId: 'busca-financeiro', placeholder: 'Buscar por descrição, categoria ou tipo...' })}
        <p class="table__count" id="contagem-financeiro"></p>
        ${tabela({ colunas, linhas: lancamentosExemplo, id: 'tabela-financeiro' })}
      </section>
    `,

    mount(root) {
      const estilo = getComputedStyle(root)
      let dados = lancamentosExemplo
      // O cartão "Entradas do mês" junta o valor da série mensal com a variação
      // do comparativo; guardo os dois para que cheguem na ordem que chegarem.
      let entradasMes = inicial.entradas
      let entradasAnterior = comparativoExemplo.entradasAnterior

      const contagem = root.querySelector('#contagem-financeiro')
      const input = root.querySelector('#busca-financeiro')

      const pintarEntradas = () =>
        atualizarKpi(root, 'entradas', {
          valor: formatBRL(entradasMes),
          delta: deltaEntradas({ entradas: entradasMes, entradasAnterior }),
        })

      const aplicar = (termo) => {
        const linhas = filtrar(dados, termo)
        atualizarTabela(root, 'tabela-financeiro', colunas, linhas)
        contagem.textContent = `${linhas.length} de ${dados.length} lançamentos`
      }

      aplicar('')

      input.addEventListener('input', () => aplicar(input.value))

      const aoBuscarGlobal = (evento) => {
        input.value = evento.detail
        aplicar(evento.detail)
      }
      window.addEventListener('busca-global', aoBuscarGlobal)

      const grafico = new Chart(root.querySelector('#grafico-fluxo'), {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Entradas',
              data: [],
              backgroundColor: estilo.getPropertyValue('--marca-verde').trim(),
              borderRadius: 6,
              maxBarThickness: 34,
            },
            {
              label: 'Saídas',
              data: [],
              backgroundColor: estilo.getPropertyValue('--marca-dourado').trim(),
              borderRadius: 6,
              maxBarThickness: 34,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: estilo.getPropertyValue('--borda').trim() },
              ticks: { callback: (v) => `R$ ${v}` },
            },
            x: { grid: { display: false } },
          },
        },
      })

      const aplicarLancamentos = (remotos) => {
        dados = remotos
        aplicar(input.value)
      }

      const aplicarFluxo = (fluxo) => {
        grafico.data.labels = fluxo.labels
        grafico.data.datasets[0].data = fluxo.entradas
        grafico.data.datasets[1].data = fluxo.saidas
        grafico.update()

        const kpi = indicadores(fluxo)
        entradasMes = kpi.entradas
        pintarEntradas()
        atualizarKpi(root, 'saidas', { valor: formatBRL(kpi.saidas) })
        atualizarKpi(root, 'resultado', { valor: formatBRL(kpi.resultado) })
        atualizarKpi(root, 'margem', { valor: `${kpi.margem.toFixed(1).replace('.', ',')}%` })
      }

      /**
       * O comparativo só entra se a consulta deu certo. Quando falha, `carregar`
       * devolve o exemplo — e misturar o número de exemplo com o valor real do
       * cartão seria pior do que não ter etiqueta nenhuma.
       */
      const comparativoDe = ({ dados, erro }) => (erro ? { entradasAnterior: null } : dados)

      const aplicarComparativo = ({ entradasAnterior: anterior }) => {
        entradasAnterior = anterior
        pintarEntradas()
      }

      const pararLancamentos = observar(listarLancamentos(), ({ dados: remotos }) =>
        aplicarLancamentos(remotos),
      )

      const pararFluxo = observar(carregarFluxoMensal(), ({ dados: fluxo }) => aplicarFluxo(fluxo))

      const pararComparativo = observar(carregarComparativoMensal(), (resultado) =>
        aplicarComparativo(comparativoDe(resultado)),
      )

      /** Busca de novo no banco e redesenha — usado depois de gravar. */
      const recarregar = async () => {
        const [{ dados: remotos }, { dados: fluxo }, comparativo] = await Promise.all([
          listarLancamentos(),
          carregarFluxoMensal(),
          carregarComparativoMensal(),
        ])

        aplicarLancamentos(remotos)
        aplicarFluxo(fluxo)
        aplicarComparativo(comparativoDe(comparativo))
      }

      root.querySelector('[data-acao="novo-lancamento"]').addEventListener('click', () => {
        abrirFormulario({
          titulo: 'Novo lançamento',
          descricao: 'Registre uma entrada ou uma saída do caixa.',
          campos: [
            { nome: 'descricao', label: 'Descrição', tipo: 'texto', obrigatorio: true, largo: true },
            {
              nome: 'tipo',
              label: 'Tipo',
              tipo: 'select',
              opcoes: [
                { valor: 'entrada', rotulo: 'Entrada' },
                { valor: 'saida', rotulo: 'Saída' },
              ],
              obrigatorio: true,
            },
            { nome: 'valor', label: 'Valor', tipo: 'numero', prefixo: 'R$', obrigatorio: true },
            {
              nome: 'categoria',
              label: 'Categoria',
              tipo: 'texto',
              obrigatorio: true,
              sugestoes: [...new Set(dados.map((l) => l.categoria))].sort(),
            },
            {
              nome: 'forma',
              label: 'Forma',
              tipo: 'texto',
              placeholder: 'Pix, Dinheiro, Crédito...',
              sugestoes: [...new Set(dados.map((l) => l.forma).filter((f) => f && f !== '—'))].sort(),
            },
            { nome: 'data', label: 'Data', tipo: 'data', obrigatorio: true },
          ],
          valores: { tipo: 'entrada', data: hoje(), valor: 0 },
          aoSalvar: async (valores) => {
            const { dados: criado, origem } = await criarLancamento(valores)

            if (origem === 'exemplo') {
              dados = [criado, ...dados]
              aplicar(input.value)
              return `${criado.descricao} entrou só nesta sessão — o Neon não está configurado.`
            }

            await recarregar()
            return `${criado.descricao} lançado no caixa.`
          },
        })
      })

      return () => {
        grafico.destroy()
        window.removeEventListener('busca-global', aoBuscarGlobal)
        pararLancamentos()
        pararFluxo()
        pararComparativo()
      }
    },
  }
}
