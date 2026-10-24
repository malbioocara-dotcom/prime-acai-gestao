/**
 * Cadastro de Usuários (administrativo).
 *
 * Lista as contas da organização (perfis + convites pendentes) e permite
 * convidar, editar, ativar/desativar, redefinir senha e ajustar as permissões
 * individuais de cada um. Tudo passa por funções `security definer` no banco,
 * que checam `eh_admin()` — o navegador só mostra e esconde.
 */

import { abrirFormulario, confirmar } from '../formulario.js'
import { renderIcons } from '../icons.js'
import { estadoSessao } from 'login-projetos/sessao'
import { neon } from 'login-projetos/neon'
import { ACOES, ehAdmin, MODULOS, ORDEM_MODULOS } from '../services/permissoes.js'
import {
  atualizarUsuario,
  cancelarConvite,
  convidarUsuario,
  definirAtivo,
  definirPermissaoUsuario,
  enviarRecuperacaoDeSenha,
  listarUsuarios,
  permissoesDoUsuario,
  removerPermissaoUsuario,
  restaurarPermissoesUsuario,
} from '../services/usuarios.js'
import { esc, toast, tabela, atualizarTabela } from '../ui.js'

const PAPEIS = [
  { valor: 'admin', rotulo: 'Administrador' },
  { valor: 'manager', rotulo: 'Gerente' },
  { valor: 'cashier', rotulo: 'Operador de caixa' },
]

function rotuloPapel(papel) {
  return PAPEIS.find((p) => p.valor === papel)?.rotulo ?? papel
}

function badgePapel(papel) {
  const tom = papel === 'admin' ? 'danger' : papel === 'manager' ? 'info' : 'neutral'
  return `<span class="badge badge--${tom}">${esc(rotuloPapel(papel))}</span>`
}

/** Botões de ação de cada linha. Puro: só monta HTML com atributos data-*. */
function acoesHtml(u) {
  if (u.pendente) {
    return `
      <div class="table__acoes">
        <button class="btn btn--ghost btn--sm" type="button" data-acao="cancelar-convite" data-id="${esc(u.id)}" title="Cancelar convite">
          <i data-lucide="x"></i>
        </button>
      </div>
    `
  }
  const pendenteAprovacao = !u.is_active && !u.aprovado_em
  if (pendenteAprovacao) {
    return `
      <div class="table__acoes">
        <button class="btn btn--primary btn--sm" type="button" data-acao="decidir" data-id="${esc(u.id)}" title="Aprovar ou rejeitar cadastro">
          <i data-lucide="user-check"></i><span>Decidir</span>
        </button>
      </div>
    `
  }
  const desativarLabel = u.is_active ? 'Desativar' : 'Ativar'
  const desativarIcon = u.is_active ? 'user-x' : 'user-check'
  const ehProprio = u.id === estadoSessao.perfil?.id
  return `
    <div class="table__acoes">
      <button class="btn btn--ghost btn--sm" type="button" data-acao="editar" data-id="${esc(u.id)}" title="Editar">
        <i data-lucide="pencil"></i>
      </button>
      <button class="btn btn--ghost btn--sm" type="button" data-acao="permissoes" data-id="${esc(u.id)}" title="Permissões">
        <i data-lucide="shield"></i>
      </button>
      ${ehProprio ? '' : `<button class="btn btn--ghost btn--sm" type="button" data-acao="toggle-ativo" data-id="${esc(u.id)}" title="${desativarLabel}">
        <i data-lucide="${desativarIcon}"></i>
      </button>`}
      <button class="btn btn--ghost btn--sm" type="button" data-acao="reset-senha" data-id="${esc(u.id)}" title="Redefinir senha" data-email="${esc(u.email || '')}">
        <i data-lucide="key-round"></i>
      </button>
    </div>
  `
}

