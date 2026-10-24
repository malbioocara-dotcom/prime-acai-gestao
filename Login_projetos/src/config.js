/**
 * ============================================================================
 * Login_projetos — configuração central
 * ============================================================================
 *
 * Tudo que muda de um projeto para outro mora aqui: marca, rotas, tamanho
 * mínimo de senha, rótulos de papel e textos das telas.
 *
 * O host chama `configurarLogin({...})` UMA vez, no boot, antes de renderizar
 * qualquer tela. O que não for passado fica no padrão.
 *
 * Nada aqui guarda segredo: a conexão com o Neon vem da variável de ambiente
 * `VITE_NEON_URL` (veja `.env.example`). O que autoriza de verdade é o RLS no
 * banco — esta configuração só decide como as telas aparecem.
 */

// `import.meta.env` existe no Vite; fora dele (Node puro, testes) fica vazio.
const env = import.meta.env ?? {}

export const config = {
  /** Identidade visual do painel lateral das telas de autenticação. */
  marca: {
    nome: 'Meu Sistema',
    assinatura: 'Gestão',
    /** Nome de um ícone do Lucide (ex.: 'store', 'building-2', 'shopping-cart'). */
    icone: 'store',
    chamada: 'A gestão do seu negócio em um só lugar.',
    descricao: 'Tenha os números do dia sempre à mão.',
    pontos: [
      'Pedidos e status em tempo real',
      'Estoque com ponto de reposição',
      'Caixa e margem do mês',
    ],
  },

  /**
   * Rotas do host. Os valores começam com "/" (o roteador é por hash, então o
   * endereço fica `#/login`). O host declara essas rotas no seu roteador.
   */
  rotas: {
    login: '/login',
    cadastro: '/cadastro',
    recuperar: '/recuperar-senha',
    redefinir: '/redefinir-senha',
    /** Para onde o host leva o usuário depois de entrar. */
    depoisDoLogin: '/',
    /** Para onde o host leva o usuário depois de sair. */
    depoisDoLogout: '/login',
  },

  /** Se `false`, o link "Criar conta" some e a tela de cadastro bloqueia. */
  cadastroPublico: env.VITE_CADASTRO_PUBLICO !== 'false',

  /** Telas e operações opcionais; login permanece habilitado por padrão. */
  funcionalidades: {
    login: true,
    cadastro: true,
    recuperacaoSenha: true,
    redefinicaoSenha: true,
  },

  /**
   * Provedor ativo. O padrão usa o Neon Auth + Data API.
   *
   * `cliente` permite fornecer um cliente compatível com a API documentada em
   * docs/INTEGRACAO.md. É uma configuração em runtime, nunca uma credencial.
   */
  provedor: {
    nome: 'neon',
    cliente: null,
    redefinirSenha: null,
  },

  /** Origem pública usada nos links de e-mail; vazia usa a origem atual. */
  urlAplicacao: env.VITE_APP_URL ?? '',

  /** Tamanho mínimo de senha exigido no cliente. */
  senhaMinima: 8,

  /** Rótulos de papel usados na interface. */
  papeis: {
    admin: 'Administrador',
    manager: 'Gerente',
    cashier: 'Caixa',
  },

  /**
   * Cadastro entra como pendente e um administrador aprova?
   *   true  -> após cadastrar mostra "aguarde a aprovação" e encerra a sessão;
   *   false -> após cadastrar mostra "conta criada, faça login" e encerra.
   *
   * O app da Prime Açaí exige acesso imediato sem aprovação manual.
   */
  aprovacaoManual: false,

  /** Espera (ms) antes de voltar para o login depois do cadastro. */
  redirecionarAposCadastroMs: 1500,

  /** Nome da função no banco que cria/atualiza o perfil de quem entrou. */
  rpcPerfil: 'garantir_perfil',

  /** Tabela de perfis (Data API). */
  tabelaPerfis: 'profiles',

  /** Textos das telas. Use {marca} e {papel} para interpolar. */
  textos: {
    loginTitulo: 'Entrar na sua conta',
    loginDica: 'Use o e-mail cadastrado em {marca}.',
    cadastroTitulo: 'Criar conta',
    cadastroDica: 'Preencha os dados abaixo para começar a usar o sistema.',
    cadastroRodape: 'Novas contas entram como {papel}. Um administrador ajusta o perfil depois.',
    recuperarTitulo: 'Recuperar senha',
    recuperarDica: 'Informe o seu e-mail e enviaremos um link para criar uma nova senha.',
    redefinirTitulo: 'Criar nova senha',
    redefinirDica: 'Escolha uma senha nova para a sua conta.',
  },
}

const ROTAS_FUNCIONALIDADES = {
  login: 'login',
  cadastro: 'cadastro',
  recuperar: 'recuperacaoSenha',
  redefinir: 'redefinicaoSenha',
}

/** Identifica uma rota de autenticação configurada, mesmo se estiver desativada. */
export function ehRotaAuthConfigurada(rota) {
  const caminho = String(rota ?? '').split('?')[0]
  return Object.keys(ROTAS_FUNCIONALIDADES).some((nome) => config.rotas[nome] === caminho)
}

/** Verifica se uma tela/operação de autenticação foi habilitada pelo host. */
export function funcionalidadeAuthHabilitada(funcionalidade) {
  if (funcionalidade === 'cadastro') {
    return config.cadastroPublico && config.funcionalidades.cadastro !== false
  }
  return config.funcionalidades[funcionalidade] !== false
}

/** Verifica se a rota de autenticação está habilitada. */
export function rotaAuthHabilitada(rota) {
  const caminho = String(rota ?? '').split('?')[0]
  const chave = Object.keys(ROTAS_FUNCIONALIDADES).find(
    (nome) => config.rotas[nome] === caminho,
  )
  return chave ? funcionalidadeAuthHabilitada(ROTAS_FUNCIONALIDADES[chave]) : false
}

/**
 * Mescla a configuração passada pelo host, sem apagar o resto.
 *
 * Objetos (marca, rotas, papeis, textos) são mesclados em profundidade — assim
 * dá para trocar só o `marca.nome` e manter todo o resto no padrão.
 *
 * Importante: a mesclagem é feita NO MESMO objeto (`Object.assign`), e não
 * trocando a referência. Quem já importou `config` continua vendo o valor novo.
 */
export function configurarLogin(parcial = {}) {
  for (const [chave, valor] of Object.entries(parcial)) {
    const atual = config[chave]
    const ehObjeto = (v) => v && typeof v === 'object' && !Array.isArray(v)

    if (ehObjeto(valor) && ehObjeto(atual)) {
      Object.assign(atual, valor)
    } else {
      config[chave] = valor
    }
  }
  return config
}

/**
 * Lê um texto configurado e troca `{marca}`, `{assinatura}` e `{papel}` pelos
 * valores atuais. Um `extra` permite passar outras variáveis (ex.: `{sistema}`).
 */
export function texto(chave, extra = {}) {
  const bruto = config.textos[chave] ?? ''
  const valores = {
    marca: config.marca.nome,
    assinatura: config.marca.assinatura ?? '',
    papel: config.papeis.cashier,
    ...extra,
  }

  return String(bruto).replace(/\{(\w+)\}/g, (todo, nome) =>
    Object.hasOwn(valores, nome) ? valores[nome] : todo,
  )
}
