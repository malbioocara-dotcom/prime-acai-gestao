import { produtos as produtosExemplo } from '../data.js'
import { confirmar, paraNumero } from '../formulario.js'
import { renderIcons } from '../icons.js'
import { ajustarSaldo } from '../services/movimentacoes.js'
import { listarCategorias } from '../services/categorias.js'
import { pode } from '../services/permissoes.js'
import {
  IMAGEM_PRODUTO_TAMANHO_MAX,
  carregarImagemProduto,
  listarImagensProdutos,
  validarImagemProduto,
} from '../services/imagens-produtos.js'
import {
  METODOS_ESTOQUE,
  TIPOS_VENDA,
  atualizarProduto,
  criarProduto,
  listarProdutos,
  normalizarProduto,
  proximoCodigoProduto,
  salvarProdutoComImagem,
  unidadeDeVenda,
} from '../services/produtos.js'
import { badge, esc, formatBRL, formatNumero, tabela, toast } from '../ui.js'

const METODOS_PESO = [
  { valor: 'bruto_tara', rotulo: 'Peso bruto (descontar a tara)' },
  { valor: 'liquido', rotulo: 'Peso líquido (tara já descontada)' },
]
const SITUACOES = [
  { valor: 'true', rotulo: 'Ativo' },
  { valor: 'false', rotulo: 'Inativo' },
]
const TAMANHO_PAGINA = 20
const ICONE_PADRAO = '<span class="produtos__foto-fallback" aria-hidden="true"><i data-lucide="image"></i></span>'

const formatarProduto = (produto) => ({
  codigo: produto.id,
  nome: produto.nome,
  descricao: produto.descricao ?? '',
  categoria: produto.categoria,
  tipoVenda: produto.tipoVenda,
  metodoPeso: produto.metodoPeso ?? 'bruto_tara',
  preco: produto.preco,
  unidade: produto.unidade,
  controlaEstoque: produto.controlaEstoque ? 'true' : 'false',
  metodoEstoque: produto.metodoEstoque,
  minimo: produto.minimo,
  custo: produto.custo,
  ativo: produto.ativo ? 'true' : 'false',
})

function statusProduto(produto) {
  if (!produto.ativo) return badge('Inativo', 'neutral')
  if (!produto.controlaEstoque) return badge('Sem controle', 'neutral')
  if (produto.quantidade < produto.minimo) return badge('Repor', 'danger')
  return badge('Ativo', 'success')
}

function opcoesHtml(opcoes, selecionado) {
  return opcoes
    .map(({ valor, rotulo }) => `<option value="${esc(valor)}"${String(valor) === String(selecionado) ? ' selected' : ''}>${esc(rotulo)}</option>`)
    .join('')
}

function campo({ nome, label, valor = '', tipo = 'text', opcoes, ajuda = '', obrigatorio = false, largo = false }) {
  const id = `produto-${nome}`
  const control = opcoes
    ? `<select id="${id}" name="${nome}" class="campo__input"${obrigatorio ? ' required' : ''}><option value="">Selecione...</option>${opcoesHtml(opcoes, valor)}</select>`
    : tipo === 'textarea'
      ? `<textarea id="${id}" name="${nome}" class="campo__input" rows="3"${obrigatorio ? ' required' : ''}>${esc(valor)}</textarea>`
      : `<input id="${id}" name="${nome}" class="campo__input" type="${tipo}" value="${esc(valor)}"${tipo === 'number' ? ' min="0" step="0.01" inputmode="decimal"' : ''}${obrigatorio ? ' required' : ''} />`
  return `<div class="campo${largo ? ' campo--largo' : ''}">
    <label class="campo__label" for="${id}">${esc(label)}${obrigatorio ? ' <span class="campo__req">*</span>' : ''}</label>
    ${control}
    ${ajuda ? `<p class="campo__ajuda">${esc(ajuda)}</p>` : ''}
  </div>`
}

