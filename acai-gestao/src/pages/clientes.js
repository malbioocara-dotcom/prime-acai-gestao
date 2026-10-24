import { clientes as clientesExemplo, resumo as resumoExemplo } from '../data.js'
import { abrirFormulario } from '../formulario.js'
import { observar, hoje } from '../services/base.js'
import { criarCliente, listarClientes, proximoCodigoCliente } from '../services/clientes.js'
import { carregarResumo } from '../services/resumo.js'
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

const tons = { VIP: 'vip', Recorrente: 'info', Novo: 'neutral' }

function iniciais(nome) {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase()
}

const colunas = [
  {
    key: 'nome',
    label: 'Cliente',
    render: (c) => `
      <div class="cell-user">
        <span class="avatar avatar--sm" aria-hidden="true">${iniciais(c.nome)}</span>
        <span>
          <span class="cell-main">${esc(c.nome)}</span>
          <span class="cell-sub">${esc(c.email)}</span>
        </span>
      </div>
    `,
  },
  { key: 'telefone', label: 'Telefone', render: (c) => `<span class="muted">${esc(c.telefone)}</span>` },
  {
    key: 'desde',
    label: 'Cliente desde',
    render: (c) => `<span class="muted">${formatData(c.desde)}</span>`,
  },
  {
    key: 'pedidos',
    label: 'Pedidos',
    align: 'center',
    render: (c) => `<span class="cell-main">${c.pedidos}</span>`,
  },
  {
    key: 'total',
    label: 'Total gasto',
    align: 'right',
    render: (c) => `<strong>${formatBRL(c.total)}</strong>`,
  },
  {
    key: 'ultimaCompra',
    label: 'Última compra',
    render: (c) => `<span class="muted">${formatData(c.ultimaCompra)}</span>`,
  },
  { key: 'tier', label: 'Perfil', render: (c) => badge(c.tier, tons[c.tier] ?? 'neutral') },
]

const filtrar = (dados, termo) => {
  const busca = termo.trim().toLowerCase()
  if (!busca) return dados
  return dados.filter((c) =>
    [c.nome, c.email, c.telefone, c.tier].join(' ').toLowerCase().includes(busca),
  )
}

/** Gasto médio por pedido e quantidade de clientes VIP da lista exibida. */
function indicadores(lista) {
  const pedidos = lista.reduce((acc, c) => acc + c.pedidos, 0)
  const gasto = lista.reduce((acc, c) => acc + c.total, 0)
  return {
    gastoMedio: pedidos ? gasto / pedidos : 0,
    vips: lista.filter((c) => c.tier === 'VIP').length,
  }
}

