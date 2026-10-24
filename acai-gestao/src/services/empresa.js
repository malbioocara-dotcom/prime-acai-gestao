/**
 * Configuração da empresa — a tabela `company_settings` e a logomarca na tabela
 * `company_logos` (o Neon não tem Storage).
 *
 * Três decisões que valem explicação:
 *
 * 1. O `organization_id` NÃO vai no corpo de nenhuma escrita. A coluna tem
 *    `default public.minha_organizacao()`, então quem escolhe a empresa é o
 *    banco, a partir da sessão. Se o navegador mandasse uma organização, o RLS
 *    recusaria no `with check` — mas o certo é nem enviar.
 *
 * 2. Os nomes dos campos aqui são os das colunas (snake_case). Nas outras telas
 *    o serviço traduz para camelCase; aqui o formulário é um espelho da linha,
 *    e uma tradução de 22 campos só criaria uma chance a mais de erro.
 *
 * 3. A logomarca não mora em `company_settings`: fica em `company_logos`, uma
 *    linha por organização, com o mesmo RLS. A imagem vai como base64 e o app a
 *    exibe por um data URL — não existe URL pública.
 */

import { estadoSessao } from 'login-projetos/sessao'
import { carregar, gravar, neon, neonConfigurado } from './base.js'

/* ==========================================================================
   Constantes
   ========================================================================== */

/** 2 MB. O mesmo limite existe no banco (check em `company_logos`). */
export const LOGO_TAMANHO_MAX = 2 * 1024 * 1024

/** Campos de texto que o formulário grava. */
const CAMPOS_TEXTO = [
  'nome_fantasia',
  'razao_social',
  'cnpj',
  'inscricao_estadual',
  'inscricao_municipal',
  'telefone',
  'whatsapp',
  'email',
  'site',
  'cep',
  'uf',
  'municipio',
  'bairro',
  'logradouro',
  'numero',
  'complemento',
  'referencia',
]

const CAMPOS = ['id', 'organization_id', ...CAMPOS_TEXTO, 'moeda', 'fuso', 'formato_data'].join(', ')

/** Unidades da federação — a lista inteira, inclusive o DF. */
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

/** Fuso padrão `America/Fortaleza`, como pedido. Os outros são os do Brasil. */
export const FUSOS = [
  { valor: 'America/Fortaleza', rotulo: 'America/Fortaleza (Fortaleza · Ceará)' },
  { valor: 'America/Sao_Paulo', rotulo: 'America/Sao_Paulo (Brasília)' },
  { valor: 'America/Belem', rotulo: 'America/Belem (Belém)' },
  { valor: 'America/Recife', rotulo: 'America/Recife' },
  { valor: 'America/Bahia', rotulo: 'America/Bahia (Salvador)' },
  { valor: 'America/Maceio', rotulo: 'America/Maceio' },
  { valor: 'America/Araguaina', rotulo: 'America/Araguaina' },
  { valor: 'America/Manaus', rotulo: 'America/Manaus' },
  { valor: 'America/Cuiaba', rotulo: 'America/Cuiaba' },
  { valor: 'America/Campo_Grande', rotulo: 'America/Campo_Grande' },
  { valor: 'America/Porto_Velho', rotulo: 'America/Porto_Velho' },
  { valor: 'America/Boa_Vista', rotulo: 'America/Boa_Vista' },
  { valor: 'America/Rio_Branco', rotulo: 'America/Rio_Branco' },
  { valor: 'America/Noronha', rotulo: 'America/Noronha (Fernando de Noronha)' },
]

export const PREFERENCIAS_PADRAO = {
  moeda: 'BRL',
  fuso: 'America/Fortaleza',
  formato_data: 'DD/MM/AAAA',
}

/* ==========================================================================
   Leitura e gravação
   ========================================================================== */

/**
 * Lê a configuração da organização de quem está logado.
 *
 * Sem filtro de organização de propósito: quem limita é a política
 * `empresa_leitura`. O cliente não escolhe de quem é o dado.
 *
 * `exemplo: null` também é proposital: sem Neon (ou se a consulta falhar) a
 * tela abre com os campos VAZIOS. Inventar uma empresa fictícia seria passar
 * dado falso por real.
 */
export function carregarEmpresa() {
  return carregar({
    nome: 'company_settings',
    exemplo: null,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('company_settings')
        .select(CAMPOS)
        .maybeSingle()

      if (error) throw error
      return data ?? null
    },
  })
}

