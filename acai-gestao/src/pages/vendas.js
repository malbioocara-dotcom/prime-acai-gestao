import { resumo as resumoExemplo, vendas as vendasExemplo } from '../data.js'
import { diaValido, rotuloDia, somarDias } from '../datas.js'
import { abrirFormulario, paraNumero } from '../formulario.js'
import { renderIcons } from '../icons.js'
import { hoje, observar } from '../services/base.js'
import { listarClientes } from '../services/clientes.js'
import { pode } from '../services/permissoes.js'
import { listarProdutos } from '../services/produtos.js'
import { listarRecipientes } from '../services/recipientes.js'
import { carregarImagemProduto, listarImagensProdutos } from '../services/imagens-produtos.js'
import { listarFormasPagamento, listarTiposVenda } from '../services/config-vendas.js'
import { carregarResumo } from '../services/resumo.js'
import {
  estornarVenda,
  LIMITE_DIA,
  listarVendas,
  proximoCodigoVenda,
  registrarVenda,
} from '../services/vendas.js'
import {
  atualizarKpi,
  atualizarTabela,
  badgeStatusVenda,
  botaoPrimario,
  cardHead,
  esc,
  formatBRL,
  statCard,
  tabela,
  toast,
  toolbar,
} from '../ui.js'

/**
 * Ação de linha: estornar a venda.
 *
 * Só aparece para quem tem `vendas.editar` (o banco recusa o resto de novo) e
 * não aparece numa venda já cancelada/estornada — não há o que devolver.
 */
const acoesVenda = (v) => `
  <div class="table__acoes">
    ${
      v.status === 'Cancelada'
        ? '<span class="muted">—</span>'
        : `<button class="btn btn--ghost btn--sm" type="button" data-acao="estornar-venda"
                   data-id="${esc(v.uuid ?? v.id)}" title="Estornar e devolver o estoque">
             <i data-lucide="rotate-ccw"></i><span>Estornar</span>
           </button>`
    }
  </div>
`

/**
 * Colunas da tabela de vendas. A coluna de Ações só existe para quem pode
 * estornar: para os demais, a tabela é a de antes — sem coluna vazia.
 */
const colunas = ({ podeEstornar = false } = {}) => [
  { key: 'id', label: 'Pedido', render: (v) => `<span class="mono">${esc(v.id)}</span>` },
  {
    key: 'cliente',
    label: 'Cliente',
    render: (v) => `
      <span class="cell-main">${esc(v.cliente)}</span>
      <span class="cell-sub">${v.itens} ${v.itens === 1 ? 'item' : 'itens'}</span>
    `,
  },
  { key: 'hora', label: 'Hora', render: (v) => `<span class="muted">${esc(v.hora)}</span>` },
  {
    key: 'tipoVenda',
    label: 'Tipo',
    render: (v) => `
      <span class="cell-main">${esc(v.tipoVenda ?? '—')}</span>
      ${v.plataforma ? `<span class="cell-sub">${esc(v.plataforma)}${v.pedidoExterno ? ` · ${esc(v.pedidoExterno)}` : ''}</span>` : ''}
      ${v.taxaEntrega ? `<span class="cell-sub">Entrega: ${formatBRL(v.taxaEntrega)}</span>` : ''}
      ${v.tipoVenda === 'Aplicativo' ? `<span class="cell-sub">Líquido est.: ${formatBRL(v.valorLiquidoEstimado ?? 0)} · Comissão: ${formatBRL(v.comissaoEstimada ?? 0)}</span>` : ''}
    `,
  },
  { key: 'pagamento', label: 'Pagamento', render: (v) => esc(v.pagamento) },
  {
    key: 'total',
    label: 'Total',
    align: 'right',
    render: (v) => `<strong>${formatBRL(v.total)}</strong>`,
  },
  { key: 'status', label: 'Status', render: badgeStatusVenda },
  ...(podeEstornar ? [{ key: 'acoes', label: 'Ações', render: acoesVenda }] : []),
]

const filtrar = (dados, termo) => {
  const busca = termo.trim().toLowerCase()
  if (!busca) return dados
  return dados.filter((venda) =>
    [venda.id, venda.cliente, venda.pagamento, venda.tipoVenda, venda.plataforma, venda.pedidoExterno, venda.status]
      .join(' ')
      .toLowerCase()
      .includes(busca),
  )
}

