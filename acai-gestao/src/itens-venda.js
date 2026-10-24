/**
 * ============================================================================
 * Itens de uma venda
 * ============================================================================
 *
 * A linha de item do pedido, com os três jeitos de vender:
 *
 *   unidade / receita — uma quantidade (3 copos, 2 porções).
 *   peso              — o peso lido na balança, em gramas, e a tara quando o
 *                       peso vem BRUTO. O que vai para a venda é o LÍQUIDO.
 *
 * Por que a conta do peso acontece aqui, e não só no banco
 * -------------------------------------------------------
 * O banco é a autoridade (migração 08: `registrar_venda` recalcula tudo com
 * `numeric` e ignora qualquer preço que venha do navegador). Aqui é só a
 * prévia: o operador precisa ver "450 g × R$ 69,90/kg = R$ 31,46" ANTES de
 * fechar o pedido, e precisa ver a recusa (tara maior que o bruto, por
 * exemplo) enquanto digita — não depois. As regras vêm de `peso.js`, que é o
 * mesmo módulo que os testes cobrem; nada de conta nova inventada aqui.
 *
 * O método de entrada ('bruto_tara' ou 'liquido') começa no que o cadastro do
 * produto diz, mas a linha deixa trocar: há balança que já desconta a tara e
 * balança que não, e quem está no balcão sabe qual está na frente dele.
 */

import { renderIcons } from './icons.js'
import { esc, formatBRL } from './ui.js'
import { formatarNumero, paraNumero, paraTextoNumero } from './numeros.js'
import {
  METODOS_PESO,
  METODOS_PESO_ATIVOS,
  METODO_PESO_ROTULO,
  calcularVendaPorPeso,
  formatPeso,
} from './peso.js'

const TIPO_PESO = 'peso'

/** Como o preço é cobrado — "/kg" muda completamente o que o número significa. */
function unidade(preco) {
  if (preco.tipoVenda === 'peso') return '/kg'
  if (preco.tipoVenda === 'receita') return '/porção'
  return ''
}

const rotuloProduto = (p) => `${p.nome} — ${formatBRL(p.preco)}${unidade(p)}`

/* --------------------------------------------------------------- desenho -- */

/**
 * Uma linha de item. Os campos de peso nascem escondidos: quem os mostra é
 * `sincronizarLinha`, quando o produto escolhido é vendido por peso.
 */
export function linhaItemHtml(campo, linha = {}) {
  // `uuid` é a chave do banco; sem banco (modo demonstração), os dados de
  // exemplo só têm o código (`P001`) — usar o código aqui evita a opção com
  // `value="undefined"`, que era o que o select de exemplo montava.
  const chave = (p) => p.uuid ?? p.id

  const opcoes = (campo.produtos ?? [])
    .map(
      (p) =>
        `<option value="${esc(chave(p))}" data-tipo="${esc(p.tipoVenda ?? 'unidade')}"
           data-metodo="${esc(p.metodoPeso ?? '')}" data-preco="${esc(p.preco)}"
           data-nome="${esc(p.nome)}" ${chave(p) === linha.produtoId ? 'selected' : ''}>
           ${esc(rotuloProduto(p))}</option>`,
    )
    .join('')

  const recipientes = (campo.recipientes ?? [])
    .map(
      (r) =>
        `<option value="${esc(r.uuid ?? r.id)}" data-tara="${esc(r.tara)}">${esc(
          r.nome,
        )} — ${formatPeso(r.tara)}</option>`,
    )
    .join('')

  const metodos = METODOS_PESO_ATIVOS.map(
    (m) => `<option value="${esc(m)}">${esc(METODO_PESO_ROTULO[m])}</option>`,
  ).join('')

  return `
    <div class="itens__linha" data-item>
      <span class="itens__foto" data-item-foto aria-hidden="true"><i data-lucide="image"></i></span>
      <select class="campo__input" data-item-produto aria-label="Produto">
        <option value="">Selecione o produto...</option>
        ${opcoes}
      </select>
      <input class="campo__input" type="text" inputmode="decimal" data-item-qtd
             aria-label="Quantidade" value="${esc(paraTextoNumero(linha.quantidade ?? 1))}" />
      <span class="itens__sub" data-item-sub>${formatBRL(0)}</span>
      <button type="button" class="itens__x" data-item-remover aria-label="Remover item">
        <i data-lucide="trash-2"></i>
      </button>

      <div class="itens__peso" data-item-peso hidden>
        <label class="itens__campo">
          <span class="itens__rotulo">Peso lido</span>
          <select class="campo__input" data-item-metodo aria-label="Como o peso foi lido">
            ${metodos}
          </select>
        </label>

        <label class="itens__campo" data-item-campo-recipiente>
          <span class="itens__rotulo">Recipiente</span>
          <select class="campo__input" data-item-recipiente aria-label="Recipiente">
            <option value="">Digitar a tara</option>
            ${recipientes}
          </select>
        </label>

        <label class="itens__campo" data-item-campo-bruto>
          <span class="itens__rotulo">Peso bruto (g)</span>
          <input class="campo__input" type="text" inputmode="decimal" data-item-bruto
                 aria-label="Peso bruto em gramas" />
        </label>

        <label class="itens__campo" data-item-campo-tara>
          <span class="itens__rotulo">Tara (g)</span>
          <input class="campo__input" type="text" inputmode="decimal" data-item-tara
                 aria-label="Tara em gramas" value="0" />
        </label>

        <label class="itens__campo" data-item-campo-liquido hidden>
          <span class="itens__rotulo">Peso líquido (g)</span>
          <input class="campo__input" type="text" inputmode="decimal" data-item-liquido
                 aria-label="Peso líquido em gramas" />
        </label>

        <span class="itens__leitura" data-item-leitura></span>
      </div>
    </div>
  `
}