function colunasProdutos({ podeEditar }) {
  return [
    {
      key: 'produto',
      label: 'Produto',
      render: (produto) => `
        <span class="produtos__item">
          <span class="produtos__foto" data-foto-wrap="${esc(produto.uuid ?? '')}">
            ${produto.imagemPath ? `<img data-foto-produto="${esc(produto.uuid)}" alt="" loading="lazy" hidden />` : ''}
            ${ICONE_PADRAO}
          </span>
          <span><strong class="cell-main">${esc(produto.nome)}</strong><span class="cell-sub mono">${esc(produto.id)}</span></span>
        </span>`,
    },
    { key: 'categoria', label: 'Categoria', render: (produto) => esc(produto.categoria) },
    {
      key: 'tipo',
      label: 'Tipo e unidade',
      render: (produto) => `${esc(TIPOS_VENDA[produto.tipoVenda] ?? produto.tipoVenda)}<span class="cell-sub">${esc(unidadeDeVenda(produto.tipoVenda))}</span>`,
    },
    { key: 'preco', label: 'Preço', align: 'right', render: (produto) => `<strong>${formatBRL(produto.preco)}</strong><span class="cell-sub">${produto.tipoVenda === 'unidade' ? '' : `/ ${esc(unidadeDeVenda(produto.tipoVenda))}`}</span>` },
    {
      key: 'estoque',
      label: 'Estoque',
      align: 'right',
      render: (produto) => produto.controlaEstoque
        ? `${formatNumero(produto.quantidade)} ${esc(produto.unidade)}<span class="cell-sub">mínimo ${formatNumero(produto.minimo)} ${esc(produto.unidade)}</span>`
        : '<span class="muted">Sem controle</span>',
    },
    { key: 'situacao', label: 'Situação', render: statusProduto },
    {
      key: 'acoes',
      label: 'Ações',
      render: (produto) => `<div class="table__acoes">
        ${podeEditar ? `<button class="btn btn--ghost btn--sm" type="button" data-editar-produto="${esc(produto.uuid ?? produto.id)}" aria-label="Editar ${esc(produto.nome)}"><i data-lucide="pencil"></i><span>Editar</span></button>
        <button class="btn btn--ghost btn--sm" type="button" data-alternar-produto="${esc(produto.uuid ?? produto.id)}" aria-label="${produto.ativo ? 'Inativar' : 'Ativar'} ${esc(produto.nome)}"><i data-lucide="${produto.ativo ? 'pause' : 'play'}"></i><span>${produto.ativo ? 'Inativar' : 'Ativar'}</span></button>` : '<span class="muted">—</span>'}
      </div>`,
    },
  ]
}

