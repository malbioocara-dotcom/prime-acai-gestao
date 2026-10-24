// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { config, configurarLogin } from 'login-projetos/config'
import {
  definirNovaSenha,
  criarConta,
  entrar,
  enviarLinkDeRecuperacao,
  sair,
  sessaoAtual,
} from 'login-projetos/auth'

function configurarCliente({ session = null, perfil = null } = {}) {
  const cliente = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      signInWithPassword: vi.fn(async () => ({
        data: { user: { id: 'usuario-1' } },
        error: null,
      })),
      signUp: vi.fn(async () => ({
        data: { user: { id: 'usuario-1' }, session: { user: { id: 'usuario-1' } } },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(async () => ({ data: perfil, error: null })),
  }

  configurarLogin({
    provedor: {
      nome: 'adaptador-teste',
      cliente,
      redefinirSenha: vi.fn(async () => ({ error: null })),
    },
  })

  return cliente
}

afterEach(() => {
  configurarLogin({
    provedor: { nome: 'neon', cliente: null, redefinirSenha: null },
    funcionalidades: { login: true, cadastro: true, recuperacaoSenha: true, redefinicaoSenha: true },
    cadastroPublico: true,
    urlAplicacao: '',
  })
})

describe('adaptador de provedor de autenticação', () => {
  it('usa o provedor configurado para login e logout', async () => {
    const cliente = configurarCliente()

    await expect(entrar({ email: 'pessoa@example.test', senha: 'nao-registrada' }))
      .resolves.toEqual({ id: 'usuario-1' })
    await sair()

    expect(cliente.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'pessoa@example.test',
      password: 'nao-registrada',
    })
    expect(cliente.auth.signOut).toHaveBeenCalledOnce()
  })

  it('cria conta enviando apenas os dados de identidade (papel é definido no backend)', async () => {
    const cliente = configurarCliente()

    await criarConta({
      nome: 'Pessoa Teste',
      email: 'pessoa@example.test',
      senha: 'SenhaSegura123',
    })

    expect(cliente.auth.signUp).toHaveBeenCalledWith({
      email: 'pessoa@example.test',
      password: 'SenhaSegura123',
      options: { data: { displayName: 'Pessoa Teste' } },
    })
  })

  it('trata sessão ausente ou expirada como deslogada', async () => {
    const cliente = configurarCliente()

    await expect(sessaoAtual()).resolves.toBeNull()
    expect(cliente.auth.getSession).toHaveBeenCalledOnce()
    expect(cliente.rpc).not.toHaveBeenCalled()
  })

  it('carrega o perfil da sessão pelo RPC configurado', async () => {
    const cliente = configurarCliente({
      session: { user: { id: 'usuario-1' } },
      perfil: {
        id: 'usuario-1',
        full_name: 'Pessoa Teste',
        email: 'pessoa@example.test',
        role: 'cashier',
        organization_id: 'org-1',
        is_active: true,
        aprovado_em: null,
      },
    })

    await expect(sessaoAtual()).resolves.toMatchObject({
      usuario: { id: 'usuario-1' },
      perfil: { nome: 'Pessoa Teste', ativo: true, organizacao: 'org-1' },
    })
    expect(cliente.rpc).toHaveBeenCalledWith(config.rpcPerfil)
  })

  it('envia recuperação para a URL pública configurada sem revelar a existência da conta', async () => {
    const cliente = configurarCliente()
    configurarLogin({ urlAplicacao: 'https://login.example.test/app' })

    await enviarLinkDeRecuperacao('pessoa@example.test')

    expect(cliente.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'pessoa@example.test',
      { redirectTo: 'https://login.example.test/app#/redefinir-senha' },
    )
  })

  it('encaminha a redefinição ao adaptador e bloqueia funcionalidades desativadas', async () => {
    const cliente = configurarCliente()
    const redefinir = config.provedor.redefinirSenha

    await definirNovaSenha('SenhaSegura123', 'token-opaco')
    expect(redefinir).toHaveBeenCalledWith({
      senha: 'SenhaSegura123',
      token: 'token-opaco',
      cliente,
    })

    configurarLogin({ funcionalidades: { recuperacaoSenha: false } })
    await expect(enviarLinkDeRecuperacao('pessoa@example.test'))
      .rejects.toThrow('desativada')
    expect(cliente.auth.resetPasswordForEmail).not.toHaveBeenCalled()

    configurarLogin({ funcionalidades: { cadastro: false } })
    await expect(criarConta({
      nome: 'Pessoa Teste',
      email: 'pessoa@example.test',
      senha: 'SenhaSegura123',
    })).rejects.toThrow('desativada')
    expect(cliente.auth.signUp).not.toHaveBeenCalled()
  })
})
