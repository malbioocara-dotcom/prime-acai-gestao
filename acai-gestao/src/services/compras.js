import { carregar, gravar, hoje } from './base.js'

/**
 * ============================================================================
 * Compras e entradas de mercadoria
 * ============================================================================
 *
 * O caminho da entrada é sempre o mesmo:
 *
 *   rascunho -> aguardando_recebimento -> (recebimento_parcial) ->
 *   recebido_confirmado
 *
 *   • Criar/editar a compra NÃO mexe no estoque.
 *   • Quem mexe é o RPC `confirmar_recebimento_compra` (migração 16), numa
 *     transação só: movimento `fornecedor -> estoque` no livro-razão, custo
 *     médio do produto e status da compra.
 *   • Compra recebida não é editável: o RLS da migration 16 recusa no banco,
 *     não é só a tela escondendo o botão.
 *
 * Unidade de compra x unidade de estoque
 *   `quantidade` e `custo` do item estão na unidade de COMPRA (caixa, fardo,
 *   kg...). `fator_conversao` diz quantas unidades de ESTOQUE existem em uma
 *   unidade de compra. O estoque recebe `quantidade * fator`.
 *
 *   Ex.: 3 caixas, fator 12, custo R$ 48,00 a caixa
 *        -> 36 un entram no estoque, a R$ 4,00 por unidade.
 *
 * Custo médio
 *   O custo do produto é recalculado pelo valor da entrada (incluindo rateio de
 *   frete e desconto). `produtos.preco` NÃO é tocado: preço de venda é decisão
 *   comercial, não consequência de uma compra.
 */

/** Status possíveis, com rótulo e tom usados na interface. */
export const STATUS_COMPRA = {
  rascunho: { rotulo: 'Rascunho', tom: 'neutral' },
  aguardando_recebimento: { rotulo: 'Aguardando recebimento', tom: 'warning' },
  recebimento_parcial: { rotulo: 'Recebimento parcial', tom: 'info' },
  recebido_confirmado: { rotulo: 'Recebido e confirmado', tom: 'success' },
  cancelado: { rotulo: 'Cancelado', tom: 'danger' },
}

export const STATUS_EDITAVEIS = ['rascunho', 'aguardando_recebimento']
export const STATUS_ABERTOS = ['rascunho', 'aguardando_recebimento', 'recebimento_parcial']

export const TIPOS_DOCUMENTO = {
  sem_nota: 'Sem nota fiscal',
  com_nota: 'Com nota fiscal',
}

export const rotuloStatus = (status) => STATUS_COMPRA[status]?.rotulo ?? status ?? '—'
export const tomStatus = (status) => STATUS_COMPRA[status]?.tom ?? 'neutral'

const CAMPOS_COMPRA = [
  'id',
  'organization_id',
  'numero',
  'data_compra',
  'data_recebimento',
  'fornecedor_id',
  'tipo_documento',
  'numero_nota',
  'observacoes',
  'desconto_valor',
  'frete_valor',
  'status',
  'usuario_id',
  'criado_em',
  'atualizado_em',
].join(', ')

const CAMPOS_ITEM = [
  'id',
  'compra_id',
  'produto_id',
  'nome',
  'unidade_compra',
  'fator_conversao',
  'quantidade_solicitada',
  'quantidade_recebida',
  'custo_unitario',
  'desconto_valor',
  'lote',
  'validade',
  'criado_em',
].join(', ')

const CAMPOS_FORNECEDOR = [
  'id',
  'organization_id',
  'nome',
  'cnpj',
  'telefone',
  'whatsapp',
  'email',
  'observacoes',
  'ativo',
  'criado_em',
  'atualizado_em',
].join(', ')

const CAMPOS_FORNECEDOR_SEM_WHATSAPP = CAMPOS_FORNECEDOR
  .split(', ')
  .filter((campo) => campo !== 'whatsapp')
  .join(', ')

const mensagemMigracaoWhatsApp =
  'O banco ainda não tem o campo WhatsApp dos fornecedores. Aplique a migração neon/23_whatsapp_fornecedores.sql e tente novamente.'

