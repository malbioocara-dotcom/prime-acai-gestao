/**
 * "Esqueci minha senha".
 *
 * Só pede o e-mail e dispara o link de recuperação. A resposta na tela é sempre
 * a mesma, exista ou não a conta: dizer "e-mail não encontrado" entregaria a
 * lista de quem tem acesso ao sistema.
 */

import {
  alertaAuth,
  campoAuth,
  definirCarregando,
  esconderAlerta,
  focarPrimeiroErro,
  layoutAuth,
  limparErros,
  marcarErro,
  mostrarAlerta,
} from '../auth-ui.js'
import { config, funcionalidadeAuthHabilitada, texto } from '../config.js'
import { emailValido, enviarLinkDeRecuperacao, mensagemDeErro } from '../services/auth.js'

export function recuperarSenhaPage() {
  if (!funcionalidadeAuthHabilitada('recuperacaoSenha')) {
    return {
      html: layoutAuth({
        titulo: 'Recuperação indisponível',
        subtitulo: 'A recuperação de senha está desativada neste aplicativo.',
        conteudo: `<a class="btn-auth" href="#${config.rotas.login}" style="text-decoration: none">Voltar para o login</a>`,
      }),
    }
  }

  return {
    html: layoutAuth({
      titulo: texto('recuperarTitulo'),
      subtitulo: texto('recuperarDica'),
      conteudo: `
        ${alertaAuth('recuperar-alerta')}

        <form class="auth__form" id="form-recuperar" novalidate>
          ${campoAuth({
            nome: 'email',
            label: 'E-mail',
            tipo: 'email',
            icone: 'mail',
            placeholder: 'voce@exemplo.com',
            autocomplete: 'email',
          })}

          <button class="btn-auth" type="submit" id="btn-recuperar">
            <span class="btn-auth__girando" aria-hidden="true"></span>
            <span>Enviar link de recuperação</span>
          </button>
        </form>
      `,
      rodape: `
        <div class="auth__rodape-linha">
          <a class="auth__voltar" href="#${config.rotas.login}"><i data-lucide="arrow-left"></i> Voltar para o login</a>
        </div>
      `,
    }),

    mount(root) {
      const form = root.querySelector('#form-recuperar')
      const botao = root.querySelector('#btn-recuperar')
      // Campos lidos por `form.elements.x`: o atalho `form.x` funciona no
      // navegador, mas não existe no jsdom — e sem ele nada disso seria testável.
      let enviando = false

      form.addEventListener('submit', async (evento) => {
        evento.preventDefault()
        if (enviando) return

        limparErros(root)
        esconderAlerta(root, 'recuperar-alerta')

        const email = form.elements.email.value.trim()

        if (!email) {
          marcarErro(root, 'email', 'Informe o seu e-mail.')
          focarPrimeiroErro(root)
          return
        }

        if (!emailValido(email)) {
          marcarErro(root, 'email', 'E-mail inválido.')
          focarPrimeiroErro(root)
          return
        }

        enviando = true
        definirCarregando(botao, true, 'Enviando…')

        try {
          await enviarLinkDeRecuperacao(email)

          mostrarAlerta(
            root,
            'recuperar-alerta',
            'ok',
            'Se este e-mail tiver uma conta, o link de recuperação já está a caminho. Confira também a caixa de spam.',
          )
          form.reset()
        } catch (erro) {
          mostrarAlerta(root, 'recuperar-alerta', 'erro', mensagemDeErro(erro))
        } finally {
          definirCarregando(botao, false, 'Enviar link de recuperação')
          enviando = false
        }
      })
    },
  }
}
