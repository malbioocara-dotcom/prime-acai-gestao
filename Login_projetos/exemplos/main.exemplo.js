/**
 * ============================================================================
 * Exemplo de integração — host mínimo (Vite + JavaScript puro, rota por hash)
 * ============================================================================
 *
 * Este arquivo NÃO é importado por nada: é um ponto de partida. Copie o
 * conteúdo para o `main.js` do seu projeto e ajuste o que precisar.
 *
 * Ele mostra:
 *   1. como configurar o módulo no boot;
 *   2. como ler a sessão e proteger as rotas (o "guarda" do roteador);
 *   3. como montar as telas de login/cadastro/recuperação/redefinição.
 *
 * Detalhes passo a passo: docs/INTEGRACAO.md
 */

// Quando o módulo está dentro do próprio projeto, o caminho é relativo:
//   import 'login-projetos/estilo.css'
//   import { ... } from 'login-projetos'
// Se você instalou como dependência local (`npm i ../Login_projetos`), os
// caminhos acima funcionam como estão.
import 'login-projetos/estilo.css'

import {
  avisarSessao,
  carregarFonteAuth,
  config,
  configurarLogin,
  ehRotaAuth,
  estadoSessao,
  iniciais,
  observarAuth,
  renderIcons,
  sair,
  sessaoAtual,
  telaDeEspera,
  telasAuth,
} from 'login-projetos'

/* ============================================================================
 * 1. Configuração — uma vez, antes de renderizar qualquer tela
 * ========================================================================== */

configurarLogin({
  marca: {
    nome: 'Doce Vida',
    assinatura: 'Gestão',
    icone: 'ice-cream-cone',
    chamada: 'A gestão da sua loja em um só lugar.',
    descricao: 'Pedidos, estoque e caixa com os números do dia sempre à mão.',
    pontos: ['Pedidos e status em tempo real', 'Estoque com ponto de reposição'],
  },
  rotas: {
    login: '/entrar',
    cadastro: '/criar-conta',
    recuperar: '/esqueci-minha-senha',
    redefinir: '/nova-senha',
    depoisDoLogin: '/',
  },
  aprovacaoManual: true, // cadastro entra pendente e depende de aprovação
  papeis: { admin: 'Dono', manager: 'Gerente', cashier: 'Atendente' },
  senhaMinima: 8,
})

/* ============================================================================
 * 2. Suas telas (o que o login protege)
 * ========================================================================== */

const app = document.querySelector('#app')

const paginaInicio = () => ({
  html: `
    <header style="display:flex;justify-content:space-between;align-items:center;padding:16px">
      <strong>${config.marca.nome}</strong>
      <span>
        ${iniciais(estadoSessao.perfil?.nome)}
        — ${estadoSessao.perfil?.papelRotulo ?? ''}
        <button id="btn-sair" type="button">Sair</button>
      </span>
    </header>
    <main style="padding:16px">
      <h1>Início</h1>
      <p>Conteúdo protegido por login. A autorização de verdade vive no RLS do banco.</p>
    </main>
  `,
  mount() {
    app.querySelector('#btn-sair')?.addEventListener('click', async () => {
      await sair()
      avisarSessao()
    })
  },
})

const paginaNaoEncontrada = () => ({
  html: '<main style="padding:16px"><h1>404</h1></main>',
  mount() {},
})

/** Todas as rotas do app: as suas + as quatro telas do módulo. */
const rotas = {
  ...telasAuth(), // /entrar, /criar-conta, /esqueci-minha-senha, /nova-senha
  '/': paginaInicio,
}

/* ============================================================================
 * 3. Roteador por hash + guarda de sessão
 * ========================================================================== */

const irPara = (rota) => {
  const destino = `#${rota}`
  if (window.location.hash === destino) desenhar()
  else window.location.hash = destino
}

const rotaAtual = () => {
  const bruto = window.location.hash.replace(/^#/, '') || '/'
  return (bruto.startsWith('/') ? bruto : `/${bruto}`).split('?')[0]
}

/**
 * Relê a sessão no serviço e decide quem entra.
 *
 * Chamado no boot, sempre que `sessao-mudou` for disparado (login/cadastro) e
 * quando a aba volta a ficar visível.
 */
async function atualizarSessao() {
  estadoSessao.carregando = true

  try {
    const sessao = await sessaoAtual()
    estadoSessao.usuario = sessao?.usuario ?? null
    estadoSessao.perfil = sessao?.perfil ?? null

    // Sessão aberta mas conta não aprovada/ativa: encerra e explica no login.
    if (estadoSessao.usuario && estadoSessao.perfil && !estadoSessao.perfil.ativo) {
      await sair().catch(() => {})
      estadoSessao.usuario = null
      estadoSessao.perfil = null
      estadoSessao.aviso =
        'A sua conta ainda não foi aprovada. Fale com um administrador.'
      window.location.hash = config.rotas.login
    }
  } catch (erro) {
    console.error('[boot] falha ao ler a sessão', erro)
    estadoSessao.usuario = null
    estadoSessao.perfil = null
  } finally {
    estadoSessao.carregando = false
  }

  desenhar()
}

/** Desenha a rota atual, aplicando o guarda. */
function desenhar() {
  if (estadoSessao.carregando) {
    app.innerHTML = telaDeEspera()
    return
  }

  const rota = rotaAtual()
  const logadoAgora = Boolean(estadoSessao.usuario && estadoSessao.perfil?.ativo)

  if (logadoAgora && ehRotaAuth(rota)) {
    // Já logado não precisa ver login/cadastro.
    return irPara(config.rotas.depoisDoLogin)
  }

  if (!logadoAgora && !ehRotaAuth(rota)) {
    // Deslogado só acessa as telas de autenticação.
    return irPara(config.rotas.login)
  }

  const fabrica = rotas[rota] ?? paginaNaoEncontrada
  const pagina = fabrica()

  app.innerHTML = pagina.html
  renderIcons(app)
  pagina.mount?.(app)

  if (ehRotaAuth(rota)) carregarFonteAuth()
}

/* ============================================================================
 * 4. Boot
 * ========================================================================== */

window.addEventListener('hashchange', desenhar)
window.addEventListener('sessao-mudou', atualizarSessao)
observarAuth(() => avisarSessao()) // mudou em outra aba / token expirou

atualizarSessao()
