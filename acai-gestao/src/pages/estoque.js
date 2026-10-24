import { produtos as produtosExemplo, recipientes as recipientesExemplo } from '../data.js'
import { abrirFormulario } from '../formulario.js'
import { renderIcons } from '../icons.js'
import { METODO_PESO_ROTULO, METODOS_PESO_ATIVOS, formatPeso } from '../peso.js'
import { observar } from '../services/base.js'
import { listarCategorias } from '../services/categorias.js'
import {
  LOCAIS,
  LOCAIS_CONTAGEM,
  LOCAIS_MOVIMENTO_LOCAL,
  OPERACOES,
  ajustarSaldo,
  listarSaldosEstoqueLocais,
  listarMovimentacoes,
  locaisDaOperacao,
  registrarMovimentacao,
} from '../services/movimentacoes.js'
import { pode } from '../services/permissoes.js'
import {
  METODOS_ESTOQUE,
  TIPOS_VENDA,
  TIPO_VENDA_AJUDA,
  atualizarProduto,
  criarProduto,
  listarProdutos,
  proximoCodigoProduto,
  unidadeDeVenda,
} from '../services/produtos.js'
import {
  atualizarRecipiente,
  criarRecipiente,
  listarHistoricoRecipiente,
  listarRecipientes,
} from '../services/recipientes.js'
import {
  atualizarKpi,
  atualizarTabela,
  badge,
  botaoPrimario,
  cardHead,
  esc,
  formatBRL,
  formatNumero,
  statCard,
  tabela,
  toolbar,
} from '../ui.js'

/* ------------------------------------------------------------- opções ----- */

const lista = (mapa) => Object.entries(mapa).map(([valor, rotulo]) => ({ valor, rotulo }))

const OPCOES_TIPO_VENDA = lista(TIPOS_VENDA)
const OPCOES_METODO_ESTOQUE = lista(METODOS_ESTOQUE)
const OPCOES_METODO_PESO = METODOS_PESO_ATIVOS.map((valor) => ({
  valor,
  rotulo: METODO_PESO_ROTULO[valor],
}))
const OPCOES_SITUACAO = [
  { valor: 'true', rotulo: 'Ativo' },
  { valor: 'false', rotulo: 'Inativo' },
]
const OPCOES_CONTROLE = [
  { valor: 'true', rotulo: 'Ativado' },
  { valor: 'false', rotulo: 'Desativado' },
]

/* Locais do livro-razão: o rótulo é o que o operador lê, o valor é o que o
   banco grava (o CHECK da migração 06 só aceita estes). */
const rotuloLocal = (local) => LOCAIS[local] ?? local
const OPCOES_LOCAL = LOCAIS_MOVIMENTO_LOCAL.map((valor) => ({ valor, rotulo: LOCAIS[valor] }))
const OPCOES_OPERACAO = OPERACOES.map(({ valor, rotulo }) => ({ valor, rotulo }))
const OPCOES_CONTAGEM = LOCAIS_CONTAGEM.map((valor) => ({ valor, rotulo: LOCAIS[valor] }))

const quando = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const quandoTexto = (iso) => (iso ? quando.format(new Date(iso)) : '—')

const tomTipo = (tipo) => ({ peso: 'info', receita: 'warning' })[tipo] ?? 'neutral'

/* ------------------------------------------------------- colunas: item ---- */

/** Situação do item conforme a quantidade em relação ao mínimo definido. */
function situacao(produto) {
  if (!produto.ativo) return { texto: 'Inativo', tom: 'neutral' }
  if (!produto.controlaEstoque) return { texto: 'Sem controle', tom: 'neutral' }
  if (produto.quantidade < produto.minimo) return { texto: 'Repor', tom: 'danger' }
  if (produto.quantidade < produto.minimo * 1.25) return { texto: 'Atenção', tom: 'warning' }
  return { texto: 'Normal', tom: 'success' }
}

const precoHtml = (p) => {
  if (!p.preco) return '<span class="muted">—</span>'
  const unidade = unidadeDeVenda(p.tipoVenda)
  const sufixo = p.tipoVenda === 'unidade' ? '' : ` <span class="cell-sub">/ ${esc(unidade)}</span>`
  return `<strong>${formatBRL(p.preco)}</strong>${sufixo}`
}

/**
 * Ações da linha do item. "Histórico" aparece sempre: quem enxerga a tela já
 * tem `estoque.consultar`. "Movimentar" e "Contar" dependem da permissão de
 * verdade — e o banco recusa de novo se a tela errar.
 */
const acoesProduto = ({ podeEditar, podeMovimentar }) => (p) => `
  <div class="table__acoes">
    ${
      podeMovimentar
        ? `<button class="btn btn--ghost btn--sm" type="button" data-acao="movimentar-produto"
                   data-id="${esc(p.uuid ?? p.id)}" title="Registrar entrada, saída ou perda">
             <i data-lucide="arrow-left-right"></i><span>Movimentar</span>
           </button>
           <button class="btn btn--ghost btn--sm" type="button" data-acao="contar-produto"
                   data-id="${esc(p.uuid ?? p.id)}" title="Contagem física: informo o saldo contado">
             <i data-lucide="clipboard-list"></i><span>Contar</span>
           </button>`
        : ''
    }
    <button class="btn btn--ghost btn--sm" type="button" data-acao="historico-movimentacoes"
            data-id="${esc(p.uuid ?? p.id)}" title="Histórico de movimentação do estoque">
      <i data-lucide="history"></i><span>Histórico</span>
    </button>
    ${
      podeEditar
        ? `<button class="btn btn--ghost btn--sm" type="button" data-acao="editar-produto"
                   data-id="${esc(p.uuid ?? p.id)}" title="Editar item">
             <i data-lucide="pencil"></i><span>Editar</span>
           </button>`
        : ''
    }
  </div>
`

