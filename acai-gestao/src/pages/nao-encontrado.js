/** Tela exibida quando a rota do hash não corresponde a nenhuma página. */
export function naoEncontradoPage() {
  return {
    html: `
      <section class="vazio">
        <span class="vazio__icon"><i data-lucide="search"></i></span>
        <h2>Página não encontrada</h2>
        <p>O endereço acessado não existe neste aplicativo.</p>
        <a class="btn btn--primary" href="#/">
          <i data-lucide="layout-dashboard"></i><span>Voltar para o Dashboard</span>
        </a>
      </section>
    `,
  }
}