const colunas = [
  {
    key: 'nome',
    label: 'Usuário',
    render: (u) => `
      <div class="cell-user">
        <span class="avatar avatar--sm" aria-hidden="true">${esc((u.full_name || '?').slice(0, 2).toUpperCase())}</span>
        <span>
          <span class="cell-main">${esc(u.full_name || '—')}</span>
          <span class="cell-sub">${esc(u.email || '')}</span>
        </span>
      </div>
    `,
  },
  { key: 'role', label: 'Perfil', render: (u) => badgePapel(u.role) },
  {
    key: 'status',
    label: 'Situação',
    render: (u) =>
      u.pendente
        ? `<span class="badge badge--warning">Convite pendente</span>`
        : u.is_active
          ? `<span class="badge badge--success">Ativo</span>`
          : (u.aprovado_em
              ? `<span class="badge badge--neutral">Desativado</span>`
              : `<span class="badge badge--warning">Pendente de aprovacao</span>`),
  },
  {
    key: 'last_login_at',
    label: 'Último acesso',
    render: (u) =>
      u.last_login_at
        ? `<span class="muted">${new Date(u.last_login_at).toLocaleString('pt-BR')}</span>`
        : `<span class="muted">—</span>`,
  },
]

/** Colunas da tabela com a coluna de ações à frente. */
const colunasComAcoes = [
  { key: 'acoes', label: 'Ações', align: 'left', render: (u) => acoesHtml(u) },
  ...colunas,
]

