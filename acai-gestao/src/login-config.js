/**
 * Configuração das telas de autenticação para a Prime Açaí.
 *
 * O login, o cadastro e a recuperação de senha vêm do pacote `Login_projetos`
 * (dependência local `file:../Login_projetos`), compartilhado com outros
 * projetos. Aqui ficam só as escolhas deste app: marca, rotas e textos.
 *
 * Fica num arquivo separado do `main.js` de propósito — assim o teste
 * `tests/login-pacote.test.js` verifica exatamente a configuração que roda em
 * produção, e não uma cópia que poderia divergir.
 */
export const loginProjetosConfig = {
  marca: {
    nome: 'Prime Açaí',
    assinatura: 'Gestão',
    icone: 'store',
    chamada: 'A gestão da sua açaiteria em um só lugar.',
    descricao: 'Vendas, estoque, clientes e caixa — com os números do dia sempre à mão.',
    pontos: [
      'Pedidos e status em tempo real',
      'Estoque com ponto de reposição',
      'Caixa e margem do mês',
    ],
  },

  rotas: {
    login: '/login',
    cadastro: '/cadastro',
    recuperar: '/recuperar-senha',
    redefinir: '/redefinir-senha',
    depoisDoLogin: '/',
    depoisDoLogout: '/login',
  },

  funcionalidades: {
    login: true,
    cadastro: true,
    recuperacaoSenha: true,
    redefinicaoSenha: true,
  },

  provedor: {
    nome: 'neon',
  },

  textos: {
    // O padrão do pacote é "em {marca}"; aqui mantemos o texto original do app.
    loginDica: 'Use o e-mail cadastrado na Prime Açaí.',
  },

  // Nova conta entra imediatamente sem etapa de aprovação manual.
  aprovacaoManual: false,
}