const colunasProdutos = ({ podeEditar = false, podeMovimentar = false } = {}) => [
  {
    key: 'nome',
    label: 'Produto',
    render: (p) => `
      <span class="cell-main">${esc(p.nome)}</span>
      <span class="cell-sub mono">${esc(p.id)}</span>
    `,
  },
  {
    key: 'tipoVenda',
    label: 'Tipo de venda',
    render: (p) => {
      const metodo =
        p.tipoVenda === 'peso' && p.metodoPeso
          ? `<span class="cell-sub">${esc(METODO_PESO_ROTULO[p.metodoPeso] ?? p.metodoPeso)}</span>`
          : ''
      return `${badge(TIPOS_VENDA[p.tipoVenda] ?? p.tipoVenda, tomTipo(p.tipoVenda))}${metodo}`
    },
  },
  { key: 'categoria', label: 'Categoria', render: (p) => esc(p.categoria) },
  {
    key: 'quantidade',
    label: 'Loja',
    align: 'right',
    render: (p) =>
      p.controlaEstoque
        ? `
      <span class="cell-main">${formatNumero(p.quantidade)} ${esc(p.unidade)}</span>
      <span class="cell-sub">mínimo ${formatNumero(p.minimo)}</span>
    `
        : '<span class="muted">—</span>',
  },
  {
    key: 'quantidadeGeral',
    label: 'Geral',
    align: 'right',
    render: (p) => p.controlaEstoque
      ? `<span class="cell-main">${formatNumero(p.quantidadeGeral ?? 0)} ${esc(p.unidade)}</span>`
      : '<span class="muted">—</span>',
  },
  {
    key: 'nivel',
    label: 'Nível',
    render: (p) => {
      if (!p.controlaEstoque || !p.minimo) return '<span class="muted">—</span>'
      const percentual = Math.min(100, Math.round((p.quantidade / (p.minimo * 2)) * 100))
      const critico = p.quantidade < p.minimo
      return `
        <div class="progress" title="${percentual}% do nível ideal">
          <span class="${critico ? 'is-critico' : ''}" style="width:${Math.max(4, percentual)}%"></span>
        </div>
      `
    },
  },
  {
    key: 'custo',
    label: 'Custo',
    align: 'right',
    render: (p) => `<span class="muted">${formatBRL(p.custo)}</span>`,
  },
  { key: 'preco', label: 'Preço', align: 'right', render: precoHtml },
  {
    key: 'situacao',
    label: 'Situação',
    render: (p) => {
      const s = situacao(p)
      return badge(s.texto, s.tom)
    },
  },
  // A coluna de ações é sempre desenhada: "Histórico" é leitura.
  {
    key: 'acoes',
    label: 'Ações',
    render: acoesProduto({ podeEditar, podeMovimentar }),
  },
]

/* -------------------------------------------------- colunas: recipiente --- */

/* Editar recipiente muda a tara, e a tara entra na conta da venda por peso —
 * por isso o banco exige `estoque.editar`. O botão só aparece para quem tem,
 * para a tela não oferecer o que o RLS vai recusar. */
const acoesRecipiente =
  ({ podeEditar = false } = {}) =>
  (r) => `
  <div class="table__acoes">
    <button class="btn btn--ghost btn--sm" type="button" data-acao="historico-recipiente"
            data-id="${esc(r.uuid ?? r.id)}" title="Histórico de alteração da tara">
      <i data-lucide="history"></i><span>Histórico</span>
    </button>
    ${
      podeEditar
        ? `<button class="btn btn--ghost btn--sm" type="button" data-acao="editar-recipiente"
            data-id="${esc(r.uuid ?? r.id)}" title="Editar recipiente">
      <i data-lucide="pencil"></i><span>Editar</span>
    </button>`
        : ''
    }
  </div>
`

const colunasRecipientesCompletas = ({ comAcoes = false, podeEditar = false } = {}) => [
  { key: 'nome', label: 'Recipiente', render: (r) => `<span class="cell-main">${esc(r.nome)}</span>` },
  {
    key: 'tara',
    label: 'Tara',
    align: 'right',
    render: (r) => `<strong>${formatPeso(r.tara)}</strong>`,
  },
  {
    key: 'situacao',
    label: 'Situação',
    render: (r) => (r.ativo ? badge('Ativo', 'success') : badge('Inativo', 'neutral')),
  },
  ...(comAcoes ? [{ key: 'acoes', label: 'Ações', render: acoesRecipiente({ podeEditar }) }] : []),
]