/** Transforma o que o formulário mandou no que o banco aceita. */
export function montarRegistro(valores) {
  const registro = {}

  for (const campo of CAMPOS_TEXTO) {
    const texto = String(valores[campo] ?? '').trim()
    // Campo em branco vira NULL, não string vazia: assim "não informado" é uma
    // coisa só no banco.
    registro[campo] = texto === '' ? null : texto
  }

  registro.moeda = valores.moeda || PREFERENCIAS_PADRAO.moeda
  registro.fuso = valores.fuso || PREFERENCIAS_PADRAO.fuso
  registro.formato_data = valores.formato_data || PREFERENCIAS_PADRAO.formato_data

  return registro
}

/**
 * Grava a configuração da empresa.
 *
 * Duas etapas (procurar → inserir ou atualizar) em vez de `upsert`: assim o
 * `organization_id` fica de fora do corpo e quem o define é o default do banco.
 * O `update` é endereçado pelo `id` da própria linha que o RLS deixou ler.
 */
export function salvarEmpresa(valores) {
  const registro = montarRegistro(valores)

  return gravar({
    nome: 'company_settings',
    registro,
    escrever: async (neon) => {
      const { data: existente, error: erroBusca } = await neon
        .from('company_settings')
        .select('id')
        .maybeSingle()

      if (erroBusca) throw erroBusca

      const alvo = existente
        ? neon.from('company_settings').update(registro).eq('id', existente.id)
        : neon.from('company_settings').insert(registro)

      const { data, error } = await alvo.select(CAMPOS).single()
      if (error) throw error
      return data
    },
  })
}

/* ==========================================================================
   Logomarca
   ========================================================================== */

/** Tamanho de arquivo em texto curto, para a mensagem de erro. */
function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < LOGO_TAMANHO_MAX) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ASSINATURAS = [
  { tipo: 'image/png', extensao: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { tipo: 'image/jpeg', extensao: 'jpg', bytes: [0xff, 0xd8, 0xff] },
]

/**
 * Descobre o tipo do arquivo pelos primeiros bytes, não pelo nome nem pelo
 * `type` que o navegador informa — os dois vêm do usuário. Um `.exe` renomeado
 * para `.png` tem `type` de PNG e assinatura de executável.
 */
async function tipoReal(arquivo) {
  const cabecalho = new Uint8Array(await arquivo.slice(0, 16).arrayBuffer())

  for (const assinatura of ASSINATURAS) {
    if (assinatura.bytes.every((byte, i) => cabecalho[i] === byte)) return assinatura
  }

  // WEBP: "RIFF" nos quatro primeiros bytes e "WEBP" nos bytes 8 a 11.
  const trecho = (de, ate) => String.fromCharCode(...cabecalho.slice(de, ate))
  if (trecho(0, 4) === 'RIFF' && trecho(8, 12) === 'WEBP') {
    return { tipo: 'image/webp', extensao: 'webp' }
  }

  return null
}

/**
 * Confere tipo real e tamanho antes de qualquer upload.
 * @returns {Promise<{ ok: boolean, tipo?: string, extensao?: string, mensagem?: string }>}
 */
export async function validarLogo(arquivo) {
  if (!arquivo) return { ok: false, mensagem: 'Nenhum arquivo selecionado.' }

  if (arquivo.size === 0) return { ok: false, mensagem: 'O arquivo está vazio.' }

  if (arquivo.size > LOGO_TAMANHO_MAX) {
    return {
      ok: false,
      mensagem: `A imagem tem ${formatarTamanho(arquivo.size)}. O limite é 2 MB.`,
    }
  }

  let real
  try {
    real = await tipoReal(arquivo)
  } catch {
    return { ok: false, mensagem: 'Não foi possível ler o arquivo.' }
  }

  if (!real) {
    return {
      ok: false,
      mensagem: 'O arquivo não é uma imagem PNG, JPG, JPEG ou WEBP de verdade. O tipo é conferido pelo conteúdo, não pelo nome.',
    }
  }

  return { ok: true, ...real }
}

/**
 * Lê a logomarca da organização de quem está logado (ou `null`).
 *
 * Sem filtro de organização, como `carregarEmpresa`: quem limita é a política
 * `logo_leitura`.
 */
export function carregarLogo() {
  return carregar({
    nome: 'company_logos',
    exemplo: null,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('company_logos')
        .select('mime, conteudo')
        .maybeSingle()

      if (error) throw error
      return data ?? null
    },
  })
}

/** Lê o arquivo como base64, sem o prefixo `data:...;base64,`. */
function arquivoEmBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    leitor.onload = () => {
      const resultado = String(leitor.result)
      resolve(resultado.slice(resultado.indexOf(',') + 1))
    }
    leitor.readAsDataURL(arquivo)
  })
}