export function produtosPage() {
  const podeCriar = pode('estoque', 'criar')
  const podeEditar = pode('estoque', 'editar')
  const colunas = colunasProdutos({ podeEditar })

  return {
    html: `
      <div class="produtos">
        <section class="produtos__intro">
          <div>
            <p class="produtos__eyebrow">CATÁLOGO</p>
            <h2>Produtos e insumos</h2>
            <p>Organize o catálogo do PDV, os preços e as regras de estoque em um só lugar.</p>
          </div>
          <div class="produtos__intro-acoes">
            <a class="btn btn--ghost" href="#/estoque"><i data-lucide="boxes"></i><span>Ver movimentações de estoque</span></a>
            ${podeCriar ? '<button class="btn btn--primary" id="produto-novo" type="button"><i data-lucide="plus"></i><span> Novo produto</span></button>' : ''}
          </div>
        </section>

        <p class="produtos__aviso" id="produtos-aviso" role="status" hidden></p>
        <p class="produtos__erro" id="produtos-erro" role="alert" hidden></p>

        <section class="card" id="produtos-listagem" aria-labelledby="produtos-lista-titulo">
          <header class="produtos__lista-head">
            <div><h2 id="produtos-lista-titulo">Catálogo</h2><p id="produtos-contagem" class="card__desc">Carregando produtos...</p></div>
          </header>
          <div class="produtos__filtros">
            <label class="search search--inline" for="produtos-busca"><i data-lucide="search"></i><input id="produtos-busca" type="search" placeholder="Buscar nome, código ou categoria..." autocomplete="off" /></label>
            <label class="produtos__filtro" for="produtos-filtro-categoria"><span>Categoria</span><select id="produtos-filtro-categoria" class="campo__input"><option value="">Todas</option></select></label>
            <label class="produtos__filtro" for="produtos-filtro-tipo"><span>Tipo</span><select id="produtos-filtro-tipo" class="campo__input"><option value="">Todos</option>${opcoesHtml(Object.entries(TIPOS_VENDA).map(([valor, rotulo]) => ({ valor, rotulo })), '')}</select></label>
            <label class="produtos__filtro" for="produtos-filtro-status"><span>Situação</span><select id="produtos-filtro-status" class="campo__input"><option value="">Todas</option>${opcoesHtml(SITUACOES, '')}</select></label>
          </div>
          <p class="table__count" id="produtos-pagina"></p>
          <div id="produtos-tabela">${tabela({ colunas, linhas: [], id: 'tabela-produtos' })}</div>
          <nav class="produtos__paginacao" aria-label="Paginação do catálogo">
            <button class="btn btn--ghost btn--sm" id="produtos-anterior" type="button" aria-label="Página anterior"><i data-lucide="chevron-left"></i><span>Anterior</span></button>
            <span id="produtos-pagina-atual" aria-live="polite"></span>
            <button class="btn btn--ghost btn--sm" id="produtos-proxima" type="button" aria-label="Próxima página"><span>Próxima</span><i data-lucide="chevron-right"></i></button>
          </nav>
        </section>

        <section class="card produtos__editor" id="produto-editor" hidden aria-labelledby="produto-editor-titulo">
          <header class="produtos__editor-head">
            <div><p class="produtos__eyebrow">CADASTRO</p><h2 id="produto-editor-titulo">Novo produto</h2><p id="produto-editor-desc" class="card__desc">Preencha os dados comerciais e de estoque.</p></div>
            <button class="btn btn--ghost" type="button" data-voltar-lista><i data-lucide="arrow-left"></i><span>Voltar à listagem</span></button>
          </header>
          <p class="produtos__erro" id="produto-form-erro" role="alert" hidden></p>
          <form id="produto-form" novalidate>
            <section class="produtos__secao" aria-labelledby="produto-geral-titulo">
              <div class="produtos__secao-head"><span class="produtos__secao-icone"><i data-lucide="align-left"></i></span><div><h3 id="produto-geral-titulo">Informações gerais</h3><p>Identificação e descrição do item.</p></div></div>
              <div class="produtos__campos">
                ${campo({ nome: 'codigo', label: 'Código / SKU', obrigatorio: true })}
                ${campo({ nome: 'nome', label: 'Nome do produto', obrigatorio: true })}
                ${campo({ nome: 'descricao', label: 'Descrição', tipo: 'textarea', largo: true })}
              </div>
            </section>
            <section class="produtos__secao" aria-labelledby="produto-imagem-titulo">
              <div class="produtos__secao-head"><span class="produtos__secao-icone"><i data-lucide="image"></i></span><div><h3 id="produto-imagem-titulo">Imagem do produto</h3><p>Foto persistente para identificar o produto no catálogo e no PDV.</p></div></div>
              <div class="produtos__imagem-editor">
                <div class="produtos__imagem-preview" id="produto-imagem-preview" aria-live="polite">${ICONE_PADRAO}<span>Sem imagem cadastrada</span></div>
                <div class="produtos__imagem-acoes">
                  <input class="produtos__arquivo" id="produto-imagem-arquivo" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-describedby="produto-imagem-ajuda produto-imagem-estado" />
                  <label class="btn btn--ghost" for="produto-imagem-arquivo"><i data-lucide="upload"></i><span>Selecionar imagem</span></label>
                  <button class="btn btn--ghost" id="produto-imagem-remover" type="button" disabled><i data-lucide="trash-2"></i><span>Remover imagem</span></button>
                  <p id="produto-imagem-ajuda" class="campo__ajuda">JPG, PNG ou WebP. Tamanho máximo: ${Math.round(IMAGEM_PRODUTO_TAMANHO_MAX / 1024)} KiB.</p>
                  <p class="campo__ajuda" id="produto-imagem-estado" role="status">A imagem só será confirmada após salvar o produto.</p>
                  <p class="produtos__erro" id="produto-imagem-erro" role="alert" hidden></p>
                </div>
              </div>
            </section>
            <section class="produtos__secao" aria-labelledby="produto-classificacao-titulo">
              <div class="produtos__secao-head"><span class="produtos__secao-icone"><i data-lucide="tags"></i></span><div><h3 id="produto-classificacao-titulo">Categoria e classificação</h3><p>Defina como o item será vendido no PDV.</p></div></div>
              <div class="produtos__campos">
                ${campo({ nome: 'categoria', label: 'Categoria', opcoes: [], obrigatorio: true, ajuda: 'Selecione uma categoria ativa. Gerencie categorias em Configurações → Produtos.' })}
                ${campo({ nome: 'tipoVenda', label: 'Tipo de venda', opcoes: Object.entries(TIPOS_VENDA).map(([valor, rotulo]) => ({ valor, rotulo })) })}
                ${campo({ nome: 'metodoPeso', label: 'Entrada do peso', opcoes: METODOS_PESO, ajuda: 'Produtos por peso usam o preço por kg e preservam o cálculo de tara.' })}
              </div>
            </section>
            <section class="produtos__secao" aria-labelledby="produto-preco-titulo">
              <div class="produtos__secao-head"><span class="produtos__secao-icone"><i data-lucide="circle-dollar-sign"></i></span><div><h3 id="produto-preco-titulo">Preços e unidades</h3><p>O preço por kg não é confundido com o total calculado da venda.</p></div></div>
              <div class="produtos__campos">
                ${campo({ nome: 'preco', label: 'Preço de venda', tipo: 'number', obrigatorio: true })}
                ${campo({ nome: 'unidade', label: 'Unidade de estoque', opcoes: ['un', 'kg', 'g', 'L', 'ml', 'porção'].map((valor) => ({ valor, rotulo: valor.toLocaleUpperCase('pt-BR') })) })}
                ${campo({ nome: 'custo', label: 'Custo', tipo: 'number' })}
              </div>
            </section>
            <section class="produtos__secao" aria-labelledby="produto-estoque-titulo">
              <div class="produtos__secao-head"><span class="produtos__secao-icone"><i data-lucide="boxes"></i></span><div><h3 id="produto-estoque-titulo">Controle de estoque</h3><p>O saldo é gerido pelo livro-razão de movimentações, sem ajustes indevidos ao editar.</p></div></div>
              <div class="produtos__campos">
                ${campo({ nome: 'controlaEstoque', label: 'Controlar estoque', opcoes: [{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }] })}
                ${campo({ nome: 'metodoEstoque', label: 'Método de controle', opcoes: Object.entries(METODOS_ESTOQUE).map(([valor, rotulo]) => ({ valor, rotulo })) })}
                ${campo({ nome: 'minimo', label: 'Estoque mínimo', tipo: 'number' })}
                ${campo({ nome: 'quantidade', label: 'Saldo inicial', tipo: 'number', ajuda: 'Em novo cadastro, o saldo inicial é lançado como contagem de abertura.' })}
              </div>
            </section>
            <section class="produtos__secao" aria-labelledby="produto-status-titulo">
              <div class="produtos__secao-head"><span class="produtos__secao-icone"><i data-lucide="circle-check"></i></span><div><h3 id="produto-status-titulo">Status e configurações</h3><p>Produtos inativos permanecem no histórico e podem ser reativados.</p></div></div>
              <div class="produtos__campos">${campo({ nome: 'ativo', label: 'Situação', opcoes: SITUACOES })}</div>
            </section>
            <footer class="produtos__acoes">
              <button class="btn btn--ghost" type="button" data-voltar-lista>Cancelar</button>
              <button class="btn btn--primary" type="submit" id="produto-salvar"><i data-lucide="save"></i><span>Salvar produto</span></button>
            </footer>
          </form>
        </section>
      </div>
    `,

    mount(root) {
      let itens = produtosExemplo
      let categoriasAtivas = []
      let categoriasDisponiveis = false
      let imagemPaths = new Map()
      let imagemStorageDisponivel = false
      let pagina = 0
      let editando = null
      let arquivoImagem = null
      let removerImagem = false
      let urlPrevia = null
      let observerFotos = null
      const urlsImagens = new Map()
      const desmontadores = []
      const categoriasCarregadas = listarCategorias({ somenteAtivas: true })
        .then((resultado) => {
          categoriasAtivas = resultado.dados
          categoriasDisponiveis = true
        })
        .catch((erro) => {
          categoriasDisponiveis = false
          categoriasAtivas = []
          console.error('[produtos] Não foi possível consultar categorias ativas.', erro)
        })

      const lista = root.querySelector('#produtos-listagem')
      const editor = root.querySelector('#produto-editor')
      const aviso = root.querySelector('#produtos-aviso')
      const erroLista = root.querySelector('#produtos-erro')
      const formErro = root.querySelector('#produto-form-erro')
      const form = root.querySelector('#produto-form')
      const fileInput = root.querySelector('#produto-imagem-arquivo')
      const imagePreview = root.querySelector('#produto-imagem-preview')
      const imageError = root.querySelector('#produto-imagem-erro')
      const imageStatus = root.querySelector('#produto-imagem-estado')
      const imageRemove = root.querySelector('#produto-imagem-remover')
      const botaoSalvar = root.querySelector('#produto-salvar')
      const busca = root.querySelector('#produtos-busca')
      const filtroCategoria = root.querySelector('#produtos-filtro-categoria')
      const filtroTipo = root.querySelector('#produtos-filtro-tipo')
      const filtroStatus = root.querySelector('#produtos-filtro-status')

      function limparPrevia() {
        if (urlPrevia) URL.revokeObjectURL(urlPrevia)
        urlPrevia = null
      }

      function mostrarPrevia(url, alt = 'Prévia da imagem do produto') {
        imagePreview.innerHTML = url
          ? `<img src="${esc(url)}" alt="${esc(alt)}" />`
          : `${ICONE_PADRAO}<span>Sem imagem cadastrada</span>`
        renderIcons(imagePreview)
      }

      function avisoImagem(mensagem = '') {
        imageError.hidden = !mensagem
        imageError.textContent = mensagem
      }

      function manterAvisoStorage() {
        const podeEnviar = imagemStorageDisponivel && (podeCriar || podeEditar)
        fileInput.disabled = !podeEnviar
        imageRemove.disabled = !podeEnviar || (!editando?.imagemPath && !arquivoImagem)
        aviso.hidden = imagemStorageDisponivel
        aviso.textContent = imagemStorageDisponivel
          ? ''
          : 'Fotos não estão disponíveis para envio persistente. ' +
            (neonOrigem === 'exemplo'
              ? 'Configure o Neon e aplique a migração 19 para habilitar este recurso.'
              : mensagemStorage ?? 'O recurso de imagens não foi configurado.')
      }

      let neonOrigem = 'exemplo'
      let mensagemStorage = ''

      function filtrar() {
        const termo = busca.value.trim().toLocaleLowerCase('pt-BR')
        const categoria = filtroCategoria.value
        const tipo = filtroTipo.value
        const status = filtroStatus.value
        return itens.filter((produto) => {
          const correspondeBusca = !termo || [produto.id, produto.nome, produto.categoria, produto.descricao]
            .join(' ').toLocaleLowerCase('pt-BR').includes(termo)
          return correspondeBusca &&
            (!categoria || produto.categoria === categoria) &&
            (!tipo || produto.tipoVenda === tipo) &&
            (status === '' || String(produto.ativo) === status)
        })
      }

      function renderCategorias() {
        const selecionada = filtroCategoria.value
        const categorias = [...new Set([
          ...categoriasAtivas.map((item) => item.nome),
          ...itens.map((p) => p.categoria).filter(Boolean),
        ])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
        filtroCategoria.innerHTML = `<option value="">Todas</option>${categorias.map((categoria) => `<option value="${esc(categoria)}">${esc(categoria)}</option>`).join('')}`
        filtroCategoria.value = categorias.includes(selecionada) ? selecionada : ''
      }

      function opcoesCategoria(atual = '') {
        const opcoes = categoriasAtivas.map(({ nome }) => ({ valor: nome, rotulo: nome }))
        if (atual && !opcoes.some(({ valor }) => valor === atual)) {
          opcoes.push({ valor: atual, rotulo: `${atual} (categoria inativa)` })
        }
        return opcoes
      }

      function configurarCampoCategoria(valor) {
        const campoAtual = form.elements.namedItem('categoria')
        const recipiente = campoAtual.closest('.campo')
        const ajuda = recipiente.querySelector('.campo__ajuda')

        if (categoriasDisponiveis) {
          const select = campoAtual.tagName === 'SELECT' ? campoAtual : document.createElement('select')
          select.id = 'produto-categoria'
          select.name = 'categoria'
          select.className = 'campo__input'
          select.required = true
          select.innerHTML = `<option value="">Selecione...</option>${opcoesHtml(opcoesCategoria(valor), valor)}`
          if (campoAtual !== select) campoAtual.replaceWith(select)
          ajuda.textContent = categoriasAtivas.length
            ? 'Selecione uma categoria ativa. Categorias inativas existentes são preservadas na edição.'
            : 'Nenhuma categoria ativa. Cadastre uma em Configurações → Produtos.'
          if (!categoriasAtivas.length && !editando) {
            formErro.hidden = false
            formErro.textContent = 'Não há categorias ativas para novos produtos. Cadastre uma categoria antes de continuar.'
          }
          return
        }

        const input = campoAtual.tagName === 'INPUT' ? campoAtual : document.createElement('input')
        input.id = 'produto-categoria'
        input.name = 'categoria'
        input.className = 'campo__input'
        input.required = true
        input.type = 'text'
        input.setAttribute('list', 'produto-categorias-legadas')
        input.value = valor ?? ''
        if (campoAtual !== input) campoAtual.replaceWith(input)
        let lista = recipiente.querySelector('#produto-categorias-legadas')
        if (!lista) {
          lista = document.createElement('datalist')
          lista.id = 'produto-categorias-legadas'
          recipiente.append(lista)
        }
        lista.innerHTML = [...new Set(itens.map((item) => item.categoria).filter(Boolean))]
          .map((nome) => `<option value="${esc(nome)}"></option>`)
          .join('')
        ajuda.textContent = 'Catálogo temporariamente indisponível; informe uma categoria ou use uma já existente.'
      }

      async function carregarFotoDaLinha(img) {
        const id = img.dataset.fotoProduto
        if (!id || !imagemStorageDisponivel) return
        try {
          let url = [...urlsImagens.keys()].find((chave) => chave === id)
          if (!url) {
            const blob = await carregarImagemProduto(id)
            if (!blob) return
            url = URL.createObjectURL(blob)
            urlsImagens.set(id, url)
          }
          img.src = url
          img.hidden = false
          img.closest('[data-foto-wrap]')?.classList.add('has-image')
          const fallback = img.parentElement.querySelector('.produtos__foto-fallback')
          if (fallback) fallback.hidden = true
        } catch (erro) {
          console.error(`[produtos] Não foi possível carregar a foto do produto ${id}.`, erro)
        }
      }

      function imagemQuebrou(evento) {
        if (evento.target?.tagName !== 'IMG') return
        evento.target.hidden = true
        const wrap = evento.target.closest('[data-foto-wrap]')
        if (wrap) {
          wrap.classList.remove('has-image')
          const fallback = wrap.querySelector('.produtos__foto-fallback')
          if (fallback) fallback.hidden = false
        } else if (evento.target.parentElement === imagePreview) {
          mostrarPrevia(null)
          imageStatus.textContent = 'A imagem não pôde ser exibida. O produto continua salvo.'
        }
      }

      function observarFotos() {
        observerFotos?.disconnect()
        const imagens = root.querySelectorAll('[data-foto-produto]')
        if (typeof IntersectionObserver === 'undefined') return
        observerFotos = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              observerFotos.unobserve(entry.target)
              carregarFotoDaLinha(entry.target)
            }
          })
        }, { rootMargin: '80px' })
        imagens.forEach((img) => observerFotos.observe(img))
      }

      function renderProdutos() {
        const filtrados = filtrar()
        const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANHO_PAGINA))
        pagina = Math.min(pagina, totalPaginas - 1)
        const inicio = pagina * TAMANHO_PAGINA
        const linhas = filtrados.slice(inicio, inicio + TAMANHO_PAGINA).map((produto) => ({
          ...produto,
          imagemPath: imagemPaths.has(produto.uuid) ? imagemPaths.get(produto.uuid) : null,
        }))
        const tbody = root.querySelector('#tabela-produtos tbody')
        tbody.innerHTML = linhas.length
          ? tabela({ colunas, linhas, id: 'tabela-produtos' }).match(/<tbody>([\s\S]*?)<\/tbody>/)[1]
          : `<tr><td class="table__vazio" colspan="${colunas.length}">${itens.length ? 'Nenhum produto corresponde aos filtros.' : 'Nenhum produto cadastrado.'}</td></tr>`
        root.querySelector('#produtos-contagem').textContent = `${filtrados.length} produto(s) encontrado(s) · ${itens.length} no total`
        root.querySelector('#produtos-pagina').textContent = filtrados.length
          ? `Exibindo ${inicio + 1}–${Math.min(inicio + TAMANHO_PAGINA, filtrados.length)} de ${filtrados.length}`
          : 'Ajuste a busca ou os filtros para encontrar produtos.'
        root.querySelector('#produtos-pagina-atual').textContent = `${pagina + 1} / ${totalPaginas}`
        root.querySelector('#produtos-anterior').disabled = pagina === 0
        root.querySelector('#produtos-proxima').disabled = pagina >= totalPaginas - 1
        renderIcons(root)
        ligarAcoes()
        observarFotos()
      }

      function campoValor(nome, valor) {
        const alvo = form.elements.namedItem(nome)
        if (alvo) alvo.value = valor ?? ''
      }

      function definirTipoVenda() {
        const tipo = form.elements.namedItem('tipoVenda').value
        const unidade = form.elements.namedItem('unidade')
        if (tipo === 'peso') unidade.value = 'kg'
        root.querySelector('label[for="produto-preco"]').textContent =
          `Preço de venda por ${unidadeDeVenda(tipo)}`
      }

      async function abrirEditor(produto = null) {
        await categoriasCarregadas
        editando = produto
        arquivoImagem = null
        removerImagem = false
        limparPrevia()
        avisoImagem()
        formErro.hidden = true
        form.reset()
        root.querySelector('#produto-editor-titulo').textContent = produto ? `Editar ${produto.nome}` : 'Novo produto'
        root.querySelector('#produto-editor-desc').textContent = produto
          ? 'Atualize o cadastro comercial. O saldo continua sendo controlado pelas movimentações.'
          : 'Preencha os dados comerciais e de estoque do novo item.'
        const valores = produto ? formatarProduto(produto) : {
          codigo: proximoCodigoProduto(itens),
          nome: '',
          descricao: '',
          categoria: '',
          tipoVenda: 'unidade',
          metodoPeso: 'bruto_tara',
          preco: '0',
          unidade: 'un',
          controlaEstoque: 'true',
          metodoEstoque: 'movimentacoes',
          minimo: '0',
          quantidade: '0',
          custo: '0',
          ativo: 'true',
        }
        configurarCampoCategoria(valores.categoria)
        Object.entries(valores).forEach(([nome, valor]) => campoValor(nome, valor))
        form.elements.namedItem('quantidade').disabled = Boolean(produto)
        form.elements.namedItem('quantidade').closest('.campo').hidden = Boolean(produto)
        fileInput.value = ''
        imageRemove.disabled = true
        mostrarPrevia(null)
        imageStatus.textContent = 'A imagem só será confirmada após salvar o produto.'
        manterAvisoStorage()
        if (produto?.imagemPath && imagemStorageDisponivel) {
          imageStatus.textContent = 'Carregando imagem salva…'
          try {
            const blob = await carregarImagemProduto(produto.uuid)
            if (blob && editando === produto) {
              urlPrevia = URL.createObjectURL(blob)
              mostrarPrevia(urlPrevia, produto.nome)
              imageRemove.disabled = !podeEditar
              imageStatus.textContent = 'Imagem persistida. Salve para substituir ou remover.'
            } else {
              imageStatus.textContent = 'Não foi encontrada uma imagem salva para este produto.'
            }
          } catch (erro) {
            imageStatus.textContent = erro.message
          }
        }
        lista.hidden = true
        editor.hidden = false
        root.querySelector('#produto-nome').focus()
      }

      function voltarLista() {
        limparPrevia()
        arquivoImagem = null
        removerImagem = false
        editando = null
        editor.hidden = true
        lista.hidden = false
        form.reset()
      }

      async function recarregar() {
        erroLista.hidden = true
        const resultado = await listarProdutos({ incluirInativos: true })
        itens = resultado.dados
        neonOrigem = resultado.origem
        await categoriasCarregadas
        try {
          const imagens = await listarImagensProdutos(itens.map((produto) => produto.uuid).filter(Boolean))
          imagemStorageDisponivel = imagens.disponivel
          imagemPaths = imagens.imagens
          mensagemStorage = imagens.mensagem ?? ''
          itens = itens.map((produto) => ({
            ...produto,
            imagemPath: imagemPaths.get(produto.uuid) ?? null,
          }))
        } catch (erro) {
          imagemStorageDisponivel = false
          mensagemStorage = 'Não foi possível consultar o armazenamento de imagens. As fotos foram desativadas para evitar alterações incompletas.'
          console.error('[produtos] Falha ao consultar imagens persistidas.', erro)
        }
        renderCategorias()
        manterAvisoStorage()
        renderProdutos()
      }

      function lerValores() {
        const get = (nome) => form.elements.namedItem(nome)?.value ?? ''
        return {
          codigo: get('codigo'),
          nome: get('nome'),
          descricao: get('descricao'),
          categoria: get('categoria'),
          tipoVenda: get('tipoVenda'),
          metodoPeso: get('metodoPeso'),
          preco: paraNumero(get('preco')),
          unidade: get('unidade'),
          controlaEstoque: get('controlaEstoque'),
          metodoEstoque: get('metodoEstoque'),
          minimo: paraNumero(get('minimo')),
          custo: paraNumero(get('custo')),
          ativo: get('ativo'),
          quantidade: paraNumero(get('quantidade')),
        }
      }

      async function salvar(evento) {
        evento.preventDefault()
        formErro.hidden = true
        avisoImagem()
        if (!form.reportValidity()) return
        botaoSalvar.disabled = true
        const textoBotao = botaoSalvar.innerHTML
        botaoSalvar.innerHTML = '<span>Salvando produto…</span>'

        try {
          const valores = lerValores()
          normalizarProduto(valores)
          let resultado
          if (!editando && arquivoImagem) {
            resultado = await salvarProdutoComImagem(null, valores, { arquivo: arquivoImagem })
          } else if (editando && (arquivoImagem || removerImagem)) {
            resultado = await salvarProdutoComImagem(editando.uuid, valores, {
              arquivo: arquivoImagem,
              remover: removerImagem,
            })
          } else if (editando) {
            resultado = await atualizarProduto(editando.uuid ?? editando.id, {
              ...valores,
              quantidade: editando.quantidade,
            })
          } else {
            resultado = await criarProduto(valores)
          }

          const salvo = resultado.dados
          let mensagem = `${salvo.nome} ${editando ? 'atualizado' : 'cadastrado'}${resultado.origem === 'exemplo' ? ' apenas nesta sessão — o Neon não está configurado' : ''}.`
          if (!editando && resultado.origem === 'neon' && valores.quantidade > 0) {
            try {
              await ajustarSaldo({
                produtoId: salvo.uuid,
                contado: valores.quantidade,
                motivo: 'Saldo inicial do cadastro',
                local: 'abertura',
              })
            } catch (erro) {
              mensagem += ` O saldo inicial não foi registrado: ${erro?.message ?? erro}`
            }
          }

          if (arquivoImagem || removerImagem) {
            const idImagem = editando?.uuid ?? salvo.uuid
            const urlAntiga = idImagem ? urlsImagens.get(idImagem) : null
            if (urlAntiga) URL.revokeObjectURL(urlAntiga)
            if (idImagem) urlsImagens.delete(idImagem)
          }
          await recarregar()
          voltarLista()
          toast(mensagem)
        } catch (erro) {
          console.error('[produtos] Não foi possível salvar o cadastro.', erro)
          formErro.textContent = erro?.message ?? 'Não foi possível salvar o produto.'
          formErro.hidden = false
        } finally {
          botaoSalvar.disabled = false
          botaoSalvar.innerHTML = textoBotao
          renderIcons(botaoSalvar)
        }
      }

      function ligarAcoes() {
        root.querySelectorAll('[data-editar-produto]').forEach((botao) => {
          botao.addEventListener('click', () => {
            const produto = itens.find((item) => (item.uuid ?? item.id) === botao.dataset.editarProduto)
            if (produto) abrirEditor(produto)
          })
        })
        root.querySelectorAll('[data-alternar-produto]').forEach((botao) => {
          botao.addEventListener('click', async () => {
            const produto = itens.find((item) => (item.uuid ?? item.id) === botao.dataset.alternarProduto)
            if (!produto) return
            const ativar = !produto.ativo
            const aceitou = await confirmar({
              titulo: `${ativar ? 'Ativar' : 'Inativar'} ${produto.nome}?`,
              descricao: ativar
                ? 'O produto voltará a aparecer nas opções do PDV.'
                : 'O produto deixa de aparecer em novas vendas. O histórico será preservado.',
              textoBotao: ativar ? 'Ativar produto' : 'Inativar produto',
            })
            if (!aceitou) return
            try {
              await atualizarProduto(produto.uuid ?? produto.id, {
                ...formatarProduto(produto),
                ativo: ativar ? 'true' : 'false',
                quantidade: produto.quantidade,
              })
              await recarregar()
              toast(`${produto.nome} ${ativar ? 'ativado' : 'inativado'}.`)
            } catch (erro) {
              erroLista.textContent = `Não foi possível alterar a situação: ${erro?.message ?? erro}`
              erroLista.hidden = false
            }
          })
        })
      }

      fileInput.addEventListener('change', async () => {
        const arquivo = fileInput.files?.[0]
        if (!arquivo) return
        try {
          const validacao = await validarImagemProduto(arquivo)
          if (!validacao.ok) throw new Error(validacao.mensagem)
          limparPrevia()
          arquivoImagem = arquivo
          removerImagem = false
          urlPrevia = URL.createObjectURL(arquivo)
          mostrarPrevia(urlPrevia, arquivo.name)
          imageRemove.disabled = !imagemStorageDisponivel || (!editando && !arquivoImagem)
          imageStatus.textContent = `Pronta para salvar (${(arquivo.size / 1024).toFixed(0)} KiB).`
          avisoImagem()
        } catch (erro) {
          fileInput.value = ''
          avisoImagem(erro?.message ?? 'Não foi possível validar a imagem.')
        }
      })

      imageRemove.addEventListener('click', () => {
        limparPrevia()
        arquivoImagem = null
        removerImagem = Boolean(editando?.uuid && imagemPaths.has(editando.uuid))
        fileInput.value = ''
        mostrarPrevia(null)
        imageRemove.disabled = true
        imageStatus.textContent = removerImagem
          ? 'A imagem será removida ao salvar.'
          : 'Nenhuma imagem selecionada.'
        avisoImagem()
      })

      form.elements.namedItem('tipoVenda').addEventListener('change', definirTipoVenda)
      form.addEventListener('submit', salvar)
      root.addEventListener('error', imagemQuebrou, true)
      root.querySelector('#produto-novo')?.addEventListener('click', () => abrirEditor())
      root.querySelectorAll('[data-voltar-lista]').forEach((botao) => botao.addEventListener('click', voltarLista))
      busca.addEventListener('input', () => { pagina = 0; renderProdutos() })
      ;[filtroCategoria, filtroTipo, filtroStatus].forEach((filtro) =>
        filtro.addEventListener('change', () => { pagina = 0; renderProdutos() }),
      )
      root.querySelector('#produtos-anterior').addEventListener('click', () => {
        pagina = Math.max(0, pagina - 1)
        renderProdutos()
      })
      root.querySelector('#produtos-proxima').addEventListener('click', () => {
        pagina++
        renderProdutos()
      })
      const aoBuscarGlobal = (evento) => {
        busca.value = evento.detail
        pagina = 0
        renderProdutos()
      }
      window.addEventListener('busca-global', aoBuscarGlobal)
      desmontadores.push(() => window.removeEventListener('busca-global', aoBuscarGlobal))

      recarregar().catch((erro) => {
        console.error('[produtos] Não foi possível carregar o catálogo.', erro)
        erroLista.textContent = `Não foi possível carregar os produtos. ${erro?.message ?? erro}`
        erroLista.hidden = false
        root.querySelector('#produtos-contagem').textContent = 'Falha ao carregar o catálogo.'
      })

      return () => {
        observerFotos?.disconnect()
        root.removeEventListener('error', imagemQuebrou, true)
        limparPrevia()
        urlsImagens.forEach((url) => URL.revokeObjectURL(url))
        desmontadores.forEach((limpar) => limpar())
      }
    },
  }
}
