// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: true,
  neon: {},
}))

const { carregar, EVENTOS_DADOS } = await import('../src/services/base.js')
const eventos = []
const capturarEvento = (evento) => eventos.push(evento)

window.addEventListener(EVENTOS_DADOS.carregamentoFalhou, capturarEvento)
window.addEventListener(EVENTOS_DADOS.carregamentoConcluido, capturarEvento)

afterEach(() => {
  eventos.length = 0
  vi.restoreAllMocks()
})

describe('carregar com Neon configurado', () => {
  it('propaga falhas sem devolver dados de demonstração', async () => {
    const erro = new Error('conexão indisponível')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      carregar({
        nome: 'produtos',
        consulta: async () => {
          throw erro
        },
        exemplo: [{ id: 'DEMO' }],
      }),
    ).rejects.toBe(erro)

    expect(eventos).toHaveLength(1)
    expect(eventos[0].type).toBe(EVENTOS_DADOS.carregamentoFalhou)
    expect(eventos[0].detail).toEqual({ nome: 'produtos' })
  })

  it('emite recuperação após uma consulta bem-sucedida', async () => {
    const dados = [{ id: 'real' }]
    const resultado = await carregar({
      nome: 'produtos',
      consulta: async () => dados,
      exemplo: [],
    })

    expect(resultado).toEqual({ dados, origem: 'neon' })
    expect(eventos).toHaveLength(1)
    expect(eventos[0].type).toBe(EVENTOS_DADOS.carregamentoConcluido)
  })
})
