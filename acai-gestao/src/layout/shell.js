/**
 * Layout base: menu lateral fixo + barra superior.
 * Em telas pequenas (<= 1024px) o menu vira uma gaveta deslizante.
 *
 * `usuario` já chega pronto ({ nome, papel, iniciais }): o `main.js` é quem
 * conhece a sessão, e o layout não precisa saber de onde ela veio.
 */

import { esc } from '../ui.js'

export function renderShell(
  routes,
  usuario = { nome: 'Visitante', papel: '', iniciais: '?' },
  podeAcessar = () => true,
) {
  const itens = routes.filter((rota) => !rota.hidden && rota.group && (!rota.modulo || podeAcessar(rota.modulo)))
  const grupos = [...new Set(itens.map((rota) => rota.group))]

  const navegacao = grupos
    .map(
      (grupo) => `
        <p class="nav__label" id="nav-${slug(grupo)}">${grupo}</p>
        <ul class="nav__list" aria-labelledby="nav-${slug(grupo)}">
          ${itens.filter((rota) => rota.group === grupo).map(itemNav).join('')}
        </ul>
      `,
    )
    .join('')

  return `
    <div class="app">
      <button class="skip-link" type="button" data-skip>Ir para o conteúdo</button>

      <aside class="sidebar" id="sidebar" aria-label="Navegação principal">
        <div class="sidebar__brand">
          <span class="brand__mark" id="brand-mark">
            <i data-lucide="store"></i>
            <img class="brand__logo" id="brand-logo" alt="Logomarca da empresa" hidden />
          </span>
          <span class="brand__text">
            <strong id="brand-nome">Prime Açaí</strong>
            <small id="brand-sub">Gestão</small>
          </span>
          <button class="icon-btn sidebar__close" id="sidebar-close" type="button" aria-label="Fechar menu">
            <i data-lucide="x"></i>
          </button>
        </div>

        <nav class="nav">${navegacao}</nav>

        <div class="sidebar__footer">
          <div class="user">
            <span class="user__avatar" aria-hidden="true">${esc(usuario.iniciais)}</span>
            <span class="user__info">
              <strong title="${esc(usuario.nome)}">${esc(usuario.nome)}</strong>
              <small>${esc(usuario.papel)}</small>
            </span>
          </div>
          <div class="sidebar__actions">
            <button class="icon-btn" type="button" id="btn-config" aria-label="Configurações" title="Configurações"${podeAcessar('configuracoes') ? '' : ' hidden'}>
              <i data-lucide="settings"></i>
            </button>
            <button class="icon-btn" type="button" id="btn-sair" aria-label="Sair da conta" title="Sair">
              <i data-lucide="log-out"></i>
            </button>
          </div>
        </div>
      </aside>

      <div class="scrim" id="scrim" hidden></div>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn topbar__menu" id="sidebar-open" type="button" aria-label="Abrir ou fechar o menu">
            <i data-lucide="menu"></i>
          </button>

          <div class="topbar__titles">
            <h1 id="page-title">Dashboard</h1>
            <p id="page-subtitle">Visão geral do negócio</p>
          </div>

          <div class="topbar__actions">
            <span class="status-pill" id="status-dados" role="status" aria-live="polite">
              <span class="status-pill__dot" aria-hidden="true"></span>
              <span id="status-dados-texto">Verificando…</span>
            </span>

            <label class="search" for="busca-global">
              <i data-lucide="search"></i>
              <input
                id="busca-global"
                type="search"
                placeholder="Buscar na página atual..."
                autocomplete="off"
              />
            </label>

            <button class="icon-btn" id="theme-toggle" type="button" aria-label="Alternar tema">
              <i data-lucide="moon"></i>
            </button>

            <div style="position:relative" id="notif-wrap">
              <button class="icon-btn" type="button" id="btn-notif" aria-label="Notificações">
                <i data-lucide="bell"></i>
                <span id="notif-badge" style="position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--marca-dourado);color:var(--texto-contraste);font-size:10px;font-weight:700;line-height:16px;text-align:center;display:none">0</span>
              </button>
              <div id="notif-painel" hidden style="position:absolute;right:0;top:40px;width:min(320px,92vw);max-height:400px;overflow:auto;background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);box-shadow:var(--sombra);z-index:200;padding:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px">
                  <strong style="font-size:13px">Notificacoes</strong>
                  <button class="btn btn--ghost btn--sm" type="button" id="notif-marcar-todas">Marcar todas como lidas</button>
                </div>
                <div id="notif-lista"></div>
              </div>
            </div>
          </div>
        </header>

        <main class="view" id="view" tabindex="-1"></main>
      </div>
    </div>
  `
}

function itemNav(rota) {
  return `
    <li>
      <a class="nav__link" href="#${rota.path}" data-route="${rota.path}">
        <i data-lucide="${rota.icon}"></i>
        <span>${rota.label}</span>
      </a>
    </li>
  `
}

function slug(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
}