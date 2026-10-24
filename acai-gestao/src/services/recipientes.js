import { recipientes as exemplo } from '../data.js'
import { TARA_MAXIMA_G, paraGramas } from '../peso.js'
import { carregar, gravar, paraBooleano } from './base.js'

/**
 * Tipos de recipiente e a tara em gramas.
 *
 * A tara é o peso da embalagem VAZIA. Na venda por peso ela é descontada do
 * peso bruto para chegar ao peso líquido — que é o que o cliente paga:
 *
 *     peso líquido = peso bruto - tara
 *
 * Um recipiente não é apagado: quando sai de uso, vira inativo. A tara de uma
 * venda antiga precisa continuar explicável, e o histórico de alteração (quem
 * mudou a tara, de quanto para quanto e quando) é gravado por trigger no banco
 * — o navegador nunca escreve nesse histórico.
 */

const CAMPOS = 'id, nome, tara_g, ativo, created_at, updated_at'

/**
 * O histórico tenta trazer o autor junto (embed em `profiles`, via a FK
 * `recipientes_historico.alterado_por`). O embed exige que o Data API conheça
 * o relacionamento — se ele ainda não estiver no cache de schema, a consulta
 * inteira falharia e o histórico apareceria vazio. Por isso existe a versão
 * sem embed como plano B.
 */
const CAMPOS_HISTORICO = 'id, nome_anterior, nome_novo, tara_g_anterior, tara_g_novo, alterado_em, autor:profiles(full_name)'
const CAMPOS_HISTORICO_SIMPLES = 'id, nome_anterior, nome_novo, tara_g_anterior, tara_g_novo, alterado_em'

const paraApp = (linha) => ({
  uuid: linha.id,
  nome: linha.nome,
  tara: Number(linha.tara_g),
  ativo: linha.ativo,
  criadoEm: linha.created_at,
  atualizadoEm: linha.updated_at,
})

const paraHistorico = (linha) => ({
  uuid: linha.id,
  autor: linha.autor?.full_name ?? linha.autor?.nome ?? null,
  nomeAnterior: linha.nome_anterior,
  nomeNovo: linha.nome_novo,
  taraAnterior: linha.tara_g_anterior == null ? null : Number(linha.tara_g_anterior),
  taraNova: Number(linha.tara_g_novo),
  quando: linha.alterado_em,
})

/**
 * Lista os recipientes da organização.
 * `somenteAtivos` é o que a tela de venda usa: recipiente fora de uso não
 * deve nem aparecer para o operador escolher.
 */
export function listarRecipientes({ somenteAtivos = false } = {}) {
  return carregar({
    nome: 'recipientes',
    exemplo: somenteAtivos ? exemplo.filter((r) => r.ativo) : exemplo,
    consulta: async (neon) => {
      let consulta = neon.from('recipientes').select(CAMPOS).order('nome')
      if (somenteAtivos) consulta = consulta.eq('ativo', true)

      const { data, error } = await consulta
      if (error) throw error
      return data.map(paraApp)
    },
  })
}

/**
 * Valida identificação e tara antes de tentar gravar.
 *
 * `paraGramas` já recusa negativo, vazio e texto (devolve NaN); aqui entram as
 * regras de negócio: nome obrigatório e o teto de sanidade da tara.
 *
 * @returns {{ok: true, valor: {nome: string, tara_g: number}} | {ok: false, erro: string}}
 */
export function validarRecipiente({ nome, tara } = {}) {
  const texto = String(nome ?? '').trim()

  if (!texto) return { ok: false, erro: 'Informe a identificação do recipiente.' }
  if (texto.length > 80) {
    return { ok: false, erro: 'A identificação do recipiente deve ter até 80 caracteres.' }
  }

  const gramas = paraGramas(tara)
  if (Number.isNaN(gramas)) {
    return { ok: false, erro: 'A tara precisa ser um número de gramas, sem negativo.' }
  }
  if (gramas > TARA_MAXIMA_G) {
    return { ok: false, erro: `A tara não pode passar de ${TARA_MAXIMA_G} g. Confira a gramatura.` }
  }

  return { ok: true, valor: { nome: texto, tara_g: gramas } }
}

/** Cadastra um recipiente. Nasce ativo. */
export function criarRecipiente(valores) {
  const v = validarRecipiente(valores)
  if (!v.ok) throw new Error(v.erro)

  return gravar({
    nome: 'recipiente',
    registro: { uuid: null, nome: v.valor.nome, tara: v.valor.tara_g, ativo: true },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('recipientes')
        .insert(v.valor)
        .select(CAMPOS)
        .single()

      if (error) throw error
      return paraApp(data)
    },
  })
}

/**
 * Altera nome, tara ou situação de um recipiente.
 * Toda mudança de tara ou nome fica no histórico — quem a grava é o trigger.
 */
export function atualizarRecipiente(uuid, { nome, tara, ativo = true } = {}) {
  const v = validarRecipiente({ nome, tara })
  if (!v.ok) throw new Error(v.erro)

  const situacao = paraBooleano(ativo, true)

  return gravar({
    nome: 'recipiente',
    registro: { uuid, nome: v.valor.nome, tara: v.valor.tara_g, ativo: situacao },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('recipientes')
        .update({ ...v.valor, ativo: situacao })
        .eq('id', uuid)
        .select(CAMPOS)
        .single()

      if (error) throw error
      return paraApp(data)
    },
  })
}

/** Histórico de alteração da tara/nome, do mais recente para o mais antigo. */
export function listarHistoricoRecipiente(recipienteId) {
  return carregar({
    nome: 'histórico do recipiente',
    exemplo: [],
    consulta: async (neon) => {
      const comAutor = await neon
        .from('recipientes_historico')
        .select(CAMPOS_HISTORICO)
        .eq('recipiente_id', recipienteId)
        .order('alterado_em', { ascending: false })

      if (!comAutor.error) return comAutor.data.map(paraHistorico)

      const semAutor = await neon
        .from('recipientes_historico')
        .select(CAMPOS_HISTORICO_SIMPLES)
        .eq('recipiente_id', recipienteId)
        .order('alterado_em', { ascending: false })

      if (semAutor.error) throw semAutor.error
      return semAutor.data.map(paraHistorico)
    },
  })
}