/** O campo `itens` inteiro: a lista, o botão de adicionar e o total do pedido. */
export function itensHtml(campo, valor) {
  const linhas = Array.isArray(valor) && valor.length ? valor : [{}]

  return `
    <div class="campo campo--largo" data-campo="${esc(campo.nome)}">
      <span class="campo__label">
        ${esc(campo.label)}${campo.obrigatorio ? ' <span class="campo__req">*</span>' : ''}
      </span>
      <div class="itens" data-itens>
        <div class="itens__lista" data-itens-lista>
          ${linhas.map((l) => linhaItemHtml(campo, l)).join('')}
        </div>
        <div class="itens__rodape">
          <button type="button" class="btn btn--ghost" data-itens-add>
            <i data-lucide="plus"></i><span>Adicionar item</span>
          </button>
          <p class="itens__total">Total do pedido <strong data-itens-total>${formatBRL(0)}</strong></p>
        </div>
      </div>
      <p class="campo__erro" data-erro hidden></p>
    </div>
  `
}

/* ---------------------------------------------------------------- leitura -- */

/**
 * Lê uma linha do DOM e devolve o que ela significa.
 *
 * @returns {{ok: true, produto: object, centavos: number, total: number,
 *            detalhe: string, dados: object}
 *          | {ok: false, produto?: object, erro?: string, vazio?: true}}
 */
