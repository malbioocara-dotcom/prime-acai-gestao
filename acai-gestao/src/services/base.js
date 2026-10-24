import { neon, neonConfigurado } from 'login-projetos/neon'

export { neon, neonConfigurado }

export const EVENTOS_DADOS = {
  carregamentoFalhou: 'dados-carregamento-falhou',
  carregamentoConcluido: 'dados-carregados',
}

function emitirEventoDados(tipo, nome) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(tipo, { detail: { nome } }))
}

/**
 * Executa uma consulta no Neon (Data API).
 *
 * Sem `VITE_NEON_URL`, devolve dados de demonstração. Com o Neon configurado,
 * erros de leitura são propagados para não confundir dados de exemplo com reais.
 *
 * @returns {Promise<{ dados: unknown, origem: 'neon' | 'exemplo' }>}
 */
export async function carregar({ nome, consulta, exemplo }) {
  if (!neonConfigurado) {
    return { dados: exemplo, origem: 'exemplo' }
  }
  try {
    const dados = await consulta(neon)
    emitirEventoDados(EVENTOS_DADOS.carregamentoConcluido, nome)
    return { dados, origem: 'neon' }
  } catch (erro) {
    console.error(`[neon] Falha ao carregar "${nome}".`, erro)
    emitirEventoDados(EVENTOS_DADOS.carregamentoFalhou, nome)
    throw erro
  }
}

/** Data de hoje no formato 'AAAA-MM-DD', pelo fuso local (evita o `toISOString`). */
export function hoje() {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Converte o valor de um `<select>` em booleano de verdade.
 *
 * O formulário manda texto: `Boolean('false')` é `true`, então não dá para
 * confiar no `Boolean` para ler "Ativo / Inativo" — este é o único lugar que
 * faz essa tradução, compartilhado por todos os serviços.
 */
export function paraBooleano(valor, padrao = true) {
  if (valor === true || valor === 'true' || valor === 'sim' || valor === 1 || valor === '1') {
    return true
  }
  if (
    valor === false ||
    valor === 'false' ||
    valor === 'nao' ||
    valor === 'não' ||
    valor === 0 ||
    valor === '0'
  ) {
    return false
  }
  return padrao
}

/**
 * Executa uma escrita no Neon.
 *
 * Diferente de `carregar`, aqui não existe fallback silencioso: se a gravação
 * falhar, o erro sobe para o formulário, que mostra a mensagem ao usuário.
 *
 * Sem credenciais no `.env`, devolve o registro já montado com origem
 * 'exemplo' — a tela insere na lista em memória e avisa que nada foi
 * persistido, em vez de fingir que salvou.
 *
 * @returns {Promise<{ dados: unknown, origem: 'neon' | 'exemplo' }>}
 */
export async function gravar({ nome, registro, escrever }) {
  if (!neonConfigurado) {
    return { dados: registro, origem: 'exemplo' }
  }

  try {
    return { dados: await escrever(neon), origem: 'neon' }
  } catch (erro) {
    console.error(`[neon] Falha ao gravar "${nome}".`, erro)
    throw erro
  }
}

/**
 * Evita atualizar a tela depois que o usuário já saiu dela.
 *
 * Uso:
 *   const parar = observar(listarProdutos(), ({ dados }) => renderizar(dados))
 *   return parar   // limpeza do mount()
 */
export function observar(promessa, callback) {
  let cancelado = false

  promessa
    .then((resultado) => {
      if (!cancelado) callback(resultado)
    })
    .catch((erro) => {
      if (!cancelado) console.error('[neon] Erro inesperado:', erro)
    })

  return () => {
    cancelado = true
  }
}
