/**
 * ============================================================================
 * Venda por peso — tara, peso líquido e total
 * ============================================================================
 *
 * Módulo PURO (sem DOM, sem rede): é a única fonte da conta de peso do app e
 * por isso é o que os testes cobrem diretamente.
 *
 * Regras que este arquivo garante
 *   • peso líquido = peso bruto - tara      (método 'bruto_tara')
 *   • se o peso já vem LÍQUIDO, a tara NÃO é subtraída de novo
 *   • nada de peso negativo, tara negativa ou tara maior que o bruto
 *   • pesos são tratados em GRAMAS inteiras
 *   • o total é arredondado para 2 casas, sem erro de ponto flutuante
 *
 * Por que a conta é feita em centavos/gramas inteiros
 * ---------------------------------------------------
 * A conta "natural" — `gramas / 1000 * preco` — dá errado:
 *
 *     450 / 1000 * 69.90   ->  31.454999999999998
 *     Math.round(31.454999999999998 * 100) / 100  ->  31.45   ✗
 *
 * O valor correto é R$ 31,46. Fazendo em inteiros não há o que arredondar de
 * errado: `6990 * 450 / 1000` = 3145,5 exato -> `Math.round` = 3146 centavos.
 *
 * No banco (migração 06 em diante) a conta é feita com `numeric`, que também é
 * decimal exato — este módulo é o espelho fiel para a interface.
 */

import { paraNumero } from './numeros.js'

/** Métodos de entrada do peso. Estes são os valores aceitos no banco. */
export const METODOS_PESO = {
  /** O operador (ou a balança) informa o peso JÁ LÍQUIDO. Não subtrai tara. */
  LIQUIDO: 'liquido',
  /** Informa-se o peso BRUTO; o sistema subtrai a tara do recipiente. */
  BRUTO_TARA: 'bruto_tara',
  /**
   * Reservado para uma integração física futura. Este projeto não tem backend
   * nem hardware para conversar com balança, então o valor existe no domínio
   * (para não quebrar contrato depois) mas NÃO é executado nem oferecido.
   */
  BALANCA: 'balanca',
}

/** Rótulos para a interface. */
export const METODO_PESO_ROTULO = {
  [METODOS_PESO.LIQUIDO]: 'Peso líquido informado',
  [METODOS_PESO.BRUTO_TARA]: 'Peso bruto menos a tara',
  [METODOS_PESO.BALANCA]: 'Balança integrada (ainda não disponível)',
}

/**
 * Métodos que o app executa HOJE. A interface só oferece estes — e é daqui que
 * sai a lista, para não haver opção "de enfeite" que não funciona.
 */
export const METODOS_PESO_ATIVOS = [METODOS_PESO.LIQUIDO, METODOS_PESO.BRUTO_TARA]

/** 1 kg = 1000 g. */
export const GRAMAS_POR_QUILO = 1000

/** Trava de sanidade espelhando o `check` de `recipientes.tara_g` no banco. */
export const TARA_MAXIMA_G = 5000

/* --------------------------------------------------------------- dinheiro -- */

// `paraNumero` (texto -> número, aceitando vírgula ou ponto) mora em
// `numeros.js` desde a P3. Antes era uma cópia da regra de `formulario.js`;
// com o terceiro consumidor (os itens da venda) a cópia virou risco de
// divergência. O módulo é puro — sem DOM, sem rede — então `peso.js` continua
// testável direto.

/** Reais -> centavos inteiros. `69.90 -> 6990`. */
export function paraCentavos(reais) {
  const n = paraNumero(reais)
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN
}

/* ---------------------------------------------------------------- pesos ---- */

/**
 * Normaliza um peso em gramas: precisa ser número finito e não negativo.
 * Arredonda para a grama inteira (a menor unidade que uma balança de cozinha
 * entrega, e exatamente a precisão de `numeric(12,3)` em quilos no banco).
 *
 * @returns {number|NaN} gramas inteiras, ou NaN se inválido
 */
export function paraGramas(valor) {
  if (valor === '' || valor == null) return Number.NaN
  const n = paraNumero(valor)
  if (!Number.isFinite(n) || n < 0) return Number.NaN
  return Math.round(n)
}

/* ----------------------------------------------------------- peso líquido -- */

/**
 * Calcula o peso líquido conforme o método de entrada.
 *
 * @param {object} dados
 * @param {'liquido'|'bruto_tara'|'balanca'} dados.metodo
 * @param {number} [dados.pesoLiquidoGramas]  usado no método 'liquido'
 * @param {number} [dados.pesoBrutoGramas]    usado no método 'bruto_tara'
 * @param {number} [dados.taraGramas]         ignorado no método 'liquido'
 *
 * @returns {{ok: true, metodo: string, liquidoGramas: number,
 *            brutoGramas: number|null, taraGramas: number|null}
 *          | {ok: false, erro: string}}
 */
