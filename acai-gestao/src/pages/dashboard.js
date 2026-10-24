import Chart from 'chart.js/auto'
import { resumo as resumoExemplo, vendas as vendasExemplo } from '../data.js'
import { observar } from '../services/base.js'
import { carregarFaturamentoDiario, carregarVendasPorCategoria } from '../services/dashboard.js'
import { carregarResumo } from '../services/resumo.js'
import { listarVendasRecentes } from '../services/vendas.js'
import { atualizarKpi, badgeStatusVenda, cardHead, esc, formatBRL, statCard, tabela, tabelaLinhas } from '../ui.js'

/**
 * Cores do gráfico de rosca ("Vendas por categoria").
 */
const colunas = [
  { key: 'id', label: 'Pedido', render: (l) => `<span class="mono">${esc(l.id)}</span>` },
  { key: 'cliente', label: 'Cliente', render: (l) => esc(l.cliente) },
  { key: 'hora', label: 'Hora', render: (l) => `<span class="muted">${esc(l.hora)}</span>` },
  {
    key: 'itens',
    label: 'Itens',
    align: 'center',
    render: (l) => `<span class="muted">${l.itens}</span>`,
  },
  {
    key: 'total',
    label: 'Total',
    align: 'right',
    render: (l) => `<strong>${formatBRL(l.total)}</strong>`,
  },
  {
    key: 'status',
    label: 'Status',
    render: badgeStatusVenda,
  },
]

export function dashboardPage() {
  return {
    html: `
      <section class="grid grid--stats">
        ${statCard({
          kpi: 'faturamentoMes',
          label: 'Faturamento do mês',
          valor: formatBRL(resumoExemplo.faturamentoMes),
          delta: resumoExemplo.faturamentoDelta,
          icon: 'circle-dollar-sign',
          hint: 'Vendas não canceladas no mês',
        })}
        ${statCard({
          kpi: 'vendasHoje',
          label: 'Vendas hoje',
          valor: resumoExemplo.vendasHoje,
          delta: resumoExemplo.vendasHojeDelta,
          icon: 'shopping-cart',
          hint: 'Pedidos registrados no dia',
        })}
        ${statCard({
          kpi: 'ticketMedio',
          label: 'Ticket médio',
          valor: formatBRL(resumoExemplo.ticketMedio),
          delta: resumoExemplo.ticketMedioDelta,
          icon: 'trending-up',
          hint: 'Média por pedido',
        })}
        ${statCard({
          kpi: 'clientesAtivos',
          label: 'Clientes na base',
          valor: resumoExemplo.clientesAtivos,
          delta: resumoExemplo.clientesAtivosDelta,
          icon: 'users',
          hint: 'Cadastrados no sistema',
        })}
      </section>

      <section class="grid grid--charts">
        <article class="card">
          ${cardHead({ titulo: 'Faturamento dos últimos 7 dias', descricao: 'Valores em reais' })}
          <div class="chart chart--line"><canvas id="grafico-faturamento"></canvas></div>
        </article>

        <article class="card">
          ${cardHead({ titulo: 'Vendas por categoria', descricao: 'Participação no período' })}
          <div class="chart chart--doughnut"><canvas id="grafico-categorias"></canvas></div>
        </article>
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Vendas recentes',
          descricao: 'Últimos pedidos registrados',
        })}
        ${tabela({ colunas, linhas: vendasExemplo, id: 'tabela-vendas-recentes' })}
      </section>
    `,

    mount(root) {
      const estilo = getComputedStyle(root)
      const cores = {
        roxo: estilo.getPropertyValue('--marca-roxo').trim(),
        roxoClaro: estilo.getPropertyValue('--primaria-fundo').trim(),
        grade: estilo.getPropertyValue('--borda').trim(),
      }
      const coresCategorias = [
        estilo.getPropertyValue('--marca-roxo').trim(),
        estilo.getPropertyValue('--marca-dourado').trim(),
        estilo.getPropertyValue('--marca-verde').trim(),
        estilo.getPropertyValue('--marca-roxo').trim(),
        estilo.getPropertyValue('--marca-dourado').trim(),
        estilo.getPropertyValue('--marca-verde').trim(),
      ]
      const graficoFaturamento = new Chart(root.querySelector('#grafico-faturamento'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Faturamento',
              data: [],
              borderColor: cores.roxo,
              backgroundColor: cores.roxoClaro,
              fill: true,
              tension: 0.35,
              borderWidth: 2,
              pointRadius: 4,
              pointBackgroundColor: cores.roxo,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: cores.grade },
              ticks: { callback: (v) => `R$ ${v}` },
            },
            x: { grid: { display: false } },
          },
        },
      })

      const graficoCategorias = new Chart(root.querySelector('#grafico-categorias'), {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              backgroundColor: coresCategorias,
              borderWidth: 0,
              // Pequeno vão entre as fatias: separa os tons sem mudar o tema.
              spacing: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
          },
        },
      })

      const pararResumo = observar(carregarResumo(), ({ dados }) => {
        atualizarKpi(root, 'faturamentoMes', {
          valor: formatBRL(dados.faturamentoMes),
          delta: dados.faturamentoDelta,
        })
        atualizarKpi(root, 'vendasHoje', {
          valor: dados.vendasHoje,
          delta: dados.vendasHojeDelta,
        })
        atualizarKpi(root, 'ticketMedio', {
          valor: formatBRL(dados.ticketMedio),
          delta: dados.ticketMedioDelta,
        })
        atualizarKpi(root, 'clientesAtivos', {
          valor: dados.clientesAtivos,
          delta: dados.clientesAtivosDelta,
        })
      })

      const pararFaturamento = observar(carregarFaturamentoDiario(), ({ dados }) => {
        graficoFaturamento.data.labels = dados.labels
        graficoFaturamento.data.datasets[0].data = dados.valores
        graficoFaturamento.update()
      })

      const pararCategorias = observar(carregarVendasPorCategoria(), ({ dados }) => {
        graficoCategorias.data.labels = dados.labels
        graficoCategorias.data.datasets[0].data = dados.valores
        graficoCategorias.update()
      })

      const pararRecentes = observar(listarVendasRecentes(), ({ dados }) => {
        const tbody = root.querySelector('#tabela-vendas-recentes tbody')
        if (tbody) tbody.innerHTML = tabelaLinhas(colunas, dados)
      })

      return () => {
        graficoFaturamento.destroy()
        graficoCategorias.destroy()
        pararResumo()
        pararFaturamento()
        pararCategorias()
        pararRecentes()
      }
    },
  }
}