export function lerLinha(linhaEl) {
  const select = linhaEl.querySelector('[data-item-produto]')
  const opcao = select.selectedOptions[0]

  if (!select.value || !opcao) return { ok: false, vazio: true }

  const produto = {
    uuid: select.value,
    nome: opcao.dataset.nome ?? '',
    tipoVenda: opcao.dataset.tipo ?? 'unidade',
    metodoPeso: opcao.dataset.metodo || null,
    preco: Number(opcao.dataset.preco ?? 0),
  }

  /* ------------------------------------------------- por unidade / receita -- */
  if (produto.tipoVenda !== TIPO_PESO) {
    const quantidade = paraNumero(linhaEl.querySelector('[data-item-qtd]').value)

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return {
        ok: false,
        produto,
        erro: `A quantidade de "${produto.nome}" precisa ser maior que zero.`,
      }
    }

    const centavos = Math.round(quantidade * produto.preco * 100)

    return {
      ok: true,
      produto,
      centavos,
      total: centavos / 100,
      detalhe: `${formatarNumero(quantidade)} × ${formatBRL(produto.preco)}`,
      // `precoUnitario` fica só para a tela (o total mostrado quando não há
      // banco); quem grava preço é o banco, e ele ignora o que vier daqui.
      dados: {
        produtoId: produto.uuid,
        descricao: produto.nome,
        quantidade,
        precoUnitario: produto.preco,
      },
    }
  }

  /* ------------------------------------------------------------- por peso -- */
  const metodo = linhaEl.querySelector('[data-item-metodo]').value

  const conta = calcularVendaPorPeso({
    metodo,
    pesoBrutoGramas: linhaEl.querySelector('[data-item-bruto]').value,
    taraGramas: linhaEl.querySelector('[data-item-tara]').value,
    pesoLiquidoGramas: linhaEl.querySelector('[data-item-liquido]').value,
    precoPorKg: produto.preco,
  })

  if (!conta.ok) return { ok: false, produto, erro: conta.erro }

  const brutoTara = conta.metodo === METODOS_PESO.BRUTO_TARA

  return {
    ok: true,
    produto,
    centavos: conta.centavos,
    total: conta.total,
    detalhe: `${formatPeso(conta.liquidoGramas)} × ${formatBRL(produto.preco)}/kg`,
    dados: {
      produtoId: produto.uuid,
      descricao: produto.nome,
      metodoPeso: conta.metodo,
      pesoBrutoGramas: conta.brutoGramas,
      taraGramas: conta.taraGramas,
      pesoLiquidoGramas: conta.liquidoGramas,
      // Idem: só para o total da tela.
      precoUnitario: produto.preco,
      // Recipiente só faz sentido quando a tara foi subtraída; no peso já
      // líquido a embalagem não entrou na conta.
      recipienteId: brutoTara
        ? linhaEl.querySelector('[data-item-recipiente]').value || null
        : null,
    },
  }
}

/* ------------------------------------------------------------------ widget -- */

/** Mostra/esconde os campos conforme o produto e o método escolhidos. */
function sincronizar(linha) {
  const opcao = linha.querySelector('[data-item-produto]').selectedOptions[0]
  const ehPeso = opcao?.dataset.tipo === TIPO_PESO

  linha.querySelector('[data-item-peso]').hidden = !ehPeso
  linha.querySelector('[data-item-qtd]').hidden = ehPeso

  if (ehPeso) {
    const metodo = linha.querySelector('[data-item-metodo]')
    const doCadastro = opcao.dataset.metodo
    metodo.value = METODOS_PESO_ATIVOS.includes(doCadastro)
      ? doCadastro
      : METODOS_PESO.BRUTO_TARA
    aplicarMetodo(linha)
  }
}

function aplicarMetodo(linha) {
  const brutoTara = linha.querySelector('[data-item-metodo]').value === METODOS_PESO.BRUTO_TARA

  linha.querySelector('[data-item-campo-bruto]').hidden = !brutoTara
  linha.querySelector('[data-item-campo-recipiente]').hidden = !brutoTara
  linha.querySelector('[data-item-campo-tara]').hidden = !brutoTara
  linha.querySelector('[data-item-campo-liquido]').hidden = brutoTara
}

/**
 * Escolheu um recipiente do cadastro? A tara vem dele e o campo trava.
 * Sem recipiente, a tara é digitada — e aí `recipiente_id` fica nulo na venda,
 * porque não houve recipiente cadastrado para apontar.
 */
function aplicarRecipiente(linha) {
  const select = linha.querySelector('[data-item-recipiente]')
  const tara = linha.querySelector('[data-item-tara]')
  const daLista = select.selectedOptions[0]?.dataset.tara

  if (select.value && daLista != null) {
    tara.value = daLista
    tara.disabled = true
  } else {
    tara.disabled = false
  }
}

function limparLinha(linha) {
  linha.querySelector('[data-item-produto]').value = ''
  linha.querySelector('[data-item-qtd]').value = '1'
  linha.querySelector('[data-item-bruto]').value = ''
  linha.querySelector('[data-item-tara]').value = '0'
  linha.querySelector('[data-item-tara]').disabled = false
  linha.querySelector('[data-item-liquido]').value = ''
  linha.querySelector('[data-item-recipiente]').value = ''
  sincronizar(linha)
  void atualizarFoto(linha)
}