export function calcularPesoLiquido({
  metodo,
  pesoLiquidoGramas,
  pesoBrutoGramas,
  taraGramas,
} = {}) {
  if (metodo === METODOS_PESO.BALANCA) {
    return {
      ok: false,
      erro: 'A leitura por balança integrada ainda não está disponível neste sistema.',
    }
  }

  if (!METODOS_PESO_ATIVOS.includes(metodo)) {
    return { ok: false, erro: 'Escolha como o peso será informado.' }
  }

  const brutoG = paraGramas(pesoBrutoGramas)
  const taraG = paraGramas(taraGramas)

  /* --- peso líquido já informado: a tara NÃO entra na conta (regra dura) --- */
  if (metodo === METODOS_PESO.LIQUIDO) {
    const liquidoG = paraGramas(pesoLiquidoGramas)

    if (Number.isNaN(liquidoG)) {
      return { ok: false, erro: 'Informe o peso líquido (um número de gramas, sem negativo).' }
    }
    if (liquidoG <= 0) {
      return { ok: false, erro: 'O peso líquido precisa ser maior que zero.' }
    }

    return {
      ok: true,
      metodo: METODOS_PESO.LIQUIDO,
      liquidoGramas: liquidoG,
      // Não foram usados: não podem virar coluna preenchida na venda.
      brutoGramas: null,
      taraGramas: null,
    }
  }

  /* ------------------------------------- peso bruto menos a tara --------- */
  if (Number.isNaN(brutoG)) {
    return { ok: false, erro: 'Informe o peso bruto (um número de gramas, sem negativo).' }
  }
  if (Number.isNaN(taraG)) {
    return { ok: false, erro: 'Informe a tara do recipiente (um número de gramas, sem negativo).' }
  }
  if (taraG > TARA_MAXIMA_G) {
    return { ok: false, erro: `A tara não pode passar de ${TARA_MAXIMA_G} g. Confira a gramatura.` }
  }
  if (taraG > brutoG) {
    return {
      ok: false,
      erro: 'A tara não pode ser maior que o peso bruto (o peso líquido ficaria negativo).',
    }
  }

  const liquidoG = brutoG - taraG

  if (liquidoG <= 0) {
    return { ok: false, erro: 'O peso líquido ficou zero. Confira o peso bruto e a tara.' }
  }

  return {
    ok: true,
    metodo: METODOS_PESO.BRUTO_TARA,
    liquidoGramas: liquidoG,
    brutoGramas: brutoG,
    taraGramas: taraG,
  }
}

/* ---------------------------------------------------------------- total ---- */

/**
 * Total em centavos para um peso líquido e um preço por quilo.
 * Aritmética inteira: `centavosPorKg * gramas / 1000`, arredondado só no fim.
 */
export function calcularTotalPeso({ liquidoGramas, precoPorKg } = {}) {
  const gramas = paraGramas(liquidoGramas)
  const centavosPorKg = paraCentavos(precoPorKg)

  if (Number.isNaN(gramas) || gramas <= 0) {
    return { ok: false, erro: 'Peso líquido inválido para calcular o total.' }
  }
  if (Number.isNaN(centavosPorKg) || centavosPorKg < 0) {
    return { ok: false, erro: 'Preço por quilo inválido.' }
  }

  // Inteiros exatos -> a divisão por 1000 no fim é o único ponto fracionário.
  const centavos = Math.round((centavosPorKg * gramas) / GRAMAS_POR_QUILO)

  return { ok: true, centavos, total: centavos / 100 }
}

/* ------------------------------------------------------------ atalho ------ */

/**
 * Faz a conta inteira de uma linha de venda por peso: método -> peso líquido
 * -> total. Devolve tudo o que precisa ser gravado na venda (bruto, tara,
 * líquido, preço unitário e total).
 *
 * @returns consulte `calcularPesoLiquido` + `{centavos, total, precoPorKg}`
 */
export function calcularVendaPorPeso({
  metodo,
  pesoLiquidoGramas,
  pesoBrutoGramas,
  taraGramas,
  precoPorKg,
} = {}) {
  const peso = calcularPesoLiquido({ metodo, pesoLiquidoGramas, pesoBrutoGramas, taraGramas })
  if (!peso.ok) return peso

  const dinheiro = calcularTotalPeso({ liquidoGramas: peso.liquidoGramas, precoPorKg })
  if (!dinheiro.ok) return dinheiro

  return {
    ok: true,
    metodo: peso.metodo,
    brutoGramas: peso.brutoGramas,
    taraGramas: peso.taraGramas,
    liquidoGramas: peso.liquidoGramas,
    precoPorKg: Number(precoPorKg),
    centavos: dinheiro.centavos,
    total: dinheiro.total,
    /** Quilos com 3 casas — é o que vai para `itens_venda.quantidade`. */
    liquidoQuilos: Number((peso.liquidoGramas / GRAMAS_POR_QUILO).toFixed(3)),
  }
}

/** `450 -> "450 g"`, `1200 -> "1,2 kg"` — só para exibir. */
export function formatPeso(gramas) {
  const g = paraGramas(gramas)
  if (Number.isNaN(g)) return '—'
  if (g < GRAMAS_POR_QUILO) return `${new Intl.NumberFormat('pt-BR').format(g)} g`

  const kg = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(
    g / GRAMAS_POR_QUILO,
  )
  return `${kg} kg`
}
