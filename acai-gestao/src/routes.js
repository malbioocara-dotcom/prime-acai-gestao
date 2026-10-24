import { acessoNegadoPage } from './pages/acesso-negado.js'
import { cadastroPage } from 'login-projetos/pages/cadastro'
import { loginProjetosConfig } from './login-config.js'
import { clientesPage } from './pages/clientes.js'
import { configuracoesPage } from './pages/configuracoes.js'
import { dashboardPage } from './pages/dashboard.js'
import { estoquePage } from './pages/estoque.js'
import { financeiroPage } from './pages/financeiro.js'
import { loginPage } from 'login-projetos/pages/login'
import { naoEncontradoPage } from './pages/nao-encontrado.js'
import { comprasPage, fornecedoresPage } from './pages/compras.js'
import { produtosPage } from './pages/produtos.js'
import { recuperarSenhaPage } from 'login-projetos/pages/recuperar-senha'
import { redefinirSenhaPage } from 'login-projetos/pages/redefinir-senha'
import { vendasPage } from './pages/vendas.js'

/**
 * Registro de rotas do app.
 *
 * - `group` define em qual seção do menu lateral a rota aparece.
 * - `icon` é o nome do ícone do Lucide (atributo data-lucide).
 * - `hidden` esconde a rota do menu (usada pela rota curinga e pelas de login).
 * - `publica` marca as rotas que ficam FORA do app (login, cadastro,
 *   recuperação de senha) e são desenhadas sem menu lateral.
 * - `modulo` é a `module_key` usada pelo serviço de permissões
 *   (`src/services/permissoes.js`). O menu só mostra a rota se o usuário tiver a
 *   permissão `modulo.ver`, e o guarda do roteador barra o acesso direto.
 *
 * Quem não é `publica` exige sessão ativa: o `main.js` passa essa lista pelo
 * guarda do roteador, que redireciona para `#/login` quando não há ninguém
 * logado. É conforto, não segurança — o que impede o acesso aos dados é o RLS
 * em `neon/00_banco_neon.sql`.
 */
export const routes = [
  {
    path: '/',
    label: 'Dashboard',
    title: 'Dashboard',
    subtitle: 'Visão geral do negócio',
    icon: 'layout-dashboard',
    group: 'Visão geral',
    modulo: 'dashboard',
    page: dashboardPage,
  },
  {
    path: '/vendas',
    label: 'Vendas',
    title: 'Vendas',
    subtitle: 'Pedidos do dia e histórico de vendas',
    icon: 'shopping-cart',
    group: 'Operação',
    modulo: 'vendas',
    page: vendasPage,
  },
  {
    path: '/estoque',
    label: 'Estoque',
    title: 'Estoque',
    subtitle: 'Produtos, insumos e ponto de reposição',
    icon: 'package',
    group: 'Operação',
    modulo: 'estoque',
    page: estoquePage,
  },
  {
    path: '/compras',
    label: 'Compras',
    title: 'Compras',
    subtitle: 'Fornecedores, compras, recebimento e custo médio',
    hideTopbarTitle: true,
    icon: 'truck',
    group: 'Operação',
    modulo: 'compras',
    page: comprasPage,
  },
  {
    path: '/clientes',
    label: 'Clientes',
    title: 'Clientes',
    subtitle: 'Cadastro e histórico de compras',
    icon: 'users',
    group: 'Cadastros',
    modulo: 'clientes',
    page: clientesPage,
  },
  {
    path: '/fornecedores',
    label: 'Fornecedores',
    title: 'Fornecedores',
    subtitle: 'Cadastro e contatos dos fornecedores',
    icon: 'truck',
    group: 'Cadastros',
    modulo: 'compras',
    page: fornecedoresPage,
  },
  {
    path: '/produtos',
    label: 'Produtos',
    title: 'Produtos',
    subtitle: 'Catálogo, preços e imagens dos produtos',
    icon: 'package',
    group: 'Cadastros',
    modulo: 'estoque',
    page: produtosPage,
  },
  {
    path: '/financeiro',
    label: 'Financeiro',
    title: 'Financeiro',
    subtitle: 'Entradas, saídas e resultado',
    icon: 'wallet',
    group: 'Gestão',
    modulo: 'financeiro',
    page: financeiroPage,
  },

  {
    // Chega-se aqui pela engrenagem do rodapé do menu lateral, não pela lista
    // de navegação. Por isso `hidden: true` e nenhum `group`: é exatamente o
    // que impede uma segunda opção "Configurações" aparecer no menu.
    path: '/configuracoes',
    label: 'Configurações',
    title: 'Configurações',
    subtitle: 'Dados da empresa, usuários e permissões',
    icon: 'settings',
    hidden: true,
    modulo: 'configuracoes',
    page: configuracoesPage,
  },


  /* ------------------------------------------------------- autenticação ---- */

  {
    path: loginProjetosConfig.rotas.login,
    label: 'Entrar',
    title: 'Entrar',
    subtitle: 'Acesso ao sistema',
    hidden: true,
    publica: true,
    page: loginPage,
  },
  {
    path: loginProjetosConfig.rotas.cadastro,
    label: 'Criar conta',
    title: 'Criar conta',
    subtitle: 'Cadastro de usuário',
    hidden: true,
    publica: true,
    page: cadastroPage,
  },
  {
    path: loginProjetosConfig.rotas.recuperar,
    label: 'Recuperar senha',
    title: 'Recuperar senha',
    subtitle: 'Envio do link de redefinição',
    hidden: true,
    publica: true,
    page: recuperarSenhaPage,
  },
  {
    path: loginProjetosConfig.rotas.redefinir,
    label: 'Nova senha',
    title: 'Criar nova senha',
    subtitle: 'Definição de nova senha',
    hidden: true,
    publica: true,
    // Esta rota precisa funcionar COM sessão: quem chega pelo link do e-mail
    // já está logado (é a sessão de recuperação). Sem esta exceção, o guarda
    // mandaria a pessoa para o dashboard antes de ela definir a senha nova.
    permiteLogado: true,
    page: redefinirSenhaPage,
  },

  /* ----------------------------------------------------- acesso negado ---- */

  {
    // Destino de quem tenta abrir um módulo sem permissão. É `hidden` (não
    // aparece no menu) e `publica` (não exige login para ser mostrada — o
    // guarda decide sozinho quando mandar alguém para cá).
    path: '/acesso-negado',
    label: 'Acesso negado',
    title: 'Acesso negado',
    subtitle: 'Você não tem permissão para abrir este módulo',
    hidden: true,
    publica: true,
    page: acessoNegadoPage,
  },

  {
    path: '*',
    label: 'Não encontrado',
    title: 'Página não encontrada',
    subtitle: 'A rota acessada não existe',
    hidden: true,
    page: naoEncontradoPage,
  },
]
