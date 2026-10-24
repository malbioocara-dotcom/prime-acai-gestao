import { neon, neonConfigurado } from './base.js'

export const IMAGEM_PRODUTO_TAMANHO_MAX = 512 * 1024

const FORMATOS = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  'image/webp': (b) =>
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
}

function tabelaAusente(erro) {
  const mensagem = String(erro?.message ?? erro)
  return (
    ['42P01', 'PGRST205'].includes(erro?.code) ||
    (mensagem.includes('imagens_produtos') && /does not exist|schema cache|not found/i.test(mensagem))
  )
}

export function mensagemArmazenamentoIndisponivel() {
  return 'O armazenamento de fotos ainda não foi habilitado. Aplique a migração neon/19_imagens_produtos.sql no banco para ativar este recurso.'
}

export async function validarImagemProduto(arquivo) {
  if (!arquivo) return { ok: false, mensagem: 'Selecione uma imagem.' }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) {
    return { ok: false, mensagem: 'Use uma imagem JPG, PNG ou WebP.' }
  }
  if (arquivo.size === 0) return { ok: false, mensagem: 'O arquivo está vazio.' }
  if (arquivo.size > IMAGEM_PRODUTO_TAMANHO_MAX) {
    return { ok: false, mensagem: 'A imagem deve ter no máximo 512 KiB.' }
  }

  let bytes
  try {
    bytes = new Uint8Array(await arquivo.slice(0, 16).arrayBuffer())
  } catch (erro) {
    throw new Error(`Não foi possível ler a imagem: ${erro?.message ?? erro}`)
  }

  if (!FORMATOS[arquivo.type]?.(bytes)) {
    return { ok: false, mensagem: 'O conteúdo do arquivo não corresponde a uma imagem JPG, PNG ou WebP válida.' }
  }

  return { ok: true, mime: arquivo.type }
}

export async function prepararImagemProduto(arquivo) {
  const validacao = await validarImagemProduto(arquivo)
  if (!validacao.ok) throw new Error(validacao.mensagem)

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  let hexadecimal = ''
  for (const byte of bytes) hexadecimal += byte.toString(16).padStart(2, '0')
  return { mime: validacao.mime, hexadecimal: `\\x${hexadecimal}` }
}

export async function listarImagensProdutos(produtoIds) {
  if (!neonConfigurado) {
    return { disponivel: false, imagens: new Map(), mensagem: 'Configure o Neon para persistir fotos de produtos.' }
  }

  let consulta = neon.from('imagens_produtos').select('produto_id, caminho')
  consulta = produtoIds.length
    ? consulta.in('produto_id', produtoIds)
    : consulta.limit(1)
  const { data, error } = await consulta

  if (error) {
    if (tabelaAusente(error)) {
      return { disponivel: false, imagens: new Map(), mensagem: mensagemArmazenamentoIndisponivel() }
    }
    throw error
  }

  return {
    disponivel: true,
    imagens: new Map((data ?? []).map((linha) => [linha.produto_id, linha.caminho])),
  }
}

export async function carregarImagemProduto(produtoId) {
  if (!neonConfigurado) throw new Error('O Neon não está configurado para carregar fotos.')

  const { data, error } = await neon
    .from('imagens_produtos')
    .select('mime, conteudo')
    .eq('produto_id', produtoId)
    .maybeSingle()

  if (error) {
    if (tabelaAusente(error)) throw new Error(mensagemArmazenamentoIndisponivel())
    throw error
  }
  if (!data) return null

  const hexadecimal = String(data.conteudo ?? '').replace(/^\\x/i, '')
  if (!hexadecimal || hexadecimal.length % 2 || !/^[\da-f]+$/i.test(hexadecimal)) {
    throw new Error('A imagem salva no banco está inválida.')
  }

  const bytes = new Uint8Array(hexadecimal.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hexadecimal.slice(i * 2, i * 2 + 2), 16)
  }
  return new Blob([bytes], { type: data.mime })
}
