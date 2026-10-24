/**
 * Peças reaproveitadas pelas telas de autenticação (login, cadastro,
 * recuperação e redefinição de senha).
 *
 * As telas declaram os campos como dados e recebem HTML pronto, em vez de
 * repetir marcação quatro vezes. O painel lateral vem de `config.marca`.
 */

import { config } from './config.js'
import { renderIcons } from './lib/icons.js'
import { esc } from './ui.js'

/** Moldura das telas: painel colorido à esquerda, formulário à direita. */
export function layoutAuth({ titulo, subtitulo = '', conteudo, rodape = '' }) {
  const m = config.marca

  const pontos = Array.isArray(m.pontos) && m.pontos.length
    ? `
        <ul class="auth__pontos">
          ${m.pontos.map((ponto) => `<li><i data-lucide="check"></i> ${esc(ponto)}</li>`).join('')}
        </ul>
      `
    : ''

  return `
    <div class="auth">
      <aside class="auth__marca">
        <div class="auth__marca-topo">
          <span class="auth__logo"><i data-lucide="${esc(m.icone || 'store')}"></i></span>
          <span>
            <strong>${esc(m.nome)}</strong>
            ${m.assinatura ? `<small>${esc(m.assinatura)}</small>` : ''}
          </span>
        </div>

        ${
          m.chamada
            ? `<div class="auth__chamada">
                 <h2>${esc(m.chamada)}</h2>
                 ${m.descricao ? `<p>${esc(m.descricao)}</p>` : ''}
               </div>`
            : ''
        }

        ${pontos}
      </aside>

      <main class="auth__painel">
        <div class="auth__caixa">
          <header class="auth__cabecalho">
            <h1>${esc(titulo)}</h1>
            ${subtitulo ? `<p>${subtitulo}</p>` : ''}
          </header>
          ${conteudo}
          ${rodape ? `<div class="auth__rodape">${rodape}</div>` : ''}
        </div>
      </main>
    </div>
  `
}

/* ------------------------------------------------------------- campos ------ */

function botaoOlho(nome) {
  return `
    <button
      class="campo-auth__olho"
      type="button"
      data-olho="${esc(nome)}"
      aria-label="Mostrar senha"
      aria-pressed="false"
      aria-controls="auth-${esc(nome)}"
    ><i data-lucide="eye"></i></button>
  `
}

/**
 * Campo com ícone à esquerda e, opcionalmente, o botão de mostrar/ocultar senha.
 * O botão só troca o `type` do input — nunca toca no `value`, então o que já
 * foi digitado (e a posição do cursor) continua igual.
 */
export function campoAuth({
  nome,
  label,
  tipo = 'text',
  icone,
  placeholder = '',
  autocomplete = '',
  obrigatorio = true,
  olho = false,
  extra = '',
}) {
  const id = `auth-${nome}`
  return `
    <div class="campo-auth">
      <label class="campo-auth__label" for="${id}">
        ${esc(label)}${obrigatorio ? ' <span class="campo-auth__req" aria-hidden="true">*</span>' : ''}
      </label>
      <div class="campo-auth__controle" data-controle="${esc(nome)}">
        <i data-lucide="${esc(icone)}"></i>
        <input
          class="campo-auth__input"
          id="${id}"
          name="${esc(nome)}"
          type="${esc(tipo)}"
          ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}
          ${autocomplete ? `autocomplete="${esc(autocomplete)}"` : ''}
          ${obrigatorio ? 'required' : ''}
          aria-describedby="erro-${esc(nome)}"
        />
        ${olho ? botaoOlho(nome) : ''}
      </div>
      <p class="campo-auth__erro" id="erro-${esc(nome)}" hidden></p>
      ${extra}
    </div>
  `
}

/** Checklist de senha forte, preenchido em tempo real enquanto se digita. */
export function regrasSenha(regras) {
  return `
    <ul class="senha-regras" id="senha-regras">
      ${regras
        .map(
          (regra, i) =>
            `<li data-regra="${i}"${regra.ok ? ' class="is-ok"' : ''}>
               <i data-lucide="check"></i>${esc(regra.texto)}
             </li>`,
        )
        .join('')}
    </ul>
  `
}

/* ------------------------------------------------------------ mensagens ---- */

const ICONE_ALERTA = { erro: 'alert-circle', ok: 'check-circle-2', info: 'info' }

