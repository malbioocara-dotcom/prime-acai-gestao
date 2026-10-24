/**
 * Formulário modal reutilizado pelas telas.
 *
 * Os campos são declarados como dados, não como HTML:
 *
 *   abrirFormulario({
 *     titulo: 'Novo item',
 *     campos: [
 *       { nome: 'nome',  label: 'Nome',  tipo: 'texto',  obrigatorio: true, largo: true },
 *       { nome: 'custo', label: 'Custo', tipo: 'numero', prefixo: 'R$' },
 *     ],
 *     aoSalvar: async (valores) => 'Item salvo.',   // a string vira um toast
 *   })
 *
 * `aoSalvar` pode lançar um erro: a mensagem aparece dentro da janela, que
 * continua aberta para o usuário corrigir e tentar de novo.
 */

import { itensHtml, iniciarItens } from './itens-venda.js'
import { renderIcons } from './icons.js'
import { paraNumero, paraTextoNumero } from './numeros.js'
import { esc, toast } from './ui.js'

/* ----------------------------------------------------------- números ------ */

/**
 * `paraNumero` e `paraTextoNumero` passaram a morar em `numeros.js` na P3: o
 * módulo de peso também precisa deles e não podia importar daqui (arrastaria
 * DOM). Continuam reexportados porque várias telas já importavam deste arquivo.
 */
export { paraNumero, paraTextoNumero }

/* ------------------------------------------------------------ campos ----- */

function opcoesHtml(opcoes, selecionado) {
  return opcoes
    .map((o) => {
      const valor = typeof o === 'string' ? o : o.valor
      const rotulo = typeof o === 'string' ? o : o.rotulo
      const sel = String(valor) === String(selecionado ?? '') ? ' selected' : ''
      return `<option value="${esc(valor)}"${sel}>${esc(rotulo)}</option>`
    })
    .join('')
}

/**
 * Um campo do formulário. Exportado porque a tela de Configurações da Empresa
 * também monta campos fora de uma janela modal — assim as duas telas usam o
 * mesmo HTML e as mesmas classes, e não existem dois estilos de campo no app.
 */
export function campoHtml(campo, valor) {
  const id = `campo-${campo.nome}`
  const attrs = `id="${id}" name="${esc(campo.nome)}"`
  const req = campo.obrigatorio ? ' data-obrigatorio="1"' : ''
  let controle = ''

  if (campo.tipo === 'select') {
    // `vazio: false` tira o "Selecione..." — usado quando a lista já tem uma
    // opção marcada por padrão (as preferências, por exemplo).
    const vazio =
      campo.vazio === false ? '' : `<option value="">${esc(campo.vazio ?? 'Selecione...')}</option>`

    controle = `<select class="campo__input" ${attrs}${req}>
        ${vazio}
        ${opcoesHtml(campo.opcoes ?? [], valor)}
      </select>`
  } else if (campo.tipo === 'textarea') {
    controle = `<textarea class="campo__input" ${attrs}${req} rows="3"
        placeholder="${esc(campo.placeholder ?? '')}">${esc(valor ?? '')}</textarea>`
  } else if (campo.tipo === 'data') {
    controle = `<input class="campo__input" type="date" ${attrs}${req} value="${esc(valor ?? '')}" />`
  } else if (campo.tipo === 'numero') {
    controle = `<input class="campo__input" type="text" inputmode="decimal" ${attrs}${req}
        value="${esc(paraTextoNumero(valor))}" placeholder="${esc(campo.placeholder ?? '0')}" />`
  } else {
    const lista = campo.sugestoes ? ` list="lista-${id}"` : ''
    // `mascara` liga a formatação enquanto o usuário digita (CNPJ, CEP,
    // telefone). Quem aplica é a tela, escutando o `data-mascara`.
    const mascara = campo.mascara ? ` data-mascara="${esc(campo.mascara)}"` : ''
    const inputmode = campo.inputmode ? ` inputmode="${esc(campo.inputmode)}"` : ''
    const maxlength = campo.maxlength ? ` maxlength="${Number(campo.maxlength)}"` : ''
    controle = `<input class="campo__input" type="text" ${attrs}${req}${lista}${mascara}${inputmode}${maxlength}
        value="${esc(valor ?? '')}" placeholder="${esc(campo.placeholder ?? '')}" autocomplete="off" />`
    if (campo.sugestoes) {
      controle += `<datalist id="lista-${id}">${campo.sugestoes
        .map((s) => `<option value="${esc(s)}"></option>`)
        .join('')}</datalist>`
    }
  }

  return `
    <div class="campo${campo.largo ? ' campo--largo' : ''}" data-campo="${esc(campo.nome)}">
      <label class="campo__label" for="${id}">
        ${esc(campo.label)}${campo.obrigatorio ? ' <span class="campo__req">*</span>' : ''}
      </label>
      ${
        campo.prefixo
          ? `<div class="campo__grupo"><span class="campo__prefixo">${esc(campo.prefixo)}</span>${controle}</div>`
          : controle
      }
      ${campo.ajuda ? `<p class="campo__ajuda">${esc(campo.ajuda)}</p>` : ''}
      <p class="campo__erro" data-erro hidden></p>
    </div>
  `
}

