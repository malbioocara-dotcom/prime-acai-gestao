/**
 * Utilitários mínimos de HTML usados pelas telas de login.
 *
 * É uma versão enxuta do `ui.js` de um app completo: aqui só entra `esc`, para
 * que o módulo não arraste dependências de negócio.
 */

/** Escapa texto que vem de dados antes de entrar no HTML. */
export function esc(valor) {
  return String(valor).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
}
