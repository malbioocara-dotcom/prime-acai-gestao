/**
 * Tela de nova senha — a última etapa do "Esqueci minha senha".
 *
 * Ela só funciona com o token que vem no link enviado por e-mail. Sem o token,
 * o formulário nem aparece: pedir senha nova sem ele seria uma porta aberta.
 *
 * No Managed Better Auth não existe "sessão de recuperação" (como no Supabase):
 * a troca da senha é feita por `resetPassword({ newPassword, token })`.
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
  regrasSenha,
} from '../auth-ui.js'
import { config, funcionalidadeAuthHabilitada, texto } from '../config.js'
import { renderIcons } from '../lib/icons.js'
import { checarSenha, definirNovaSenha, mensagemDeErro, senhaForte, tokenDeRecuperacao } from '../services/auth.js'

export function redefinirSenhaPage() {
  if (!funcionalidadeAuthHabilitada('redefinicaoSenha')) {
    return {
      html: layoutAuth({
        titulo: 'Redefinição indisponível',
        subtitulo: 'A redefinição de senha está desativada neste aplicativo.',
        conteudo: `<a class="btn-auth" href="#${config.rotas.login}" style="text-decoration: none">Voltar para o login</a>`,
      }),
    }
  }

  return {
    html: layoutAuth({
      titulo: texto('redefinirTitulo'),
      subtitulo: texto('redefinirDica'),
      conteudo: `
        ${alertaAuth('redefinir-alerta')}

        <form class="auth__form" id="form-redefinir" novalidate>
          ${campoAuth({
            nome: 'senha',
            label: 'Nova senha',
            tipo: 'password',
            icone: 'lock',
            placeholder: 'Nova senha',
            autocomplete: 'new-password',
            olho: true,
            extra: regrasSenha(checarSenha('')),
          })}

          ${campoAuth({
            nome: 'confirmacao',
            label: 'Confirmar nova senha',
            tipo: 'password',
            icone: 'lock',
            placeholder: 'Repita a nova senha',
            autocomplete: 'new-password',
            olho: true,
          })}

          <button class="btn-auth" type="submit" id="btn-redefinir" disabled>
            <span class="btn-auth__girando" aria-hidden="true"></span>
            <span>Salvar nova senha</span>
          </button>
        </form>
      `,
      rodape: `
        <div class="auth__rodape-linha">
          <a class="auth__voltar" href="#${config.rotas.login}"><i data-lucide="arrow-left"></i> Voltar para o login</a>
        </div>
      `,
    }),

    async mount(root) {
      ligarOlhos(root)

      const form = root.querySelector('#form-redefinir')
      const botao = root.querySelector('#btn-redefinir')
      // Campos lidos por `form.elements.x`: o atalho `form.x` funciona no
      // navegador, mas não existe no jsdom — e sem ele nada disso seria testável.
      const listaRegras = root.querySelector('#senha-regras')
      let enviando = false

      form.elements.senha.addEventListener('input', () => {
        checarSenha(form.elements.senha.value).forEach((regra, i) => {
          listaRegras.querySelector(`[data-regra="${i}"]`)?.classList.toggle('is-ok', regra.ok)
        })
      })

      // O token vem na própria URL do link do e-mail.
      const token = tokenDeRecuperacao()

      if (!token) {
        mostrarLinkInvalido(root)
        return
      }

      botao.disabled = false

      form.addEventListener('submit', async (evento) => {
        evento.preventDefault()
        if (enviando) return

        limparErros(root)
        esconderAlerta(root, 'redefinir-alerta')

        const senha = form.elements.senha.value
        const confirmacao = form.elements.confirmacao.value

        let valido = true

        if (!senha) {
          marcarErro(root, 'senha', 'Informe a nova senha.')
          valido = false
        } else if (!senhaForte(senha)) {
          const faltando = checarSenha(senha)
            .filter((regra) => !regra.ok)
            .map((regra) => regra.texto.toLowerCase())
            .join(', ')
          marcarErro(root, 'senha', `A senha ainda precisa de: ${faltando}.`)
          valido = false
        }

        if (!confirmacao) {
          marcarErro(root, 'confirmacao', 'Repita a nova senha.')
          valido = false
        } else if (senha && confirmacao !== senha) {
          marcarErro(root, 'confirmacao', 'As senhas não são iguais.')
          valido = false
        }

        if (!valido) {
          focarPrimeiroErro(root)
          return
        }

        enviando = true
        definirCarregando(botao, true, 'Salvando…')

        try {
          await definirNovaSenha(senha, token)

          // A senha mudou. Como a troca por token não deixa sessão aberta,
          // mandamos a pessoa para o login para entrar com a senha nova.
          window.location.hash = config.rotas.login
        } catch (erro) {
          mostrarAlerta(root, 'redefinir-alerta', 'erro', mensagemDeErro(erro))
          definirCarregando(botao, false, 'Salvar nova senha')
          enviando = false
        }
      })
    },
  }
}

/** Troca a caixa do formulário pelo aviso de link vencido. */
function mostrarLinkInvalido(root) {
  const caixa = root.querySelector('.auth__caixa')
  if (!caixa) return

  caixa.innerHTML = `
    <header class="auth__cabecalho">
      <h1>Link inválido ou expirado</h1>
      <p>Este link de recuperação já foi usado ou passou do prazo. Peça um novo para continuar.</p>
    </header>

    ${alertaAuth('redefinir-alerta')}

    <a class="btn-auth" href="#${config.rotas.recuperar}" style="text-decoration: none">Pedir novo link</a>

    <div class="auth__rodape">
      <div class="auth__rodape-linha">
        <a class="auth__voltar" href="#${config.rotas.login}"><i data-lucide="arrow-left"></i> Voltar para o login</a>
      </div>
    </div>
  `

  renderIcons(caixa)
  mostrarAlerta(
    root,
    'redefinir-alerta',
    'info',
    'Abra o link mais recente que enviamos por e-mail, ou peça outro.',
  )
}