/**
 * Grava (ou troca) a logomarca e devolve a linha salva.
 *
 * Duas etapas (procurar → inserir ou atualizar) pelo mesmo motivo de
 * `salvarEmpresa`: o `organization_id` fica de fora do corpo e quem o define é
 * o default `public.minha_organizacao()`.
 */
export async function salvarLogo(arquivo, tipo) {
  if (!neonConfigurado) throw new Error('O Neon não está configurado.')

  const registro = { mime: tipo, conteudo: await arquivoEmBase64(arquivo) }
  const campos = 'mime, conteudo'

  const { data: existente, error: erroBusca } = await neon
    .from('company_logos')
    .select('organization_id')
    .maybeSingle()

  if (erroBusca) throw erroBusca

  const alvo = existente
    ? neon.from('company_logos').update(registro).eq('organization_id', existente.organization_id)
    : neon.from('company_logos').insert(registro)

  const { data, error } = await alvo.select(campos).single()
  if (error) throw error
  return data
}

/** Remove a logomarca da organização. */
export async function removerLogo() {
  if (!neonConfigurado) return

  const organizacao = estadoSessao.perfil?.organizacao
  const { error } = await neon.from('company_logos').delete().eq('organization_id', organizacao)
  if (error) throw error
}

/**
 * Data URL da logomarca, para o `<img>`.
 *
 * Antes o Storage devolvia uma URL assinada; agora a imagem vira um data URL a
 * partir do base64 guardado no banco. Continua não existindo URL pública.
 */
export function urlDaLogo(linha) {
  if (!linha?.conteudo) return null
  return `data:${linha.mime};base64,${linha.conteudo}`
}

/* ==========================================================================
   Validação de formato (campos brasileiros)
   ========================================================================== */

export const apenasDigitos = (valor) => String(valor ?? '').replace(/\D/g, '')

/** Máscaras aplicadas enquanto o usuário digita. */
export const mascaraCnpj = (valor) =>
  apenasDigitos(valor)
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')

export const mascaraCep = (valor) =>
  apenasDigitos(valor).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2')

export const mascaraTelefone = (valor) => {
  const digitos = apenasDigitos(valor).slice(0, 11)

  if (digitos.length <= 10) {
    return digitos.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  }

  return digitos.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

/** Confere os dois dígitos verificadores do CNPJ. */
export function cnpjValido(valor) {
  const digitos = apenasDigitos(valor)
  if (digitos.length !== 14) return false

  // 111.111.111.111.11 e afins passam na conta, mas não existem.
  if (/^(\d)\1{13}$/.test(digitos)) return false

  const conferir = (ate) => {
    let peso = ate - 7
    let soma = 0

    for (let i = 0; i < ate; i += 1) {
      soma += Number(digitos[i]) * peso
      peso -= 1
      if (peso < 2) peso = 9
    }

    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  return conferir(12) === Number(digitos[12]) && conferir(13) === Number(digitos[13])
}

export const cepValido = (valor) => apenasDigitos(valor).length === 8

export const telefoneValido = (valor) => {
  const digitos = apenasDigitos(valor)
  return digitos.length === 10 || digitos.length === 11
}

/* ==========================================================================
   Mensagens
   ========================================================================== */

/**
 * Traduz o erro do PostgREST para algo que o lojista entenda.
 *
 * Os dois casos que mais vão aparecer no começo são "esqueci de rodar o SQL" —
 * por isso eles têm mensagem própria, dizendo qual arquivo rodar.
 */
export function mensagemDoErro(erro) {
  const texto = String(erro?.message ?? '')
  const codigo = erro?.code ?? ''

  if (codigo === 'PGRST205' || /could not find the table|schema cache/i.test(texto)) {
    return 'A tabela company_settings não existe no banco. Rode o neon/00_banco_neon.sql no SQL Editor.'
  }

  if (/row-level security|violates row-level|permission denied|not authorized|unauthorized/i.test(texto)) {
    return 'A sua conta não tem permissão para alterar a configuração da empresa.'
  }

  if (codigo === '23514' && /company_logos/i.test(texto)) {
    return 'Formato não aceito. Use PNG, JPG, JPEG ou WEBP de até 2 MB.'
  }

  if (/exceeded the maximum allowed size|payload too large|entity too large/i.test(texto)) {
    return 'A imagem passa do limite de 2 MB.'
  }

  if (/mime type .* is not supported|invalid mime type/i.test(texto)) {
    return 'Formato não aceito. Use PNG, JPG, JPEG ou WEBP.'
  }

  if (erro?.status === 0 || /fetch|network|failed to load/i.test(texto)) {
    return 'Não foi possível falar com o servidor. Verifique a sua conexão.'
  }

  console.error('[empresa] Erro não mapeado:', erro)
  return 'Não foi possível salvar a configuração. Tente de novo.'
}
