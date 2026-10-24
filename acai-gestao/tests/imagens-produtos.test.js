import { describe, expect, it, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({ neonConfigurado: false, neon: null }))

const {
  IMAGEM_PRODUTO_TAMANHO_MAX,
  prepararImagemProduto,
  validarImagemProduto,
} = await import('../src/services/imagens-produtos.js')

function arquivo(bytes, type, size = bytes.length) {
  const conteudo = new Blob([Uint8Array.from(bytes)], { type })
  return {
    type,
    size,
    slice: (...args) => conteudo.slice(...args),
    arrayBuffer: () => conteudo.arrayBuffer(),
  }
}

describe('imagens de produto', () => {
  it('confere MIME e assinatura real para PNG, JPEG e WebP', async () => {
    expect(await validarImagemProduto(arquivo(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
      'image/png',
    ))).toMatchObject({ ok: true, mime: 'image/png' })
    expect(await validarImagemProduto(arquivo(
      [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0],
      'image/jpeg',
    ))).toMatchObject({ ok: true, mime: 'image/jpeg' })
    expect(await validarImagemProduto(arquivo(
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      'image/webp',
    ))).toMatchObject({ ok: true, mime: 'image/webp' })
  })

  it('rejeita formatos não permitidos e extensões/MIME falsificados', async () => {
    expect(await validarImagemProduto(arquivo([1, 2, 3], 'image/svg+xml'))).toMatchObject({ ok: false })
    expect(await validarImagemProduto(arquivo(
      [0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      'image/png',
    ))).toMatchObject({ ok: false })
  })

  it('recusa arquivos vazios, acima de 512 KiB e ilegíveis', async () => {
    expect(await validarImagemProduto(arquivo([], 'image/png'))).toMatchObject({ ok: false })
    expect(await validarImagemProduto(arquivo(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
      'image/png',
      IMAGEM_PRODUTO_TAMANHO_MAX + 1,
    ))).toMatchObject({ ok: false, mensagem: expect.stringMatching(/512 KiB/) })
    await expect(validarImagemProduto({
      type: 'image/png',
      size: 12,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('falha de leitura')) }),
    })).rejects.toThrow(/falha de leitura/)
  })

  it('prepara bytes hexadecimais para bytea sem gravar Base64', async () => {
    const resultado = await prepararImagemProduto(arquivo(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
      'image/png',
    ))
    expect(resultado).toEqual({ mime: 'image/png', hexadecimal: '\\x89504e470d0a1a0a00000000' })
  })
})
