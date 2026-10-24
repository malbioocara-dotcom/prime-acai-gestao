import { neon, neonConfigurado } from 'login-projetos/neon'

async function rpc(nome, params = {}) {
  if (!neonConfigurado) return null
  const { data, error } = await neon.rpc(nome, params)
  if (error) throw new Error(error.message || 'Erro')
  return data
}

export async function contarNaoLidas() {
  if (!neonConfigurado) return 0
  const data = await rpc('contar_notificacoes_nao_lidas')
  return Number(data ?? 0)
}

export async function listarNotificacoes(limite = 20) {
  if (!neonConfigurado) return []
  const data = await rpc('listar_notificacoes', { p_limite: limite })
  return Array.isArray(data) ? data : []
}

export async function marcarLida(id) {
  if (!neonConfigurado) return
  await rpc('marcar_notificacao_lida', { p_id: id })
}

export async function marcarTodasLidas() {
  if (!neonConfigurado) return
  await rpc('marcar_todas_lidas')
}