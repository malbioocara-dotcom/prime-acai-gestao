/**
 * Tela de cadastro.
 *
 * O formulário manda **só nome, e-mail e senha**. Papel e organização são
 * decididos no banco, pela função `garantir_perfil()` — é por isso que este
 * arquivo não tem (e não pode ter) nenhum campo de "perfil de acesso".
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
import {
  checarSenha,
  criarConta,
  emailValido,
  garantirPerfil,
  mensagemDeErro,
  rotuloPapel,
  sair,
  senhaForte,
} from '../services/auth.js'
import { avisarSessao } from '../sessao.js'
import { esc } from '../ui.js'

export function cadastroPage() {
  // Com o cadastro público desligado a tela nem aparece (o roteador manda de
  // volta para o login); a checagem aqui é a segunda tranca.
  if (!funcionalidadeAuthHabilitada('cadastro')) {
    return {
      html: layoutAuth({
        titulo: 'Cadastro indisponível',
        subtitulo: 'As contas são criadas por um administrador.',
        conteudo: `
          ${alertaAuth('cadastro-alerta')}
          <a class="btn-auth" href="#${config.rotas.login}" style="text-decoration: none">Voltar para o login</a>
        `,
        rodape: '<p>Peça o seu acesso ao responsável pelo sistema.</p>',
      }),
      mount(root) {
        mostrarAlerta(
          root,
          'cadastro-alerta',
          'info',
          'O cadastro pelo app está desativado. Peça a um administrador para criar a sua conta.',
        )
      },
    }
  }

  return {
    html: layoutAuth({
      titulo: texto('cadastroTitulo'),
      subtitulo: texto('cadastroDica'),
      conteudo: `
        ${alertaAuth('cadastro-alerta')}

        <form class="auth__form" id="form-cadastro" novalidate>
          ${campoAuth({
            nome: 'nome',
            label: 'Nome completo',
            icone: 'user',
            placeholder: 'Maria Souza',
            autocomplete: 'name',
          })}

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
            placeholder: 'Crie uma senha',
            autocomplete: 'new-password',
            olho: true,
            extra: regrasSenha(checarSenha('')),
          })}

          ${campoAuth({
            nome: 'confirmacao',
            label: 'Confirmar senha',
            tipo: 'password',
            icone: 'lock',
            placeholder: 'Repita a senha',
            autocomplete: 'new-password',
            olho: true,
          })}

          <button class="btn-auth" type="submit" id="btn-cadastro">
            <span class="btn-auth__girando" aria-hidden="true"></span>
            <span>Cadastrar usuário</span>
          </button>
        </form>
      `,
      rodape: `
        <div class="auth__rodape-linha">
          <a href="#${config.rotas.login}">Já tenho conta</a>
        </div>
        <p>${destaquePapel(texto('cadastroRodape'))}</p>
      `,
    }),

    mount(root) {
      ligarOlhos(root)

      const form = root.querySelector('#form-cadastro')
      const botao = root.querySelector('#btn-cadastro')
      // Campos lidos por `form.elements.x`: o atalho `form.x` funciona no
      // navegador, mas não existe no jsdom — e sem ele nada disso seria testável.
      const listaRegras = root.querySelector('#senha-regras')
      let enviando = false

      // Checklist de senha forte: atualiza a cada tecla, sem esperar o envio.
      form.elements.senha.addEventListener('input', () => {
        checarSenha(form.elements.senha.value).forEach((regra, i) => {
          listaRegras.querySelector(`[data-regra="${i}"]`)?.classList.toggle('is-ok', regra.ok)
        })
      })

      form.addEventListener('submit', async (evento) => {
        evento.preventDefault()
        if (enviando) return

        limparErros(root)
        esconderAlerta(root, 'cadastro-alerta')

        const nome = form.elements.nome.value.trim()
        const email = form.elements.email.value.trim()
        const senha = form.elements.senha.value
        const confirmacao = form.elements.confirmacao.value

        let valido = true

        if (!nome) {
          marcarErro(root, 'nome', 'Informe o seu nome completo.')
          valido = false
        } else if (nome.length < 3) {
          marcarErro(root, 'nome', 'O nome precisa ter pelo menos 3 caracteres.')
          valido = false
        }

        if (!email) {
          marcarErro(root, 'email', 'Informe o seu e-mail.')
          valido = false
        } else if (!emailValido(email)) {
          marcarErro(root, 'email', 'E-mail inválido.')
          valido = false
        }

        if (!senha) {
          marcarErro(root, 'senha', 'Crie uma senha.')
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
          marcarErro(root, 'confirmacao', 'Repita a senha.')
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
        definirCarregando(botao, true, 'Cadastrando…')

        try {
          const { precisaConfirmarEmail } = await criarConta({ nome, email, senha })

          if (precisaConfirmarEmail) {
            // A conta existe, mas o serviço exige o clique no link antes do
            // primeiro login. Dizemos isso sem confirmar nem negar se o e-mail
            // já tinha conta — a resposta é a mesma nos dois casos.
            mostrarAlerta(
              root,
              'cadastro-alerta',
              'ok',
              'Conta criada! Enviamos um link de confirmação para o seu e-mail — abra-o para ativar o acesso.',
            )
            form.reset()
            listaRegras.querySelectorAll('[data-regra]').forEach((li) => li.classList.remove('is-ok'))
            definirCarregando(botao, false, 'Cadastrar usuário')
            enviando = false
            return
          }

          // Cria o perfil (possivelmente pendente) antes de encerrar a sessão,
          // para a conta já aparecer na lista do administrador.
          try {
            await garantirPerfil()
          } catch (erroPerfil) {
            console.error('[cadastro] Não foi possível criar o perfil da conta.', erroPerfil)
            mostrarAlerta(
              root,
              'cadastro-alerta',
              'erro',
              'A conta foi criada, mas não foi possível concluir a configuração do acesso. Tente entrar novamente ou fale com um administrador.',
            )
            definirCarregando(botao, false, 'Cadastrar usuário')
            enviando = false
            return
          }

          try {
            await sair()
          } catch (erroLogout) {
            console.error('[cadastro] Não foi possível encerrar a sessão após o cadastro.', erroLogout)
            mostrarAlerta(
              root,
              'cadastro-alerta',
              'erro',
              'A conta foi criada, mas não foi possível encerrar a sessão automaticamente. Saia e entre novamente para continuar.',
            )
            definirCarregando(botao, false, 'Cadastrar usuário')
            enviando = false
            return
          }

          mostrarAlerta(root, 'cadastro-alerta', 'ok', mensagemDeSucesso())

          setTimeout(() => {
            window.location.hash = config.rotas.login
          }, config.redirecionarAposCadastroMs)
        } catch (erro) {
          mostrarAlerta(root, 'cadastro-alerta', 'erro', mensagemDeErro(erro))
          definirCarregando(botao, false, 'Cadastrar usuário')
          enviando = false
        }
      })
    },
  }
}

/** Mensagem depois do cadastro, conforme o fluxo de aprovação configurado. */
function mensagemDeSucesso() {
  return config.aprovacaoManual
    ? 'Conta criada! Aguarde a aprovação do administrador para acessar o sistema.'
    : 'Conta criada! Você já pode entrar com o seu e-mail e senha.'
}

/**
 * O rodapé do cadastro destaca o papel em `<strong>`. O texto é interpolado da
 * configuração, então escapamos tudo e realçamos apenas o rótulo do papel.
 */
function destaquePapel(textoFinal) {
  const papel = rotuloPapel('cashier')
  const [antes, depois] = String(textoFinal).split(papel)

  if (depois === undefined) return esc(textoFinal)

  return `${esc(antes)}<strong>${esc(papel)}</strong>${esc(depois)}`
}