const erroColunaWhatsAppAusente = (erro) =>
  ['42703', 'PGRST204'].includes(erro?.code) && /whatsapp/i.test(`${erro.message ?? ''} ${erro.details ?? ''}`)

const semCampoWhatsApp = ({ whatsapp, ...registro }) => registro

async function gravarFornecedorCompat(escrever, whatsappInformado = false) {
  let resposta = await escrever(CAMPOS_FORNECEDOR, true)

  if (!resposta.error) return paraFornecedor(resposta.data)
  if (!erroColunaWhatsAppAusente(resposta.error)) throw resposta.error
  if (whatsappInformado) throw new Error(mensagemMigracaoWhatsApp)

  resposta = await escrever(CAMPOS_FORNECEDOR_SEM_WHATSAPP, false)
  if (resposta.error) throw resposta.error
  return paraFornecedor({ ...resposta.data, whatsapp: '' })
}

/* ------------------------------------------------------------ utilidades -- */

const numero = (valor) => {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

const texto = (valor) => String(valor ?? '').trim()

const opcional = (valor) => {
  const t = texto(valor)
  return t || null
}

const booleano = (valor) => valor === true || valor === 'true'

/** Id local para o modo demonstração (sem Neon). */
const idLocal = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`

/**
 * Traduz os erros técnicos do PostgREST em algo que o operador entende.
 * A mensagem original continua no console para quem for investigar.
 */
export function mensagemErro(erro) {
  const bruto = erro?.message ?? erro?.details ?? String(erro ?? '')

  if (/whatsapp/i.test(bruto) && /column|schema cache|does not exist|not found/i.test(bruto)) {
    return 'O banco ainda não tem o campo WhatsApp dos fornecedores. Aplique a migração neon/23_whatsapp_fornecedores.sql e tente novamente.'
  }
  if (/fornecedores_org_nome_unico|duplicate key.*fornecedor/i.test(bruto)) {
    return 'Já existe um fornecedor com esse nome. Renomeie ou reative o cadastro existente.'
  }
  if (/compras_org_numero_unico|duplicate key/i.test(bruto)) {
    return 'O número desta compra já existe. Salve de novo para gerar outro.'
  }
  if (/row-level security|permission denied|42501/i.test(bruto)) {
    return 'Sua conta não tem permissão para esta operação.'
  }
  if (/Sessão expirada|sessão/i.test(bruto)) {
    return 'Sessão expirada. Entre novamente.'
  }
  if (/quantidade recebida.*passa do saldo pendente|saldo pendente/i.test(bruto)) {
    return bruto
  }
  if (/Failed to fetch|NetworkError|ERR_/i.test(bruto)) {
    return 'Não foi possível falar com o banco. Confira a conexão.'
  }

  return bruto || 'Não foi possível concluir a operação.'
}

/* ------------------------------------------------------------ mapeamento -- */

export function paraItem(linha) {
  const quantidadeSolicitada = numero(linha.quantidade_solicitada)
  const custoUnitario = numero(linha.custo_unitario)
  const descontoValor = numero(linha.desconto_valor)

  return {
    id: linha.id,
    compraId: linha.compra_id,
    produtoId: linha.produto_id,
    nome: linha.nome ?? '',
    unidadeCompra: String(linha.unidade_compra ?? 'UN').toUpperCase(),
    fatorConversao: numero(linha.fator_conversao) || 1,
    quantidadeSolicitada,
    quantidadeRecebida: numero(linha.quantidade_recebida),
    custoUnitario,
    descontoValor,
    lote: linha.lote ?? '',
    validade: linha.validade ?? '',
    criadoEm: linha.criado_em ?? null,
    total: Math.max(0, quantidadeSolicitada * custoUnitario - descontoValor),
    pendente: Math.max(0, quantidadeSolicitada - numero(linha.quantidade_recebida)),
  }
}

export function paraFornecedor(linha) {
  return {
    id: linha.id,
    nome: linha.nome ?? '',
    cnpj: linha.cnpj ?? '',
    telefone: linha.telefone ?? '',
    whatsapp: linha.whatsapp ?? '',
    email: linha.email ?? '',
    observacoes: linha.observacoes ?? '',
    ativo: linha.ativo !== false,
    criadoEm: linha.criado_em ?? null,
    atualizadoEm: linha.atualizado_em ?? null,
  }
}

/**
 * Junta cabeçalho + itens + nomes e calcula os totais que a tela mostra.
 * Nada aqui é gravado: total é sempre derivado.
 */
export function paraCompra(linha, itens = [], fornecedores = new Map(), usuarios = new Map()) {
  const listaItens = itens.map(paraItem)
  const subtotal = listaItens.reduce((acc, item) => acc + item.total, 0)
  const descontoItens = listaItens.reduce((acc, item) => acc + item.descontoValor, 0)
  const descontoCompra = numero(linha.desconto_valor)
  const frete = numero(linha.frete_valor)
  const total = Math.max(0, subtotal - descontoCompra + frete)
  const quantidadeRecebida = listaItens.reduce((acc, item) => acc + item.quantidadeRecebida, 0)

  const fornecedor = fornecedores.get(linha.fornecedor_id)

  return {
    id: linha.id,
    numero: linha.numero ?? '',
    dataCompra: linha.data_compra ?? hoje(),
    dataRecebimento: linha.data_recebimento ?? null,
    fornecedorId: linha.fornecedor_id ?? null,
    fornecedorNome: fornecedor?.nome ?? 'Sem fornecedor',
    tipoDocumento: linha.tipo_documento ?? 'sem_nota',
    numeroNota: linha.numero_nota ?? '',
    observacoes: linha.observacoes ?? '',
    descontoValor: descontoCompra,
    freteValor: frete,
    status: linha.status ?? 'rascunho',
    usuarioId: linha.usuario_id ?? null,
    usuarioNome: usuarios.get(linha.usuario_id) ?? '',
    criadoEm: linha.criado_em ?? null,
    atualizadoEm: linha.atualizado_em ?? null,
    itens: listaItens,
    totalItens: listaItens.length,
    subtotal,
    descontoItens,
    total,
    quantidadeRecebida,
    temPendencia: listaItens.some((item) => item.pendente > 0.0005),
  }
}

/* ------------------------------------------------------------- consultas -- */

async function buscarItens(neon, ids) {
  if (!ids.length) return []
  const { data, error } = await neon
    .from('compras_itens')
    .select(CAMPOS_ITEM)
    .in('compra_id', ids)
    .order('criado_em', { ascending: true })

  if (error) throw error
  return data ?? []
}

async function buscarFornecedores(neon) {
  const consultaAtual = await neon
    .from('fornecedores')
    .select(CAMPOS_FORNECEDOR)
    .order('nome')
    .limit(1000)

  if (!consultaAtual.error) return consultaAtual.data ?? []

  const erroColunaWhatsAppAusente =
    ['42703', 'PGRST204'].includes(consultaAtual.error.code) &&
    /whatsapp/i.test(`${consultaAtual.error.message ?? ''} ${consultaAtual.error.details ?? ''}`)

  if (erroColunaWhatsAppAusente) {
    const consultaLegada = await neon
      .from('fornecedores')
      .select(CAMPOS_FORNECEDOR_SEM_WHATSAPP)
      .order('nome')
      .limit(1000)

    if (consultaLegada.error) throw consultaLegada.error
    return consultaLegada.data ?? []
  }

  throw consultaAtual.error
}

async function buscarUsuarios(neon, ids) {
  const alvo = ids.filter(Boolean)
  if (!alvo.length) return new Map()

  const { data, error } = await neon.from('profiles').select('id, full_name').in('id', alvo)
  if (error) {
    // Gerente pode não ter leitura dos outros perfis; não é motivo para falhar.
    return new Map()
  }
  return new Map((data ?? []).map((p) => [p.id, p.full_name ?? '']))
}

/**
 * Lista compras com filtros. Os itens, fornecedores e autores vêm em consultas
 * separadas (e não por embed) para não depender do cache de relacionamentos do
 * Data API — o mesmo cuidado usado no histórico de recipientes.
 */
export function listarCompras({ id, status, de, ate, busca } = {}) {
  return carregar({
    nome: 'compras',
    exemplo: [],
    consulta: async (neon) => {
      let consulta = neon.from('compras').select(CAMPOS_COMPRA)

      if (id) consulta = consulta.eq('id', id)
      if (status) consulta = consulta.eq('status', status)
      if (de) consulta = consulta.gte('data_compra', de)
      if (ate) consulta = consulta.lte('data_compra', ate)

      const { data, error } = await consulta
        .order('data_compra', { ascending: false })
        .limit(500)

      if (error) throw error

      const linhas = data ?? []
      if (!linhas.length) return []

      const [itens, fornecedores, usuarios] = await Promise.all([
        buscarItens(neon, linhas.map((c) => c.id)),
        buscarFornecedores(neon),
        buscarUsuarios(neon, [...new Set(linhas.map((c) => c.usuario_id).filter(Boolean))]),
      ])

      const porCompra = new Map()
      for (const item of itens) {
        const lista = porCompra.get(item.compra_id) ?? []
        lista.push(item)
        porCompra.set(item.compra_id, lista)
      }

      const mapaFornecedores = new Map(fornecedores.map((f) => [f.id, paraFornecedor(f)]))

      let resultado = linhas
        .map((linha) => paraCompra(linha, porCompra.get(linha.id) ?? [], mapaFornecedores, usuarios))
        .sort((a, b) => String(b.criadoEm ?? '').localeCompare(String(a.criadoEm ?? '')))

      if (busca) {
        const termo = texto(busca).toLowerCase()
        resultado = resultado.filter((c) =>
          [c.numero, c.fornecedorNome, c.numeroNota, c.observacoes]
            .join(' ')
            .toLowerCase()
            .includes(termo),
        )
      }

      return resultado
    },
  })
}

/** Busca uma compra específica (cabeçalho + itens). */
export async function obterCompra(id) {
  const { dados } = await listarCompras({ id })
  return dados[0] ?? null
}

/* ---------------------------------------------------------- fornecedores -- */

export function listarFornecedores({ incluirInativos = true } = {}) {
  return carregar({
    nome: 'fornecedores',
    exemplo: [],
    consulta: async (neon) => {
      const dados = await buscarFornecedores(neon)
      return dados
        .filter((fornecedor) => incluirInativos || fornecedor.ativo)
        .map(paraFornecedor)
    },
  })
}

const normalizarFornecedor = (dados = {}) => {
  const nome = texto(dados.nome)
  const documento = apenasDigitos(dados.cnpj)
  const telefone = apenasDigitos(dados.telefone)
  const whatsapp = apenasDigitos(dados.whatsapp)

  if (!nome) throw new Error('Informe o nome do fornecedor.')
  if (nome.length > 120) throw new Error('O nome do fornecedor pode ter no máximo 120 caracteres.')
  if (documento && !cpfValido(documento) && !cnpjValido(documento)) {
    throw new Error('Informe um CPF válido com 11 dígitos ou um CNPJ válido com 14 dígitos.')
  }
  if (telefone && telefone.length !== 10 && telefone.length !== 11) {
    throw new Error('O telefone deve conter DDD e 10 ou 11 dígitos.')
  }
  if (whatsapp && whatsapp.length !== 10 && whatsapp.length !== 11) {
    throw new Error('O WhatsApp deve conter DDD e 10 ou 11 dígitos.')
  }

  return {
    nome,
    cnpj: documento ? formatarDocumento(documento) : null,
    telefone: telefone ? formatarTelefone(telefone) : null,
    whatsapp: whatsapp ? formatarTelefone(whatsapp) : null,
    email: opcional(dados.email),
    observacoes: texto(dados.observacoes),
    ativo: dados.ativo === undefined ? true : booleano(dados.ativo),
  }
}

const apenasDigitos = (valor) => String(valor ?? '').replace(/\D/g, '')

function cpfValido(digitos) {
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false

  const calcularDigito = (tamanho) => {
    const soma = digitos
      .slice(0, tamanho)
      .split('')
      .reduce((total, digito, indice) => total + Number(digito) * (tamanho + 1 - indice), 0)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  return calcularDigito(9) === Number(digitos[9]) && calcularDigito(10) === Number(digitos[10])
}

function cnpjValido(digitos) {
  if (digitos.length !== 14 || /^(\d)\1{13}$/.test(digitos)) return false

  const calcularDigito = (base, pesos) => {
    const soma = base
      .split('')
      .reduce((total, digito, indice) => total + Number(digito) * pesos[indice], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const primeiro = calcularDigito(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const segundo = calcularDigito(digitos.slice(0, 12) + primeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return primeiro === Number(digitos[12]) && segundo === Number(digitos[13])
}

function formatarDocumento(digitos) {
  if (digitos.length === 11) {
    return digitos.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
  }

  return digitos
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

function formatarTelefone(digitos) {
  if (digitos.length <= 2) return digitos
  const ddd = digitos.slice(0, 2)
  const numero = digitos.slice(2)
  const limiteLocal = digitos.length > 10 ? 5 : 4
  return `(${ddd}) ${numero.slice(0, limiteLocal)}${numero.length > limiteLocal ? `-${numero.slice(limiteLocal)}` : ''}`
}

export function criarFornecedor(dados) {
  const registro = normalizarFornecedor(dados)

  return gravar({
    nome: 'fornecedor',
    registro: {
      id: idLocal(),
      ...registro,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    },
    escrever: (neon) =>
      gravarFornecedorCompat(
        (campos, comWhatsApp) =>
          neon
            .from('fornecedores')
            .insert(comWhatsApp ? registro : semCampoWhatsApp(registro))
            .select(campos)
            .single(),
        Boolean(registro.whatsapp),
      ),
  })
}

export function atualizarFornecedor(id, dados) {
  const registro = normalizarFornecedor(dados)

  return gravar({
    nome: 'fornecedor',
    registro: { id, ...registro },
    escrever: (neon) =>
      gravarFornecedorCompat(
        (campos, comWhatsApp) =>
          neon
            .from('fornecedores')
            .update(comWhatsApp ? registro : semCampoWhatsApp(registro))
            .eq('id', id)
            .select(campos)
            .single(),
        Boolean(registro.whatsapp),
      ),
  })
}

export function definirFornecedorAtivo(id, ativo) {
  return gravar({
    nome: 'situação do fornecedor',
    registro: { id, ativo: Boolean(ativo) },
    escrever: (neon) =>
      gravarFornecedorCompat(
        (campos) =>
          neon
            .from('fornecedores')
            .update({ ativo: Boolean(ativo) })
            .eq('id', id)
            .select(campos)
            .single(),
      ),
  })
}

/* --------------------------------------------------------------- compras -- */

const anoAtual = () => new Date().getFullYear()

/** Próximo número no formato C-AAAA-0001 (sequencial por ano). */
async function sugerirNumero(neon) {
  const ano = anoAtual()
  const { data, error } = await neon
    .from('compras')
    .select('numero')
    .like('numero', `C-${ano}-%`)
    .order('numero', { ascending: false })
    .limit(1)

  if (error) throw error

  const ultimo = data?.[0]?.numero ?? ''
  const partes = ultimo.split('-')
  const sequencia = Number(partes[partes.length - 1]) || 0

  return `C-${ano}-${String(sequencia + 1).padStart(4, '0')}`
}

export async function proximoNumeroCompra() {
  const { dados } = await carregar({
    nome: 'próximo número de compra',
    exemplo: `C-${anoAtual()}-0001`,
    consulta: sugerirNumero,
  })
  return dados
}

/** Confere se o número já está em uso na organização (para a tela avisar). */
export async function numeroCompraExiste(numeroCompra) {
  if (!texto(numeroCompra)) return false

  const { dados } = await carregar({
    nome: 'número da compra',
    exemplo: false,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('compras')
        .select('id')
        .eq('numero', texto(numeroCompra))
        .limit(1)

      if (error) throw error
      return Boolean(data?.length)
    },
  })

  return dados
}

const normalizarItem = (item) => {
  const produtoId = texto(item.produtoId || item.produto_id)
  const nome = texto(item.nome)
  const quantidade = numero(item.quantidadeSolicitada ?? item.quantidade_solicitada)
  const fator = numero(item.fatorConversao ?? item.fator_conversao)
  const custo = numero(item.custoUnitario ?? item.custo_unitario)
  const desconto = numero(item.descontoValor ?? item.desconto_valor)

  if (!produtoId) throw new Error('Escolha o produto de todos os itens.')
  if (!nome) throw new Error('Informe o nome do produto em todos os itens.')
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw new Error(`A quantidade de "${nome}" precisa ser maior que zero.`)
  }
  if (!Number.isFinite(fator) || fator <= 0) {
    throw new Error(`O fator de conversão de "${nome}" precisa ser maior que zero.`)
  }
  if (custo < 0) throw new Error(`O custo de "${nome}" não pode ser negativo.`)
  if (desconto < 0) throw new Error(`O desconto de "${nome}" não pode ser negativo.`)
  if (desconto > quantidade * custo + 0.001) {
    throw new Error(`O desconto de "${nome}" não pode ser maior que o valor do item.`)
  }

  const validade = texto(item.validade)

  return {
    produto_id: produtoId,
    nome,
    unidade_compra: (texto(item.unidadeCompra ?? item.unidade_compra) || 'UN').toUpperCase(),
    fator_conversao: fator,
    quantidade_solicitada: quantidade,
    custo_unitario: custo,
    desconto_valor: desconto,
    lote: opcional(item.lote),
    validade: validade || null,
  }
}

/**
 * Cria a compra inteira: cabeçalho + itens.
 *
 * O cabeçalho nasce como `rascunho`, os itens entram numa única instrução e só
 * depois o status vira `aguardando_recebimento` (quando pedido). Se os itens
 * falharem, o rascunho é apagado — não fica compra vazia pela metade.
 */
export function registrarCompra({
  dataCompra,
  fornecedorId,
  fornecedorNome,
  tipoDocumento = 'sem_nota',
  numeroNota,
  observacoes,
  freteValor,
  descontoValor,
  itens,
  aguardarRecebimento = true,
} = {}) {
  const data = texto(dataCompra) || hoje()
  const documento = TIPOS_DOCUMENTO[tipoDocumento] ? tipoDocumento : 'sem_nota'
  const lista = (itens ?? []).map(normalizarItem)

  if (!lista.length) throw new Error('Inclua pelo menos um item na compra.')
  if (documento === 'com_nota' && !texto(numeroNota)) {
    throw new Error('Informe o número da nota fiscal (ou marque "sem nota").')
  }

  const frete = numero(freteValor)
  const desconto = numero(descontoValor)

  if (frete < 0) throw new Error('O frete não pode ser negativo.')
  if (desconto < 0) throw new Error('O desconto não pode ser negativo.')

  const cabecalho = {
    data_compra: data,
    fornecedor_id: fornecedorId || null,
    tipo_documento: documento,
    numero_nota: opcional(numeroNota),
    observacoes: texto(observacoes),
    frete_valor: frete,
    desconto_valor: desconto,
  }

  // Registro do modo demonstração: já no formato que a tela usa.
  const registroId = idLocal()
  const subtotal = lista.reduce(
    (acc, item) => acc + Math.max(0, item.quantidade_solicitada * item.custo_unitario - item.desconto_valor),
    0,
  )
  const descontoItens = lista.reduce((acc, item) => acc + item.desconto_valor, 0)
  const itensRegistro = lista.map((item) => ({
    id: idLocal(),
    compraId: registroId,
    produtoId: item.produto_id,
    nome: item.nome,
    unidadeCompra: item.unidade_compra,
    fatorConversao: item.fator_conversao,
    quantidadeSolicitada: item.quantidade_solicitada,
    quantidadeRecebida: 0,
    custoUnitario: item.custo_unitario,
    descontoValor: item.desconto_valor,
    lote: item.lote ?? '',
    validade: item.validade ?? '',
    total: Math.max(0, item.quantidade_solicitada * item.custo_unitario - item.desconto_valor),
    pendente: item.quantidade_solicitada,
  }))

  return gravar({
    nome: 'compra',
    registro: {
      id: registroId,
      numero: `C-${anoAtual()}-0001`,
      dataCompra: data,
      dataRecebimento: null,
      fornecedorId: fornecedorId || null,
      fornecedorNome: fornecedorId ? texto(fornecedorNome) || 'Sem fornecedor' : 'Sem fornecedor',
      tipoDocumento: documento,
      numeroNota: texto(numeroNota),
      observacoes: texto(observacoes),
      freteValor: frete,
      descontoValor: desconto,
      status: aguardarRecebimento ? 'aguardando_recebimento' : 'rascunho',
      usuarioNome: '',
      itens: itensRegistro,
      totalItens: itensRegistro.length,
      subtotal,
      descontoItens,
      total: Math.max(0, subtotal - desconto + frete),
      quantidadeRecebida: 0,
      temPendencia: true,
      criadoEm: new Date().toISOString(),
    },
    escrever: async (neon) => {
      let compra = null
      let ultimoErro = null

      // Numeração sequencial com proteção contra dois operadores salvando ao
      // mesmo tempo: o índice único recusa, e a gente tenta o próximo número.
      for (let tentativa = 0; tentativa < 5 && !compra; tentativa += 1) {
        const numeroCompra = await sugerirNumero(neon)
        const { data, error } = await neon
          .from('compras')
          .insert({ ...cabecalho, numero: numeroCompra, status: 'rascunho' })
          .select(CAMPOS_COMPRA)
          .single()

        if (!error) {
          compra = data
          break
        }

        ultimoErro = error
        if (!/duplicate key|unique/i.test(error.message ?? '')) throw error
      }

      if (!compra) throw ultimoErro ?? new Error('Não foi possível gerar o número da compra.')

      const { data: itensCriados, error: erroItens } = await neon
        .from('compras_itens')
        .insert(lista.map((item) => ({ ...item, compra_id: compra.id })))
        .select(CAMPOS_ITEM)

      if (erroItens) {
        // Rascunho sem itens não serve para nada: limpa antes de avisar.
        await neon.from('compras').delete().eq('id', compra.id)
        throw erroItens
      }

      if (aguardarRecebimento) {
        const { data: atualizada, error: erroStatus } = await neon
          .from('compras')
          .update({ status: 'aguardando_recebimento' })
          .eq('id', compra.id)
          .select(CAMPOS_COMPRA)
          .single()

        if (erroStatus) throw erroStatus
        compra = atualizada
      }

      const fornecedor = cabecalho.fornecedor_id
        ? (await buscarFornecedores(neon)).find((f) => f.id === cabecalho.fornecedor_id)
        : null

      const mapa = new Map(fornecedor ? [[fornecedor.id, paraFornecedor(fornecedor)]] : [])

      return paraCompra(compra, itensCriados ?? [], mapa)
    },
  })
}

/** Coloca um rascunho na fila de recebimento. */
export function marcarAguardandoRecebimento(id) {
  return gravar({
    nome: 'status da compra',
    registro: { id, status: 'aguardando_recebimento' },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('compras')
        .update({ status: 'aguardando_recebimento' })
        .eq('id', id)
        .eq('status', 'rascunho')
        .select('id')

      if (error) throw error
      if (!data?.length) throw new Error('Esta compra não está mais em rascunho.')
      return data[0]
    },
  })
}

/** Cancela uma compra que ainda não foi recebida. O histórico continua. */
export function cancelarCompra(id) {
  return gravar({
    nome: 'cancelamento da compra',
    registro: { id, status: 'cancelado' },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('compras')
        .update({ status: 'cancelado' })
        .eq('id', id)
        .in('status', STATUS_ABERTOS)
        .select('id')

      if (error) throw error
      if (!data?.length) throw new Error('Compra já recebida ou cancelada não pode ser cancelada.')
      return data[0]
    },
  })
}

/** Exclui somente rascunho (o banco recusa qualquer outro status). */
export function excluirCompra(id) {
  return gravar({
    nome: 'exclusão do rascunho',
    registro: { id },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('compras')
        .delete()
        .eq('id', id)
        .eq('status', 'rascunho')
        .select('id')

      if (error) throw error
      if (!data?.length) throw new Error('Só rascunho pode ser excluído. Cancele a compra para manter o histórico.')
      return data[0]
    },
  })
}

/**
 * Confirma o recebimento de um ou mais itens.
 *
 * `itens`: [{ itemId, quantidade, lote?, validade? }] na unidade de COMPRA.
 * O banco converte para a unidade de estoque, movimenta, calcula o custo médio
 * e decide entre `recebimento_parcial` e `recebido_confirmado`.
 */
export function receberCompra(compraId, itens = []) {
  const linhas = itens
    .map((item) => ({
      item_id: item.itemId ?? item.id,
      quantidade: numero(item.quantidade ?? item.quantidadeRecebida),
      lote: opcional(item.lote),
      validade: texto(item.validade) || null,
    }))
    .filter((item) => item.item_id && item.quantidade > 0)

  if (!compraId) throw new Error('Compra não informada.')
  if (!linhas.length) throw new Error('Informe a quantidade recebida de pelo menos um item.')

  return gravar({
    nome: 'recebimento da compra',
    registro: { compraId, itens: linhas },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('confirmar_recebimento_compra', {
        p_compra_id: compraId,
        p_itens: linhas,
      })

      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
  })
}

/* -------------------------------------------------------------- relatório -- */

/** Resumo para os indicadores do topo da tela. */
export function resumoCompras(compras = []) {
  const hojeISO = hoje()
  const mes = hojeISO.slice(0, 7)

  const doMes = compras.filter((c) => String(c.dataCompra).startsWith(mes) && c.status !== 'cancelado')
  const recebidasMes = doMes.filter((c) => c.status === 'recebido_confirmado')
  const pendentes = compras.filter((c) => STATUS_ABERTOS.includes(c.status))
  const valorPendente = pendentes.reduce((acc, c) => acc + c.total, 0)

  const limite = new Date(`${hojeISO}T00:00:00`)
  limite.setDate(limite.getDate() + 30)

  const validadeProxima = compras
    .filter((c) => c.status !== 'cancelado')
    .flatMap((c) => c.itens.map((item) => ({ ...item, compra: c })))
    .filter((item) => item.validade && item.quantidadeRecebida > 0.0005)
    .filter((item) => {
      const data = new Date(`${String(item.validade).slice(0, 10)}T00:00:00`)
      return !Number.isNaN(data.getTime()) && data <= limite
    })
    .sort((a, b) => String(a.validade).localeCompare(String(b.validade)))

  return {
    pendentes,
    valorPendente,
    totalMes: doMes.reduce((acc, c) => acc + c.total, 0),
    recebidasMes: recebidasMes.length,
    valorRecebidoMes: recebidasMes.reduce((acc, c) => acc + c.total, 0),
    validadeProxima,
  }
}

/** CSV compatível com Excel brasileiro (BOM + ponto e vírgula). */
export function gerarCsvCompras(compras = []) {
  const cabecalho = [
    'Numero',
    'Data da compra',
    'Fornecedor',
    'Documento',
    'Nota',
    'Status',
    'Itens',
    'Valor total (R$)',
    'Recebido em',
  ]

  const escapar = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`

  const linhas = compras.map((c) => [
    c.numero,
    c.dataCompra,
    c.fornecedorNome,
    c.tipoDocumento === 'com_nota' ? 'Com nota' : 'Sem nota',
    c.numeroNota,
    rotuloStatus(c.status),
    c.totalItens,
    c.total.toFixed(2).replace('.', ','),
    c.dataRecebimento ?? '',
  ])

  return `\uFEFF${[cabecalho, ...linhas].map((linha) => linha.map(escapar).join(';')).join('\r\n')}`
}