/* ------------------------------------------------------------ janela ----- */

let aberto = null
let limpar = null

/** Traduz erros técnicos em mensagens que o usuário entende. */
function mensagemDeErro(erro) {
  const texto = erro?.message ?? String(erro)

  if (/duplicate key/i.test(texto)) return 'Já existe um registro com esse código.'
  if (/violates foreign key/i.test(texto)) return 'O registro relacionado não foi encontrado.'
  if (/permission denied|row-level security/i.test(texto))
    return 'Sem permissão para gravar. Rode o neon/00_banco_neon.sql no seu projeto.'
  if (/Failed to fetch|NetworkError|ERR_/i.test(texto))
    return 'Não foi possível falar com o banco. Confira a conexão e a URL no .env.'
  return texto
}

export function abrirFormulario({
  titulo,
  descricao = '',
  campos,
  valores = {},
  textoBotao = 'Salvar',
  aoSalvar,
}) {
  fechar()

  const overlay = document.createElement('div')
  overlay.className = 'modal'
  overlay.innerHTML = `
    <div class="modal__scrim" data-fechar></div>
    <div class="modal__caixa" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
      <header class="modal__head">
        <div>
          <h2 class="modal__titulo" id="modal-titulo">${esc(titulo)}</h2>
          ${descricao ? `<p class="modal__desc">${esc(descricao)}</p>` : ''}
        </div>
        <button class="modal__x" type="button" data-fechar aria-label="Fechar">
          <i data-lucide="x"></i>
        </button>
      </header>
      <form class="modal__form" novalidate>
        <div class="modal__campos">
          ${campos
            .map((c) =>
              c.tipo === 'itens' ? itensHtml(c, valores[c.nome]) : campoHtml(c, valores[c.nome]),
            )
            .join('')}
        </div>
        <p class="modal__erro" role="alert" hidden></p>
        <footer class="modal__acoes">
          <button class="btn btn--ghost" type="button" data-fechar>Cancelar</button>
          <button class="btn btn--primary" type="submit" data-salvar>${esc(textoBotao)}</button>
        </footer>
      </form>
    </div>
  `

  document.body.appendChild(overlay)
  aberto = overlay
  renderIcons(overlay)
  document.body.classList.add('sem-scroll')

  const form = overlay.querySelector('form')
  const botaoSalvar = overlay.querySelector('[data-salvar]')
  const erroGeral = overlay.querySelector('.modal__erro')
  const campoDeItens = campos.find((c) => c.tipo === 'itens')

  /* -------------------------------------------------------- fechar ------ */

  function aoTeclar(evento) {
    if (evento.key === 'Escape') fechar()
  }

  overlay.querySelectorAll('[data-fechar]').forEach((el) => el.addEventListener('click', fechar))
  document.addEventListener('keydown', aoTeclar)
  limpar = () => document.removeEventListener('keydown', aoTeclar)

  /* --------------------------------------------- itens: somar subtotais -- */

  // O campo `itens` (produto + quantidade ou peso) mora em `itens-venda.js`:
  // é onde vive a conta da venda por peso e onde os campos de peso aparecem.
  const widgetItens = campoDeItens ? iniciarItens({ overlay, campo: campoDeItens }) : null

  /* ---------------------------------------------------- validação ------- */

  function limparErros() {
    overlay.querySelectorAll('[data-erro]').forEach((el) => {
      el.hidden = true
      el.textContent = ''
    })
    overlay.querySelectorAll('.campo__input').forEach((el) => el.classList.remove('is-erro'))
    erroGeral.hidden = true
  }

  function mostrarErro(nome, mensagem) {
    const alvo = overlay.querySelector(`[data-campo="${nome}"]`)
    if (!alvo) return

    const p = alvo.querySelector('[data-erro]')
    p.textContent = mensagem
    p.hidden = false
    alvo.querySelectorAll('.campo__input').forEach((el) => el.classList.add('is-erro'))
  }

  function coletar() {
    const saida = {}

    for (const campo of campos) {
      if (campo.tipo === 'itens') {
        // Quem lê as linhas é o widget (`itens-venda.js`): só as linhas
        // preenchidas e válidas — linha inválida é barrada antes pela validação.
        saida[campo.nome] = widgetItens ? widgetItens.coletar() : []
        continue
      }

      const el = overlay.querySelector(`[name="${campo.nome}"]`)
      const bruto = el.value.trim()
      saida[campo.nome] = campo.tipo === 'numero' ? paraNumero(bruto) : bruto
    }

    return saida
  }

  function validar(valoresColetados) {
    const erros = []

    for (const campo of campos) {
      const v = valoresColetados[campo.nome]

      if (campo.tipo === 'itens') {
        const problema = widgetItens?.validar(v)
        if (problema) erros.push([campo.nome, problema])
        continue
      }

      if (campo.obrigatorio && (v === '' || v == null)) {
        erros.push([campo.nome, 'Campo obrigatório.'])
        continue
      }

      if (campo.tipo === 'numero' && v !== '' && v != null) {
        if (!Number.isFinite(v)) erros.push([campo.nome, 'Informe um número válido.'])
        else if (v < (campo.min ?? 0))
          erros.push([campo.nome, `O menor valor aceito é ${campo.min ?? 0}.`])
      }
    }

    return erros
  }

  /* ------------------------------------------------------- enviar ------- */

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    limparErros()

    const valoresColetados = coletar()
    const erros = validar(valoresColetados)

    if (erros.length) {
      erros.forEach(([nome, mensagem]) => mostrarErro(nome, mensagem))
      overlay.querySelector('.campo__input.is-erro')?.focus()
      return
    }

    botaoSalvar.disabled = true
    const rotulo = botaoSalvar.textContent
    botaoSalvar.textContent = 'Salvando...'

    try {
      const mensagem = await aoSalvar(valoresColetados)
      fechar()
      toast(mensagem || 'Salvo com sucesso.')
    } catch (erro) {
      console.error('[formulario] Falha ao salvar:', erro)
      erroGeral.textContent = mensagemDeErro(erro)
      erroGeral.hidden = false
      botaoSalvar.disabled = false
      botaoSalvar.textContent = rotulo
    }
  })

  // Foco no primeiro campo livre, para já poder digitar.
  const primeiro = overlay.querySelector('.modal__campos .campo__input')
  primeiro?.focus()
  if (primeiro && primeiro.tagName === 'INPUT' && primeiro.type === 'text') primeiro.select()
}