export function usuariosPage() {
  return {
    html: `
      <section class="card">
        <div class="card__head">
          <div>
            <h2 class="card__title">Usuários da organização</h2>
            <p class="card__desc">Contas, perfis e convites pendentes. Apenas administradores gerenciam.</p>
          </div>
          <div class="card__actions">
            <button class="btn btn--primary" type="button" data-acao="convidar">
              <i data-lucide="user-plus"></i><span>Convidar usuário</span>
            </button>
          </div>
        </div>
        <p class="table__count" id="contagem-usuarios"></p>
        ${tabela({ colunas: colunasComAcoes, linhas: [], id: 'tabela-usuarios' })}
      </section>
    `,

    mount(root) {
      if (!ehAdmin() && estadoSessao.perfil) {
        root.innerHTML = `<section class="card"><p class="card__desc">Apenas administradores acessam esta tela.</p></section>`
        return () => {}
      }

      let dados = []
      const contagem = root.querySelector('#contagem-usuarios')
      const tabelaEl = root.querySelector('#tabela-usuarios')

      async function carregar() {
        try {
          try { await neon.auth.getSession() } catch { /* ignora */ }
          dados = await listarUsuarios()
        } catch (erro) {
          console.error('[usuarios] falha ao listar', erro)
          toast(erro?.message || 'Não foi possível carregar os usuários.')
          dados = []
        }
        render()
      }

      function render() {
        // Só troca o corpo da tabela: evita aninhar `.table-wrap` a cada atualização.
        atualizarTabela(root, 'tabela-usuarios', colunasComAcoes, dados)
        const wrap = root.querySelector('#tabela-usuarios')?.closest('.table-wrap')
        if (wrap) wrap.style.margin = '0'
        contagem.textContent = `${dados.length} registro(s)`
        renderIcons(root)
        ligarAcoes(root)
      }

      function ligarAcoes(root) {
        root.querySelectorAll('[data-acao="editar"]').forEach((btn) => {
          btn.addEventListener('click', () => editarUsuario(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="permissoes"]').forEach((btn) => {
          btn.addEventListener('click', () => gerenciarPermissoes(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="toggle-ativo"]').forEach((btn) => {
          btn.addEventListener('click', () => toggleAtivo(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="reset-senha"]').forEach((btn) => {
          btn.addEventListener('click', () => resetSenha(btn.dataset.id, btn.dataset.email))
        })
        root.querySelectorAll('[data-acao="cancelar-convite"]').forEach((btn) => {
          btn.addEventListener('click', () => cancelarConviteAcao(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="decidir"]').forEach((btn) => {
          btn.addEventListener('click', () => decidirCadastro(btn.dataset.id))
        })
      }

      async function convidar() {
        abrirFormulario({
          titulo: 'Convidar usuário',
          descricao: 'Nenhum e-mail e enviado automaticamente. Compartilhe o link de cadastro com a pessoa; ao se cadastrar com este e-mail, o perfil e as permissoes serao aplicados. O perfil nasce como operador; ajuste depois se precisar.',
          campos: [
            { nome: 'nome', label: 'Nome completo', tipo: 'texto', obrigatorio: true, largo: true },
            { nome: 'email', label: 'E-mail', tipo: 'texto', obrigatorio: true, placeholder: 'pessoa@exemplo.com' },
            {
              nome: 'role',
              label: 'Perfil',
              tipo: 'select',
              vazio: false,
              opcoes: PAPEIS,
              obrigatorio: true,
            },
          ],
          valores: { role: 'cashier' },
          aoSalvar: async (valores) => {
            await convidarUsuario({ email: valores.email, nome: valores.nome, role: valores.role })
            await carregar()
            return 'Convite criado. Compartilhe o link: ' + window.location.origin + window.location.pathname + '#/cadastro'
          },
        })
      }

      async function editarUsuario(id) {
        const u = dados.find((x) => x.id === id)
        if (!u) return
        abrirFormulario({
          titulo: 'Editar usuário',
          campos: [
            { nome: 'nome', label: 'Nome completo', tipo: 'texto', obrigatorio: true, largo: true },
            {
              nome: 'role',
              label: 'Perfil',
              tipo: 'select',
              vazio: false,
              opcoes: PAPEIS,
              obrigatorio: true,
            },
          ],
          valores: { nome: u.full_name || '', role: u.role },
          aoSalvar: async (valores) => {
            await atualizarUsuario(id, { nome: valores.nome, role: valores.role })
            await carregar()
            return 'Usuário atualizado.'
          },
        })
      }

      async function toggleAtivo(id) {
        const u = dados.find((x) => x.id === id)
        if (!u) return
        const novo = !u.is_active
        const confirmado = await confirmar({
          titulo: novo ? 'Ativar usuário?' : 'Desativar usuário?',
          descricao: novo
            ? 'A conta volta a ter acesso conforme o perfil.'
            : 'A conta perde o acesso até ser reativada.',
          textoBotao: novo ? 'Ativar' : 'Desativar',
        })
        if (!confirmado) return
        try {
          await definirAtivo(id, novo)
          await carregar()
          toast(novo ? 'Usuário ativado.' : 'Usuário desativado.')
        } catch (erro) {
          toast(erro?.message || 'Não foi possível alterar a situação.')
        }
      }

      async function decidirCadastro(id) {
        const u = dados.find((x) => x.id === id)
        if (!u) return

        const overlay = document.createElement('div')
        overlay.className = 'modal'
        overlay.innerHTML = `
          <div class="modal__scrim" data-fechar></div>
          <div class="modal__caixa" role="dialog" aria-modal="true">
            <header class="modal__head">
              <div>
                <h2 class="modal__titulo">Decidir cadastro</h2>
                <p class="modal__desc">${esc(u.full_name || u.email)} - escolha o perfil e aprove ou rejeite.</p>
              </div>
              <button class="modal__x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
            </header>
            <div class="modal__form">
              <div class="modal__campos">
                <div class="campo" data-campo="role">
                  <label class="campo__label" for="decidir-role">Perfil de acesso</label>
                  <select class="campo__input" id="decidir-role">
                    <option value="cashier">Operador de caixa</option>
                    <option value="manager">Gerente</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
              <footer class="modal__acoes">
                <button class="btn btn--ghost" type="button" data-fechar>Cancelar</button>
                <button class="btn btn--danger" type="button" data-rejeitar>Rejeitar</button>
                <button class="btn btn--primary" type="button" data-aprovar>Aprovar</button>
              </footer>
            </div>
          </div>
        `
        document.body.appendChild(overlay)
        renderIcons(overlay)
        document.body.classList.add('sem-scroll')

        function fechar() {
          overlay.remove()
          document.body.classList.remove('sem-scroll')
        }

        overlay.querySelectorAll('[data-fechar]').forEach((el) => el.addEventListener('click', fechar))

        overlay.querySelector('[data-aprovar]').addEventListener('click', async () => {
          const role = overlay.querySelector('#decidir-role').value
          fechar()
          try {
            await atualizarUsuario(id, { nome: u.full_name || '', role })
            await definirAtivo(id, true)
            await carregar()
            toast('Cadastro aprovado.')
          } catch (erro) {
            toast(erro?.message || 'Nao foi possivel aprovar.')
          }
        })

        overlay.querySelector('[data-rejeitar]').addEventListener('click', async () => {
          fechar()
          try {
            await definirAtivo(id, false)
            await carregar()
            toast('Cadastro rejeitado.')
          } catch (erro) {
            toast(erro?.message || 'Nao foi possivel rejeitar.')
          }
        })
      }
      async function resetSenha(id, email) {
        if (!email) {
          toast('Este registro não tem e-mail.')
          return
        }
        const confirmado = await confirmar({
          titulo: 'Enviar link de redefinição?',
          descricao: `Um e-mail será enviado para ${email} com o link para criar uma nova senha.`,
          textoBotao: 'Enviar link',
        })
        if (!confirmado) return
        try {
          await enviarRecuperacaoDeSenha(email)
          toast('Link de redefinição enviado.')
        } catch (erro) {
          toast(erro?.message || 'Não foi possível enviar o link.')
        }
      }

      async function cancelarConviteAcao(id) {
        const confirmado = await confirmar({
          titulo: 'Cancelar convite?',
          descricao: 'O convite pendente será removido. A pessoa não conseguirá mais entrar com ele.',
          textoBotao: 'Cancelar convite',
        })
        if (!confirmado) return
        try {
          await cancelarConvite(id)
          await carregar()
          toast('Convite cancelado.')
        } catch (erro) {
          toast(erro?.message || 'Não foi possível cancelar o convite.')
        }
      }

      async function gerenciarPermissoes(id) {
        const u = dados.find((x) => x.id === id)
        if (!u || u.pendente) return

        let matriz = []
        try {
          matriz = await permissoesDoUsuario(id)
        } catch (erro) {
          toast(erro?.message || 'Nao foi possivel carregar as permissoes.')
          return
        }

        const overlay = document.createElement('div')
        overlay.className = 'modal'
        overlay.innerHTML = `
          <div class="modal__scrim" data-fechar></div>
          <div class="modal__caixa" role="dialog" aria-modal="true">
            <header class="modal__head">
              <div>
                <h2 class="modal__titulo">Permissoes - ${esc(u.full_name || u.email)}</h2>
                <p class="modal__desc">Perfil base: ${esc(rotuloPapel(u.role))}. Marque ou desmarque cada acao. "Padrao" remove a decisao individual.</p>
              </div>
              <button class="modal__x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
            </header>
            <div class="modal__form">
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                <button class="btn btn--ghost btn--sm" type="button" data-marcar-todos>Selecionar todos</button>
                <button class="btn btn--ghost btn--sm" type="button" data-desmarcar-todos>Desmarcar todos</button>
                <button class="btn btn--ghost btn--sm" type="button" data-restaurar>Restaurar padrao do perfil</button>
              </div>
              <div class="modal__campos" id="perm-matriz"></div>
              <footer class="modal__acoes">
                <button class="btn btn--primary" type="button" data-fechar>Fechar</button>
              </footer>
            </div>
          </div>
        `
        document.body.appendChild(overlay)
        renderIcons(overlay)
        document.body.classList.add('sem-scroll')

        const matrizEl = overlay.querySelector('#perm-matriz')

        const estado = {}
        const herdado = {}
        for (const linha of matriz) {
          if (!estado[linha.modulo]) estado[linha.modulo] = {}
          if (!herdado[linha.modulo]) herdado[linha.modulo] = {}
          estado[linha.modulo][linha.acao] = linha.individual === true ? 'conceder' : (linha.individual === false ? 'negar' : 'padrao')
          herdado[linha.modulo][linha.acao] = !!linha.perfil
        }

        const expandido = {}
        ORDEM_MODULOS.forEach((m) => { expandido[m] = true })

        async function aplicar(modulo, acao, valor) {
          try {
            if (valor === 'padrao') await removerPermissaoUsuario(id, modulo, acao)
            else await definirPermissaoUsuario(id, modulo, acao, valor === 'conceder')
            estado[modulo][acao] = valor
            toast('Permissao atualizada.')
          } catch (erro) {
            toast(erro?.message || 'Nao foi possivel alterar.')
          }
          renderArvore()
        }

        function renderArvore() {
          matrizEl.innerHTML = ORDEM_MODULOS
            .filter((m) => MODULOS[m] && estado[m])
            .map((modulo) => {
              const acoes = Object.keys(estado[modulo])
              const todasConcedidas = acoes.every((a) => estado[modulo][a] === 'conceder' || (estado[modulo][a] === 'padrao' && herdado[modulo][a]))
              const algumConcedido = acoes.some((a) => estado[modulo][a] === 'conceder' || (estado[modulo][a] === 'padrao' && herdado[modulo][a]))
              const mestre = todasConcedidas ? 'conceder' : (algumConcedido ? 'parcial' : 'negar')
              return `
                <section class="card" style="margin-bottom:10px;padding:12px 14px">
                  <div style="display:flex;align-items:center;gap:8px;cursor:pointer" data-toggle="${esc(modulo)}">
                    <input type="checkbox" data-mestre="${esc(modulo)}" ${mestre === 'conceder' ? 'checked' : ''} />
                    <strong>${esc(MODULOS[modulo])}</strong>
                    <span style="margin-left:auto;font-size:12px;color:var(--texto-fraco)">${expandido[modulo] ? 'v' : '>'}</span>
                  </div>
                  ${expandido[modulo] ? `
                    <div style="margin-top:8px;margin-left:22px;display:flex;flex-direction:column;gap:6px">
                      ${acoes.map((acao) => {
                        const v = estado[modulo][acao]
                        const h = herdado[modulo][acao]
                        const checked = v === 'conceder' || (v === 'padrao' && h)
                        return `
                          <label style="display:flex;align-items:center;gap:8px;font-size:13px">
                            <input type="checkbox" data-acao="${esc(modulo)}|${esc(acao)}" ${checked ? 'checked' : ''} />
                            <span>${esc(ACOES[acao]?.rotulo || acao)}</span>
                            ${v === 'negar' ? '<span class="badge badge--danger" style="font-size:10px">Negado</span>' : ''}
                            ${v === 'conceder' ? '<span class="badge badge--success" style="font-size:10px">Individual</span>' : ''}
                            ${v === 'padrao' && h ? '<span class="badge badge--neutral" style="font-size:10px">Herdado</span>' : ''}
                            ${v === 'padrao' && !h ? '<span class="badge badge--neutral" style="font-size:10px">Padrao</span>' : ''}
                          </label>
                        `
                      }).join('')}
                    </div>
                  ` : ''}
                </section>
              `
            }).join('')
          renderIcons(matrizEl)

          matrizEl.querySelectorAll('input[data-mestre]').forEach((cb) => {
            cb.addEventListener('change', async () => {
              const modulo = cb.dataset.mestre
              const novo = cb.checked
              for (const acao of Object.keys(estado[modulo])) {
                await aplicar(modulo, acao, novo ? 'conceder' : 'negar')
              }
            })
          })
          matrizEl.querySelectorAll('[data-toggle]').forEach((el) => {
            el.addEventListener('click', (e) => {
              if (e.target.tagName === 'INPUT') return
              const m = el.dataset.toggle
              expandido[m] = !expandido[m]
              renderArvore()
            })
          })
          matrizEl.querySelectorAll('input[data-acao]').forEach((cb) => {
            cb.addEventListener('change', async () => {
              const [modulo, acao] = cb.dataset.acao.split('|')
              await aplicar(modulo, acao, cb.checked ? 'conceder' : 'negar')
            })
          })
        }

        renderArvore()

        overlay.querySelector('[data-marcar-todos]').addEventListener('click', async () => {
          for (const m of ORDEM_MODULOS) {
            if (!estado[m]) continue
            for (const a of Object.keys(estado[m])) {
              if (estado[m][a] !== 'conceder') await aplicar(m, a, 'conceder')
            }
          }
          toast('Todas as permissoes concedidas.')
        })
        overlay.querySelector('[data-desmarcar-todos]').addEventListener('click', async () => {
          for (const m of ORDEM_MODULOS) {
            if (!estado[m]) continue
            for (const a of Object.keys(estado[m])) {
              if (estado[m][a] !== 'negar') await aplicar(m, a, 'negar')
            }
          }
          toast('Todas as permissoes removidas.')
        })
        overlay.querySelector('[data-restaurar]').addEventListener('click', async () => {
          const ok = await confirmar({
            titulo: 'Restaurar padrao do perfil?',
            descricao: 'Todas as decisoes individuais serao removidas; passam a valer as permissoes do perfil.',
            textoBotao: 'Restaurar',
          })
          if (!ok) return
          try {
            await restaurarPermissoesUsuario(id)
            matriz = await permissoesDoUsuario(id)
            for (const k of Object.keys(estado)) delete estado[k]
            for (const k of Object.keys(herdado)) delete herdado[k]
            for (const linha of matriz) {
              if (!estado[linha.modulo]) estado[linha.modulo] = {}
              if (!herdado[linha.modulo]) herdado[linha.modulo] = {}
              estado[linha.modulo][linha.acao] = linha.individual === true ? 'conceder' : (linha.individual === false ? 'negar' : 'padrao')
              herdado[linha.modulo][linha.acao] = !!linha.perfil
            }
            renderArvore()
            toast('Permissoes restauradas ao padrao do perfil.')
          } catch (erro) {
            toast(erro?.message || 'Nao foi possivel restaurar.')
          }
        })

        overlay.querySelectorAll('[data-fechar]').forEach((el) => {
          el.addEventListener('click', () => {
            overlay.remove()
            document.body.classList.remove('sem-scroll')
            carregar()
          })
        })
      }
      root.querySelector('[data-acao="convidar"]').addEventListener('click', convidar)

      // Recarrega a lista (usado ao reabrir o painel, para nao ficar com dados velhos).
      root.recarregarUsuarios = () => carregar()

      // Permite que a central de notificacoes abra direto o registro do usuario.
      root.abrirNotificacaoUsuario = async (id) => {
        if (!id) return
        if (!dados.length) { try { await carregar() } catch { /* ignora */ } }
        const u = dados.find((x) => x.id === id)
        if (!u) { toast('Usuario nao encontrado nesta lista.'); return }
        // Convite pendente OU cadastro aguardando aprovacao -> escolher o perfil de acesso.
        const aguardandoAprovacao = !u.is_active && !u.aprovado_em
        if (u.pendente || aguardandoAprovacao) decidirCadastro(id)
        else gerenciarPermissoes(id)
      }

      carregar()

      return () => {}
    },
  }
}
