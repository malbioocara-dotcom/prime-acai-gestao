import './style.css'
import 'login-projetos/estilo.css'
import './styles/config.css'
import './styles/produtos.css'

import { telaDeEspera, carregarFonteAuth } from 'login-projetos/auth-ui'
import {
  configurarLogin,
  config,
  ehRotaAuthConfigurada,
  rotaAuthHabilitada,
} from 'login-projetos/config'
import { renderIcons } from './icons.js'
import { esc } from './ui.js'
import { renderShell } from './layout/shell.js'
import { loginProjetosConfig } from './login-config.js'
import { authConfigurado, neonConfigurado } from 'login-projetos/neon'
import { createRouter } from './router.js'
import { routes } from './routes.js'
import { observarAuth, sair, sessaoAtual } from 'login-projetos/auth'
import { carregarEmpresa, carregarLogo, urlDaLogo } from './services/empresa.js'
import { carregarPermissoes, podeAcessar, sincronizarPermissoes } from './services/permissoes.js'
import { EVENTOS_DADOS } from './services/base.js'
import { contarNaoLidas, listarNotificacoes, marcarLida, marcarTodasLidas } from './services/notificacoes.js'
import { estadoSessao, iniciais, logado } from 'login-projetos/sessao'
import { initTheme } from './theme.js'
import { dadosTesteHabilitados } from './demo-test-data.js'

const app = document.querySelector('#app')

/* ==========================================================================
   Login_projetos — telas de autenticação (marca, rotas e textos)

   O login/cadastro/recuperação de senha vêm do pacote `Login_projetos`
   (dependência local `file:../Login_projetos`), compartilhado com outros
   projetos. A configuração da Prime Açaí está em `src/login-config.js`.
   ========================================================================== */

configurarLogin(loginProjetosConfig)

/* ==========================================================================
   Sessao
   ========================================================================== */

async function lerSessao() {
  try {
    const sessao = await sessaoAtual()

    estadoSessao.usuario = sessao?.usuario ?? null
    estadoSessao.perfil = sessao?.perfil ?? null

    const semAcesso = estadoSessao.usuario && (!estadoSessao.perfil || !estadoSessao.perfil.ativo)

    if (semAcesso) {
      const motivo = estadoSessao.perfil
        ? (estadoSessao.perfil.aprovadoEm ? 'Esta conta esta desativada.' : 'Esta conta esta pendente de aprovacao pelo administrador.')
        : 'Nao encontramos o perfil desta conta.'

      try {
        await sair()
      } catch (erroLogout) {
        console.error('[auth] Nao foi possivel encerrar a sessao sem acesso.', erroLogout)
      }
      estadoSessao.usuario = null
      estadoSessao.perfil = null
      estadoSessao.aviso = `${motivo} Fale com um administrador.`
    } else {
      await carregarPermissoes()
    }
  } catch (erro) {
    console.error('[auth] Nao foi possivel ler a sessao:', erro)
    estadoSessao.usuario = null
    estadoSessao.perfil = null
    estadoSessao.permissoes = new Set()
    estadoSessao.aviso = 'Nao foi possivel verificar a sessao. Entre novamente.'
  } finally {
    estadoSessao.carregando = false
  }
}

let router = null
let sincronizando = null
const falhasCarregamento = new Set()

function sincronizar() {
  if (sincronizando) return sincronizando

  sincronizando = lerSessao()
    .then(() => router?.render())
    .finally(() => {
      sincronizando = null
    })

  return sincronizando
}

/* ==========================================================================
   Guarda de rota
   ========================================================================== */

function guarda(rota) {
  if (!authConfigurado()) return rota.publica ? '/' : null

  if (rota.publica && ehRotaAuthConfigurada(rota.path) && !rotaAuthHabilitada(rota.path)) {
    return rota.path === config.rotas.login ? '/acesso-negado' : config.rotas.login
  }

  if (rota.publica) {
    return logado() && !rota.permiteLogado ? config.rotas.depoisDoLogin : null
  }

  if (!logado()) return config.rotas.login

  if (rota.modulo && !podeAcessar(rota.modulo)) return '/acesso-negado'

  return null
}

/* ==========================================================================
   Involucros
   ========================================================================== */