const colunasHistorico = (comAutor) => [
  { key: 'quando', label: 'Quando', render: (h) => esc(quandoTexto(h.quando)) },
  {
    key: 'tara',
    label: 'Tara',
    render: (h) =>
      h.taraAnterior == null
        ? `<strong>${formatPeso(h.taraNova)}</strong>`
        : `${formatPeso(h.taraAnterior)} → <strong>${formatPeso(h.taraNova)}</strong>`,
  },
  {
    key: 'nome',
    label: 'Identificação',
    render: (h) =>
      h.nomeAnterior && h.nomeNovo && h.nomeAnterior !== h.nomeNovo
        ? `${esc(h.nomeAnterior)} → <strong>${esc(h.nomeNovo)}</strong>`
        : '<span class="muted">sem mudança</span>',
  },
  ...(comAutor
    ? [{ key: 'autor', label: 'Alterado por', render: (h) => (h.autor ? esc(h.autor) : '<span class="muted">—</span>') }]
    : []),
]

/* ---------------------------------------------- colunas: movimentação ----- */

/**
 * O livro-razão do item. Quem leu o saldo merece ver de onde ele veio: o par
 * origem → destino é o "o que aconteceu", e o motivo é o porquê.
 */
const colunasMovimentacoes = (comAutor) => [
  { key: 'quando', label: 'Quando', render: (m) => esc(quandoTexto(m.quando)) },
  {
    key: 'movimento',
    label: 'Movimento',
    render: (m) =>
      `${esc(rotuloLocal(m.origem))} <span class="muted">→</span> <strong>${esc(rotuloLocal(m.destino))}</strong>`,
  },
  {
    key: 'quantidade',
    label: 'Quantidade',
    align: 'right',
    render: (m) => `<strong>${formatNumero(m.quantidade)}</strong>`,
  },
  {
    key: 'motivo',
    label: 'Motivo',
    render: (m) => (m.motivo ? esc(m.motivo) : '<span class="muted">—</span>'),
  },
  ...(comAutor
    ? [
        {
          key: 'quem',
          label: 'Registrado por',
          render: (m) => (m.quem ? esc(m.quem) : '<span class="muted">sistema</span>'),
        },
      ]
    : []),
]

/* ------------------------------------------------------- indicadores ------ */

const filtrar = (dados, termo) => {
  const busca = termo.trim().toLowerCase()
  if (!busca) return dados
  return dados.filter((p) => [p.id, p.nome, p.categoria].join(' ').toLowerCase().includes(busca))
}

/**
 * Indicadores do estoque.
 *
 * Dinheiro só conta item ATIVO — o inativo não vai ser vendido nem consumido.
 * "Reposição" só olha item ativo, com controle de estoque e ponto de reposição
 * definidos: um item sem controle não tem mínimo para estourar.
 */
function indicadores(listaDeItens) {
  const ativos = listaDeItens.filter((p) => p.ativo)
  const controlados = ativos.filter((p) => p.controlaEstoque)

  return {
    total: ativos.length,
    valorEstoque: ativos.reduce((acc, p) => acc + p.quantidade * p.custo, 0),
    potencial: ativos.reduce((acc, p) => acc + p.quantidade * p.preco, 0),
    criticos: controlados.filter((p) => p.minimo > 0 && p.quantidade < p.minimo),
  }
}

function htmlAlerta(criticos) {
  if (!criticos.length) return ''
  return `
    <div class="alert">
      <i data-lucide="alert-triangle"></i>
      <div>
        <strong>${criticos.length} ${criticos.length === 1 ? 'item precisa' : 'itens precisam'} de reposição</strong>
        <p>${criticos.map((p) => esc(p.nome)).join(' · ')}</p>
      </div>
    </div>
  `
}

/* ------------------------------------------------------------ a página ---- */

