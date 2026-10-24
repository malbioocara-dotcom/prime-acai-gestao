/**
 * Estado de sessão, compartilhado entre o boot do host, o roteador e as telas
 * de autenticação.
 *
 * É um singleton de propósito: o roteador precisa decidir de forma SÍNCRONA
 * entre mostrar a página e mandar para o login, e a tela de login precisa saber
 * *por que* alguém foi mandado para lá.
 *
 * Este objeto é só um retrato do que o serviço de autenticação diz. A
 * autorização de verdade mora no banco (RLS): apagar este arquivo não abriria
 * nenhum dado.
 */

export const estadoSessao = {
  /** Usuário do serviço de autenticação, ou `null`. */
  usuario: null,
  /** Perfil da tabela de perfis, ou `null`. */
  perfil: null,
  /**
   * Permissões efetivas do usuário, como `Set` de `"modulo.acao"`.
   *
   * Campo livre do host: o módulo de login não o preenche. Serve para o menu e
   * para ligar/desligar botões — o que realmente autoriza é o banco.
   */
  permissoes: new Set(),
  /** Recado a mostrar na tela de login (ex.: conta desativada). */
  aviso: null,
  /** `true` enquanto o app ainda está conferindo a sessão. */
  carregando: true,
}

/** Só entra no sistema quem tem sessão **e** perfil ativo. */
export const logado = () => Boolean(estadoSessao.usuario && estadoSessao.perfil?.ativo)

/**
 * Avisa o host de que a sessão mudou.
 *
 * As telas de login/cadastro chamam isto depois de falar com o serviço de
 * autenticação; quem escuta é o boot do host, que relê a sessão e redesenha.
 * Assim as telas não precisam conhecer o roteador — e existe um só lugar
 * decidindo "quem está logado".
 */
export function avisarSessao() {
  window.dispatchEvent(new CustomEvent('sessao-mudou'))
}

/** Duas letras para o avatar (ex.: "Maria Souza" → "MS"). */
export function iniciais(nome) {
  const partes = String(nome ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}
