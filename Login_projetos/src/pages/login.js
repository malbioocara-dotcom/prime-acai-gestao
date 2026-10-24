/**
 * Tela de login.
 *
 * O envio chama `entrar()` e para por aí: quem confere o perfil e decide para
 * onde ir é o host, ouvindo a mudança de sessão (`avisarSessao`). Assim existe
 * um só lugar responsável por "quem está logado".
 */

import {
  alertaAuth,
  campoAuth,
  definirCarregando,
  esconderAlerta,
  focarPrimeiroErro,
  layoutAuth,
  ligarOlhos,
  limparErros,
  marcarErro,
  mostrarAlerta,
} from '../auth-ui.js'
import { config, funcionalidadeAuthHabilitada, texto } from '../config.js'
import { emailValido, entrar, mensagemDeErro } from '../services/auth.js'
import { avisarSessao, estadoSessao } from '../sessao.js'

export function loginPage() {
  const cadastroPublico = funcionalidadeAuthHabilitada('cadastro')
  const recuperacaoHabilitada = funcionalidadeAuthHabilitada('recuperacaoSenha')

  return {
    html: layoutAuth({
      titulo: texto('loginTitulo'),
      subtitulo: texto('loginDica'),
      conteudo: `
        ${alertaAuth('login-alerta')}

        <form class="auth__form" id="form-login" novalidate>
          ${campoAuth({
            nome: 'email',
            label: 'E-mail',
            tipo: 'email',
            icone: 'mail',
            placeholder: 'voce@exemplo.com',
            autocomplete: 'email',
          })}

          ${campoAuth({
            nome: 'senha',
            label: 'Senha',
            tipo: 'password',
            icone: 'lock',
            placeholder: 'Sua senha',
            autocomplete: 'current-password',
            olho: true,
          })}

          <button class="btn-auth" type="submit" id="btn-login">
            <span class="btn-auth__girando" aria-hidden="true"></span>
            <span>Entrar</span>
          </button>
        </form>
      `,
      rodape: `
        <div class="auth__rodape-linha">
          ${recuperacaoHabilitada ? `<a href="#${config.rotas.recuperar}">Esqueci minha senha</a>` : ''}
          ${cadastroPublico ? `<a href="#${config.rotas.cadastro}">Criar conta</a>` : ''}
        </div>
        ${
          cadastroPublico
            ? ''
            : '<p>O cadastro pelo app está desativado. Peça o seu acesso a um administrador.</p>'
        }
      `,
    }),

    mount(root) {
      ligarOlhos(root)

      const form = root.querySelector('#form-login')
      const botao = root.querySelector('#btn-login')
      // Campos lidos por `form.elements.x`: o atalho `form.x` funciona no
      // navegador, mas não existe no jsdom — e sem ele nada disso seria testável.
      let enviando = false

      // Recado deixado pelo host (ex.: conta desativada).
      if (estadoSessao.aviso) {
        mostrarAlerta(root, 'login-alerta', 'erro', estadoSessao.aviso)
        estadoSessao.aviso = null
      }

      form.addEventListener('submit', async (evento) => {
        evento.preventDefault()
        if (enviando) return

        limparErros(root)
        esconderAlerta(root, 'login-alerta')

        const email = form.elements.email.value.trim()
        const senha = form.elements.senha.value

        let valido = true

        if (!email) {
          marcarErro(root, 'email', 'Informe o seu e-mail.')
          valido = false
        } else if (!emailValido(email)) {
          marcarErro(root, 'email', 'E-mail inválido.')
          valido = false
        }

        if (!senha) {
          marcarErro(root, 'senha', 'Informe a sua senha.')
          valido = false
        }

        if (!valido) {
          focarPrimeiroErro(root)
          return
        }

        enviando = true
        definirCarregando(botao, true, 'Entrando…')

        try {
          await entrar({ email, senha })
          // A partir daqui quem manda é o host: ele relê a sessão, confere o
          // perfil e redesenha. Se a conta estiver inativa, ele desloga e
          // devolve o recado para cá.
          avisarSessao()
        } catch (erro) {
          mostrarAlerta(root, 'login-alerta', 'erro', mensagemDeErro(erro))
          definirCarregando(botao, false, 'Entrar')
          enviando = false
        }
      })
    },
  }
}
