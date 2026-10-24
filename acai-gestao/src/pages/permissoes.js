import { neon, neonConfigurado } from '../services/base.js'
import { definirPermissaoPerfil } from '../services/usuarios.js'
import { esc, toast } from '../ui.js'
import { renderIcons } from '../icons.js'
import { MODULOS, ORDEM_MODULOS, ACOES } from '../services/permissoes.js'

const PERFIS = [
  { nome: 'admin', rotulo: 'Administrador', editavel: false, cor: 'danger' },
  { nome: 'manager', rotulo: 'Gerente', editavel: true, cor: 'info' },
  { nome: 'cashier', rotulo: 'Operador de caixa', editavel: true, cor: 'neutral' },
]

export function permissoesPage() {
  return {
    html: `
      <section class="card">
        <div class="card__head">
          <div>
            <h2 class="card__title">Permissoes por perfil</h2>
            <p class="card__desc">Clique em um perfil para ver e ajustar suas permissoes. O administrador e somente leitura.</p>
          </div>
        </div>
        <p class="table__count" id="contagem-perm"></p>
        <div id="lista-perfis"></div>
      </section>
    `,

    mount(root) {
      const contagem = root.querySelector('#contagem-perm')
      const listaEl = root.querySelector('#lista-perfis')

      if (!neonConfigurado) {
        contagem.textContent = 'Modo demonstracao: todas as permissoes estao liberadas.'
        return () => {}
      }

      let dados = { roles: [], perms: [], rolePerms: [] }
      let aberto = null

      async function carregar() {
        try {
          try { await neon.auth.getSession() } catch { /* ignora */ }
          const [{ data: roles }, { data: perms }, { data: rolePerms }] = await Promise.all([
            neon.from('roles').select('id,name'),
            neon.from('permissions').select('id,module_key,action_key'),
            neon.from('role_permissions').select('role_id,permission_id'),
          ])
          dados = { roles: roles || [], perms: perms || [], rolePerms: rolePerms || [] }
          render()
        } catch (erro) {
          console.error('[permissoes] falha ao carregar', erro)
          contagem.textContent = 'Nao foi possivel carregar o catalogo.'
          toast(erro?.message || 'Nao foi possivel carregar.')
        }
      }

      function rolePermsSet(roleName) {
        const role = dados.roles.find((r) => r.name === roleName)
        if (!role) return new Set()
        return new Set(
          dados.rolePerms
            .filter((rp) => rp.role_id === role.id)
            .map((rp) => {
              const p = dados.perms.find((x) => x.id === rp.permission_id)
              return p ? `${p.module_key}.${p.action_key}` : null
            })
            .filter(Boolean),
        )
      }

      function render() {
        const total = dados.perms.length
        contagem.textContent = `${total} permissoes x ${PERFIS.length} perfis`

        listaEl.innerHTML = PERFIS.map((perfil) => {
          const isOpen = aberto === perfil.nome
          return `
            <section class="card" style="margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:10px;padding:4px 2px;cursor:pointer;user-select:none" data-perfil="${esc(perfil.nome)}">
                <span class="badge badge--${perfil.cor}" style="font-size:11px">${esc(perfil.rotulo)}</span>
                <span style="margin-left:auto;font-size:12px;color:var(--texto-fraco)">${isOpen ? '▾' : '▸'}</span>
              </div>
              ${isOpen ? renderMatriz(perfil) : ''}
            </section>
          `
        }).join('')
        renderIcons(listaEl)
      }

      function renderMatriz(perfil) {
        const set = rolePermsSet(perfil.nome)
        return `
          <div style="margin-top:10px;border-top:1px solid var(--borda);padding-top:10px">
            ${ORDEM_MODULOS.filter((m) => MODULOS[m]).map((modulo) => {
              const acoes = dados.perms.filter((p) => p.module_key === modulo)
              if (acoes.length === 0) return ''
              const todas = acoes.every((p) => set.has(`${modulo}.${p.action_key}`))
              const algumas = acoes.some((p) => set.has(`${modulo}.${p.action_key}`))
              const mestre = todas ? 'checked' : (algumas ? 'data-indeterminate="1"' : '')
              return `
                <div style="margin-bottom:12px">
                  <label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;cursor:pointer">
                    <input type="checkbox" data-modulo="${esc(modulo)}" data-role="${esc(perfil.nome)}" ${todas ? 'checked' : ''} ${perfil.editavel ? '' : 'disabled'} />
                    ${esc(MODULOS[modulo])}
                  </label>
                  <div style="margin-left:24px;display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px">
                    ${acoes.map((p) => `
                      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                        <input type="checkbox" data-perm="${esc(modulo)}|${esc(p.action_key)}" data-role="${esc(perfil.nome)}" ${set.has(`${modulo}.${p.action_key}`) ? 'checked' : ''} ${perfil.editavel ? '' : 'disabled'} />
                        ${esc(ACOES[p.action_key]?.rotulo || p.action_key)}
                      </label>
                    `).join('')}
                  </div>
                </div>
              `
            }).join('')}
          </div>
        `
      }

      // Delegated change handler
      listaEl.addEventListener('change', async (e) => {
        const cb = e.target
        if (!cb || cb.tagName !== 'INPUT' || cb.type !== 'checkbox') return
        const role = cb.dataset?.role
        const perfil = PERFIS.find((p) => p.nome === role)
        if (!perfil?.editavel) return

        if (cb.dataset.modulo) {
          const modulo = cb.dataset.modulo
          const acoes = dados.perms.filter((p) => p.module_key === modulo)
          for (const p of acoes) {
            const input = listaEl.querySelector(`input[data-perm="${modulo}|${p.action_key}"][data-role="${role}"]`)
            if (input && input.checked !== cb.checked) {
              input.checked = cb.checked
              try {
                await definirPermissaoPerfil(role, modulo, p.action_key, cb.checked)
              } catch (erro) {
                toast(erro?.message || 'Nao foi possivel alterar.')
                input.checked = !cb.checked
              }
            }
          }
          await carregar()
        } else if (cb.dataset.perm) {
          const [modulo, acao] = cb.dataset.perm.split('|')
          try {
            await definirPermissaoPerfil(role, modulo, acao, cb.checked)
            await carregar()
          } catch (erro) {
            toast(erro?.message || 'Nao foi possivel alterar.')
            cb.checked = !cb.checked
          }
        }
      })

      // Click on profile header to toggle
      listaEl.addEventListener('click', (e) => {
        const header = e.target.closest('[data-perfil]')
        if (!header) return
        if (e.target.tagName === 'INPUT') return
        const nome = header.dataset.perfil
        aberto = aberto === nome ? null : nome
        render()
      })

      root.recarregarPermissoes = () => carregar()

      carregar()

      return () => {}
    },
  }
}