export function alertaAuth(id) {
  return `<div class="alerta-auth alerta-auth--erro" id="${esc(id)}" role="alert" hidden></div>`
}

export function mostrarAlerta(root, id, tipo, texto) {
  const caixa = root.querySelector(`#${id}`)
  if (!caixa) return

  caixa.className = `alerta-auth alerta-auth--${tipo}`
  caixa.hidden = false
  caixa.innerHTML = `<i data-lucide="${ICONE_ALERTA[tipo] ?? 'alert-circle'}"></i><p></p>`
  caixa.querySelector('p').textContent = texto
  renderIcons(caixa)
}

export function esconderAlerta(root, id) {
  const caixa = root.querySelector(`#${id}`)
  if (caixa) caixa.hidden = true
}

export function marcarErro(root, nome, mensagem) {
  const controle = root.querySelector(`[data-controle="${nome}"]`)
  const erro = root.querySelector(`#erro-${nome}`)
  const input = root.querySelector(`#auth-${nome}`)

  controle?.classList.toggle('is-erro', Boolean(mensagem))

  if (erro) {
    erro.textContent = mensagem ?? ''
    erro.hidden = !mensagem
  }

  if (input) {
    if (mensagem) input.setAttribute('aria-invalid', 'true')
    else input.removeAttribute('aria-invalid')
  }
}

export function limparErros(root) {
  root.querySelectorAll('.campo-auth__controle').forEach((c) => c.classList.remove('is-erro'))
  root.querySelectorAll('.campo-auth__erro').forEach((e) => {
    e.hidden = true
    e.textContent = ''
  })
  root.querySelectorAll('.campo-auth__input').forEach((i) => i.removeAttribute('aria-invalid'))
}

/** Leva o foco para o primeiro campo com erro — teclado e leitor de tela. */
export function focarPrimeiroErro(root) {
  root.querySelector('.campo-auth__controle.is-erro input')?.focus()
}

/* ------------------------------------------------------------- controles --- */

/**
 * Liga os botões de olho. Sem tocar no `value`: só alterna `password`/`text`,
 * troca o ícone e atualiza os rótulos de acessibilidade.
 */
export function ligarOlhos(root) {
  root.querySelectorAll('[data-olho]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const input = root.querySelector(`#auth-${botao.dataset.olho}`)
      if (!input) return

      const estavaVisivel = input.type === 'text'
      input.type = estavaVisivel ? 'password' : 'text'

      botao.setAttribute('aria-pressed', String(!estavaVisivel))
      botao.setAttribute('aria-label', estavaVisivel ? 'Mostrar senha' : 'Ocultar senha')
      botao.innerHTML = `<i data-lucide="${estavaVisivel ? 'eye' : 'eye-off'}"></i>`
      renderIcons(botao)
    })
  })
}

/**
 * Estado de carregamento do botão. `disabled` também é o que impede o envio
 * duplicado: um segundo clique não passa.
 */
export function definirCarregando(botao, carregando, texto = null) {
  if (!botao) return
  botao.classList.toggle('is-carregando', carregando)
  botao.disabled = carregando
  botao.setAttribute('aria-busy', carregando ? 'true' : 'false')
  if (texto) {
    const alvo = botao.querySelector('span:not(.btn-auth__girando)')
    if (alvo) alvo.textContent = texto
  }
}

/** Tela cheia de espera, mostrada enquanto o app confere a sessão. */
export function telaDeEspera(texto = 'Verificando a sua sessão…') {
  return `
    <div class="auth auth--carregando">
      <div class="auth__espera" role="status">
        <span class="btn-auth__girando" aria-hidden="true"></span>
        <p>${esc(texto)}</p>
      </div>
    </div>
  `
}

/**
 * Carrega a fonte Inter só quando uma tela de autenticação aparece.
 *
 * O resto do app usa a fonte do sistema de propósito — sem requisição externa.
 * Puxar a webfont no `index.html` atrasaria o carregamento de todas as páginas
 * por causa de quatro telas.
 */
export function carregarFonteAuth() {
  if (document.querySelector('#fonte-auth')) return

  const link = document.createElement('link')
  link.id = 'fonte-auth'
  link.rel = 'stylesheet'
  link.href =
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
  document.head.append(link)
}
