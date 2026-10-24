/**
 * Datas de calendário que as telas consultam (o dia dos pedidos, o dia do
 * fechamento).
 *
 * Tudo aqui é `AAAA-MM-DD` no fuso LOCAL do navegador — o dia do operador, não
 * o dia UTC. É a mesma convenção do `hoje()` de `services/base.js`, e o motivo é
 * concreto: no Brasil (UTC−3), converter `19/10 21:00` para `toISOString()`
 * devolve `20/10`. A noite inteira cairia no dia seguinte.
 */

const FORMATO = /^\d{4}-\d{2}-\d{2}$/

/** `AAAA-MM-DD` de uma data local, sem passar por UTC. */
function isoLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * O texto é uma data de calendário de verdade?
 *
 * Confere o formato E o dia existente: `2026-02-31` tem o formato certo, mas o
 * `Date` o rola para 03/03 — e a comparação de volta pega isso.
 */
export function diaValido(valor) {
  if (!FORMATO.test(String(valor ?? ''))) return false
  const d = new Date(`${valor}T12:00:00`)
  return !Number.isNaN(d.getTime()) && isoLocal(d) === valor
}

/**
 * Soma (ou subtrai) dias de calendário.
 *
 * Meio-dia, e não meia-noite: em fuso com horário de verão, a meia-noite de
 * alguns dias não existe, e o `Date` a empurraria para o dia errado.
 */
export function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + Number(dias))
  return isoLocal(d)
}

/**
 * O intervalo do dia para consultar uma coluna `timestamptz`: de 00:00 local
 * (inclusive) até 00:00 do dia seguinte (exclusive).
 *
 * Devolve ISO em UTC porque é o que o Postgres compara; o recorte é local
 * porque é o que o operador chama de "o dia".
 */
export function limitesDoDia(iso) {
  return {
    inicio: new Date(`${iso}T00:00:00`).toISOString(),
    fim: new Date(`${somarDias(iso, 1)}T00:00:00`).toISOString(),
  }
}

/** Rótulo curto para a tela: `hoje`, `ontem` ou `12/10/2026`. */
export function rotuloDia(iso, referencia) {
  if (iso === referencia) return 'hoje'
  if (iso === somarDias(referencia, -1)) return 'ontem'

  const [ano, mes, dia] = String(iso).split('-')
  return `${dia}/${mes}/${ano}`
}