function usuarioDoShell() {
  if (!logado()) {
    return { nome: 'Modo demonstracao', papel: 'Dados de exemplo', iniciais: 'PA' }
  }

  const perfil = estadoSessao.perfil
  return { nome: perfil.nome, papel: perfil.papelRotulo, iniciais: iniciais(perfil.nome) }
}

let limparShellApp = null

const shells = {
  app: {
    html: () => renderShell(routes, usuarioDoShell(), podeAcessar),
    outlet: '#view',
    aoMontar: montarShellApp,
    aoDesmontar: () => {
      limparShellApp?.()
      limparShellApp = null
    },
  },
  auth: {
    html: () => '<div id="auth-view"></div>',
    outlet: '#auth-view',
    aoMontar: () => carregarFonteAuth(),
  },
}

const consultaEstreita = window.matchMedia('(max-width: 1024px)')

function telaEstreita() {
  return consultaEstreita.matches
}

function abrirMenu() {
  if (!telaEstreita()) return
  app.querySelector('#sidebar')?.classList.add('is-open')
  const scrim = app.querySelector('#scrim')
  if (scrim) scrim.hidden = false
  document.body.classList.add('sem-scroll')
}

function fecharMenu() {
  app.querySelector('#sidebar')?.classList.remove('is-open')
  const scrim = app.querySelector('#scrim')
  if (scrim) scrim.hidden = true
  document.body.classList.remove('sem-scroll')
}

function alternarMenu() {
  if (telaEstreita()) {
    abrirMenu()
    return
  }
  app.querySelector('.app')?.classList.toggle('menu-recolhido')
}

