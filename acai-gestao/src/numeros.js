/**
 * ============================================================================
 * Leitura de números digitados
 * ============================================================================
 *
 * O app inteiro digita número à mão: quantidade, peso, preço, tara. O teclado
 * do celular manda ponto, o do balcão manda vírgula, e vem "1.234,5" quando
 * alguém copia de uma planilha. Esta é a única tradução — antes a mesma regra
 * vivia copiada em `formulario.js` e em `peso.js`, que era uma divergência à
 * espera de acontecer.
 *
 * Módulo PURO: sem DOM, sem rede. Por isso `peso.js` pode depender dele.
 */

/**
 * Converte texto digitado em número.
 * Aceita "1.234,56" (padrão brasileiro) e "1234.56" (padrão do teclado).
 * Devolve `NaN` para vazio ou para o que não for número.
 */
export function paraNumero(texto) {
  let s = String(texto ?? '').trim().replace(/\s/g, '')
  if (!s) return NaN
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return Number(s)
}

/** Mostra um número para edição, com vírgula decimal. */
export function paraTextoNumero(valor) {
  if (valor === '' || valor == null) return ''
  return String(valor).replace('.', ',')
}

/** Número para exibir na tela, com vírgula e no máximo `casas` decimais. */
export function formatarNumero(valor, casas = 3) {
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(n)
}