/**
 * Selo de idempotência da venda (ver `registrarVenda`).
 *
 * Uma chave por abertura do formulário: se o POST chegar duas vezes — clique
 * duplo, rede que repetiu, operador que tentou de novo depois de um erro — a
 * segunda volta traz a venda que já foi gravada, em vez de criar outra.
 */
const novaChave = () =>
  globalThis.crypto?.randomUUID?.() ??
  `venda-${Date.now()}-${Math.random().toString(16).slice(2)}`

export function vendasPage() {
  // Estornar é `vendas.editar` (o banco confere de novo). Sem a permissão, a
  // tela é a de sempre, sem a coluna de ações.
  const podeEstornar = pode('vendas', 'editar')
  const colunasVenda = colunas({ podeEstornar })

  return {
    html: `
      <section class="grid grid--stats">
        ${statCard({
          kpi: 'vendasHoje',
          label: 'Vendas hoje',
          valor: resumoExemplo.vendasHoje,
          delta: resumoExemplo.vendasHojeDelta,
          icon: 'clipboard-list',
          hint: 'Pedidos registrados',
        })}
        ${statCard({
          kpi: 'faturamentoHoje',
          label: 'Faturamento hoje',
          valor: formatBRL(resumoExemplo.faturamentoHoje),
          delta: resumoExemplo.faturamentoHojeDelta,
          icon: 'circle-dollar-sign',
          hint: 'Antes de taxas de cartão',
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
          kpi: 'cancelamentos',
          label: 'Cancelamentos',
          valor: resumoExemplo.cancelamentos,
          icon: 'alert-triangle',
          hint: 'Pedidos cancelados hoje',
        })}
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Pedidos',
          descricao: podeEstornar
            ? 'Escolha o dia, acompanhe os pedidos e estorne o que precisar'
            : 'Escolha o dia e acompanhe os pedidos',
          acoes: botaoPrimario({ label: 'Nova venda', icon: 'plus', acao: 'nova-venda' }),
        })}
        ${toolbar({
          buscaId: 'busca-vendas',
          placeholder: 'Buscar por pedido, cliente ou pagamento...',
          // O dia vem antes da busca: é o filtro que dá sentido à lista.
          filtros: `
            <div class="dia-nav" role="group" aria-label="Dia dos pedidos">
              <button class="btn btn--ghost btn--sm" type="button" data-dia="-1"
                      title="Dia anterior" aria-label="Dia anterior">
                <i data-lucide="chevron-left"></i>
              </button>
              <input class="dia-nav__campo" id="dia-vendas" type="date"
                     value="${hoje()}" max="${hoje()}" aria-label="Dia dos pedidos" />
              <button class="btn btn--ghost btn--sm" type="button" data-dia="1"
                      title="Próximo dia" aria-label="Próximo dia">
                <i data-lucide="chevron-right"></i>
              </button>
              <button class="btn btn--ghost btn--sm" type="button" data-acao="dia-hoje">Hoje</button>
            </div>
          `,
        })}
        <p class="table__count" id="contagem-vendas"></p>
        ${tabela({ colunas: colunasVenda, linhas: vendasExemplo, id: 'tabela-vendas' })}
      </section>
    `,

    mount(root) {
      let dados = vendasExemplo
      // O dia mostrado. Nasce em hoje; a navegação troca e busca de novo.
      let dia = hoje()

      const contagem = root.querySelector('#contagem-vendas')
      const input = root.querySelector('#busca-vendas')
      const campoDia = root.querySelector('#dia-vendas')
      const botaoHoje = root.querySelector('[data-acao="dia-hoje"]')
      const botaoProximo = root.querySelector('[data-dia="1"]')

      const aplicar = (termo) => {
        const linhas = filtrar(dados, termo)
        atualizarTabela(root, 'tabela-vendas', colunasVenda, linhas)
        // O rótulo do dia fica junto da contagem: é ele que diz ao operador que
        // a lista NÃO é a de hoje quando ele navegou para outro dia.
        //
        // Quando o dia bate o teto da consulta, os carregados são os MAIS
        // RECENTES (a consulta ordena de trás para frente) — e "300 de 300"
        // sozinho faria o operador achar que o dia teve 300 pedidos.
        const cortado = dados.length >= LIMITE_DIA ? ' · mostrando os mais recentes' : ''
        contagem.textContent = `${rotuloDia(dia, hoje())} · ${linhas.length} de ${dados.length} pedidos${cortado}`
        renderIcons(root)
        ligarAcoes()
      }

      aplicar('')

      input.addEventListener('input', () => aplicar(input.value))

      // A busca da barra superior também filtra esta tabela.
      const aoBuscarGlobal = (evento) => {
        input.value = evento.detail
        aplicar(evento.detail)
      }
      window.addEventListener('busca-global', aoBuscarGlobal)

      const aplicarResumo = (r) => {
        atualizarKpi(root, 'vendasHoje', { valor: r.vendasHoje, delta: r.vendasHojeDelta })
        atualizarKpi(root, 'faturamentoHoje', {
          valor: formatBRL(r.faturamentoHoje),
          delta: r.faturamentoHojeDelta,
        })
        atualizarKpi(root, 'ticketMedio', {
          valor: formatBRL(r.ticketMedio),
          delta: r.ticketMedioDelta,
        })
        atualizarKpi(root, 'cancelamentos', { valor: r.cancelamentos })
      }

      const diaInicial = dia
      const pararVendas = observar(listarVendas({ dia: diaInicial }), ({ dados: remotas }) => {
        // O operador pode ter trocado o dia enquanto esta resposta vinha: a
        // resposta antiga não pode sobrescrever a lista do dia novo.
        if (dia !== diaInicial) return
        dados = remotas
        aplicar(input.value)
      })

      const pararResumo = observar(carregarResumo(), ({ dados: r }) => aplicarResumo(r))

      /** Busca o dia escolhido e redesenha — ao navegar e depois de gravar. */
      const recarregar = async () => {
        const pedido = dia
        const [{ dados: remotas }, { dados: r }] = await Promise.all([
          listarVendas({ dia: pedido }),
          carregarResumo(),
        ])

        // Dois cliques rápidos em "dia anterior": só a resposta do último vale.
        if (dia !== pedido) return

        dados = remotas
        aplicar(input.value)
        aplicarResumo(r)
      }

      /** Deixa os controles coerentes com o dia (não existe pedido no futuro). */
      const ajustarDia = () => {
        const limite = hoje()
        campoDia.value = dia
        campoDia.max = limite
        botaoProximo.disabled = dia >= limite
        botaoHoje.disabled = dia >= limite
      }

      /** Troca o dia e busca de novo. */
      const irPara = async (novo) => {
        const alvo = diaValido(novo) ? novo : hoje()
        if (alvo === dia) {
          ajustarDia()
          return
        }

        dia = alvo
        ajustarDia()
        await recarregar()
      }

      campoDia.addEventListener('change', () => irPara(campoDia.value))
      botaoHoje.addEventListener('click', () => irPara(hoje()))
      root.querySelectorAll('[data-dia]').forEach((botao) => {
        botao.addEventListener('click', () => irPara(somarDias(dia, Number(botao.dataset.dia))))
      })

      ajustarDia()

      /** (Re)liga os botões da tabela: cada redesenho troca os botões antigos. */
      function ligarAcoes() {
        root.querySelectorAll('[data-acao="estornar-venda"]').forEach((btn) => {
          btn.addEventListener('click', () => estornar(btn.dataset.id))
        })
      }

      /**
       * Estorna uma venda (migração 11).
       *
       * O motivo é obrigatório no banco — sem ele o estorno não se audita. Uma
       * janela de verdade (e não um "tem certeza?") porque o operador precisa
       * dizer POR QUE está desfazendo a venda.
       */
      async function estornar(vendaId) {
        const venda = dados.find((v) => (v.uuid ?? v.id) === vendaId)
        if (!venda) return

        abrirFormulario({
          titulo: `Estornar pedido ${venda.id}`,
          descricao:
            'O pedido sai do faturamento e o estoque que ele tirou volta para a prateleira. O histórico guarda quem estornou, quando e por quê.',
          campos: [
            {
              nome: 'motivo',
              label: 'Motivo do estorno',
              tipo: 'textarea',
              obrigatorio: true,
              largo: true,
              placeholder: 'Ex.: cliente desistiu, pedido lançado em duplicidade...',
            },
          ],
          textoBotao: 'Estornar venda',
          aoSalvar: async ({ motivo }) => {
            const { dados: estornada, origem } = await estornarVenda({
              vendaId: venda.uuid ?? null,
              codigo: venda.id,
              motivo,
            })

            if (origem === 'exemplo') {
              dados = dados.map((v) =>
                (v.uuid ?? v.id) === vendaId
                  ? { ...v, status: 'Cancelada', estornadaEm: estornada.estornadaEm }
                  : v,
              )
              aplicar(input.value)
              return `Pedido ${venda.id} estornado só nesta sessão — o Neon não está configurado.`
            }

            await recarregar()

            if (estornada.jaEstornada) {
              return `Pedido ${venda.id} já estava estornado — nada foi devolvido de novo.`
            }

            return estornada.movimentos
              ? `Pedido ${venda.id} estornado — ${estornada.movimentos} ${estornada.movimentos === 1 ? 'movimento devolvido' : 'movimentos devolvidos'} ao estoque.`
              : `Pedido ${venda.id} estornado — não havia estoque a devolver.`
          },
        })
      }

      const botaoNova = root.querySelector('[data-acao="nova-venda"]')

      botaoNova.addEventListener('click', async () => {
        // O formulário precisa das listas de clientes e produtos para os selects.
        const rotulo = botaoNova.innerHTML
        botaoNova.disabled = true
        botaoNova.textContent = 'Carregando...'

        try {
          const [
            { dados: listaClientes },
            { dados: listaProdutos },
            { dados: listaRecipientes },
            { dados: tiposVenda },
            { dados: formasPagamento },
            codigo,
          ] = await Promise.all([
            listarClientes(),
            listarProdutos(),
            listarRecipientes({ somenteAtivos: true }),
            listarTiposVenda({ somenteAtivos: true }),
            listarFormasPagamento({ somenteAtivos: true }),
            proximoCodigoVenda(),
          ])
          if (!tiposVenda.length || !formasPagamento.length) {
            throw new Error('Cadastre pelo menos um tipo de venda e uma forma de pagamento nas Configurações.')
          }

          let fotosDisponiveis = new Map()
          try {
            const resultadoFotos = await listarImagensProdutos(
              listaProdutos.map((produto) => produto.uuid).filter(Boolean),
            )
            if (resultadoFotos.disponivel) fotosDisponiveis = resultadoFotos.imagens
          } catch (erro) {
            console.error('[vendas] Não foi possível consultar as fotos dos produtos.', erro)
          }
          const produtosComFotos = listaProdutos.map((produto) => ({
            ...produto,
            imagemPath: fotosDisponiveis.get(produto.uuid) ?? null,
          }))

          // Uma chave por abertura de formulário (ver `novaChave`).
          const chave = novaChave()
          const tipoInicial = tiposVenda.find((tipo) => tipo.codigo === 'balcao') ?? tiposVenda[0]
          const pagamentoInicial =
            formasPagamento.find((forma) => forma.categoria === 'pix') ?? formasPagamento[0]
          const urlsFotos = new Map()
          let modalVenda = null
          let observarFechamento = null
          const carregarFotoProduto = async (produtoId) => {
            if (!fotosDisponiveis.has(produtoId)) return null
            if (urlsFotos.has(produtoId)) return urlsFotos.get(produtoId)
            const blob = await carregarImagemProduto(produtoId)
            if (!blob) return null
            if (!modalVenda?.isConnected) return null
            const url = URL.createObjectURL(blob)
            urlsFotos.set(produtoId, url)
            return url
          }

          abrirFormulario({
            titulo: 'Nova venda',
            descricao:
              'Monte o pedido escolhendo os itens — o total é calculado sozinho. Item por peso pede o peso lido na balança. Taxas e comissões são estimativas: não confirmam pagamento nem consultam aplicativos.',
            campos: [
              {
                nome: 'codigo',
                label: 'Pedido',
                tipo: 'texto',
                placeholder: codigo,
                ajuda:
                  'Pode deixar em branco: o sistema numera o pedido. Digite só se precisar escolher o número.',
              },
              {
                nome: 'clienteId',
                label: 'Cliente',
                tipo: 'select',
                vazio: 'Consumidor (sem cadastro)',
                opcoes: listaClientes.map((c) => ({ valor: c.uuid ?? c.id, rotulo: c.nome })),
              },
              {
                nome: 'tipoVendaId',
                label: 'Tipo de venda',
                tipo: 'select',
                opcoes: tiposVenda.map((tipo) => ({
                  valor: tipo.id,
                  rotulo: tipo.nome,
                })),
                obrigatorio: true,
              },
              {
                nome: 'status',
                label: 'Status',
                tipo: 'select',
                opcoes: ['Aguardando', 'Em preparo', 'Concluída', 'Cancelada'],
                obrigatorio: true,
              },
              {
                nome: 'formaPagamentoId',
                label: 'Forma de pagamento',
                tipo: 'select',
                opcoes: formasPagamento.map((forma) => ({
                  valor: forma.id,
                  rotulo: forma.nome,
                })),
                obrigatorio: true,
              },
              {
                nome: 'enderecoEntrega',
                label: 'Endereço de entrega',
                tipo: 'texto',
                largo: true,
                placeholder: 'Rua, número, bairro e referência',
              },
              {
                nome: 'taxaEntrega',
                label: 'Taxa de entrega',
                tipo: 'numero',
                prefixo: 'R$',
              },
              {
                nome: 'plataforma',
                label: 'Aplicativo / plataforma',
                tipo: 'texto',
                placeholder: 'Ex.: iFood',
              },
              {
                nome: 'pedidoExterno',
                label: 'Número do pedido no aplicativo',
                tipo: 'texto',
                placeholder: 'Identificador externo (opcional)',
              },
              {
                nome: 'comissaoPercentual',
                label: 'Comissão do aplicativo',
                tipo: 'numero',
                ajuda: 'Percentual aplicado sobre o total cobrado.',
                placeholder: '0',
              },
              {
                nome: 'taxaAplicativo',
                label: 'Outras taxas do aplicativo',
                tipo: 'numero',
                prefixo: 'R$',
              },
              {
                nome: 'valorRecebido',
                label: 'Valor recebido em dinheiro',
                tipo: 'texto',
                placeholder: 'Opcional — usado para calcular o troco',
              },
              {
                nome: 'itens',
                label: 'Itens do pedido',
                tipo: 'itens',
                obrigatorio: true,
                produtos: produtosComFotos,
                recipientes: listaRecipientes,
                carregarImagem: carregarFotoProduto,
              },
            ],
            valores: {
              status: 'Concluída',
              tipoVendaId: tipoInicial.id,
              formaPagamentoId: pagamentoInicial.id,
              taxaEntrega: 0,
              comissaoPercentual: 0,
              taxaAplicativo: 0,
            },
            textoBotao: 'Registrar venda',
            aoSalvar: async (valores) => {
              const tipoVenda = tiposVenda.find((tipo) => tipo.id === valores.tipoVendaId)
              const formaPagamento = formasPagamento.find(
                (forma) => forma.id === valores.formaPagamentoId,
              )
              if (!tipoVenda || !formaPagamento) {
                throw new Error('Selecione um tipo de venda e uma forma de pagamento ativos.')
              }

              const textoRecebido = String(valores.valorRecebido ?? '').trim()
              const valorRecebido =
                formaPagamento.categoria === 'dinheiro' && textoRecebido
                  ? paraNumero(textoRecebido)
                  : undefined
              if (textoRecebido && formaPagamento.categoria === 'dinheiro' &&
                  (!Number.isFinite(valorRecebido) || valorRecebido < 0)) {
                throw new Error('Informe um valor recebido válido.')
              }

              const clienteNome = listaClientes.find(
                (c) => (c.uuid ?? c.id) === valores.clienteId,
              )?.nome

              const { dados: criada, origem } = await registrarVenda({
                ...valores,
                clienteNome,
                tipoVendaNome: tipoVenda.nome,
                formaPagamentoNome: formaPagamento.nome,
                formaPagamentoCategoria: formaPagamento.categoria,
                valorRecebido,
                chave,
              })

              if (origem === 'exemplo') {
                dados = [criada, ...dados]
                aplicar(input.value)
                return `Pedido ${criada.id} entrou só nesta sessão — o Neon não está configurado.`
              }

              await recarregar()

              if (criada.jaExistia) {
                return `Pedido ${criada.id} já estava registrado — nada foi duplicado.`
              }

              return criada.movimentos
                ? `Pedido ${criada.id} registrado — ${formatBRL(criada.total)} (estoque baixado).`
                : `Pedido ${criada.id} registrado — ${formatBRL(criada.total)}.`
            },
          })
          modalVenda = document.querySelector('.modal')
          if (modalVenda && typeof MutationObserver !== 'undefined') {
            observarFechamento = new MutationObserver(() => {
              if (modalVenda.isConnected) return
              observarFechamento.disconnect()
              urlsFotos.forEach((url) => URL.revokeObjectURL(url))
              urlsFotos.clear()
            })
            observarFechamento.observe(document.body, { childList: true })
          }

          const modal = document.querySelector('.modal')
          const campoTipo = modal?.querySelector('[name="tipoVendaId"]')
          const campoForma = modal?.querySelector('[name="formaPagamentoId"]')
          const camposEntrega = ['enderecoEntrega', 'taxaEntrega']
          const camposAplicativo = ['plataforma', 'pedidoExterno', 'comissaoPercentual', 'taxaAplicativo']
          const resumo = document.createElement('p')
          resumo.className = 'campo__ajuda campo--largo'
          resumo.id = 'resumo-venda-cobranca'
          modal?.querySelector('[data-campo="itens"]')?.after(resumo)

          const atualizarCampos = () => {
            const categoria = tiposVenda.find((tipo) => tipo.id === campoTipo?.value)?.categoria
            for (const nome of camposEntrega) {
              const campo = modal?.querySelector(`[data-campo="${nome}"]`)
              if (campo) campo.hidden = !['delivery', 'aplicativo'].includes(categoria)
            }
            for (const nome of camposAplicativo) {
              const campo = modal?.querySelector(`[data-campo="${nome}"]`)
              if (campo) campo.hidden = categoria !== 'aplicativo'
            }
            const dinheiro =
              formasPagamento.find((forma) => forma.id === campoForma?.value)?.categoria === 'dinheiro'
            const campoRecebido = modal?.querySelector('[data-campo="valorRecebido"]')
            if (campoRecebido) campoRecebido.hidden = !dinheiro
          }

          const atualizarResumoCobranca = () => {
            if (!modal || !resumo) return
            const textoTotal = modal.querySelector('[data-itens-total]')?.textContent ?? ''
            const subtotal = (Number(textoTotal.replace(/\D/g, '')) || 0) / 100
            const taxaEl = modal.querySelector('[name="taxaEntrega"]')
            const taxa = taxaEl && !taxaEl.closest('[data-campo]')?.hidden
              ? (paraNumero(taxaEl.value) || 0)
              : 0
            const total = subtotal + taxa
            const recebidoTexto = modal.querySelector('[name="valorRecebido"]')?.value.trim()
            const categoriaForma = formasPagamento.find((forma) => forma.id === campoForma?.value)?.categoria
            const recebido = categoriaForma === 'dinheiro' && recebidoTexto ? paraNumero(recebidoTexto) : total
            const troco = categoriaForma === 'dinheiro' && Number.isFinite(recebido)
              ? Math.max(0, recebido - total)
              : 0
            resumo.textContent = `Total a cobrar: ${formatBRL(total)} · Troco: ${formatBRL(troco)}`
          }

          campoTipo?.addEventListener('change', atualizarCampos)
          campoForma?.addEventListener('change', atualizarCampos)
          modal?.addEventListener('input', atualizarResumoCobranca)
          modal?.addEventListener('change', atualizarResumoCobranca)
          atualizarCampos()
          atualizarResumoCobranca()
        } catch (erro) {
          console.error('[vendas] Não foi possível abrir o formulário.', erro)
          toast('Não foi possível carregar clientes e produtos.')
        } finally {
          botaoNova.disabled = false
          botaoNova.innerHTML = rotulo
          renderIcons(botaoNova)
        }
      })

      return () => {
        window.removeEventListener('busca-global', aoBuscarGlobal)
        pararVendas()
        pararResumo()
      }
    },
  }
}
