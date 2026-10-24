import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: true,
  neon: { rpc: (...args) => rpc(...args) },
}))

const {
  contarNaoLidas,
  listarNotificacoes,
  marcarLida,
  marcarTodasLidas,
} = await import('../src/services/notificacoes.js')

describe('notificacoes', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: null, error: null })
  })

  it('contarNaoLidas usa a RPC e converte para numero', async () => {
    rpc.mockResolvedValueOnce({ data: 3, error: null })
    await expect(contarNaoLidas()).resolves.toBe(3)
    expect(rpc).toHaveBeenCalledWith('contar_notificacoes_nao_lidas', {})
  })

  it('contarNaoLidas devolve 0 quando a RPC nao retorna nada', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(contarNaoLidas()).resolves.toBe(0)
  })

  it('listarNotificacoes devolve array e passa o limite', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    const lista = await listarNotificacoes(5)
    expect(lista).toHaveLength(2)
    expect(rpc).toHaveBeenCalledWith('listar_notificacoes', { p_limite: 5 })
  })

  it('listarNotificacoes devolve [] se a RPC nao devolver array', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(listarNotificacoes()).resolves.toEqual([])
  })

  it('marcarLida chama a RPC com o id', async () => {
    await marcarLida('xyz')
    expect(rpc).toHaveBeenCalledWith('marcar_notificacao_lida', { p_id: 'xyz' })
  })

  it('marcarTodasLidas chama a RPC', async () => {
    await marcarTodasLidas()
    expect(rpc).toHaveBeenCalledWith('marcar_todas_lidas', {})
  })

  it('propaga erro da RPC', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'falhou' } })
    await expect(contarNaoLidas()).rejects.toThrow('falhou')
  })
})
