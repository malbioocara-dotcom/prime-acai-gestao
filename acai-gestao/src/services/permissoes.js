/**
 * Serviço central de permissões.
 *
 * As permissões nascem no banco: `public.minhas_permissoes()` devolve o que o
 * usuário logado pode fazer (perfil + decisões individuais, com a negação
 * individual vencendo). Este módulo só pede isso ao servidor e guarda o
 * retrato em `estadoSessao.permissoes`.
 *
 * O que protege de verdade é o banco: `public.pode(modulo, acao)` é quem
 * autoriza, e o RLS fecha as tabelas. Esconder um item de menu ou um botão aqui
 * é só interface — apagar este arquivo não abre dado nenhum.
 */

import { neon, neonConfigurado } from './base.js'
import { estadoSessao } from 'login-projetos/sessao'

/**
 * Módulos reais do sistema, com o rótulo usado na tela de permissões.
 *
 * As chaves são as `module_key` gravadas em `public.permissions` pela migration
 * `neon/01_usuarios_permissoes.sql` — não dá para inventar nome novo sem
 * mexer no banco.
 */
export const MODULOS = {
  dashboard: 'Dashboard',
  vendas: 'Vendas',
  estoque: 'Estoque',
  compras: 'Compras',
  clientes: 'Clientes',
  financeiro: 'Financeiro',
  configuracoes: 'Configuração da Empresa',
  usuarios: 'Cadastro de Usuários',
  permissoes: 'Permissões de Acesso',
}

/** Ordem em que os módulos aparecem na tela de permissões. */
export const ORDEM_MODULOS = Object.keys(MODULOS)

/**
 * Ações possíveis, com rótulo e descrição curta.
 *
 * `ver` é a ação de "ver o menu/abrir o módulo"; as demais são as operações de
 * cada módulo. Nem toda ação existe em todo módulo (o banco é quem decide).
 */
export const ACOES = {
  ver: { rotulo: 'Visualizar menu', descricao: 'Ver e abrir o módulo' },
  consultar: { rotulo: 'Consultar', descricao: 'Ver os registros' },
  criar: { rotulo: 'Criar', descricao: 'Cadastrar novos registros' },
  editar: { rotulo: 'Editar', descricao: 'Alterar registros existentes' },
  excluir: { rotulo: 'Excluir', descricao: 'Remover registros' },
  desativar: { rotulo: 'Ativar/desativar', descricao: 'Mudar a situação da conta' },
  permissoes: { rotulo: 'Configurar permissões', descricao: 'Mudar o acesso do usuário' },
  redefinir_senha: { rotulo: 'Redefinir senha', descricao: 'Enviar o link de redefinição' },
}

/** Monta a chave `"modulo.acao"`. */
export const chave = (modulo, acao) => `${modulo}.${acao}`

/**
 * Carrega as permissões do usuário logado e guarda em `estadoSessao`.
 *
 * Sem o Neon configurado (modo demonstração) tudo é liberado, para as telas
 * continuarem navegáveis. Em caso de erro, zera: sem permissão não se abre
 * nada — o oposto seria deixar a interface mentir.
 */
export async function carregarPermissoes() {
  if (!neonConfigurado) {
    estadoSessao.permissoes = new Set(
      ORDEM_MODULOS.flatMap((modulo) => Object.keys(ACOES).map((acao) => chave(modulo, acao))),
    )
    return estadoSessao.permissoes
  }

  try {
    const { data, error } = await neon.rpc('minhas_permissoes')
    if (error) throw error

    const lista = Array.isArray(data) ? data : []
    estadoSessao.permissoes = new Set(lista.map((p) => chave(p.modulo, p.acao)))
  } catch (erro) {
    console.error('[permissoes] Não foi possível carregar as permissões.', erro)
    estadoSessao.permissoes = new Set()
  }

  return estadoSessao.permissoes
}

/** Recarrega as permissões (depois de um admin mudar algo). */
export function sincronizarPermissoes() {
  return carregarPermissoes().then(() => avisarPermissoesMudaram())
}

/**
 * Avisa o app de que as permissões mudaram.
 *
 * O menu lateral é montado uma vez; sem este aviso ele continuaria mostrando
 * itens que a pessoa já não pode abrir.
 */
export function avisarPermissoesMudaram() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('permissoes-mudaram'))
  }
}

/** O usuário logado tem esta permissão? */
export function temPermissao(chavePermissao) {
  if (!neonConfigurado) return true
  return estadoSessao.permissoes?.has(chavePermissao) ?? false
}

/** Atalho: `pode('vendas', 'criar')`. */
export function pode(modulo, acao) {
  return temPermissao(chave(modulo, acao))
}

/** O módulo aparece no menu e pode ser aberto. */
export function podeAcessar(modulo) {
  return pode(modulo, 'ver')
}

/** É administrador? (atalho para não espalhar `role === 'admin'` pelo app). */
export function ehAdmin() {
  return estadoSessao.perfil?.papel === 'admin'
}

/**
 * Descreve o perfil atual, para mensagens.
 *
 * Continua existindo o `papel` em `perfil` (vem de `profiles.role`), mas a
 * decisão de acesso é por permissão — isto é só para texto.
 */
export const PERFIS = {
  admin: 'Administrador',
  manager: 'Gerente',
  cashier: 'Operador de caixa',
}

export const perfilRotulo = (papel) => PERFIS[papel] ?? papel