export function estoquePage() {
  const podeCriar = pode('estoque', 'criar')
  const podeEditar = pode('estoque', 'editar')
  // Quem registra movimento é quem tem `estoque.criar`; quem ajusta por
  // contagem precisa de `estoque.editar` — é a mesma divisão que os RPCs da
  // migração 07 impõem no banco.
  const podeMovimentar = podeCriar
  const podeContar = podeEditar

  const colunas = colunasProdutos({ podeEditar, podeMovimentar })
  const colunasRec = colunasRecipientesCompletas({ comAcoes: true, podeEditar })

  const inicial = indicadores(produtosExemplo)

  return {
    html: `
      <section class="grid grid--stats">
        ${statCard({
          kpi: 'itensCadastrados',
          label: 'Itens cadastrados',
          valor: inicial.total,
          icon: 'boxes',
          hint: 'Produtos e insumos ativos',
        })}
        ${statCard({
          kpi: 'valorEstoque',
          label: 'Valor em estoque',
          valor: formatBRL(inicial.valorEstoque),
          icon: 'package',
          hint: 'Pelo custo de compra',
        })}
        ${statCard({
          kpi: 'potencialVenda',
          label: 'Potencial de venda',
          valor: formatBRL(inicial.potencial),
          icon: 'trending-up',
          hint: 'Se tudo for vendido',
        })}
        ${statCard({
          kpi: 'abaixoMinimo',
          label: 'Abaixo do mínimo',
          valor: inicial.criticos.length,
          icon: 'alert-triangle',
          hint: 'Itens que precisam de reposição',
        })}
      </section>

      <div id="alerta-estoque">${htmlAlerta(inicial.criticos)}</div>
      <div id="aviso-saldos-locais" class="alert alert--perigo" role="alert" hidden>
        Não foi possível consultar os saldos por local. Atualize a página ou tente novamente mais tarde.
      </div>

      <section class="card">
        ${cardHead({
          titulo: 'Produtos e insumos',
          descricao: 'Saldos separados para o estoque geral e o estoque da loja. Transferências são registradas no histórico.',
          acoes: podeCriar
            ? botaoPrimario({ label: 'Novo item', icon: 'plus', acao: 'novo-produto' })
            : '',
        })}
        ${toolbar({ buscaId: 'busca-estoque', placeholder: 'Buscar por nome, código ou categoria...' })}
        <p class="table__count" id="contagem-estoque"></p>
        ${tabela({ colunas, linhas: produtosExemplo, id: 'tabela-estoque' })}
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Recipientes e tara',
          descricao:
            'A tara é o peso da embalagem vazia. Na venda por peso, peso líquido = peso bruto − tara.',
          acoes: podeCriar
            ? botaoPrimario({ label: 'Novo recipiente', icon: 'plus', acao: 'novo-recipiente' })
            : '',
        })}
        <p class="table__count" id="contagem-recipientes"></p>
        ${tabela({ colunas: colunasRec, linhas: recipientesExemplo, id: 'tabela-recipientes' })}
      </section>

      <section class="card" id="card-historico" hidden></section>

      <section class="card" id="card-movimentacoes" hidden></section>
    `,

    mount(root) {
      let itens = produtosExemplo
      let saldosLocais = new Map()
      let taras = recipientesExemplo
      let categoriasAtivas = []
      let categoriasDisponiveis = false

      async function anexarSaldosLocais(lista) {
        const resultado = await listarSaldosEstoqueLocais()
        saldosLocais = new Map(resultado.dados.map((saldo) => [saldo.produtoId, saldo]))
        itens = lista.map((produto) => ({
          ...produto,
          quantidadeGeral: saldosLocais.get(produto.uuid ?? produto.id)?.geral ?? 0,
        }))
      }

      const contagem = root.querySelector('#contagem-estoque')
      const contagemRec = root.querySelector('#contagem-recipientes')
      const alerta = root.querySelector('#alerta-estoque')
      const cardHistorico = root.querySelector('#card-historico')
      const cardMov = root.querySelector('#card-movimentacoes')
      const input = root.querySelector('#busca-estoque')

      /** Acha pelo uuid do banco ou, no modo demonstração, pelo código. */
      const achar = (id) => itens.find((p) => p.uuid === id || p.id === id)
      const acharTara = (id) => taras.find((r) => r.uuid === id || r.id === id)

      const unidadesDisponiveis = () =>
        [...new Set(['un', 'kg', 'L', ...itens.map((p) => p.unidade)])].filter(Boolean)

      const categoriasLegadas = () => [...new Set(itens.map((p) => p.categoria))].filter(Boolean).sort()
      const opcoesCategoria = (categoriaAtual = '') => {
        const opcoes = categoriasAtivas.map(({ nome }) => ({ valor: nome, rotulo: nome }))
        if (categoriaAtual && !opcoes.some(({ valor }) => valor === categoriaAtual)) {
          opcoes.push({ valor: categoriaAtual, rotulo: `${categoriaAtual} (inativa)` })
        }
        return opcoes
      }

      /* ------------------------------------------------------- desenho --- */

      function aplicarIndicadores() {
        const kpi = indicadores(itens)

        atualizarKpi(root, 'itensCadastrados', { valor: kpi.total })
        atualizarKpi(root, 'valorEstoque', { valor: formatBRL(kpi.valorEstoque) })
        atualizarKpi(root, 'potencialVenda', { valor: formatBRL(kpi.potencial) })
        atualizarKpi(root, 'abaixoMinimo', { valor: kpi.criticos.length })

        alerta.innerHTML = htmlAlerta(kpi.criticos)
        renderIcons(alerta)
      }

      function renderProdutos() {
        const linhas = filtrar(itens, input.value)
        atualizarTabela(root, 'tabela-estoque', colunas, linhas)
        contagem.textContent = `${linhas.length} de ${itens.length} itens`
        renderIcons(root)
        ligarAcoesProdutos()
      }

      function renderRecipientes() {
        atualizarTabela(root, 'tabela-recipientes', colunasRec, taras)
        contagemRec.textContent = `${taras.length} recipiente(s)`
        renderIcons(root)
        ligarAcoesRecipientes()
      }

      const aplicar = () => {
        renderProdutos()
        aplicarIndicadores()
      }

      aplicar()
      renderRecipientes()

      input.addEventListener('input', renderProdutos)

      const aoBuscarGlobal = (evento) => {
        input.value = evento.detail
        renderProdutos()
      }
      window.addEventListener('busca-global', aoBuscarGlobal)

      const pararProdutos = observar(listarProdutos({ incluirInativos: true }), (r) => {
        void anexarSaldosLocais(r.dados)
          .then(aplicar)
          .catch((erro) => {
            console.error('[estoque] Não foi possível carregar saldos por local.', erro)
            itens = r.dados.map((produto) => ({ ...produto, quantidadeGeral: null }))
            aplicar()
            root.querySelector('#aviso-saldos-locais').hidden = false
          })
      })
      const categoriasCarregadas = listarCategorias({ somenteAtivas: true })
        .then((resultado) => {
          categoriasAtivas = resultado.dados
          categoriasDisponiveis = true
        })
        .catch((erro) => {
          categoriasAtivas = []
          categoriasDisponiveis = false
          console.error('[estoque] Não foi possível carregar categorias ativas.', erro)
        })
      const pararRecipientes = observar(listarRecipientes(), (r) => {
        taras = r.dados
        renderRecipientes()
      })

      /** Busca de novo no banco e redesenha — usado depois de gravar. */
      async function recarregarProdutos() {
        const { dados } = await listarProdutos({ incluirInativos: true })
        await anexarSaldosLocais(dados)
        aplicar()
      }

      async function recarregarRecipientes() {
        const { dados } = await listarRecipientes()
        taras = dados
        renderRecipientes()
      }

      /* -------------------------------------------------- ações: item ---- */

      function ligarAcoesProdutos() {
        root.querySelectorAll('[data-acao="editar-produto"]').forEach((btn) => {
          btn.addEventListener('click', () => editarProduto(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="movimentar-produto"]').forEach((btn) => {
          btn.addEventListener('click', () => movimentarProduto(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="contar-produto"]').forEach((btn) => {
          btn.addEventListener('click', () => contarProduto(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="historico-movimentacoes"]').forEach((btn) => {
          btn.addEventListener('click', () => abrirMovimentacoes(btn.dataset.id))
        })
      }

      /**
       * Campos do cadastro de item. `comSaldo` só no cadastro novo: o saldo não
       * é digitado, ele nasce de uma movimentação — por isso a edição não mexe
       * nele.
       */
      function camposProduto({ comSaldo, categoriaAtual = '' }) {
        return [
          { nome: 'codigo', label: 'Código', tipo: 'texto', obrigatorio: true },
          { nome: 'nome', label: 'Nome do item', tipo: 'texto', obrigatorio: true, largo: true },
          {
            nome: 'descricao',
            label: 'Descrição',
            tipo: 'textarea',
            largo: true,
            placeholder: 'Opcional',
          },
          {
            nome: 'categoria',
            label: 'Categoria',
            obrigatorio: true,
            ...(categoriasDisponiveis
              ? {
                  tipo: 'select',
                  vazio: false,
                  opcoes: opcoesCategoria(categoriaAtual),
                  ajuda: 'Somente categorias ativas estão disponíveis para novos itens.',
                }
              : {
                  tipo: 'texto',
                  sugestoes: categoriasLegadas(),
                  ajuda: 'O catálogo de categorias não está disponível; informe o nome para manter o cadastro.',
                }),
          },
          {
            nome: 'tipoVenda',
            label: 'Tipo de venda',
            tipo: 'select',
            vazio: false,
            obrigatorio: true,
            opcoes: OPCOES_TIPO_VENDA,
            ajuda: 'Por peso: self-service, o preço passa a ser por quilo.',
          },
          {
            nome: 'metodoPeso',
            label: 'Entrada do peso (só no tipo por peso)',
            tipo: 'select',
            vazio: false,
            opcoes: OPCOES_METODO_PESO,
            ajuda: 'No peso líquido a tara não é descontada de novo.',
          },
          {
            nome: 'preco',
            label: 'Preço de venda',
            tipo: 'numero',
            prefixo: 'R$',
            obrigatorio: true,
            ajuda: 'No produto por peso, este é o preço do QUILO.',
          },
          {
            nome: 'unidade',
            label: 'Unidade de estoque',
            tipo: 'select',
            vazio: false,
            obrigatorio: true,
            opcoes: unidadesDisponiveis(),
            ajuda: 'Como o item é contado. Produto por peso fica em kg.',
          },
          {
            nome: 'controlaEstoque',
            label: 'Controle de estoque',
            tipo: 'select',
            vazio: false,
            obrigatorio: true,
            opcoes: OPCOES_CONTROLE,
          },
          {
            nome: 'metodoEstoque',
            label: 'Método de controle',
            tipo: 'select',
            vazio: false,
            obrigatorio: true,
            opcoes: OPCOES_METODO_ESTOQUE,
          },
          ...(comSaldo
            ? [
                {
                  nome: 'quantidade',
                  label: 'Saldo inicial',
                  tipo: 'numero',
                  min: 0,
                  ajuda: 'Entra no livro-razão como contagem de abertura, com data e responsável.',
                },
              ]
            : []),
          { nome: 'minimo', label: 'Ponto de reposição', tipo: 'numero', min: 0 },
          { nome: 'custo', label: 'Custo', tipo: 'numero', prefixo: 'R$', min: 0 },
          {
            nome: 'ativo',
            label: 'Situação',
            tipo: 'select',
            vazio: false,
            obrigatorio: true,
            opcoes: OPCOES_SITUACAO,
          },
        ]
      }

      function valoresDoProduto(p) {
        return {
          codigo: p.id,
          nome: p.nome,
          descricao: p.descricao,
          categoria: p.categoria,
          tipoVenda: p.tipoVenda,
          metodoPeso: p.metodoPeso ?? 'bruto_tara',
          preco: p.preco,
          unidade: p.unidade,
          controlaEstoque: p.controlaEstoque ? 'true' : 'false',
          metodoEstoque: p.metodoEstoque,
          minimo: p.minimo,
          custo: p.custo,
          ativo: p.ativo ? 'true' : 'false',
        }
      }

      async function novoProduto() {
        await categoriasCarregadas
        abrirFormulario({
          titulo: 'Novo item de estoque',
          descricao: 'O item passa a contar no controle de quantidade e de reposição.',
          campos: camposProduto({ comSaldo: true }),
          valores: {
            codigo: proximoCodigoProduto(itens),
            tipoVenda: 'unidade',
            metodoPeso: 'bruto_tara',
            unidade: 'un',
            controlaEstoque: 'true',
            metodoEstoque: 'movimentacoes',
            quantidade: 0,
            minimo: 0,
            custo: 0,
            preco: 0,
            ativo: 'true',
          },
          aoSalvar: async (valores) => {
            const { dados: criado, origem } = await criarProduto(valores)

            if (origem === 'exemplo') {
              const bruto = Number(valores.quantidade)
              criado.quantidade = Number.isFinite(bruto) && bruto > 0 ? bruto : 0
              itens = [criado, ...itens]
              aplicar()
              return `${criado.id} entrou só nesta sessão — o Neon não está configurado.`
            }

            // O saldo não é digitado no item: ele nasce no livro-razão. O número
            // do cadastro vira uma contagem de abertura — com autor e data.
            const saldoInicial = Number(valores.quantidade)
            let aviso = ''
            if (Number.isFinite(saldoInicial) && saldoInicial > 0) {
              try {
                await ajustarSaldo({
                  produtoId: criado.uuid,
                  contado: saldoInicial,
                  motivo: 'Saldo inicial do cadastro',
                  local: 'abertura',
                })
              } catch (erro) {
                aviso = ` O saldo inicial não entrou: ${erro?.message ?? erro}`
              }
            }

            await recarregarProdutos()
            return `${criado.id} salvo no estoque.${aviso}`
          },
        })
      }

      async function editarProduto(id) {
        const p = achar(id)
        if (!p) return
        await categoriasCarregadas

        abrirFormulario({
          titulo: `Editar ${p.id}`,
          descricao:
            'O saldo não é editado aqui: mudar saldo é movimentação de estoque, com motivo e responsável.',
          campos: camposProduto({ comSaldo: false, categoriaAtual: p.categoria }),
          valores: valoresDoProduto(p),
          aoSalvar: async (valores) => {
            const { dados: salvo, origem } = await atualizarProduto(p.uuid ?? p.id, {
              ...valores,
              quantidade: p.quantidade,
            })

            if (origem === 'exemplo') {
              Object.assign(p, salvo)
              aplicar()
              return `${salvo.id} alterado só nesta sessão — o Neon não está configurado.`
            }

            await recarregarProdutos()
            return `${salvo.id} atualizado.`
          },
        })
      }

      /* ------------------------------------------- ações: movimentação --- */

      /**
       * Saldo depois de um movimento, na mesma conta do banco: entra o que vai
       * para 'estoque', sai o que vem de 'estoque'. Só é usado no modo
       * demonstração — com o banco, quem responde é o RPC.
       */
      const saldoAposMovimento = (p, { quantidade, origem, destino }) =>
        p.quantidade +
        (destino === 'estoque' ? quantidade : 0) -
        (origem === 'estoque' ? quantidade : 0)
      const saldoGeralAposMovimento = (p, { quantidade, origem, destino }) =>
        (p.quantidadeGeral ?? 0) +
        (destino === 'estoque_geral' ? quantidade : 0) -
        (origem === 'estoque_geral' ? quantidade : 0)

      function movimentarProduto(id) {
        const p = achar(id)
        if (!p) return
        const chaveIdempotencia = globalThis.crypto?.randomUUID?.()
          ?? `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`

        abrirFormulario({
          titulo: `Movimentar ${p.nome}`,
          descricao: `Estoque da loja: ${formatNumero(p.quantidade)} ${p.unidade}. Estoque geral: ${formatNumero(p.quantidadeGeral ?? 0)} ${p.unidade}.`,
          campos: [
            {
              nome: 'operacao',
              label: 'O que aconteceu',
              tipo: 'select',
              vazio: false,
              obrigatorio: true,
              opcoes: OPCOES_OPERACAO,
              ajuda: 'O atalho já sabe de onde sai e para onde vai.',
            },
            {
              nome: 'origem',
              label: 'Sai de',
              tipo: 'select',
              vazio: false,
              obrigatorio: true,
              opcoes: OPCOES_LOCAL,
              ajuda: 'Vale para o atalho "Outro".',
            },
            {
              nome: 'destino',
              label: 'Entra em',
              tipo: 'select',
              vazio: false,
              obrigatorio: true,
              opcoes: OPCOES_LOCAL,
              ajuda: 'Transferências entre estoque geral e loja são registradas em uma única operação.',
            },
            {
              nome: 'quantidade',
              label: `Quantidade (${p.unidade})`,
              tipo: 'numero',
              min: 0,
              obrigatorio: true,
            },
            {
              nome: 'motivo',
              label: 'Motivo',
              tipo: 'texto',
              obrigatorio: true,
              largo: true,
              placeholder: 'Compra de 10 kg para a semana',
            },
          ],
          valores: { operacao: 'compra', origem: 'fornecedor', destino: 'estoque' },
          aoSalvar: async (valores) => {
            const atalho = locaisDaOperacao(valores.operacao)
            const origem = atalho.origem || valores.origem
            const destino = atalho.destino || valores.destino
            const quantidade = Number(valores.quantidade)

            const { dados: movimento, origem: deOnde } = await registrarMovimentacao({
              produtoId: p.uuid ?? p.id,
              quantidade,
              origem,
              destino,
              motivo: valores.motivo,
              chaveIdempotencia,
            })

            if (deOnde === 'exemplo') {
              p.quantidade = saldoAposMovimento(p, { quantidade, origem, destino })
              p.quantidadeGeral = saldoGeralAposMovimento(p, { quantidade, origem, destino })
              aplicar()
              return `${formatNumero(quantidade)} ${p.unidade} movimentado só nesta sessão — o Neon não está configurado.`
            }

            await recarregarProdutos()
            if (cardMov.dataset.produto === (p.uuid ?? p.id)) await abrirMovimentacoes(p.uuid ?? p.id)

            return `${formatNumero(movimento.quantidade)} ${p.unidade}: ${rotuloLocal(movimento.origem)} → ${rotuloLocal(movimento.destino)}. Saldo agora ${formatNumero(movimento.saldo)} ${p.unidade}.`
          },
        })
      }

      function contarProduto(id) {
        const p = achar(id)
        if (!p) return

        abrirFormulario({
          titulo: `Contagem de ${p.nome}`,
          descricao: `O sistema diz ${formatNumero(p.quantidade)} ${p.unidade}. Informe o que foi contado: o banco registra só a diferença.`,
          campos: [
            {
              nome: 'contado',
              label: `Saldo contado (${p.unidade})`,
              tipo: 'numero',
              min: 0,
              obrigatorio: true,
            },
            {
              nome: 'local',
              label: 'Tipo de contagem',
              tipo: 'select',
              vazio: false,
              obrigatorio: true,
              opcoes: OPCOES_CONTAGEM,
              ajuda: 'Saldo inicial é a primeira contagem do item.',
            },
            {
              nome: 'motivo',
              label: 'Motivo',
              tipo: 'texto',
              obrigatorio: true,
              largo: true,
              placeholder: 'Contagem de fechamento do dia',
            },
          ],
          valores: { contado: p.quantidade, local: 'contagem' },
          aoSalvar: async (valores) => {
            const { dados: ajuste, origem } = await ajustarSaldo({
              produtoId: p.uuid ?? p.id,
              contado: valores.contado,
              motivo: valores.motivo,
              local: valores.local,
            })

            if (origem === 'exemplo') {
              p.quantidade = Number(valores.contado)
              aplicar()
              return `${p.nome}: saldo ajustado só nesta sessão — o Neon não está configurado.`
            }

            await recarregarProdutos()
            if (cardMov.dataset.produto === (p.uuid ?? p.id)) await abrirMovimentacoes(p.uuid ?? p.id)

            if (ajuste.saldo === ajuste.saldoAnterior) {
              return 'A contagem bateu com o sistema: nada foi ajustado.'
            }
            return `Contagem: ${formatNumero(ajuste.saldoAnterior)} → ${formatNumero(ajuste.saldo)} ${p.unidade}.`
          },
        })
      }

      async function abrirMovimentacoes(id) {
        const p = achar(id)
        if (!p) return

        cardMov.dataset.produto = id
        cardMov.hidden = false
        cardMov.innerHTML = `
          ${cardHead({
            titulo: 'Histórico de movimentação',
            descricao: `${p.nome} — saldo atual de ${formatNumero(p.quantidade)} ${p.unidade}`,
            acoes:
              '<button class="btn btn--ghost" type="button" data-acao="fechar-movimentacoes"><i data-lucide="x"></i><span>Fechar</span></button>',
          })}
          <p class="table__count" id="contagem-movimentacoes">Carregando...</p>
          ${tabela({ colunas: colunasMovimentacoes(false), linhas: [], id: 'tabela-movimentacoes' })}
        `
        renderIcons(cardMov)
        cardMov
          .querySelector('[data-acao="fechar-movimentacoes"]')
          .addEventListener('click', fecharMovimentacoes)

        const { dados, origem } = await listarMovimentacoes(p.uuid ?? p.id)
        const contagemMov = cardMov.querySelector('#contagem-movimentacoes')

        if (origem === 'exemplo' && !dados.length) {
          contagemMov.textContent = 'O livro-razão aparece só com o banco configurado.'
          return
        }

        const comAutor = dados.some((m) => m.quem)
        atualizarTabela(cardMov, 'tabela-movimentacoes', colunasMovimentacoes(comAutor), dados)
        contagemMov.textContent = dados.length
          ? `${dados.length} movimento(s), do mais recente para o mais antigo`
          : 'Nenhuma movimentação registrada — o saldo é o saldo inicial.'
        renderIcons(cardMov)
      }

      function fecharMovimentacoes() {
        cardMov.hidden = true
        cardMov.innerHTML = ''
        delete cardMov.dataset.produto
      }

      /* --------------------------------------------- ações: recipiente --- */

      function ligarAcoesRecipientes() {
        root.querySelectorAll('[data-acao="editar-recipiente"]').forEach((btn) => {
          btn.addEventListener('click', () => editarRecipiente(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="historico-recipiente"]').forEach((btn) => {
          btn.addEventListener('click', () => abrirHistorico(btn.dataset.id))
        })
      }

      const camposRecipiente = (comSituacao) => [
        {
          nome: 'nome',
          label: 'Identificação',
          tipo: 'texto',
          obrigatorio: true,
          largo: true,
          placeholder: 'Copo 500ml com tampa',
        },
        {
          nome: 'tara',
          label: 'Tara (gramas)',
          tipo: 'numero',
          min: 0,
          obrigatorio: true,
          ajuda: 'Peso da embalagem vazia. 500 g = meio quilo.',
        },
        ...(comSituacao
          ? [
              {
                nome: 'ativo',
                label: 'Situação',
                tipo: 'select',
                vazio: false,
                obrigatorio: true,
                opcoes: OPCOES_SITUACAO,
              },
            ]
          : []),
      ]

      function novoRecipiente() {
        abrirFormulario({
          titulo: 'Novo recipiente',
          descricao: 'A tara entra no cálculo da venda por peso.',
          campos: camposRecipiente(false),
          valores: { tara: 0 },
          aoSalvar: async (valores) => {
            const { dados: criado, origem } = await criarRecipiente(valores)

            if (origem === 'exemplo') {
              taras = [...taras, criado]
              renderRecipientes()
              return `${criado.nome} entrou só nesta sessão — o Neon não está configurado.`
            }

            await recarregarRecipientes()
            return `${criado.nome} cadastrado com tara de ${formatPeso(criado.tara)}.`
          },
        })
      }

      function editarRecipiente(id) {
        const r = acharTara(id)
        if (!r) return

        abrirFormulario({
          titulo: `Editar ${r.nome}`,
          descricao: 'Toda mudança de tara fica no histórico, com data e responsável.',
          campos: camposRecipiente(true),
          valores: { nome: r.nome, tara: r.tara, ativo: r.ativo ? 'true' : 'false' },
          aoSalvar: async (valores) => {
            const { dados: salvo, origem } = await atualizarRecipiente(r.uuid ?? r.id, valores)

            if (origem === 'exemplo') {
              Object.assign(r, salvo)
              renderRecipientes()
              return `${salvo.nome} alterado só nesta sessão — o Neon não está configurado.`
            }

            await recarregarRecipientes()
            if (cardHistorico.dataset.recipiente === (salvo.uuid ?? salvo.id)) {
              await abrirHistorico(salvo.uuid ?? salvo.id)
            }
            return `${salvo.nome} atualizado.`
          },
        })
      }

      async function abrirHistorico(id) {
        const r = acharTara(id)
        if (!r) return

        cardHistorico.dataset.recipiente = id
        cardHistorico.hidden = false
        cardHistorico.innerHTML = `
          ${cardHead({
            titulo: 'Histórico de alteração da tara',
            descricao: r.nome,
            acoes:
              '<button class="btn btn--ghost" type="button" data-acao="fechar-historico"><i data-lucide="x"></i><span>Fechar</span></button>',
          })}
          <p class="table__count" id="contagem-historico">Carregando...</p>
          ${tabela({ colunas: colunasHistorico(false), linhas: [], id: 'tabela-historico' })}
        `
        renderIcons(cardHistorico)
        cardHistorico.querySelector('[data-acao="fechar-historico"]').addEventListener('click', fecharHistorico)

        const { dados, origem } = await listarHistoricoRecipiente(r.uuid ?? r.id)
        const contagemHist = cardHistorico.querySelector('#contagem-historico')

        if (origem === 'exemplo' && !dados.length) {
          contagemHist.textContent = 'Histórico disponível só com o banco configurado.'
          return
        }

        const comAutor = dados.some((h) => h.autor)
        atualizarTabela(cardHistorico, 'tabela-historico', colunasHistorico(comAutor), dados)
        contagemHist.textContent = dados.length
          ? `${dados.length} alteração(ões) registrada(s)`
          : 'Nenhuma alteração registrada — a tara está como foi cadastrada.'
        renderIcons(cardHistorico)
      }

      function fecharHistorico() {
        cardHistorico.hidden = true
        cardHistorico.innerHTML = ''
        delete cardHistorico.dataset.recipiente
      }

      /* ---------------------------------------------- botões do topo ------ */

      root
        .querySelector('[data-acao="novo-produto"]')
        ?.addEventListener('click', novoProduto)
      root
        .querySelector('[data-acao="novo-recipiente"]')
        ?.addEventListener('click', novoRecipiente)

      return () => {
        window.removeEventListener('busca-global', aoBuscarGlobal)
        pararProdutos()
        pararRecipientes()
      }
    },
  }
}