async function atualizarFoto(linha, campo) {
  const alvo = linha.querySelector('[data-item-foto]')
  const produtoId = linha.querySelector('[data-item-produto]').value
  const chamada = Number(linha.dataset.fotoChamada ?? 0) + 1
  linha.dataset.fotoChamada = String(chamada)
  alvo.innerHTML = '<i data-lucide="image"></i>'
  const produto = campo?.produtos?.find((item) => String(item.uuid ?? item.id) === produtoId)
  if (!produtoId || !produto?.imagemPath || !campo.carregarImagem) {
    renderIcons(alvo)
    return
  }

  try {
    const url = await campo.carregarImagem(produtoId)
    if (!url || !linha.isConnected || linha.dataset.fotoChamada !== String(chamada)) return
    alvo.innerHTML = `<img src="${esc(url)}" alt="" />`
  } catch (erro) {
    console.error('[vendas] Não foi possível carregar a foto do produto selecionado.', erro)
  }
}

/**
 * Liga o campo de itens: adicionar, remover, recalcular e ler.
 *
 * @returns {{coletar: () => object[], validar: (itens: object[]) => string|null,
 *            recalcular: () => void}}
 */
export function iniciarItens({ overlay, campo }) {
  const lista = overlay.querySelector(`[data-campo="${campo.nome}"] [data-itens-lista]`)
  const alvoTotal = overlay.querySelector('[data-itens-total]')
  const linhas = () => [...lista.querySelectorAll('[data-item]')]

  function recalcular() {
    let centavos = 0

    for (const linha of linhas()) {
      const conta = lerLinha(linha)
      const sub = linha.querySelector('[data-item-sub]')
      const leitura = linha.querySelector('[data-item-leitura]')

      if (conta.ok) {
        sub.textContent = formatBRL(conta.total)
        leitura.textContent = conta.detalhe
        centavos += conta.centavos
      } else {
        sub.textContent = formatBRL(0)
        // Linha ainda em branco não é erro: o operador está preenchendo.
        leitura.textContent = conta.vazio ? '' : (conta.erro ?? '')
      }
    }

    if (alvoTotal) alvoTotal.textContent = formatBRL(centavos / 100)
  }

  overlay.addEventListener('click', (evento) => {
    if (evento.target.closest('[data-itens-add]')) {
      lista.insertAdjacentHTML('beforeend', linhaItemHtml(campo))
      const nova = lista.lastElementChild
      renderIcons(lista)
      sincronizar(nova)
      recalcular()
      return
    }

    const remover = evento.target.closest('[data-item-remover]')
    if (remover) {
      const linha = remover.closest('[data-item]')
      // Sempre sobra uma linha: se for a última, ela é limpa em vez de sumir.
      if (linhas().length > 1) linha.remove()
      else limparLinha(linha)
      recalcular()
    }
  })

  overlay.addEventListener('input', (evento) => {
    if (evento.target.closest('[data-item]')) recalcular()
  })

  overlay.addEventListener('change', (evento) => {
    const linha = evento.target.closest('[data-item]')
    if (!linha) return

    if (evento.target.matches('[data-item-produto]')) {
      sincronizar(linha)
      void atualizarFoto(linha, campo)
    }
    if (evento.target.matches('[data-item-metodo]')) aplicarMetodo(linha)
    if (evento.target.matches('[data-item-recipiente]')) aplicarRecipiente(linha)

    recalcular()
  })

  for (const linha of linhas()) {
    sincronizar(linha)
    void atualizarFoto(linha, campo)
  }
  recalcular()

  return {
    recalcular,

    /** Só as linhas com produto escolhido e conta válida. */
    coletar: () =>
      linhas()
        .map(lerLinha)
        .filter((conta) => conta.ok)
        .map((conta) => conta.dados),

    /** Mensagem de erro da primeira linha problemática, ou `null`. */
    validar: (itens) => {
      // Linha com produto escolhido e dados incompletos vem primeiro: é ela que
      // precisa de correção. "Adicione pelo menos um item" só quando não há
      // nenhum produto escolhido.
      for (const linha of linhas()) {
        const conta = lerLinha(linha)
        if (!conta.ok && !conta.vazio) return conta.erro
      }

      if (campo.obrigatorio && !itens.length) return 'Adicione pelo menos um item.'

      return null
    },
  }
}