function marcarMenuAtivo(path) {
  app.querySelectorAll('.nav__link').forEach((link) => {
    const ativo = link.dataset.route === path
    link.classList.toggle('is-active', ativo)
    if (ativo) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
}

function pintarOrigemDados() {
  const pill = app.querySelector('#status-dados')
  const texto = app.querySelector('#status-dados-texto')
  if (!pill || !texto) return

  pill.classList.remove('status-pill--ok', 'status-pill--exemplo', 'status-pill--erro')

  if (neonConfigurado) {
    if (falhasCarregamento.size) {
      pill.classList.add('status-pill--erro')
      texto.textContent = 'Falha ao carregar'
      pill.title = 'A consulta ao Neon falhou. Dados de demonstração não foram exibidos.'
      return
    }

    pill.classList.add('status-pill--ok')
    texto.textContent = 'Neon'
    pill.title = 'Lendo dados do seu banco no Neon.'
  } else {
    pill.classList.add('status-pill--exemplo')
    texto.textContent = dadosTesteHabilitados ? 'Teste fictício' : 'Dados de exemplo'
    pill.title = dadosTesteHabilitados
      ? 'Dados fictícios de demonstração; nenhuma alteração é gravada no banco.'
      : 'Preencha VITE_NEON_URL no arquivo .env para usar dados reais.'
  }
}

function pintarUsuario() {
  const nome = app.querySelector('.user__info strong')
  const papel = app.querySelector('.user__info small')
  const avatar = app.querySelector('.user__avatar')
  if (!nome) return

  const usuario = usuarioDoShell()
  nome.textContent = usuario.nome
  nome.title = usuario.nome
  if (papel) papel.textContent = usuario.papel
  if (avatar) avatar.textContent = usuario.iniciais
}

async function pintarMarca() {
  const marca = app.querySelector('#brand-mark')
  const imagem = app.querySelector('#brand-logo')
  if (!marca || !imagem) return

  let resultado
  try {
    resultado = await carregarLogo()
  } catch {
    // carregar() registra a falha no indicador global.
    return
  }

  const { dados } = resultado
  const url = urlDaLogo(dados)

  if (url) {
    imagem.src = url
    imagem.hidden = false
    marca.classList.add('brand__mark--com-logo')
  } else {
    imagem.removeAttribute('src')
    imagem.hidden = true
    marca.classList.remove('brand__mark--com-logo')
  }
}

async function pintarNomeEmpresa() {
  const nomeEl = app.querySelector('#brand-nome')
  if (!nomeEl) return
  try {
    const { dados, origem } = await carregarEmpresa()
    if (origem === 'neon' && dados?.nome_fantasia) {
      nomeEl.textContent = dados.nome_fantasia
    }
  } catch (e) {
    // mantem o padrao
  }
}

function montarShellApp(raiz) {
  const outlet = raiz.querySelector('#view')
  const scrim = raiz.querySelector('#scrim')
  const buscaGlobal = raiz.querySelector('#busca-global')

  renderIcons(raiz)
  initTheme()
  pintarOrigemDados()
  pintarUsuario()
  pintarMarca()
  pintarNomeEmpresa()

  raiz.querySelector('#sidebar-open').addEventListener('click', alternarMenu)
  raiz.querySelector('#sidebar-close').addEventListener('click', fecharMenu)
  scrim.addEventListener('click', fecharMenu)

  const aoRedimensionar = () => {
    if (telaEstreita()) app.querySelector('.app')?.classList.remove('menu-recolhido')
    else fecharMenu()
  }
  window.addEventListener('resize', aoRedimensionar)

  raiz.querySelector('#btn-config')?.addEventListener('click', () => router.navigate('/configuracoes'))

  if (!authConfigurado()) raiz.querySelector('#btn-sair')?.remove()

  const aoTeclar = (evento) => {
    if (evento.key === 'Escape') fecharMenu()
  }
  document.addEventListener('keydown', aoTeclar)

  raiz.querySelector('[data-skip]').addEventListener('click', () => outlet.focus())

  buscaGlobal.addEventListener('input', () => {
    window.dispatchEvent(new CustomEvent('busca-global', { detail: buscaGlobal.value }))
  })

  raiz.querySelector('#btn-sair')?.addEventListener('click', async (evento) => {
    const botao = evento.currentTarget
    botao.disabled = true

    try {
      await sair()
      await sincronizar()
      router?.navigate(config.rotas.depoisDoLogout)
    } catch (erro) {
      console.error('[auth] Falha ao sair:', erro)
      botao.disabled = false
    }
  })

  const aoAtualizarEmpresa = () => { pintarMarca(); pintarNomeEmpresa() }
  window.addEventListener('logo-mudou', aoAtualizarEmpresa)
  window.addEventListener('empresa-mudou', aoAtualizarEmpresa)

  /* ---------- Notificacoes ---------- */
  const badge = raiz.querySelector('#notif-badge')
  const painel = raiz.querySelector('#notif-painel')
  const lista = raiz.querySelector('#notif-lista')
  const btnNotif = raiz.querySelector('#btn-notif')

  async function atualizarBadge() {
    if (!badge) return
    try {
      const n = await contarNaoLidas()
      if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.style.display = 'block' }
      else { badge.style.display = 'none' }
    } catch (e) { /* silencioso */ }
  }

  async function carregarPainel() {
    if (!lista) return
    lista.innerHTML = '<p style="padding:8px;font-size:12px;color:var(--texto-fraco)">Carregando...</p>'
    try {
      const notifs = await listarNotificacoes(20)
      if (!notifs.length) {
        lista.innerHTML = '<p style="padding:8px;font-size:12px;color:var(--texto-fraco)">Sem notificacoes.</p>'
        return
      }
      lista.innerHTML = notifs.map((n) => {
        const acao = n.tipo === 'novo_usuario_pendente' ? 'Definir perfil de acesso' : 'Ver'
        return `
        <div style="padding:8px;border-bottom:1px solid var(--borda);${n.lida ? 'opacity:0.6' : ''}">
          <div style="display:flex;justify-content:space-between;gap:6px">
            <strong style="font-size:12px">${esc(n.titulo)}</strong>
            ${n.lida ? '' : '<span style="font-size:10px;color:var(--alerta)">nova</span>'}
          </div>
          <p style="font-size:12px;margin:2px 0;color:var(--texto-suave)">${esc(n.mensagem)}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;gap:6px;flex-wrap:wrap">
            <span style="font-size:10px;color:var(--texto-fraco)">${esc(n.tipo || '')} · ${new Date(n.criado_em).toLocaleString('pt-BR')}</span>
            <div style="display:flex;gap:4px">
              ${n.link ? `<button class="btn btn--ghost btn--sm" type="button" data-notif-link="${esc(n.link)}" data-notif-id="${esc(n.id)}" data-notif-alvo="${esc(n.actor_id || '')}">${acao}</button>` : ''}
              ${!n.lida ? `<button class="btn btn--ghost btn--sm" type="button" data-notif-lida="${esc(n.id)}">Marcar lida</button>` : ''}
            </div>
          </div>
        </div>
      `}).join('')
      renderIcons(lista)

      lista.querySelectorAll('[data-notif-lida]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await marcarLida(btn.dataset.notifLida)
          await carregarPainel()
          await atualizarBadge()
        })
      })
      lista.querySelectorAll('[data-notif-link]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await marcarLida(btn.dataset.notifId)
          painel.hidden = true
          window.__notifAlvo = btn.dataset.notifAlvo || null
          router?.navigate(btn.dataset.notifLink)
          await atualizarBadge()
        })
      })
    } catch (e) {
      lista.innerHTML = '<p style="padding:8px;font-size:12px;color:var(--texto-fraco)">Erro ao carregar.</p>'
    }
  }

  btnNotif?.addEventListener('click', async () => {
    if (!painel) return
    painel.hidden = !painel.hidden
    if (!painel.hidden) await carregarPainel()
  })

  raiz.querySelector('#notif-marcar-todas')?.addEventListener('click', async () => {
    await marcarTodasLidas()
    await carregarPainel()
    await atualizarBadge()
  })

  // fecha painel ao clicar fora
  document.addEventListener('click', (e) => {
    if (painel && !painel.hidden && !raiz.querySelector('#notif-wrap')?.contains(e.target)) {
      painel.hidden = true
    }
  })

  atualizarBadge()
  const intervalo = setInterval(atualizarBadge, 30000)

  limparShellApp = () => {
    clearInterval(intervalo)
    document.removeEventListener('keydown', aoTeclar)
    window.removeEventListener('logo-mudou', aoAtualizarEmpresa)
    window.removeEventListener('empresa-mudou', aoAtualizarEmpresa)
    window.removeEventListener('resize', aoRedimensionar)
  }
}

