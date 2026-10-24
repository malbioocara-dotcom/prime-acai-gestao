import '../styles/compras.css'

import { abrirFormulario, confirmar, fechar as fecharFormulario } from '../formulario.js'
import { renderIcons } from '../icons.js'
import { formatarNumero, paraNumero } from '../numeros.js'
import { hoje } from '../services/base.js'
import {
  STATUS_ABERTOS,
  STATUS_COMPRA,
  TIPOS_DOCUMENTO,
  atualizarFornecedor,
  cancelarCompra,
  criarFornecedor,
  definirFornecedorAtivo,
  excluirCompra,
  gerarCsvCompras,
  listarCompras,
  listarFornecedores,
  marcarAguardandoRecebimento,
  mensagemErro,
  receberCompra,
  registrarCompra,
  resumoCompras,
  rotuloStatus,
  tomStatus,
} from '../services/compras.js'
import { pode } from '../services/permissoes.js'
import { listarProdutos } from '../services/produtos.js'
import {
  atualizarKpi,
  badge,
  botaoPrimario,
  cardHead,
  esc,
  formatBRL,
  statCard,
  tabela,
  toast,
} from '../ui.js'

/* ============================================================================
 * Estado da tela
 * ========================================================================== */

let compras = []
let fornecedores = []
let produtos = []
let itensNovos = []
let editandoKey = null

const podeCriar = () => pode('compras', 'criar')
const podeEditar = () => pode('compras', 'editar')
const podeExcluir = () => pode('compras', 'excluir')

