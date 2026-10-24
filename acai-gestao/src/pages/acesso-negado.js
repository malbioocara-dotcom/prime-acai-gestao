/**
 * Tela de acesso negado.
 *
 * Aparece quando alguém tenta abrir (pelo menu ou digitando o endereço) um
 * módulo para o qual não tem a permissão `modulo.ver`.
 *
 * Importante: isto é só a parte visível. O bloqueio de verdade acontece no
 * banco — as políticas de RLS e a função `public.pode()` é que impedem a
 * leitura e a escrita. Sem isso, bastaria trocar o hash na barra de endereço.
 */

import { esc } from '../ui.js'
import { estadoSessao } from 'login-projetos/sessao'
import { MODULOS, perfilRotulo } from '../services/permissoes.js'

export function acessoNegadoPage() {
  return {
    html: `
      <section class="vazio vazio--permissao">
        <span class="vazio__icon"><i data-lucide="shield-off"></i></span>
        <h2>Acesso negado</h2>
        <p id="acesso-negado-texto">
          Você não tem permissão para abrir este módulo.
        </p>
        <p class="vazio__dica" id="acesso-negado-dica"></p>
        <div class="vazio__acoes">
          <a class="btn btn--primary" href="#/">
            <i data-lucide="layout-dashboard"></i><span>Voltar para o Dashboard</span>
          </a>
        </div>
      </section>
    `,
    mount(root) {
      const texto = root.querySelector('#acesso-negado-texto')
      const dica = root.querySelector('#acesso-negado-dica')

      // Tenta dizer qual módulo foi negado, lendo o hash que a pessoa tentou.
      const tentativa = window.location.hash.replace(/^#\//, '').replace(/^\//, '')
      const modulo = Object.keys(MODULOS).find((chave) => chave === tentativa)
      const rotulo = modulo ? MODULOS[modulo] : null

      if (texto) {
        texto.textContent = rotulo
          ? `Você não tem permissão para abrir "${rotulo}".`
          : 'Você não tem permissão para abrir este módulo.'
      }

      const papel = estadoSessao.perfil ? perfilRotulo(estadoSessao.perfil.papel) : ''
      if (dica) {
        dica.textContent = papel
          ? `Sua conta é "${papel}". Se precisa deste acesso, fale com um administrador.`
          : 'Se precisa deste acesso, fale com um administrador.'
      }
    },
  }
}
