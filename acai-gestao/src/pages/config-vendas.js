import { abrirFormulario } from '../formulario.js'
import { renderIcons } from '../icons.js'
import {
  alterarFormaPagamentoAtivo,
  alterarCategoriaTipoVendaAtiva,
  alterarTipoVendaAtivo,
  listarCategoriasTipoVenda,
  listarFormasPagamento,
  listarTiposVenda,
  salvarFormaPagamento,
  salvarCategoriaTipoVenda,
  salvarTipoVenda,
} from '../services/config-vendas.js'
import {
  alterarCategoriaAtiva,
  listarCategorias,
  salvarCategoria,
} from '../services/categorias.js'
import { pode } from '../services/permissoes.js'
import { esc, toast } from '../ui.js'

const CATEGORIAS_PAGAMENTO = [
  { valor: 'dinheiro', rotulo: 'Dinheiro (com troco)' },
  { valor: 'pix', rotulo: 'PIX' },
  { valor: 'debito', rotulo: 'Cartão de débito' },
  { valor: 'credito', rotulo: 'Cartão de crédito' },
  { valor: 'outros', rotulo: 'Outras formas' },
]

const esquemas = {
  tipo: {
    titulo: 'tipo de venda',
    icone: 'shopping-bag',
    colunas: [],
    listar: listarTiposVenda,
    salvar: salvarTipoVenda,
    ativar: alterarTipoVendaAtivo,
  },
  pagamento: {
    titulo: 'forma de pagamento',
    icone: 'wallet',
    colunas: CATEGORIAS_PAGAMENTO,
    listar: listarFormasPagamento,
    salvar: salvarFormaPagamento,
    ativar: alterarFormaPagamentoAtivo,
  },
  categoria: {
    titulo: 'categoria',
    icone: 'tags',
    colunas: [],
    listar: listarCategorias,
    salvar: salvarCategoria,
    ativar: alterarCategoriaAtiva,
    valoresNovos: { ativo: 'true' },
    campos: [
      { nome: 'nome', label: 'Nome da categoria', tipo: 'texto', obrigatorio: true, largo: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', largo: true, placeholder: 'Opcional' },
      {
        nome: 'ativo',
        label: 'Situação',
        tipo: 'select',
        vazio: false,
        opcoes: [{ valor: 'true', rotulo: 'Ativa' }, { valor: 'false', rotulo: 'Inativa' }],
      },
    ],
  },
  categoriaTipo: {
    titulo: 'categoria de tipo de venda',
    icone: 'tags',
    colunas: [],
    listar: listarCategoriasTipoVenda,
    salvar: salvarCategoriaTipoVenda,
    ativar: alterarCategoriaTipoVendaAtiva,
    valoresNovos: { ativo: 'true' },
    campos: [
      { nome: 'nome', label: 'Nome da categoria', tipo: 'texto', obrigatorio: true, largo: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', largo: true, placeholder: 'Opcional' },
      {
        nome: 'ativo',
        label: 'Situação',
        tipo: 'select',
        vazio: false,
        opcoes: [{ valor: 'true', rotulo: 'Ativa' }, { valor: 'false', rotulo: 'Inativa' }],
      },
    ],
  },
}

const rotuloCategoria = (esquema, categoria) =>
  esquema.colunas.find((item) => item.valor === categoria)?.rotulo ?? categoria

function formatarDataCategoria(valor) {
  if (!valor) return '<span class="muted">—</span>'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return '<span class="muted">—</span>'
  return esc(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data))
}

function rotuloCategoriaTipoVenda(codigo, categorias) {
  return categorias.find((categoria) => categoria.codigo === codigo)?.nome ?? codigo
}

function tabelaHtml(chave, { visivel = chave === 'tipo', rotuloPainel } = {}) {
  const esquema = esquemas[chave]
  const eCategoria = chave === 'categoria' || chave === 'categoriaTipo'
  const idPainel = rotuloPainel ?? (chave === 'categoriaTipo'
    ? 'aba-vendas-categoria-tipo'
    : `aba-vendas-${chave}`)
  return `
    <section class="card config__bloco config-vendas__painel" id="painel-vendas-${chave}" data-painel-vendas="${chave}" role="tabpanel" aria-labelledby="${idPainel}" tabindex="0"${visivel ? '' : ' hidden'}>
      <header class="config__bloco-head">
        <span class="config__bloco-icon"><i data-lucide="${esquema.icone}"></i></span>
        <p class="card__desc">${eCategoria
          ? chave === 'categoriaTipo'
            ? 'Classifique os tipos de venda. Categorias utilizadas permanecem preservadas ao serem inativadas.'
            : 'Organize as opções disponíveis no cadastro de produtos. Categorias existentes são inativadas, não excluídas.'
          : 'Pesquise, edite e ative ou inative. Registros usados em vendas ficam preservados no histórico.'}</p>
        <button class="btn btn--primary" type="button" data-novo="${chave}">
          <i data-lucide="plus"></i><span>${eCategoria ? 'Nova categoria' : chave === 'tipo' ? 'Novo tipo' : 'Nova forma'}</span>
        </button>
      </header>
      <div class="toolbar">
        <input class="campo__input" type="search" data-busca="${chave}" placeholder="Pesquisar ${eCategoria ? 'categoria' : esquema.titulo}..." aria-label="Pesquisar ${eCategoria ? 'categoria' : esquema.titulo}" />
      </div>
      <div class="table-wrap">
        <table class="table" id="tabela-${chave}-venda" aria-label="${esquema.titulo}">
          <thead><tr>${eCategoria
            ? '<th scope="col">Nome</th><th scope="col">Descrição</th><th scope="col">Situação</th><th scope="col">Criada em</th><th scope="col">Atualizada em</th><th scope="col">Ações</th>'
            : '<th scope="col">Nome</th><th scope="col">Categoria</th><th scope="col">Situação</th><th scope="col">Ações</th>'}</tr></thead>
          <tbody data-linhas="${chave}" aria-live="polite"><tr><td colspan="${eCategoria ? 6 : 4}" class="muted">Carregando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `
}

export function configVendasPage({ categoriasOnly = false } = {}) {
  const chaves = categoriasOnly ? ['categoria'] : ['categoriaTipo', 'tipo', 'pagamento']
  const chaveInicial = categoriasOnly ? 'categoria' : 'tipo'
  return {
    html: `
      <div class="config-vendas">
        <div id="config-vendas-aviso"></div>
        <header class="config-vendas__cabecalho">
          <div>
            <h2>${categoriasOnly ? 'Categorias de produtos' : 'Cadastros do PDV'}</h2>
            <p>${categoriasOnly
              ? 'Organize as categorias disponíveis nos cadastros de produtos. Categorias existentes são inativadas, não excluídas.'
                : 'Gerencie categorias de tipos de venda, canais de atendimento e meios de pagamento.'}</p>
          </div>
        </header>
        ${categoriasOnly ? '' : `<nav class="config-vendas__submenu" aria-label="Configurações de vendas" role="tablist">
          <button class="config-vendas__aba is-active" id="aba-vendas-tipo" type="button" role="tab" aria-selected="true" aria-controls="painel-vendas-tipo" data-aba-vendas="tipo">
            <i data-lucide="shopping-bag"></i><span>Tipos de venda</span>
          </button>
          <button class="config-vendas__aba" id="aba-vendas-categoria-tipo" type="button" role="tab" aria-selected="false" aria-controls="painel-vendas-categoriaTipo" data-aba-vendas="categoriaTipo" tabindex="-1">
            <i data-lucide="tags"></i><span>Categorias de tipos</span>
          </button>
          <button class="config-vendas__aba" id="aba-vendas-pagamento" type="button" role="tab" aria-selected="false" aria-controls="painel-vendas-pagamento" data-aba-vendas="pagamento" tabindex="-1">
            <i data-lucide="wallet"></i><span>Formas de pagamento</span>
          </button>
        </nav>`}
        ${chaves.map((chave) => tabelaHtml(chave, {
          visivel: chave === chaveInicial,
          rotuloPainel: categoriasOnly ? 'btn-produtos' : undefined,
        })).join('')}
      </div>
    `,
    mount(root) {
      let vivo = true
      const podeEditar = pode('configuracoes', 'editar')
      const aviso = root.querySelector('#config-vendas-aviso')
      const listas = { tipo: [], categoria: [], pagamento: [], categoriaTipo: [] }

      function mostrarPainel(chave) {
        root.querySelectorAll('[data-aba-vendas]').forEach((aba) => {
          const ativa = aba.dataset.abaVendas === chave
          aba.classList.toggle('is-active', ativa)
          aba.setAttribute('aria-selected', String(ativa))
          aba.tabIndex = ativa ? 0 : -1
        })
        root.querySelectorAll('[data-painel-vendas]').forEach((painel) => {
          painel.hidden = painel.dataset.painelVendas !== chave
        })
      }

      function renderizar(chave) {
        const lista = listas[chave]
        const busca = root.querySelector(`[data-busca="${chave}"]`)
        const termo = busca ? busca.value.trim().toLocaleLowerCase('pt-BR') : ''
        const esquema = esquemas[chave]
        const filtrados = lista.filter((item) =>
          `${item.nome} ${item.codigo ?? ''} ${item.descricao ?? ''} ${chave === 'tipo'
            ? rotuloCategoriaTipoVenda(item.categoria, listas.categoriaTipo)
            : rotuloCategoria(esquema, item.categoria ?? '')}`
            .toLocaleLowerCase('pt-BR')
            .includes(termo),
        )
        const tbody = root.querySelector(`[data-linhas="${chave}"]`)

        tbody.innerHTML = filtrados.length
          ? filtrados.map((item) => chave === 'categoria' || chave === 'categoriaTipo' ? `
              <tr>
                <td><span class="cell-main">${esc(item.nome)}</span></td>
                <td>${item.descricao ? esc(item.descricao) : '<span class="muted">—</span>'}</td>
                <td><span class="badge ${item.ativo ? 'badge--success' : 'badge--neutral'}">${item.ativo ? 'Ativa' : 'Inativa'}</span></td>
                <td>${formatarDataCategoria(item.criado_em)}</td>
                <td>${formatarDataCategoria(item.atualizado_em)}</td>
                <td>
                  <div class="table__acoes">
                    <button class="btn btn--ghost btn--sm" type="button" data-editar="${chave}" data-id="${esc(item.id)}"${podeEditar ? '' : ' disabled'}>
                      <i data-lucide="pencil"></i><span>Editar</span>
                    </button>
                    <button class="btn btn--ghost btn--sm" type="button" data-alternar="${chave}" data-id="${esc(item.id)}"${podeEditar ? '' : ' disabled'}>
                      <i data-lucide="${item.ativo ? 'pause' : 'play'}"></i><span>${item.ativo ? 'Inativar' : 'Ativar'}</span>
                    </button>
                  </div>
                </td>
              </tr>
            ` : `
              <tr>
                <td><span class="cell-main">${esc(item.nome)}</span></td>
                <td>${esc(rotuloCategoriaTipoVenda(item.categoria, listas.categoriaTipo))}</td>
                <td><span class="badge ${item.ativo ? 'badge--success' : 'badge--neutral'}">${item.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td>
                  <div class="table__acoes">
                    <button class="btn btn--ghost btn--sm" type="button" data-editar="${chave}" data-id="${esc(item.id)}"${podeEditar ? '' : ' disabled'}>
                      <i data-lucide="pencil"></i><span>Editar</span>
                    </button>
                    <button class="btn btn--ghost btn--sm" type="button" data-alternar="${chave}" data-id="${esc(item.id)}"${podeEditar ? '' : ' disabled'}>
                      <i data-lucide="${item.ativo ? 'pause' : 'play'}"></i><span>${item.ativo ? 'Inativar' : 'Ativar'}</span>
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')
          : `<tr><td colspan="${chave === 'categoria' || chave === 'categoriaTipo' ? 6 : 4}" class="muted">Nenhum registro encontrado.</td></tr>`

        root.querySelector(`[data-novo="${chave}"]`).disabled = !podeEditar
        renderIcons(tbody)
      }

      async function carregarDados() {
        aviso.innerHTML = ''
        root.querySelectorAll('[data-linhas]').forEach((tbody) => {
          const chave = tbody.dataset.linhas
          tbody.innerHTML = `<tr><td colspan="${chave === 'categoria' || chave === 'categoriaTipo' ? 6 : 4}" class="muted">Carregando...</td></tr>`
        })
        const resultados = await Promise.allSettled(chaves.map((chave) => esquemas[chave].listar()))
        if (!vivo) return

        const falhas = []
        for (const [indice, chave] of chaves.entries()) {
          const resultado = resultados[indice]
          const tbody = root.querySelector(`[data-linhas="${chave}"]`)
          if (resultado.status === 'fulfilled') {
            listas[chave] = resultado.value.dados
            renderizar(chave)
          } else {
            console.error(`[config-vendas] Não foi possível carregar ${esquemas[chave].titulo}.`, resultado.reason)
            tbody.innerHTML = `<tr><td colspan="${chave === 'categoria' || chave === 'categoriaTipo' ? 6 : 4}" class="muted">Não foi possível carregar ${esquemas[chave].titulo}.</td></tr>`
            falhas.push(`${esquemas[chave].titulo}: ${resultado.reason?.message ?? 'falha de comunicação'}`)
          }
        }

        if (falhas.length) {
          aviso.innerHTML = `
            <div class="alert alert--perigo config-vendas__erro" role="alert">
              <i data-lucide="alert-circle"></i>
              <div>
                <strong>Falha ao carregar alguns cadastros</strong>
                <p>${esc(falhas.join(' · '))}</p>
              </div>
              <button class="btn btn--ghost btn--sm" type="button" data-recarregar>
                <i data-lucide="refresh-cw"></i><span>Tentar novamente</span>
              </button>
            </div>
          `
          renderIcons(aviso)
        } else if (!podeEditar) {
          aviso.innerHTML = '<div class="alert alert--info"><i data-lucide="info"></i><div><strong>Somente leitura</strong><p>Você pode consultar os cadastros, mas apenas quem tem permissão para editar configurações pode alterá-los.</p></div></div>'
          renderIcons(aviso)
        }
      }

      function editar(chave, existente = null) {
        const esquema = esquemas[chave]
        abrirFormulario({
          titulo: existente ? `Editar ${esquema.titulo}` : `Novo ${esquema.titulo}`,
          descricao: chave === 'categoria'
            ? 'Categorias são usadas pelos produtos. Inative uma categoria para removê-la de novos cadastros sem perder o histórico.'
            : chave === 'categoriaTipo'
              ? 'Categorias usadas pelos tipos de venda. Inative uma categoria para ocultá-la em novos tipos sem perder o histórico.'
            : 'Cadastros já usados não são excluídos; inative-os para removê-los das novas vendas.',
          campos: esquema.campos ?? [
            {
              nome: 'nome',
              label: 'Nome',
              tipo: 'texto',
              obrigatorio: true,
              largo: true,
              placeholder: chave === 'tipo' ? 'Ex.: Retirada no balcão' : 'Ex.: Vale-refeição',
            },
            {
              nome: 'categoria',
              label: 'Categoria',
              tipo: 'select',
              opcoes: chave === 'tipo'
                ? listas.categoriaTipo
                    .filter((categoria) => categoria.ativo || categoria.codigo === existente?.categoria)
                    .map((categoria) => ({ valor: categoria.codigo, rotulo: categoria.nome }))
                : esquema.colunas,
              obrigatorio: true,
            },
          ],
          valores: existente ?? esquema.valoresNovos ?? { categoria: listas.categoriaTipo.find((categoria) => categoria.ativo)?.codigo },
          textoBotao: 'Salvar cadastro',
          aoSalvar: async (valores) => {
            const resposta = await esquema.salvar({
              ...valores,
              id: existente?.id,
              codigo: existente?.codigo,
              ativo: valores.ativo ?? existente?.ativo ?? true,
            })
            const registro = resposta.origem === 'exemplo'
              ? { ...resposta.dados, id: existente?.id ?? `${chave}-${Date.now()}` }
              : resposta.dados
            const lista = listas[chave]
            const indice = lista.findIndex((item) => item.id === registro.id)
            if (indice >= 0) lista.splice(indice, 1, registro)
            else lista.push(registro)
            renderizar(chave)
            return resposta.origem === 'exemplo'
              ? `${esquema.titulo} salvo somente nesta sessão; o banco não está configurado.`
              : `${esquema.titulo} salvo.`
          },
        })
      }

      async function alternar(chave, id) {
        const lista = listas[chave]
        const item = lista.find((registro) => registro.id === id)
        if (!item) return

        try {
          const resposta = await esquemas[chave].ativar({ id, ativo: !item.ativo })
          const alterado = resposta.origem === 'exemplo'
            ? { ...item, ativo: !item.ativo }
            : resposta.dados
          const indice = lista.findIndex((registro) => registro.id === id)
          lista.splice(indice, 1, alterado)
          renderizar(chave)
          toast(resposta.origem === 'exemplo'
            ? 'Situação alterada somente nesta sessão; o banco não está configurado.'
            : `${item.nome} ${alterado.ativo ? 'ativado' : 'inativado'}.`)
        } catch (erro) {
          console.error('[config-vendas] Não foi possível alterar a situação.', erro)
          toast(erro?.message ?? 'Não foi possível alterar a situação.')
        }
      }

      const aoClicar = (evento) => {
        if (evento.target.closest('[data-recarregar]')) {
          void carregarDados()
          return
        }

        const aba = evento.target.closest('[data-aba-vendas]')
        if (aba) return mostrarPainel(aba.dataset.abaVendas)

        const novo = evento.target.closest('[data-novo]')
        if (novo) return editar(novo.dataset.novo)

        const botaoEditar = evento.target.closest('[data-editar]')
        if (botaoEditar) {
          const chave = botaoEditar.dataset.editar
          const lista = listas[chave]
          return editar(chave, lista.find((item) => item.id === botaoEditar.dataset.id))
        }

        const botaoAlternar = evento.target.closest('[data-alternar]')
        if (botaoAlternar) return alternar(botaoAlternar.dataset.alternar, botaoAlternar.dataset.id)
      }

      const aoNavegarAbas = (evento) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return
        const abas = [...root.querySelectorAll('[data-aba-vendas]')]
        const atual = abas.indexOf(evento.target.closest('[data-aba-vendas]'))
        if (atual < 0) return
        evento.preventDefault()
        const indice = evento.key === 'Home'
          ? 0
          : evento.key === 'End'
            ? abas.length - 1
            : (atual + (evento.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length
        abas[indice].focus()
        mostrarPainel(abas[indice].dataset.abaVendas)
      }

      root.addEventListener('click', aoClicar)
      root.addEventListener('keydown', aoNavegarAbas)
      mostrarPainel(chaveInicial)
      root.querySelectorAll('[data-busca]').forEach((campo) => {
        campo.addEventListener('input', () => renderizar(campo.dataset.busca))
      })
      renderIcons(root)
      void carregarDados()

      return () => {
        vivo = false
        root.removeEventListener('click', aoClicar)
        root.removeEventListener('keydown', aoNavegarAbas)
      }
    },
  }
}

export function configProdutosPage() {
  return configVendasPage({ categoriasOnly: true })
}