/** Fecha a janela aberta, se houver. */
export function fechar() {
  if (!aberto) return
  limpar?.()
  limpar = null
  aberto.remove()
  aberto = null
  document.body.classList.remove('sem-scroll')
}

/* ------------------------------------------------------- confirmação ----- */

/**
 * Janela de confirmação, com a mesma cara do formulário.
 *
 *   if (!(await confirmar({ titulo: 'Remover logomarca?', descricao: '...' }))) return
 *
 * Devolve `true` só quando o usuário confirma. Cancelar, Escape e clique fora
 * devolvem `false`.
 */
export function confirmar({ titulo, descricao = '', textoBotao = 'Confirmar' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal'
    overlay.innerHTML = `
      <div class="modal__scrim" data-cancelar></div>
      <div class="modal__caixa modal__caixa--estreita" role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo">
        <header class="modal__head">
          <div>
            <h2 class="modal__titulo" id="confirmar-titulo">${esc(titulo)}</h2>
            ${descricao ? `<p class="modal__desc">${esc(descricao)}</p>` : ''}
          </div>
          <button class="modal__x" type="button" data-cancelar aria-label="Fechar">
            <i data-lucide="x"></i>
          </button>
        </header>
        <footer class="modal__acoes">
          <button class="btn btn--ghost" type="button" data-cancelar>Cancelar</button>
          <button class="btn btn--danger" type="button" data-confirmar>${esc(textoBotao)}</button>
        </footer>
      </div>
    `

    document.body.appendChild(overlay)
    renderIcons(overlay)
    document.body.classList.add('sem-scroll')

    function encerrar(resultado) {
      document.removeEventListener('keydown', aoTeclar)
      overlay.remove()
      // Se outra janela ainda estiver aberta, o scroll continua travado.
      if (!document.querySelector('.modal')) document.body.classList.remove('sem-scroll')
      resolve(resultado)
    }

    function aoTeclar(evento) {
      if (evento.key === 'Escape') encerrar(false)
    }

    overlay
      .querySelectorAll('[data-cancelar]')
      .forEach((el) => el.addEventListener('click', () => encerrar(false)))

    const botaoConfirmar = overlay.querySelector('[data-confirmar]')
    botaoConfirmar.addEventListener('click', () => encerrar(true))
    document.addEventListener('keydown', aoTeclar)

    // O foco vai para o botão de confirmar (o destrutivo), mas o usuário pode
    // sair com Escape — a ação não acontece por acidente.
    botaoConfirmar.focus()
  })
}
