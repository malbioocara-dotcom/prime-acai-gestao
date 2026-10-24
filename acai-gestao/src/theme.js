import { renderIcons } from './icons.js'

const CHAVE = 'prime-acai:tema'

function aplica(tema) {
  document.documentElement.dataset.theme = tema
  localStorage.setItem(CHAVE, tema)

  const botao = document.querySelector('#theme-toggle')
  if (!botao) return

  const noite = tema === 'dark'
  botao.setAttribute('aria-label', noite ? 'Ativar tema claro' : 'Ativar tema escuro')
  botao.innerHTML = `<i data-lucide="${noite ? 'sun' : 'moon'}"></i>`
  renderIcons(botao)
}

/** Lê o tema salvo (ou a preferência do sistema) e liga o botão de alternância. */
export function initTheme() {
  const salvo = localStorage.getItem(CHAVE)
  aplica(salvo ?? 'light')

  document.querySelector('#theme-toggle')?.addEventListener('click', () => {
    aplica(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
  })
}