export function clientesPage() {
  const inicial = indicadores(clientesExemplo)

  return {
    html: `
      <section class="grid grid--stats">
        ${statCard({
          kpi: 'clientesBase',
          label: 'Clientes na base',
          valor: resumoExemplo.clientesAtivos,
          delta: resumoExemplo.clientesAtivosDelta,
          icon: 'users',
          hint: 'Cadastrados no sistema',
        })}
        ${statCard({
          kpi: 'novosClientes',
          label: 'Novos clientes',
          valor: resumoExemplo.novosClientes,
          icon: 'user-plus',
          hint: 'Cadastrados nos últimos 30 dias',
        })}
        ${statCard({
          kpi: 'gastoMedio',
          label: 'Gasto médio por pedido',
          valor: formatBRL(inicial.gastoMedio),
          icon: 'trending-up',
          hint: 'Considerando os clientes listados',
        })}
        ${statCard({
          kpi: 'clientesVip',
          label: 'Clientes VIP',
          valor: inicial.vips,
          icon: 'circle-dollar-sign',
          hint: 'Perfil de maior recorrência',
        })}
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Base de clientes',
          descricao: 'Cadastro, histórico de compras e classificação',
          acoes: botaoPrimario({ label: 'Novo cliente', icon: 'user-plus', acao: 'novo-cliente' }),
        })}
        ${toolbar({ buscaId: 'busca-clientes', placeholder: 'Buscar por nome, e-mail ou telefone...' })}
        <p class="table__count" id="contagem-clientes"></p>
        ${tabela({ colunas, linhas: clientesExemplo, id: 'tabela-clientes' })}
      </section>
    `,

    mount(root) {
      let dados = clientesExemplo

      const contagem = root.querySelector('#contagem-clientes')
      const input = root.querySelector('#busca-clientes')

      const aplicarIndicadores = () => {
        const kpi = indicadores(dados)
        atualizarKpi(root, 'gastoMedio', { valor: formatBRL(kpi.gastoMedio) })
        atualizarKpi(root, 'clientesVip', { valor: kpi.vips })
      }

      const aplicar = (termo) => {
        const linhas = filtrar(dados, termo)
        atualizarTabela(root, 'tabela-clientes', colunas, linhas)
        contagem.textContent = `${linhas.length} de ${dados.length} clientes`
      }

      aplicar('')

      input.addEventListener('input', () => aplicar(input.value))

      const aoBuscarGlobal = (evento) => {
        input.value = evento.detail
        aplicar(evento.detail)
      }
      window.addEventListener('busca-global', aoBuscarGlobal)

      const pararClientes = observar(listarClientes(), ({ dados: remotos }) => {
        dados = remotos
        aplicar(input.value)
        aplicarIndicadores()
      })

      const aplicarResumo = (r) => {
        atualizarKpi(root, 'clientesBase', {
          valor: r.clientesAtivos,
          delta: r.clientesAtivosDelta,
        })
        atualizarKpi(root, 'novosClientes', { valor: r.novosClientes })
      }

      const pararResumo = observar(carregarResumo(), ({ dados: r }) => aplicarResumo(r))

      /** Busca de novo no banco e redesenha — usado depois de gravar. */
      const recarregar = async () => {
        const [{ dados: remotos }, { dados: r }] = await Promise.all([
          listarClientes(),
          carregarResumo(),
        ])

        dados = remotos
        aplicar(input.value)
        aplicarIndicadores()
        aplicarResumo(r)
      }

      root.querySelector('[data-acao="novo-cliente"]').addEventListener('click', () => {
        abrirFormulario({
          titulo: 'Novo cliente',
          descricao: 'O cliente entra na base e já pode ser vinculado aos pedidos.',
          campos: [
            { nome: 'codigo', label: 'Código', tipo: 'texto', obrigatorio: true },
            { nome: 'nome', label: 'Nome completo', tipo: 'texto', obrigatorio: true, largo: true },
            { nome: 'telefone', label: 'Telefone', tipo: 'texto', placeholder: '(11) 90000-0000' },
            { nome: 'email', label: 'E-mail', tipo: 'texto', placeholder: 'cliente@email.com' },
            { nome: 'desde', label: 'Cliente desde', tipo: 'data', obrigatorio: true },
            {
              nome: 'tier',
              label: 'Perfil',
              tipo: 'select',
              opcoes: ['Novo', 'Recorrente', 'VIP'],
              obrigatorio: true,
            },
            { nome: 'observacoes', label: 'Observações', tipo: 'textarea', largo: true },
          ],
          valores: { codigo: proximoCodigoCliente(dados), desde: hoje(), tier: 'Novo' },
          aoSalvar: async (valores) => {
            const { dados: criado, origem } = await criarCliente(valores)

            if (origem === 'exemplo') {
              dados = [criado, ...dados]
              aplicar(input.value)
              aplicarIndicadores()
              return `${criado.nome} entrou só nesta sessão — o Neon não está configurado.`
            }

            await recarregar()
            return `${criado.nome} salvo na base de clientes.`
          },
        })
      })

      return () => {
        window.removeEventListener('busca-global', aoBuscarGlobal)
        pararClientes()
        pararResumo()
      }
    },
  }
}