const idChave = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`

const dataBR = (iso) => {
  if (!iso) return '—'
  const texto = String(iso)
  const somenteData = texto.slice(0, 10)
  const d = new Date(`${somenteData}T00:00:00`)
  return Number.isNaN(d.getTime()) ? texto : d.toLocaleDateString('pt-BR')
}

const qtd = (valor) => formatarNumero(Number(valor) || 0)

// No Neon o produto tem `uuid`; no modo demonstração só existe o código (P001).
const chaveProduto = (produto) => produto.uuid ?? produto.id

const produtoPorId = (produtoId) =>
  produtos.find((p) => chaveProduto(p) === produtoId || p.uuid === produtoId || p.id === produtoId)

const unidadeEstoque = (produtoId) => produtoPorId(produtoId)?.unidade ?? ''

const nomeProduto = (produtoId, alternativa = '') =>
  produtoPorId(produtoId)?.nome ?? alternativa

const rotuloDocumento = (compra) =>
  compra.tipoDocumento === 'com_nota'
    ? `Nota ${compra.numeroNota || 's/nº'}`
    : 'Sem nota'

const somaItens = (lista) =>
  lista.reduce(
    (acc, item) =>
      acc +
      Math.max(
        0,
        (Number(item.quantidadeSolicitada) || 0) * (Number(item.custoUnitario) || 0) -
          (Number(item.descontoValor) || 0),
      ),
    0,
  )

const descontosItens = (lista) =>
  lista.reduce((acc, item) => acc + (Number(item.descontoValor) || 0), 0)

/* ============================================================================
 * HTML
 * ========================================================================== */

export function comprasPage({ fornecedoresOnly = false } = {}) {
  const hojeISO = hoje()

  return {
    html: `
      <section class="page-head">
        <div>
          <p class="page-subtitle">Registre a compra, receba a mercadoria e dê entrada no estoque com custo e validade.</p>
        </div>
      </section>

      <section class="grid grid--stats" aria-label="Indicadores de compras">
        ${statCard({ label: 'Compras abertas', valor: '0', icon: 'clipboard-list', kpi: 'comprasPendentes', hint: 'Rascunho, aguardando ou parcial' })}
        ${statCard({ label: 'Valor pendente', valor: formatBRL(0), icon: 'wallet', kpi: 'comprasValorPendente', hint: 'Mercadoria ainda não recebida' })}
        ${statCard({ label: 'Compras do mês', valor: formatBRL(0), icon: 'shopping-cart', kpi: 'comprasMes', hint: 'Total comprado no mês' })}
        ${statCard({ label: 'Validade próxima', valor: '0', icon: 'alert-triangle', kpi: 'comprasValidade', hint: 'Itens vencendo em até 30 dias' })}
      </section>

      <div id="compras-alertas"></div>

      <div class="compras-tabs" role="tablist" aria-label="Seções de compras">
        <button type="button" class="compras-tab is-active" data-tab="compra" role="tab" aria-selected="true">Compra</button>
        <button type="button" class="compras-tab" data-tab="fornecedores" role="tab" aria-selected="false">Fornecedores</button>
      </div>

      <!-- ============================== NOVA COMPRA ============================== -->
      <section class="compras-painel" data-painel="nova" role="tabpanel" hidden>
        <div class="card">
          ${cardHead({
            titulo: 'Nova compra',
            descricao: 'A compra só movimenta o estoque quando o recebimento é confirmado.',
            acoes: `
              <button class="btn btn--ghost" type="button" data-acao="voltar-compras">
                <i data-lucide="arrow-left"></i><span>Voltar para compras</span>
              </button>
              <span class="badge badge--neutral" id="nova-situacao">Rascunho</span>
            `,
          })}

          <div class="compras-form">
            <label class="campo">
              <span class="campo__label">Data da compra</span>
              <input class="campo__input" id="compra-data" type="date" value="${hojeISO}" />
            </label>

            <label class="campo campo--largo">
              <span class="campo__label">Fornecedor</span>
              <select class="campo__input" id="compra-fornecedor">
                <option value="">Sem fornecedor</option>
              </select>
            </label>

            <div class="campo" style="align-self:end">
              <button class="btn btn--ghost" type="button" data-acao="novo-fornecedor" ${podeCriar() ? '' : 'disabled'}>
                <i data-lucide="plus"></i><span>Novo fornecedor</span>
              </button>
            </div>

            <label class="campo">
              <span class="campo__label">Documento</span>
              <select class="campo__input" id="compra-documento">
                ${Object.entries(TIPOS_DOCUMENTO)
                  .map(([valor, rotulo]) => `<option value="${valor}">${esc(rotulo)}</option>`)
                  .join('')}
              </select>
            </label>

            <label class="campo">
              <span class="campo__label">Número da nota</span>
              <input class="campo__input" id="compra-nota" type="text" placeholder="Número da nota fiscal" autocomplete="off" />
              <p class="campo__ajuda" id="compra-nota-ajuda">Obrigatório quando a compra for com nota fiscal.</p>
            </label>

            <label class="campo">
              <span class="campo__label">Frete (R$)</span>
              <input class="campo__input" id="compra-frete" type="text" inputmode="decimal" placeholder="0,00" />
            </label>

            <label class="campo">
              <span class="campo__label">Desconto da compra (R$)</span>
              <input class="campo__input" id="compra-desconto" type="text" inputmode="decimal" placeholder="0,00" />
            </label>

            <label class="campo campo--full">
              <span class="campo__label">Observações</span>
              <input class="campo__input" id="compra-observacoes" type="text" placeholder="Entrega, condição de pagamento, conferência..." autocomplete="off" />
            </label>
          </div>

          <div class="compras-item-form" id="item-form">
            <label class="campo campo--produto">
              <span class="campo__label">Produto / insumo</span>
              <select class="campo__input" id="item-produto">
                <option value="">Selecione o produto...</option>
              </select>
            </label>

            <label class="campo">
              <span class="campo__label">Unidade de compra</span>
              <input class="campo__input" id="item-unidade" type="text" value="UN" maxlength="12" />
            </label>

            <label class="campo">
              <span class="campo__label">Fator (qtd. estoque)</span>
              <input class="campo__input" id="item-fator" type="text" inputmode="decimal" value="1" />
            </label>

            <label class="campo">
              <span class="campo__label">Quantidade</span>
              <input class="campo__input" id="item-qtd" type="text" inputmode="decimal" placeholder="0" />
            </label>

            <label class="campo">
              <span class="campo__label">Custo unitário (R$)</span>
              <input class="campo__input" id="item-custo" type="text" inputmode="decimal" placeholder="0,00" />
            </label>

            <label class="campo">
              <span class="campo__label">Desconto do item (R$)</span>
              <input class="campo__input" id="item-desconto" type="text" inputmode="decimal" placeholder="0,00" />
            </label>

            <label class="campo">
              <span class="campo__label">Lote</span>
              <input class="campo__input" id="item-lote" type="text" placeholder="Opcional" autocomplete="off" />
            </label>

            <label class="campo">
              <span class="campo__label">Validade</span>
              <input class="campo__input" id="item-validade" type="date" />
            </label>

            <button class="btn btn--primary" type="button" id="item-adicionar">
              <i data-lucide="plus"></i><span id="item-adicionar-texto">Adicionar item</span>
            </button>

            <button class="btn btn--ghost" type="button" id="item-cancelar" hidden>
              <i data-lucide="rotate-ccw"></i><span>Cancelar edição</span>
            </button>

            <p class="compras-dica" id="item-dica">Escolha o produto para ver a conversão entre unidade de compra e unidade de estoque.</p>
          </div>

          <div id="itens-novos"></div>

          <div class="compras-resumo" id="novo-resumo">
            <span>Subtotal <strong>${formatBRL(0)}</strong></span>
            <span>Desconto itens <strong>${formatBRL(0)}</strong></span>
            <span>Frete <strong>${formatBRL(0)}</strong></span>
            <span>Desconto compra <strong>${formatBRL(0)}</strong></span>
            <span class="compras-total">Total <strong>${formatBRL(0)}</strong></span>
          </div>

          <div class="compras-acoes">
            <button class="btn btn--ghost" type="button" id="compra-limpar">
              <i data-lucide="rotate-ccw"></i><span>Limpar</span>
            </button>
            <button class="btn" type="button" id="compra-salvar-rascunho" ${podeCriar() ? '' : 'disabled'}>
              <i data-lucide="save"></i><span>Salvar rascunho</span>
            </button>
            <button class="btn btn--primary" type="button" id="compra-salvar" ${podeCriar() ? '' : 'disabled'}>
              <i data-lucide="check"></i><span>Salvar e aguardar recebimento</span>
            </button>
          </div>

          <p class="compras-ajuda">
            A unidade de compra é como o fornecedor vende (caixa, fardo, kg). O fator converte para a unidade do estoque:
            <strong>quantidade × fator</strong>. Ex.: 3 caixas com fator 12 entram como 36 un.
            Perdas, ajustes de saldo e contagens continuam em <a href="#/estoque">Estoque</a>.
          </p>
        </div>
      </section>

      <!-- ============================== HISTÓRICO ============================== -->
      <section class="compras-painel" data-painel="compra" role="tabpanel">
        <div class="card">
          ${cardHead({
            titulo: '',
            descricao: 'Consulte as compras registradas, acompanhe o recebimento e veja o histórico.',
            acoes: `
              <button class="btn btn--ghost" type="button" id="compras-exportar">
                <i data-lucide="clipboard-list"></i><span>Exportar CSV</span>
              </button>
              ${podeCriar()
                ? botaoPrimario({ label: 'Nova compra', icon: 'plus', acao: 'nova-compra' })
                : ''}
            `,
          })}

          <div class="toolbar" style="margin-bottom:12px">
            <label class="campo" style="min-width:190px">
              <span class="campo__label">Status</span>
              <select class="campo__input" id="filtro-status">
                <option value="">Todos</option>
                ${Object.entries(STATUS_COMPRA)
                  .map(([valor, info]) => `<option value="${valor}">${esc(info.rotulo)}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="campo">
              <span class="campo__label">De</span>
              <input class="campo__input" id="filtro-de" type="date" />
            </label>
            <label class="campo">
              <span class="campo__label">Até</span>
              <input class="campo__input" id="filtro-ate" type="date" />
            </label>
            <label class="search search--inline" for="filtro-busca">
              <i data-lucide="search"></i>
              <input id="filtro-busca" type="search" placeholder="Número, fornecedor ou nota" autocomplete="off" />
            </label>
          </div>

          <p class="table__count" id="compras-contagem"></p>
          <div id="tabela-historico-container"></div>
        </div>
      </section>

      <!-- ============================= FORNECEDORES ============================= -->
      <section class="compras-painel" data-painel="fornecedores" role="tabpanel" hidden>
        <div class="card">
          ${cardHead({
            titulo: 'Fornecedores',
            descricao: 'Quem entrega a mercadoria. Desativar não apaga o histórico de compras.',
            acoes: podeCriar()
              ? botaoPrimario({ label: 'Novo fornecedor', icon: 'plus', acao: 'novo-fornecedor' })
              : '',
          })}
          <p class="table__count" id="fornecedores-contagem"></p>
          <div id="tabela-fornecedores-container"></div>
        </div>
      </section>
    `,

    mount(root) {
      compras = []
      fornecedores = []
      produtos = []
      itensNovos = []
      editandoKey = null

      const el = (seletor) => root.querySelector(seletor)

      function atualizarAjudaNumeroNota() {
        const semNota = el('#compra-documento').value === 'sem_nota'
        el('#compra-nota').placeholder = semNota ? 'Opcional para compra sem nota' : 'Informe o número da nota fiscal'
        el('#compra-nota-ajuda').textContent = semNota
          ? 'Deixe em branco somente quando a compra for sem nota fiscal.'
          : 'Obrigatório para compras com nota fiscal.'
      }

      el('#compra-documento').addEventListener('change', atualizarAjudaNumeroNota)
      atualizarAjudaNumeroNota()

      /* ------------------------------------------------------------- abas -- */
      function mostrarAba(nome) {
        const abaAtiva = nome === 'nova' ? 'compra' : nome
        root.querySelectorAll('.compras-tab').forEach((botao) => {
          const ativo = botao.dataset.tab === abaAtiva
          botao.classList.toggle('is-active', ativo)
          botao.setAttribute('aria-selected', String(ativo))
        })

        root.querySelectorAll('.compras-painel').forEach((painel) => {
          painel.hidden = painel.dataset.painel !== nome
        })
      }

      root.querySelectorAll('.compras-tab').forEach((botao) => {
        botao.addEventListener('click', () => mostrarAba(botao.dataset.tab))
      })
      el('[data-acao="voltar-compras"]').addEventListener('click', () => mostrarAba('compra'))

      /* --------------------------------------------------------- selects -- */
      function atualizarSelectFornecedores() {
        const select = el('#compra-fornecedor')
        if (!select) return
        const atual = select.value

        select.innerHTML = `
          <option value="">Sem fornecedor</option>
          ${fornecedores
            .filter((f) => f.ativo)
            .map((f) => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`)
            .join('')}
        `

        if ([...select.options].some((o) => o.value === atual)) select.value = atual
      }

      function atualizarSelectProdutos() {
        const select = el('#item-produto')
        if (!select) return
        const atual = select.value
        const disponiveis = produtos.filter((p) => p.ativo && p.controlaEstoque)

        select.innerHTML = `
          <option value="">Selecione o produto...</option>
          ${disponiveis
            .map(
              (p) =>
                `<option value="${esc(chaveProduto(p))}">${esc(p.id ? `${p.id} — ` : '')}${esc(p.nome)} (${esc(p.unidade)})</option>`,
            )
            .join('')}
        `

        if ([...select.options].some((o) => o.value === atual)) select.value = atual

        if (!disponiveis.length) {
          select.innerHTML = '<option value="">Nenhum produto com controle de estoque</option>'
          select.disabled = true
          el('#item-adicionar').disabled = true
        } else {
          select.disabled = false
          el('#item-adicionar').disabled = false
        }
      }

      /* ------------------------------------------------------ indicadores -- */
      function renderIndicadores() {
        const resumo = resumoCompras(compras)

        atualizarKpi(root, 'comprasPendentes', { valor: String(resumo.pendentes.length) })
        atualizarKpi(root, 'comprasValorPendente', { valor: formatBRL(resumo.valorPendente) })
        atualizarKpi(root, 'comprasMes', { valor: formatBRL(resumo.totalMes) })
        atualizarKpi(root, 'comprasValidade', { valor: String(resumo.validadeProxima.length) })

        const criticos = produtos.filter(
          (p) => p.ativo && p.controlaEstoque && Number(p.minimo) > 0 && Number(p.quantidade) < Number(p.minimo),
        )

        const partes = []

        if (resumo.pendentes.length) {
          partes.push(
            `<p><strong>${resumo.pendentes.length} compra(s)</strong> ainda aguardando recebimento — valor pendente de ${formatBRL(resumo.valorPendente)}.</p>`,
          )
        }

        if (resumo.validadeProxima.length) {
          const exemplos = resumo.validadeProxima.slice(0, 4).map((item) => {
            const vencido = item.validade < hoje()
            return `<strong>${esc(item.nome)}</strong> — ${vencido ? 'venceu em' : 'vence em'} ${dataBR(item.validade)} (${esc(item.compra.numero)})`
          })
          partes.push(`<p>Validade próxima: ${exemplos.join(' · ')}${resumo.validadeProxima.length > 4 ? ' · ...' : ''}.</p>`)
        }

        if (criticos.length) {
          const nomes = criticos
            .slice(0, 4)
            .map((p) => `<strong>${esc(p.nome)}</strong> (${qtd(p.quantidade)} ${esc(p.unidade)})`)
            .join(' · ')
          partes.push(`<p>Estoque abaixo do mínimo: ${nomes}${criticos.length > 4 ? ' · ...' : ''}. <a href="#/estoque">Abrir estoque</a></p>`)
        }

        const container = el('#compras-alertas')
        container.innerHTML = partes.length
          ? `<div class="alert" role="status"><i data-lucide="alert-triangle"></i><div><strong>Atenção</strong>${partes.join('')}</div></div>`
          : ''

        if (container.innerHTML) renderIcons(container)
      }

      /* ---------------------------------------------------- itens novos -- */
      const colunasItensNovos = [
        {
          key: 'nome',
          label: 'Produto',
          render: (item) =>
            `<span class="cell-main">${esc(item.nome)}</span><span class="cell-sub">${esc(item.unidadeCompra)} · compra</span>`,
        },
        {
          key: 'quantidadeSolicitada',
          label: 'Quantidade',
          align: 'right',
          render: (item) => `${qtd(item.quantidadeSolicitada)} ${esc(item.unidadeCompra)}`,
        },
        {
          key: 'conversao',
          label: 'Conversão',
          align: 'right',
          render: (item) => `× ${qtd(item.fatorConversao)} ${esc(unidadeEstoque(item.produtoId))}`,
        },
        {
          key: 'estoque',
          label: 'Entra no estoque',
          align: 'right',
          render: (item) =>
            `<strong>${qtd(item.quantidadeSolicitada * item.fatorConversao)} ${esc(unidadeEstoque(item.produtoId))}</strong>`,
        },
        {
          key: 'custoUnitario',
          label: 'Custo unit.',
          align: 'right',
          render: (item) => formatBRL(item.custoUnitario),
        },
        {
          key: 'total',
          label: 'Total',
          align: 'right',
          render: (item) =>
            `<strong>${formatBRL(Math.max(0, item.quantidadeSolicitada * item.custoUnitario - item.descontoValor))}</strong>`,
        },
        {
          key: 'lote',
          label: 'Lote / validade',
          render: (item) =>
            `${item.lote ? esc(item.lote) : '<span class="muted">—</span>'}${
              item.validade ? `<span class="cell-sub">${dataBR(item.validade)}</span>` : ''
            }`,
        },
        {
          key: 'acoes',
          label: 'Ações',
          align: 'right',
          render: (item) => `
            <button class="btn btn--ghost btn--sm" type="button" data-item-acao="editar" data-key="${esc(item._key)}" aria-label="Editar ${esc(item.nome)}"><i data-lucide="pencil"></i></button>
            <button class="btn btn--ghost btn--sm" type="button" data-item-acao="remover" data-key="${esc(item._key)}" aria-label="Remover ${esc(item.nome)}"><i data-lucide="trash-2"></i></button>
          `,
        },
      ]

      function renderItensNovos() {
        const container = el('#itens-novos')
        container.innerHTML = tabela({ colunas: colunasItensNovos, linhas: itensNovos, id: 'tabela-itens-novos' })
        renderIcons(container)

        container.querySelectorAll('[data-item-acao]').forEach((botao) => {
          botao.addEventListener('click', () => {
            const key = botao.dataset.key
            if (botao.dataset.itemAcao === 'remover') {
              itensNovos = itensNovos.filter((item) => item._key !== key)
              if (editandoKey === key) resetarEdicao()
              renderItensNovos()
              return
            }
            editarItem(key)
          })
        })

        atualizarTotais()
      }

      function atualizarTotais() {
        const subtotal = somaItens(itensNovos)
        const descontoItens = descontosItens(itensNovos)
        const frete = paraNumero(el('#compra-frete')?.value) || 0
        const desconto = paraNumero(el('#compra-desconto')?.value) || 0
        const total = Math.max(0, subtotal - desconto + frete)

        el('#novo-resumo').innerHTML = `
          <span>Subtotal <strong>${formatBRL(subtotal)}</strong></span>
          <span>Desconto itens <strong>${formatBRL(descontoItens)}</strong></span>
          <span>Frete <strong>${formatBRL(frete)}</strong></span>
          <span>Desconto compra <strong>${formatBRL(desconto)}</strong></span>
          <span class="compras-total">Total <strong>${formatBRL(total)}</strong></span>
        `
      }

      function atualizarDica() {
        const produto = produtoPorId(el('#item-produto').value)
        const unidade = el('#item-unidade').value.trim().toUpperCase() || 'UN'
        const fator = paraNumero(el('#item-fator').value) || 0
        const quantidade = paraNumero(el('#item-qtd').value) || 0
        const dica = el('#item-dica')

        if (!produto) {
          dica.textContent =
            'Escolha o produto para ver a conversão entre unidade de compra e unidade de estoque.'
          return
        }

        const entrada = quantidade * fator
        const unidadeFinal = produto.unidade || unidade

        dica.innerHTML = `${esc(produto.nome)}: 1 ${esc(unidade)} = <strong>${qtd(fator)} ${esc(unidadeFinal)}</strong>${
          entrada > 0 ? ` · este item entra com <strong>${qtd(entrada)} ${esc(unidadeFinal)}</strong>` : ''
        }.`
      }

      function resetarEdicao() {
        editandoKey = null
        el('#item-adicionar-texto').textContent = 'Adicionar item'
        el('#item-cancelar').hidden = true
      }

      function limparItemFormulario() {
        el('#item-produto').value = ''
        el('#item-unidade').value = 'UN'
        el('#item-fator').value = '1'
        el('#item-qtd').value = ''
        el('#item-custo').value = ''
        el('#item-desconto').value = ''
        el('#item-lote').value = ''
        el('#item-validade').value = ''
        resetarEdicao()
        atualizarDica()
      }

      function editarItem(key) {
        const item = itensNovos.find((i) => i._key === key)
        if (!item) return

        const select = el('#item-produto')
        if (![...select.options].some((o) => o.value === item.produtoId)) {
          const opcao = document.createElement('option')
          opcao.value = item.produtoId
          opcao.textContent = item.nome
          select.appendChild(opcao)
        }

        select.value = item.produtoId
        el('#item-unidade').value = item.unidadeCompra.toUpperCase()
        el('#item-fator').value = String(item.fatorConversao).replace('.', ',')
        el('#item-qtd').value = String(item.quantidadeSolicitada).replace('.', ',')
        el('#item-custo').value = String(item.custoUnitario).replace('.', ',')
        el('#item-desconto').value = item.descontoValor
          ? String(item.descontoValor).replace('.', ',')
          : ''
        el('#item-lote').value = item.lote ?? ''
        el('#item-validade').value = item.validade ?? ''

        editandoKey = key
        el('#item-adicionar-texto').textContent = 'Atualizar item'
        el('#item-cancelar').hidden = false
        atualizarDica()
        el('#item-qtd').focus()
      }

      function lerItemFormulario() {
        const produtoId = el('#item-produto').value
        const produto = produtoPorId(produtoId)

        if (!produto) throw new Error('Escolha o produto do item.')

        const unidadeCompra = (el('#item-unidade').value.trim() || produto.unidade || 'UN').toUpperCase()
        const fator = paraNumero(el('#item-fator').value)
        const quantidade = paraNumero(el('#item-qtd').value)
        const custo = paraNumero(el('#item-custo').value)
        const desconto = paraNumero(el('#item-desconto').value) || 0

        if (!Number.isFinite(quantidade) || quantidade <= 0) {
          throw new Error('Informe uma quantidade maior que zero.')
        }
        if (!Number.isFinite(fator) || fator <= 0) {
          throw new Error('O fator de conversão precisa ser maior que zero.')
        }
        if (!Number.isFinite(custo) || custo < 0) {
          throw new Error('Informe um custo válido (zero ou maior).')
        }
        if (desconto < 0) throw new Error('O desconto não pode ser negativo.')
        if (desconto > quantidade * custo + 0.001) {
          throw new Error('O desconto do item não pode ser maior que o valor do item.')
        }

        return {
          _key: editandoKey ?? idChave(),
          produtoId,
          nome: produto.nome,
          unidadeCompra,
          fatorConversao: fator,
          quantidadeSolicitada: quantidade,
          custoUnitario: custo,
          descontoValor: desconto,
          lote: el('#item-lote').value.trim(),
          validade: el('#item-validade').value,
        }
      }

      function adicionarItem() {
        try {
          const item = lerItemFormulario()

          if (editandoKey) {
            itensNovos = itensNovos.map((existente) =>
              existente._key === editandoKey ? { ...item, _key: editandoKey } : existente,
            )
          } else {
            itensNovos.push(item)
          }

          limparItemFormulario()
          renderItensNovos()
        } catch (erro) {
          toast(mensagemErro(erro))
        }
      }

      el('#item-adicionar').addEventListener('click', adicionarItem)
      el('#item-cancelar').addEventListener('click', () => {
        limparItemFormulario()
      })

      el('#item-produto').addEventListener('change', () => {
        const produto = produtoPorId(el('#item-produto').value)
        if (produto) {
          el('#item-unidade').value = (produto.unidade || 'UN').toUpperCase()
          el('#item-fator').value = '1'
          el('#item-custo').value = produto.custo ? String(produto.custo).replace('.', ',') : ''
        }
        atualizarDica()
      })

      el('#item-unidade').addEventListener('input', () => {
        const campo = el('#item-unidade')
        const posicao = campo.selectionStart
        campo.value = campo.value.toUpperCase()
        campo.setSelectionRange(posicao, posicao)
      })

      ;['#item-unidade', '#item-fator', '#item-qtd'].forEach((seletor) => {
        el(seletor).addEventListener('input', atualizarDica)
      })

      ;['#compra-frete', '#compra-desconto'].forEach((seletor) => {
        el(seletor).addEventListener('input', atualizarTotais)
      })

      /* ---------------------------------------------------- salvar compra -- */
      function limparCompra() {
        el('#compra-data').value = hoje()
        el('#compra-fornecedor').value = ''
        el('#compra-documento').value = 'sem_nota'
        el('#compra-nota').value = ''
        el('#compra-observacoes').value = ''
        el('#compra-frete').value = ''
        el('#compra-desconto').value = ''
        el('#nova-situacao').textContent = 'Rascunho'
        itensNovos = []
        limparItemFormulario()
        renderItensNovos()
      }

      async function salvarCompra(aguardarRecebimento) {
        if (!podeCriar()) {
          toast('Sua conta não tem permissão para registrar compras.')
          return
        }
        if (!itensNovos.length) {
          toast('Inclua pelo menos um item na compra.')
          return
        }

        const botao = aguardarRecebimento ? el('#compra-salvar') : el('#compra-salvar-rascunho')
        const rotuloOriginal = botao.innerHTML
        botao.disabled = true
        botao.innerHTML = '<span>Salvando...</span>'

        try {
          const { dados, origem } = await registrarCompra({
            dataCompra: el('#compra-data').value,
            fornecedorId: el('#compra-fornecedor').value || null,
            fornecedorNome: el('#compra-fornecedor').selectedOptions[0]?.textContent ?? '',
            tipoDocumento: el('#compra-documento').value,
            numeroNota: el('#compra-nota').value,
            observacoes: el('#compra-observacoes').value,
            freteValor: paraNumero(el('#compra-frete').value) || 0,
            descontoValor: paraNumero(el('#compra-desconto').value) || 0,
            itens: itensNovos,
            aguardarRecebimento,
          })

          toast(
            origem === 'exemplo'
              ? 'Modo demonstração: compra registrada apenas na tela.'
              : `Compra ${dados?.numero ?? ''} ${aguardarRecebimento ? 'aguardando recebimento' : 'salva como rascunho'}.`,
          )

          limparCompra()
          await carregarDados()

          if (origem === 'exemplo' && dados) {
            compras = [dados, ...compras]
            renderIndicadores()
            renderHistorico()
          }

          mostrarAba('compra')
        } catch (erro) {
          console.error('[compras] Falha ao salvar compra.', erro)
          toast(mensagemErro(erro))
        } finally {
          botao.disabled = false
          botao.innerHTML = rotuloOriginal
          renderIcons(botao)
        }
      }

      el('#compra-salvar').addEventListener('click', () => salvarCompra(true))
      el('#compra-salvar-rascunho').addEventListener('click', () => salvarCompra(false))
      el('#compra-limpar').addEventListener('click', limparCompra)
      el('[data-acao="nova-compra"]').addEventListener('click', () => {
        if (!podeCriar()) {
          toast('Sua conta não tem permissão para registrar compras.')
          return
        }
        limparCompra()
        mostrarAba('nova')
      })

      /* --------------------------------------------------- lista/histórico -- */
      const colunasHistorico = () => [
        {
          key: 'numero',
          label: 'Compra',
          render: (compra) =>
            `<span class="cell-main">${esc(compra.numero)}</span><span class="cell-sub">${dataBR(compra.dataCompra)}</span>`,
        },
        {
          key: 'fornecedor',
          label: 'Fornecedor',
          render: (compra) =>
            `<span class="cell-main">${esc(compra.fornecedorNome)}</span><span class="cell-sub">${esc(rotuloDocumento(compra))}</span>`,
        },
        {
          key: 'itens',
          label: 'Itens',
          align: 'right',
          render: (compra) => {
            const recebidos = compra.itens.filter((item) => item.quantidadeRecebida > 0.0005).length
            return `<strong>${compra.totalItens}</strong><span class="cell-sub">${recebidos} de ${compra.totalItens} recebido(s)</span>`
          },
        },
        {
          key: 'total',
          label: 'Total',
          align: 'right',
          render: (compra) => `<strong>${formatBRL(compra.total)}</strong>`,
        },
        {
          key: 'status',
          label: 'Status',
          render: (compra) => badge(rotuloStatus(compra.status), tomStatus(compra.status)),
        },
        {
          key: 'recebimento',
          label: 'Recebimento',
          render: (compra) => (compra.dataRecebimento ? dataBR(compra.dataRecebimento) : '<span class="muted">—</span>'),
        },
        {
          key: 'acoes',
          label: 'Ações',
          align: 'right',
          render: (compra) => {
            const receber =
              podeEditar() && STATUS_ABERTOS.includes(compra.status)
                ? `<button class="btn btn--ghost btn--sm" type="button" data-compra-acao="receber" data-id="${esc(compra.id)}" title="Receber mercadoria"><i data-lucide="check-circle-2"></i></button>`
                : ''
            return `
              <button class="btn btn--ghost btn--sm" type="button" data-compra-acao="detalhes" data-id="${esc(compra.id)}" title="Detalhes"><i data-lucide="eye"></i></button>
              ${receber}
            `
          },
        },
      ]

      function comprasFiltradas() {
        const status = el('#filtro-status').value
        const de = el('#filtro-de').value
        const ate = el('#filtro-ate').value
        const termo = el('#filtro-busca').value.trim().toLowerCase()

        return compras.filter((compra) => {
          if (status && compra.status !== status) return false
          if (de && compra.dataCompra < de) return false
          if (ate && compra.dataCompra > ate) return false
          if (termo) {
            const alvo = [compra.numero, compra.fornecedorNome, compra.numeroNota, compra.observacoes]
              .join(' ')
              .toLowerCase()
            if (!alvo.includes(termo)) return false
          }
          return true
        })
      }

      function renderHistorico() {
        const container = el('#tabela-historico-container')
        const lista = comprasFiltradas()

        container.innerHTML = tabela({
          colunas: colunasHistorico(),
          linhas: lista,
          id: 'tabela-historico',
        })
        renderIcons(container)

        el('#compras-contagem').textContent = `${lista.length} de ${compras.length} compra(s)`

        container.querySelectorAll('[data-compra-acao]').forEach((botao) => {
          botao.addEventListener('click', () => {
            const compra = compras.find((c) => c.id === botao.dataset.id)
            if (!compra) return
            if (botao.dataset.compraAcao === 'receber') abrirRecebimento(compra)
            else abrirDetalhes(compra)
          })
        })
      }

      ;['#filtro-status', '#filtro-de', '#filtro-ate'].forEach((seletor) => {
        el(seletor).addEventListener('change', renderHistorico)
      })
      el('#filtro-busca').addEventListener('input', renderHistorico)

      el('#compras-exportar').addEventListener('click', () => {
        const lista = comprasFiltradas()
        if (!lista.length) {
          toast('Nada para exportar com os filtros atuais.')
          return
        }
        baixarCsv(`compras-${hoje()}.csv`, gerarCsvCompras(lista))
      })

      /* --------------------------------------------------------- modal -- */
      const modaisAbertos = new Set()

      function abrirModal({ titulo, descricao = '', corpo, acoes = [] }) {
        const overlay = document.createElement('div')
        overlay.className = 'modal'

        overlay.innerHTML = `
          <div class="modal__scrim" data-fechar></div>
          <div class="modal__caixa" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
            <header class="modal__head">
              <div>
                <h2 class="modal__titulo">${esc(titulo)}</h2>
                ${descricao ? `<p class="modal__desc">${esc(descricao)}</p>` : ''}
              </div>
              <button class="modal__x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
            </header>
            <div class="modal__corpo">${corpo}</div>
            <footer class="modal__acoes">
              <button class="btn btn--ghost" type="button" data-fechar>Fechar</button>
              ${acoes
                .map(
                  (acao) =>
                    `<button class="btn ${acao.classe ?? ''}" type="button" data-modal-acao="${esc(acao.acao)}">${acao.icone ? `<i data-lucide="${esc(acao.icone)}"></i>` : ''}<span>${esc(acao.label)}</span></button>`,
                )
                .join('')}
            </footer>
          </div>
        `

        document.body.appendChild(overlay)
        document.body.classList.add('sem-scroll')
        modaisAbertos.add(overlay)
        renderIcons(overlay)

        const fechar = () => {
          overlay.remove()
          modaisAbertos.delete(overlay)
          if (!document.querySelector('.modal')) document.body.classList.remove('sem-scroll')
          document.removeEventListener('keydown', aoTeclar)
        }

        const aoTeclar = (evento) => {
          if (evento.key === 'Escape') fechar()
        }

        overlay.querySelectorAll('[data-fechar]').forEach((botao) => botao.addEventListener('click', fechar))
        document.addEventListener('keydown', aoTeclar)

        return { overlay, fechar }
      }

      function abrirDetalhes(compra) {
        const info = [
          ['Fornecedor', compra.fornecedorNome],
          ['Documento', rotuloDocumento(compra)],
          ['Data da compra', dataBR(compra.dataCompra)],
          ['Recebimento', compra.dataRecebimento ? dataBR(compra.dataRecebimento) : 'Ainda não recebida'],
          ['Responsável', compra.usuarioNome || '—'],
          ['Observações', compra.observacoes || '—'],
        ]

        const colunas = [
          {
            key: 'nome',
            label: 'Produto',
            render: (item) =>
              `<span class="cell-main">${esc(item.nome)}</span><span class="cell-sub">${esc(item.unidadeCompra)} · fator ${qtd(item.fatorConversao)}</span>`,
          },
          { key: 'pedido', label: 'Pedido', align: 'right', render: (item) => `${qtd(item.quantidadeSolicitada)} ${esc(item.unidadeCompra)}` },
          {
            key: 'recebido',
            label: 'Recebido',
            align: 'right',
            render: (item) =>
              `<strong>${qtd(item.quantidadeRecebida)} ${esc(item.unidadeCompra)}</strong><span class="cell-sub">${qtd(item.quantidadeRecebida * item.fatorConversao)} ${esc(unidadeEstoque(item.produtoId))}</span>`,
          },
          { key: 'custo', label: 'Custo', align: 'right', render: (item) => formatBRL(item.custoUnitario) },
          { key: 'total', label: 'Total', align: 'right', render: (item) => formatBRL(item.total) },
          {
            key: 'lote',
            label: 'Lote / validade',
            render: (item) =>
              `${item.lote ? esc(item.lote) : '<span class="muted">—</span>'}${
                item.validade ? `<span class="cell-sub">${dataBR(item.validade)}</span>` : ''
              }`,
          },
        ]

        const acoes = []
        const aberta = STATUS_ABERTOS.includes(compra.status)

        if (podeEditar() && aberta) {
          acoes.push({ acao: 'receber', label: 'Receber mercadoria', icone: 'check-circle-2', classe: 'btn--primary' })
          acoes.push({ acao: 'cancelar', label: 'Cancelar compra', icone: 'x' })
        }
        if (podeEditar() && compra.status === 'rascunho') {
          acoes.push({ acao: 'aguardar', label: 'Aguardar recebimento', icone: 'clock' })
        }
        if (podeExcluir() && compra.status === 'rascunho') {
          acoes.push({ acao: 'excluir', label: 'Excluir rascunho', icone: 'trash-2', classe: 'btn--danger' })
        }
        acoes.push({ acao: 'csv', label: 'Exportar CSV', icone: 'clipboard-list' })

        const corpo = `
          <dl class="compras-detalhe-grid">
            ${info
              .map(
                ([rotulo, valor]) =>
                  `<div><dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd></div>`,
              )
              .join('')}
          </dl>

          <div style="margin-bottom:8px">${badge(rotuloStatus(compra.status), tomStatus(compra.status))}</div>

          ${tabela({ colunas, linhas: compra.itens })}

          <div class="compras-resumo">
            <span>Subtotal <strong>${formatBRL(compra.subtotal)}</strong></span>
            <span>Desconto itens <strong>${formatBRL(compra.descontoItens)}</strong></span>
            <span>Desconto compra <strong>${formatBRL(compra.descontoValor)}</strong></span>
            <span>Frete <strong>${formatBRL(compra.freteValor)}</strong></span>
            <span class="compras-total">Total <strong>${formatBRL(compra.total)}</strong></span>
          </div>
        `

        const { overlay, fechar } = abrirModal({
          titulo: `Compra ${compra.numero}`,
          descricao: 'Detalhes, itens e histórico do recebimento.',
          corpo,
          acoes,
        })

        overlay.querySelector('[data-modal-acao="receber"]')?.addEventListener('click', () => {
          fechar()
          abrirRecebimento(compra)
        })

        overlay.querySelector('[data-modal-acao="aguardar"]')?.addEventListener('click', async () => {
          try {
            await marcarAguardandoRecebimento(compra.id)
            toast('Compra marcada como aguardando recebimento.')
            fechar()
            await carregarDados()
          } catch (erro) {
            toast(mensagemErro(erro))
          }
        })

        overlay.querySelector('[data-modal-acao="cancelar"]')?.addEventListener('click', async () => {
          const ok = await confirmar({
            titulo: 'Cancelar compra?',
            descricao: 'A compra continua no histórico como cancelada. Nenhum item será recebido.',
            textoBotao: 'Cancelar compra',
          })
          if (!ok) return

          try {
            await cancelarCompra(compra.id)
            toast('Compra cancelada.')
            fechar()
            await carregarDados()
          } catch (erro) {
            toast(mensagemErro(erro))
          }
        })

        overlay.querySelector('[data-modal-acao="excluir"]')?.addEventListener('click', async () => {
          const ok = await confirmar({
            titulo: 'Excluir rascunho?',
            descricao: 'O rascunho e seus itens serão apagados. Compras recebidas não podem ser excluídas.',
            textoBotao: 'Excluir',
          })
          if (!ok) return

          try {
            await excluirCompra(compra.id)
            toast('Rascunho excluído.')
            fechar()
            await carregarDados()
          } catch (erro) {
            toast(mensagemErro(erro))
          }
        })

        overlay.querySelector('[data-modal-acao="csv"]')?.addEventListener('click', () => {
          baixarCsv(`compra-${compra.numero}.csv`, gerarCsvCompras([compra]))
        })
      }

      function abrirRecebimento(compra) {
        if (!podeEditar()) {
          toast('Sua conta não tem permissão para confirmar recebimento.')
          return
        }

        const pendentes = compra.itens.filter((item) => item.pendente > 0.0005)

        if (!pendentes.length) {
          toast('Todos os itens desta compra já foram recebidos.')
          return
        }

        const linhas = pendentes
          .map(
            (item) => `
              <tr>
                <td>
                  <span class="cell-main">${esc(item.nome)}</span>
                  <span class="cell-sub">1 ${esc(item.unidadeCompra)} = ${qtd(item.fatorConversao)} ${esc(unidadeEstoque(item.produtoId))}</span>
                </td>
                <td class="ta-right">
                  <strong>${qtd(item.pendente)} ${esc(item.unidadeCompra)}</strong>
                  <span class="cell-sub">${qtd(item.pendente * item.fatorConversao)} ${esc(unidadeEstoque(item.produtoId))}</span>
                </td>
                <td>
                  <input class="campo__input" type="text" inputmode="decimal"
                    data-receber-qtd="${esc(item.id)}"
                    value="${String(item.pendente).replace('.', ',')}" />
                </td>
                <td>
                  <input class="campo__input" type="text" placeholder="Lote"
                    data-receber-lote="${esc(item.id)}"
                    value="${esc(item.lote ?? '')}" autocomplete="off" />
                </td>
                <td>
                  <input class="campo__input" type="date"
                    data-receber-validade="${esc(item.id)}"
                    value="${esc(item.validade ?? '')}" />
                </td>
              </tr>
            `,
          )
          .join('')

        const corpo = `
          <p class="compras-ajuda" style="margin-bottom:10px">
            Informe a quantidade efetivamente recebida, na <strong>unidade de compra</strong>. O estoque será atualizado pela conversão.
            Recebimento parcial mantém a compra aberta para o restante.
          </p>

          <div class="compras-receber">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" class="ta-right">Pendente</th>
                  <th scope="col">Receber</th>
                  <th scope="col">Lote</th>
                  <th scope="col">Validade</th>
                </tr>
              </thead>
              <tbody>${linhas}</tbody>
            </table>
          </div>

          <p class="compras-erro" id="erro-recebimento" hidden></p>
        `

        const { overlay, fechar } = abrirModal({
          titulo: `Receber compra ${compra.numero}`,
          descricao: `${compra.fornecedorNome} · ${rotuloDocumento(compra)}`,
          corpo,
          acoes: [
            { acao: 'confirmar', label: 'Confirmar recebimento', icone: 'check-circle-2', classe: 'btn--primary' },
          ],
        })

        const botao = overlay.querySelector('[data-modal-acao="confirmar"]')
        const erroEl = overlay.querySelector('#erro-recebimento')

        botao.addEventListener('click', async () => {
          erroEl.hidden = true
          const itens = []

          for (const item of pendentes) {
            const campoQtd = overlay.querySelector(`[data-receber-qtd="${item.id}"]`)
            const valor = paraNumero(campoQtd.value)
            const quantidade = Number.isFinite(valor) ? valor : 0

            if (quantidade < 0) {
              erroEl.textContent = `A quantidade de "${item.nome}" não pode ser negativa.`
              erroEl.hidden = false
              return
            }
            if (quantidade > item.pendente + 0.0005) {
              erroEl.textContent = `A quantidade de "${item.nome}" passa do pendente (${qtd(item.pendente)} ${item.unidadeCompra}).`
              erroEl.hidden = false
              return
            }
            if (quantidade <= 0) continue

            itens.push({
              itemId: item.id,
              quantidade,
              lote: overlay.querySelector(`[data-receber-lote="${item.id}"]`).value.trim(),
              validade: overlay.querySelector(`[data-receber-validade="${item.id}"]`).value,
            })
          }

          if (!itens.length) {
            erroEl.textContent = 'Informe pelo menos uma quantidade recebida.'
            erroEl.hidden = false
            return
          }

          const rotulo = botao.innerHTML
          botao.disabled = true
          botao.innerHTML = '<span>Recebendo...</span>'

          try {
            const { dados, origem } = await receberCompra(compra.id, itens)

            toast(
              origem === 'exemplo'
                ? 'Modo demonstração: recebimento simulado.'
                : dados?.status === 'recebido_confirmado'
                  ? 'Recebimento confirmado. Estoque e custo médio atualizados.'
                  : 'Recebimento parcial registrado. A compra continua aberta.',
            )

            fechar()
            await carregarDados()
          } catch (erro) {
            console.error('[compras] Falha no recebimento.', erro)
            erroEl.textContent = mensagemErro(erro)
            erroEl.hidden = false
          } finally {
            botao.disabled = false
            botao.innerHTML = rotulo
            renderIcons(botao)
          }
        })
      }

      /* ------------------------------------------------------ fornecedores -- */
      const colunasFornecedores = () => [
        {
          key: 'nome',
          label: 'Fornecedor',
          render: (f) =>
            `<span class="cell-main">${esc(f.nome)}</span>${f.observacoes ? `<span class="cell-sub">${esc(f.observacoes)}</span>` : ''}`,
        },
        {
          key: 'cnpj',
          label: 'Documento',
          render: (f) => {
            if (!f.cnpj) return '—'
            const tipo = f.cnpj.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ'
            return `<span class="cell-main">${tipo}: ${esc(f.cnpj)}</span>`
          },
        },
        {
          key: 'contato',
          label: 'Contato',
          render: (f) =>
            `<span class="cell-main">${esc(f.telefone || '—')}</span>${f.whatsapp ? `<span class="cell-sub">WhatsApp: ${esc(f.whatsapp)}</span>` : ''}${f.email ? `<span class="cell-sub">${esc(f.email)}</span>` : ''}`,
        },
        {
          key: 'ativo',
          label: 'Situação',
          render: (f) => badge(f.ativo ? 'Ativo' : 'Inativo', f.ativo ? 'success' : 'neutral'),
        },
        {
          key: 'acoes',
          label: 'Ações',
          align: 'right',
          render: (f) =>
            podeEditar()
              ? `
                <button class="btn btn--ghost btn--sm" type="button" data-fornecedor-acao="editar" data-id="${esc(f.id)}" title="Editar"><i data-lucide="pencil"></i></button>
                <button class="btn btn--ghost btn--sm" type="button" data-fornecedor-acao="alternar" data-id="${esc(f.id)}" title="${f.ativo ? 'Desativar' : 'Ativar'}"><i data-lucide="${f.ativo ? 'user-x' : 'user-check'}"></i></button>
              `
              : '',
        },
      ]

      function renderFornecedores() {
        const container = el('#tabela-fornecedores-container')

        container.innerHTML = tabela({ colunas: colunasFornecedores(), linhas: fornecedores, id: 'tabela-fornecedores' })
        renderIcons(container)
        el('#fornecedores-contagem').textContent = `${fornecedores.length} fornecedor(es)`

        container.querySelectorAll('[data-fornecedor-acao]').forEach((botao) => {
          botao.addEventListener('click', () => {
            const fornecedor = fornecedores.find((f) => f.id === botao.dataset.id)
            if (!fornecedor) return

            if (botao.dataset.fornecedorAcao === 'editar') abrirFornecedor(fornecedor)
            else alternarFornecedor(fornecedor)
          })
        })
      }

      function abrirFornecedor(fornecedor = null) {
        const editando = Boolean(fornecedor)

        abrirFormulario({
          titulo: editando ? 'Editar fornecedor' : 'Novo fornecedor',
          descricao: 'O fornecedor é quem entrega a mercadoria. Não é usuário do sistema.',
          valores: fornecedor
            ? {
                nome: fornecedor.nome,
                cnpj: fornecedor.cnpj,
                telefone: fornecedor.telefone,
                whatsapp: fornecedor.whatsapp,
                email: fornecedor.email,
                observacoes: fornecedor.observacoes,
              }
            : {},
          campos: [
            { nome: 'nome', label: 'Nome / Razão Social', obrigatorio: true, largo: true },
            {
              nome: 'cnpj',
              label: 'CPF ou CNPJ',
              placeholder: 'CPF ou CNPJ',
              ajuda: 'Digite até 11 dígitos para CPF ou 14 para CNPJ.',
              inputmode: 'numeric',
              maxlength: 18,
            },
            {
              nome: 'telefone',
              label: 'Telefone',
              placeholder: '(00) 0000-0000',
              ajuda: 'DDD e 10 dígitos para fixo ou 11 para celular.',
              inputmode: 'numeric',
              maxlength: 15,
            },
            {
              nome: 'whatsapp',
              label: 'WhatsApp',
              placeholder: '(00) 00000-0000',
              ajuda: 'DDD e 10 ou 11 dígitos.',
              inputmode: 'numeric',
              maxlength: 15,
            },
            { nome: 'email', label: 'E-mail', placeholder: 'Opcional' },
            { nome: 'observacoes', label: 'Observações', tipo: 'textarea', largo: true },
          ],
          aoSalvar: async (valores) => {
            const { dados, origem } = editando
              ? await atualizarFornecedor(fornecedor.id, valores)
              : await criarFornecedor(valores)

            const indice = fornecedores.findIndex((f) => f.id === dados.id)
            if (indice >= 0) fornecedores[indice] = dados
            else fornecedores.push(dados)

            fornecedores.sort((a, b) => a.nome.localeCompare(b.nome))
            renderFornecedores()
            atualizarSelectFornecedores()

            const mensagem = origem === 'neon'
              ? editando
                ? 'Fornecedor atualizado no banco.'
                : 'Fornecedor cadastrado no banco.'
              : `${editando ? 'Fornecedor atualizado' : 'Fornecedor cadastrado'} apenas nesta sessão — o Neon não está configurado.`
            return mensagem
          },
        })

        const formulario = document.querySelector('.modal')
        const documento = formulario?.querySelector('[name="cnpj"]')
        const atualizarMascara = (campo, formatar) => {
          campo.addEventListener('input', () => {
            campo.value = formatar(campo.value)
          })
          campo.value = formatar(campo.value)
        }
        const formatarDocumento = (valor) => {
          const digitos = valor.replace(/\D/g, '')
          if (digitos.length > 11) {
            return digitos
              .slice(0, 14)
              .replace(/^(\d{2})(\d)/, '$1.$2')
              .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
              .replace(/\.(\d{3})(\d)/, '.$1/$2')
              .replace(/(\d{4})(\d)/, '$1-$2')
          }

          return digitos
            .slice(0, 11)
            .replace(/^(\d{3})(\d)/, '$1.$2')
            .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
        }
        if (documento) {
          const rotuloDocumento = documento.closest('.campo')?.querySelector('.campo__label')
          documento.addEventListener('input', () => {
            const digitos = documento.value.replace(/\D/g, '')
            if (rotuloDocumento) {
              rotuloDocumento.textContent = digitos.length > 11
                ? 'CNPJ'
                : digitos.length
                  ? 'CPF'
                  : 'CPF ou CNPJ'
            }
          })
          atualizarMascara(documento, formatarDocumento)
          documento.dispatchEvent(new Event('input'))
        }

        const formatarTelefone = (valor) => {
          const digitos = valor.replace(/\D/g, '').slice(0, 11)
          if (!digitos) return ''
          const ddd = digitos.slice(0, 2)
          const local = digitos.slice(2)
          if (digitos.length <= 2) return `(${ddd}`
          const limite = digitos.length > 10 ? 5 : 4
          return `(${ddd}) ${local.slice(0, limite)}${local.length > limite ? `-${local.slice(limite)}` : ''}`
        }
        formulario?.querySelectorAll('[name="telefone"], [name="whatsapp"]')
          .forEach((campo) => atualizarMascara(campo, formatarTelefone))
      }

      async function alternarFornecedor(fornecedor) {
        try {
          await definirFornecedorAtivo(fornecedor.id, !fornecedor.ativo)
          fornecedor.ativo = !fornecedor.ativo
          renderFornecedores()
          atualizarSelectFornecedores()
          renderIndicadores()
          toast(fornecedor.ativo ? 'Fornecedor ativado.' : 'Fornecedor desativado.')
        } catch (erro) {
          toast(mensagemErro(erro))
        }
      }

      root.querySelectorAll('[data-acao="novo-fornecedor"]').forEach((botao) => {
        botao.addEventListener('click', () => {
          if (!podeCriar()) {
            toast('Sua conta não tem permissão para cadastrar fornecedores.')
            return
          }
          abrirFornecedor()
        })
      })

      /* ------------------------------------------------------------ dados -- */
      async function carregarDados() {
        try {
          const [respostaCompras, respostaFornecedores, respostaProdutos] = await Promise.all([
            listarCompras(),
            listarFornecedores(),
            listarProdutos(),
          ])

          compras = respostaCompras.dados ?? []
          fornecedores = respostaFornecedores.dados ?? []
          produtos = respostaProdutos.dados ?? []

          atualizarSelectFornecedores()
          atualizarSelectProdutos()
          renderIndicadores()
          renderHistorico()
          renderFornecedores()
        } catch (erro) {
          console.error('[compras] Falha ao carregar dados.', erro)
          toast(mensagemErro(erro))
        }
      }

      /* ------------------------------------------------------------ início -- */
      if (fornecedoresOnly) {
        el('.page-head').hidden = true
        el('.grid--stats').hidden = true
        el('#compras-alertas').hidden = true
        el('.compras-tabs').hidden = true
        mostrarAba('fornecedores')
      }

      renderItensNovos()
      atualizarDica()
      carregarDados()

      const aoBuscarGlobal = (evento) => {
        const termo = evento.detail ?? ''
        const painelCompra = root.querySelector('[data-painel="compra"]')
        if (!painelCompra || painelCompra.hidden) return
        el('#filtro-busca').value = termo
        renderHistorico()
      }

      window.addEventListener('busca-global', aoBuscarGlobal)

      return () => {
        window.removeEventListener('busca-global', aoBuscarGlobal)
        fecharFormulario()
        modaisAbertos.forEach((overlay) => overlay.remove())
        modaisAbertos.clear()
        if (!document.querySelector('.modal')) document.body.classList.remove('sem-scroll')
      }
    },
  }
}

export function fornecedoresPage() {
  return comprasPage({ fornecedoresOnly: true })
}

/* ============================================================================
 * Download de CSV
 * ========================================================================== */

function baixarCsv(nome, conteudo) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