/* ==========================================================================
   Boot
   ========================================================================== */

async function iniciar() {
  initTheme()

  window.addEventListener(EVENTOS_DADOS.carregamentoFalhou, (evento) => {
    falhasCarregamento.add(evento.detail?.nome ?? 'consulta')
    pintarOrigemDados()
  })
  window.addEventListener(EVENTOS_DADOS.carregamentoConcluido, (evento) => {
    falhasCarregamento.delete(evento.detail?.nome ?? 'consulta')
    pintarOrigemDados()
  })

  if (authConfigurado()) {
    app.innerHTML = telaDeEspera()
    renderIcons(app)
    await lerSessao()
  } else {
    estadoSessao.carregando = false
  }

  router = createRouter({
    routes,
    raiz: app,
    shells,
    guarda,
    onRender({ rota, path, outlet, shell }) {
      const rotulo = rota.title ?? rota.label
      document.title = `${rotulo} - Prime Acai`

      if (shell === 'app') {
        const titulo = app.querySelector('#page-title')
        const subtitulo = app.querySelector('#page-subtitle')
        const titulos = app.querySelector('.topbar__titles')
        const buscaGlobal = app.querySelector('#busca-global')

        if (titulo) titulo.textContent = rotulo
        if (subtitulo) subtitulo.textContent = rota.subtitle ?? ''
        if (titulos) titulos.hidden = Boolean(rota.hideTopbarTitle)
        if (buscaGlobal) buscaGlobal.value = ''

        marcarMenuAtivo(path)
        fecharMenu()
        pintarUsuario()
      }

      renderIcons(outlet)
    },
  })

  window.addEventListener('sessao-mudou', sincronizar)

  window.addEventListener('permissoes-mudaram', () => router?.reconstruirMenu())

  observarAuth((evento) => {
    if (evento === 'INITIAL_SESSION' || evento === 'TOKEN_REFRESHED' || evento === 'PASSWORD_RECOVERY') {
      return
    }

    setTimeout(sincronizar, 0)
  })

  router.render()
}

iniciar()
