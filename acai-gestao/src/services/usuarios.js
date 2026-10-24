/**
 * Serviço de usuários e permissões (lado administrativo).
 *
 * Tudo passa por funções `security definer` no banco — que checam `eh_admin()`
 * e a organização do alvo. O navegador nunca decide nada: mandar `role: 'admin'`
 * direto numa tabela não funciona (as tabelas de permissão não têm GRANT de
 * escrita para `authenticated`).
 *
 * Senha não passa por aqui: a conta nasce no Neon Auth (por convite, a pessoa
 * define a própria senha) e a redefinição usa o fluxo de e-mail do provedor.
 */

import { neon, neonConfigurado } from './base.js'
import { sincronizarPermissoes } from './permissoes.js'

/** Erro amigável a partir da resposta do Neon/PostgREST. */
function falha(erro) {
  const mensagem =
    erro?.message ?? erro?.details ?? (typeof erro === 'string' ? erro : 'Erro inesperado.')
  return new Error(mensagem)
}

async function rpc(nome, parametros = {}) {
  if (!neonConfigurado) throw new Error('Modo demonstracao: nao ha banco para gravar.')
  try { await neon.auth.getSession() } catch { /* ignora */ }
  try {
    const { data, error } = await neon.rpc(nome, parametros)
    if (error) throw falha(error)
    return data
  } catch (erro) {
    if (erro?.name === 'AuthRequiredError') {
      try { await neon.auth.getSession() } catch { /* ignora */ }
      const { data, error } = await neon.rpc(nome, parametros)
      if (error) throw falha(error)
      return data
    }
    throw erro
  }
}

/* ------------------------------------------------------------- usuários --- */

/** Lista usuários da organização + convites pendentes. Só admin. */
export function listarUsuarios() {
  return rpc('listar_usuarios')
}

/**
 * Convida uma pessoa.
 *
 * A conta em si não nasce aqui: o convite guarda nome, e-mail, perfil e
 * permissões, e `garantir_perfil()` aplica tudo quando a pessoa entra (ela
 * define a própria senha no cadastro). É assim que o sistema evita que um
 * administrador defina senha de terceiros — e evita dois sistemas de login.
 */
export async function convidarUsuario({ email, nome, role, permissoes = [] }) {
  const id = await rpc('convidar_usuario', {
    p_email: email,
    p_nome: nome,
    p_role: role,
    p_permissoes: permissoes,
  })
  await sincronizarPermissoes()
  return id
}

/** Cancela um convite ainda pendente. */
export function cancelarConvite(id) {
  return rpc('cancelar_convite', { p_id: id })
}

/** Altera nome e perfil de um usuário. */
export async function atualizarUsuario(alvo, { nome, role }) {
  await rpc('atualizar_usuario', { alvo, p_nome: nome, p_role: role })
  await sincronizarPermissoes()
}

/** Ativa ou desativa um usuário (nunca a si mesmo — o banco também impede). */
export function definirAtivo(alvo, ativo) {
  return rpc('definir_ativo_do_usuario', { alvo, ativo })
}

/* --------------------------------------------------------- permissões --- */

/** Matriz completa de um usuário: herdado do perfil + decisão individual. */
export function permissoesDoUsuario(alvo) {
  return rpc('permissoes_do_usuario', { alvo })
}

/** Concede ou nega uma permissão individualmente. */
export async function definirPermissaoUsuario(alvo, modulo, acao, permitido) {
  await rpc('definir_permissao_usuario', { alvo, p_modulo: modulo, p_acao: acao, p_permitido: permitido })
  await sincronizarPermissoes()
}

/** Remove a decisão individual (volta a valer o perfil). */
export async function removerPermissaoUsuario(alvo, modulo, acao) {
  await rpc('remover_permissao_usuario', { alvo, p_modulo: modulo, p_acao: acao })
  await sincronizarPermissoes()
}

/** Restaura todas as permissões do usuário para o padrão do perfil. */
export async function restaurarPermissoesUsuario(alvo) {
  await rpc('restaurar_permissoes_usuario', { alvo })
  await sincronizarPermissoes()
}

/* ----------------------------------------------------------- auditoria --- */

/** Trilha de auditoria da organização. */
export function listarAuditoria(limite = 100) {
  return rpc('listar_auditoria', { p_limite: limite })
}

/** Concede ou revoga uma permissão de um perfil (role). Apenas admin. */
export async function definirPermissaoPerfil(role, modulo, acao, permitido) {
  await rpc('definir_permissao_perfil', { p_role: role, p_modulo: modulo, p_acao: acao, p_permitido: permitido })
}

/* -------------------------------------------------------------- senha ---- */

/**
 * Inicia a redefinição de senha de um usuário.
 *
 * Não é uma operação de banco: o Neon Auth é quem manda o e-mail com o link.
 * A autorização (`usuarios.redefinir_senha`) é checada no banco pela função
 * `public.pode()`; aqui só chamamos o provedor.
 */
export async function enviarRecuperacaoDeSenha(email) {
  const { enviarLinkDeRecuperacao } = await import('login-projetos/auth')
  await enviarLinkDeRecuperacao(email)
}
