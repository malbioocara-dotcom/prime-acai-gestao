/**
 * Roteador mínimo baseado em hash (#/vendas, #/estoque...).
 *
 * Escolhemos hash em vez de History API de propósito: funciona em qualquer
 * hospedagem estática (Cloudflare Pages, GitHub Pages, Vercel) sem precisar de
 * configuração de rewrite no servidor.
 *
 * Cada rota aponta para uma página no formato:
 *   { html: string, mount?(root) -> cleanup? }
 *
 * O roteador conhece dois invólucros ("shells"):
 *
 *   app  — menu lateral + barra superior, o sistema em si;
 *   auth — tela cheia de login/cadastro, sem menu.
 *
 * O invólucro é escolhido por rota (`publica: true` → `auth`), e só é
 * reconstruído quando muda. Trocar de página dentro do mesmo invólucro mexe
 * apenas no miolo.
 *
 * `guarda(rota, path)` pode devolver outro caminho para onde ir — é assim que
 * quem não está logado vai parar no login. Ele é síncrono de propósito: quem
 * sabe se há sessão é o `main.js`, que carrega isso antes de criar o roteador.
 */
export function createRouter({ routes, raiz, shells, guarda, onRender }) {
  const fallback = routes.find((rota) => rota.path === '*')
  let desmontar = null
  let shellAtual = null

  function currentPath() {
    const bruto = window.location.hash.replace(/^#/, '')
    if (!bruto) return '/'
    return bruto.startsWith('/') ? bruto : `/${bruto}`
  }

  function match(path) {
    const caminho = String(path).split('?')[0]
    return routes.find((rota) => rota.path === caminho) ?? fallback
  }

  function navigate(path) {
    if (currentPath() === path) {
      render()
      return
    }
    window.location.hash = path
  }

  function render() {
    const path = currentPath()
    const rota = match(path)

    // O guarda pode mandar para outro caminho antes de qualquer desenho.
    if (typeof guarda === 'function') {
      const destino = guarda(rota, path)
      if (destino && destino !== path) {
        navigate(destino)
        return
      }
    }

    const tipo = rota.publica ? 'auth' : 'app'

    // Libera listeners e gráficos da página anterior antes de trocar o HTML.
    if (typeof desmontar === 'function') desmontar()
    desmontar = null

    if (shellAtual !== tipo) {
      if (typeof shells[shellAtual]?.aoDesmontar === 'function') shells[shellAtual].aoDesmontar(raiz)

      raiz.innerHTML = shells[tipo].html()
      shellAtual = tipo
      if (typeof shells[tipo].aoMontar === 'function') shells[tipo].aoMontar(raiz)
    }

    const outlet = raiz.querySelector(shells[tipo].outlet)
    const pagina = rota.page({ path, rota })

    outlet.innerHTML = pagina.html

    if (typeof pagina.mount === 'function') {
      desmontar = pagina.mount(outlet) ?? null
    }

    if (typeof onRender === 'function') onRender({ rota, path, outlet, shell: tipo })
  }

  window.addEventListener('hashchange', render)

  /**
   * Reconstrói o invólucro (menu lateral) na próxima renderização.
   *
   * O menu é montado uma vez e só muda junto com o invólucro. Quando as
   * permissões mudam (um admin concedeu/negou acesso), é preciso refazê-lo —
   * senão a pessoa continua vendo itens que já não pode abrir.
   */
  function reconstruirMenu() {
    shellAtual = null
    render()
  }

  return { render, navigate, currentPath, match, reconstruirMenu }
}
