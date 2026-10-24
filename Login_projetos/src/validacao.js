/**
 * Regras e mensagens puras: senha, e-mail e tradução de erros.
 *
 * Ficam separadas do serviço (`services/auth.js`) de propósito: não tocam em
 * rede nem em DOM, então podem ser testadas sozinhas e reaproveitadas por
 * qualquer parte do sistema (validação de formulário, por exemplo).
 */

import { config } from './config.js'

/** Tamanho mínimo de senha configurado. */
export const senhaMinima = () => config.senhaMinima

/**
 * Checklist de senha forte. Devolve as regras com `ok` marcado, para a tela
 * desenhar a lista e atualizar a cada tecla.
 */
export function checarSenha(senha) {
  const texto = String(senha ?? '')
  const min = config.senhaMinima

  return [
    { ok: texto.length >= min, texto: `Pelo menos ${min} caracteres` },
    { ok: /[A-Za-zÀ-ÿ]/.test(texto), texto: 'Pelo menos uma letra' },
    { ok: /\d/.test(texto), texto: 'Pelo menos um número' },
  ]
}

/** `true` quando a senha passa em todas as regras. */
export const senhaForte = (senha) => checarSenha(senha).every((regra) => regra.ok)

/** Validação simples de e-mail (o servidor valida de novo). */
export const emailValido = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email ?? '').trim())

/** Rótulo legível de um papel (ex.: 'cashier' -> 'Caixa'). */
export const rotuloPapel = (papel) => config.papeis[papel] ?? papel

/* --------------------------------------------------------------- mensagens -- */

/**
 * Erros de autenticação em português.
 *
 * O padrão é uma mensagem genérica: nada de repassar `erro.message` para a
 * tela, porque ela pode revelar detalhes internos (e, no login, dizer se o
 * e-mail existe já é informação demais).
 *
 * As chaves aparecem em dois dialetos: os códigos do Better Auth (MAIÚSCULOS) e
 * os do Supabase que o adapter mantém por compatibilidade (minúsculos).
 */
const MENSAGENS = {
  // ---- Better Auth ----
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail.',
  EMAIL_NOT_VERIFIED: 'Confirme o seu e-mail antes de entrar. O link está na sua caixa de entrada.',
  PASSWORD_TOO_SHORT: 'A senha é curta demais. Use pelo menos 8 caracteres, com letras e números.',
  INVALID_EMAIL: 'E-mail inválido.',
  SESSION_EXPIRED: 'A sua sessão expirou. Entre de novo.',
  SESSION_NOT_FOUND: 'A sua sessão expirou. Entre de novo.',
  INVALID_TOKEN: 'O link expirou ou já foi usado. Peça um novo.',
  TOKEN_EXPIRED: 'O link expirou. Peça um novo.',
  USER_BANNED: 'Esta conta está desativada. Fale com um administrador.',
  RATE_LIMIT_EXCEEDED: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',

  // ---- Supabase (compatibilidade do adapter) ----
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme o seu e-mail antes de entrar. O link está na sua caixa de entrada.',
  email_exists: 'Já existe uma conta com este e-mail.',
  user_already_exists: 'Já existe uma conta com este e-mail.',
  weak_password: 'A senha é fraca demais para o servidor. Use pelo menos 8 caracteres, com letras e números.',
  same_password: 'A nova senha precisa ser diferente da anterior.',
  signup_disabled: 'O cadastro pelo app está desativado. Peça a um administrador para criar a sua conta.',
  user_banned: 'Esta conta está desativada. Fale com um administrador.',
  over_request_rate_limit: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  over_email_send_rate_limit: 'Muitos e-mails pedidos em pouco tempo. Aguarde alguns minutos.',
  validation_failed: 'E-mail inválido.',
  otp_expired: 'O link expirou. Peça um novo.',
  session_not_found: 'A sua sessão expirou. Entre de novo.',
}

/** Traduz um erro do serviço de autenticação para uma frase segura. */
export function mensagemDeErro(erro) {
  if (!erro) return 'Não foi possível concluir a operação. Tente de novo.'

  const codigo = erro.code ?? erro.status
  if (codigo && MENSAGENS[codigo]) return MENSAGENS[codigo]
  if (codigo && MENSAGENS[String(codigo).toLowerCase()]) {
    return MENSAGENS[String(codigo).toLowerCase()]
  }

  // `status === 0` é o que os SDKs usam quando a requisição nem saiu.
  if (erro.status === 0 || /fetch|network|failed to load/i.test(erro.message ?? '')) {
    return 'Não foi possível falar com o servidor. Verifique a sua conexão.'
  }

  return 'Não foi possível concluir a operação. Tente de novo.'
}
