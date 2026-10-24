/**
 * Helpers de formatação e pedaços de HTML reutilizados pelas páginas.
 * Mantidos como funções puras que devolvem string, para combinar com o roteador.
 */

import { renderIcons } from './icons.js'

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const dateShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

export const formatBRL = (valor) => brl.format(valor)

export const formatNumero = (valor) => new Intl.NumberFormat('pt-BR').format(valor)

/** Aceita 'AAAA-MM-DD' e devolve 'DD/MM' sem sofrer com fuso horário. */
export const formatData = (iso) => dateShort.format(new Date(`${iso}T00:00:00`))

export const formatPercentual = (valor) => `${decimal.format(Math.abs(valor))}%`

/** Escapa texto que vem de dados antes de entrar no HTML. */
export function esc(valor) {
  return String(valor).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
}

export function badge(texto, tom = 'neutral') {
  return `<span class="badge badge--${tom}">${esc(texto)}</span>`
}

const tonsStatusVenda = {
  Concluída: 'success',
  'Em preparo': 'info',
  Aguardando: 'warning',
  Cancelada: 'danger',
}

/**
 * Selo do status de uma venda.
 *
 * Uma venda ESTORNADA tem status 'Cancelada' no banco — é o status que tira o
 * pedido do faturamento (ver `neon/11_estorno.sql`). Na tela ela aparece como
 * "Estornada" para não se confundir com um pedido que já nasceu cancelado; o
 * que distingue os dois é `estornadaEm`.
 */
export function badgeStatusVenda(venda) {
  const estornada = Boolean(venda.estornadaEm)
  return badge(
    estornada ? 'Estornada' : venda.status,
    estornada ? 'danger' : tonsStatusVenda[venda.status] ?? 'neutral',
  )
}

/** Etiqueta de variação (seta + percentual) usada nos cartões de indicador. */
function deltaHtml(delta) {
  if (typeof delta !== 'number') return ''

  const subiu = delta >= 0
  return `
    <span class="stat__delta stat__delta--${subiu ? 'up' : 'down'}">
      <i data-lucide="${subiu ? 'arrow-up-right' : 'arrow-down-right'}"></i>${formatPercentual(delta)}
    </span>
  `
}

/**
 * Cartão de indicador (KPI) usado no topo das páginas.
 * `kpi` identifica o cartão para que `atualizarKpi` possa reescrevê-lo depois.
 */
export function statCard({ label, valor, delta, icon = 'chart-line', hint, kpi }) {
  return `
    <article class="stat"${kpi ? ` data-kpi="${kpi}"` : ''}>
      <div class="stat__top">
        <span class="stat__icon"><i data-lucide="${icon}"></i></span>
        <span class="stat__delta-slot">${deltaHtml(delta)}</span>
      </div>
      <p class="stat__label">${esc(label)}</p>
      <p class="stat__value">${valor}</p>
      ${hint ? `<p class="stat__hint">${hint}</p>` : ''}
    </article>
  `
}

/**
 * Reescreve um cartão de indicador já renderizado.
 * Usado quando os dados reais chegam do banco depois do primeiro desenho.
 * Se `delta` não for um número, a etiqueta de variação é removida.
 */
export function atualizarKpi(root, kpi, { valor, delta }) {
  const card = root.querySelector(`[data-kpi="${kpi}"]`)
  if (!card) return

  const valorEl = card.querySelector('.stat__value')
  if (valorEl && valor != null) valorEl.innerHTML = valor

  const slot = card.querySelector('.stat__delta-slot')
  if (slot) {
    slot.innerHTML = deltaHtml(delta)
    renderIcons(slot)
  }
}

/** Cabeçalho de bloco com título e ações opcionais. */
export function cardHead({ titulo, descricao = '', acoes = '' }) {
  return `
    <div class="card__head">
      <div>
        ${titulo ? `<h2 class="card__title">${esc(titulo)}</h2>` : ''}
        ${descricao ? `<p class="card__desc">${esc(descricao)}</p>` : ''}
      </div>
      ${acoes ? `<div class="card__actions">${acoes}</div>` : ''}
    </div>
  `
}

/** Barra de ferramentas com filtros, busca e botão de ação. */
export function toolbar({ buscaId, placeholder = 'Buscar...', acao = '', filtros = '' }) {
  return `
    <div class="toolbar">
      ${filtros}
      <label class="search search--inline" for="${buscaId}">
        <i data-lucide="search"></i>
        <input id="${buscaId}" type="search" placeholder="${esc(placeholder)}" autocomplete="off" />
      </label>
      ${acao}
    </div>
  `
}

/**
 * Botão de ação principal.
 * `acao` vira o atributo `data-acao`, que a própria página escuta para abrir
 * o formulário correspondente.
 */
export function botaoPrimario({ label, icon = 'plus', acao }) {
  return `<button class="btn btn--primary" type="button"${acao ? ` data-acao="${esc(acao)}"` : ''}>
      <i data-lucide="${icon}"></i><span>${esc(label)}</span>
    </button>`
}

/** Aviso flutuante temporário, usado para confirmar as ações do usuário. */
export function toast(mensagem) {
  let host = document.querySelector('#toasts')
  if (!host) {
    host = document.createElement('div')
    host.id = 'toasts'
    host.className = 'toasts'
    document.body.appendChild(host)
  }

  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = mensagem
  host.appendChild(el)

  setTimeout(() => el.classList.add('is-out'), 2400)
  setTimeout(() => el.remove(), 2900)
}

/**
 * Tabela declarativa.
 * colunas: [{ key, label, align?, render(row) -> string }]
 */
export function tabela({ colunas, linhas, id = '' }) {
  return `
    <div class="table-wrap">
      <table class="table"${id ? ` id="${id}"` : ''}>
        <thead>
          <tr>
            ${colunas
              .map(
                (col) =>
                  `<th scope="col"${col.align ? ` class="ta-${col.align}"` : ''}${col.width ? ` style="width:${col.width}"` : ''}>${esc(col.label)}</th>`,
              )
              .join('')}
          </tr>
        </thead>
        <tbody>${tabelaLinhas(colunas, linhas)}</tbody>
      </table>
    </div>
  `
}

export function tabelaLinhas(colunas, linhas) {
  if (!linhas.length) {
    return `<tr><td class="table__vazio" colspan="${colunas.length}">Nenhum registro encontrado.</td></tr>`
  }

  return linhas
    .map(
      (linha) =>
        `<tr>${colunas
          .map(
            (col) =>
              `<td${col.align ? ` class="ta-${col.align}"` : ''}${col.width ? ` style="width:${col.width}"` : ''}>${col.render(linha)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')
}

/** Substitui apenas o corpo da tabela, usado ao filtrar sem redesenhar a página. */
export function atualizarTabela(root, id, colunas, linhas) {
  const tbody = root.querySelector(`#${id} tbody`)
  if (tbody) tbody.innerHTML = tabelaLinhas(colunas, linhas)
}
