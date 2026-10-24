import { vendas as exemplo } from '../data.js'
import { diaValido, limitesDoDia } from '../datas.js'
import { carregar, gravar, hoje, neon, neonConfigurado } from './base.js'

const hora = (iso) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Converte a linha do banco (com os relacionamentos embutidos) para o app. */
const paraApp = (linha) => {
  const detalhes = Array.isArray(linha.venda_detalhes)
    ? linha.venda_detalhes[0]
    : linha.venda_detalhes

  return {
    uuid: linha.id,
    id: linha.codigo,
    cliente: linha.clientes?.nome ?? 'Consumidor',
    itens: linha.itens_venda?.[0]?.count ?? 0,
    subtotal: Number(linha.total),
    total: Number(detalhes?.total_cobrado ?? linha.total),
    pagamento: detalhes?.forma_pagamento_nome ?? linha.pagamento,
    tipoVenda: detalhes?.tipo_venda_nome ?? 'Não informado',
    taxaEntrega: Number(detalhes?.taxa_entrega ?? 0),
    plataforma: detalhes?.plataforma ?? null,
    pedidoExterno: detalhes?.pedido_externo ?? null,
    taxaAplicativo: Number(detalhes?.taxa_aplicativo ?? 0),
    troco: Number(detalhes?.troco ?? 0),
    comissaoEstimada: Number(detalhes?.comissao_estimada ?? 0),
    valorLiquidoEstimado: Number(detalhes?.valor_liquido_estimado ?? linha.total),
    status: linha.status,
    // Preenchido só quando a venda foi estornada depois de registrada (migração
    // 11); é o que a tela usa para mostrar "Estornada" em vez de "Cancelada".
    estornadaEm: linha.estornada_em ?? null,
    hora: hora(linha.criado_em),
  }
}

const CAMPOS =
  'id, codigo, status, pagamento, total, criado_em, estornada_em, clientes(nome), itens_venda(count), venda_detalhes(tipo_venda_nome, forma_pagamento_nome, taxa_entrega, plataforma, pedido_externo, taxa_aplicativo, total_cobrado, troco, comissao_estimada, valor_liquido_estimado)'

/**
 * Teto de segurança de um dia de pedidos — não é paginação.
 *
 * Um dia cheio na loja fica na casa das centenas, não dos milhares. Quando o
 * dia bate neste teto, a tela avisa que está mostrando só os mais recentes (veja
 * `LIMITE_DIA` na página de Vendas): melhor dizer que cortou do que exibir
 * "300 de 300" como se fosse o dia inteiro.
 */
export const LIMITE_DIA = 300

/**
 * Pedidos de UM dia — hoje, por padrão.
 *
 * O dia é uma data de calendário local (`AAAA-MM-DD`), não um instante: o
 * intervalo vai de 00:00 a 00:00 do dia seguinte no fuso do navegador. É o que
 * o operador chama de "os pedidos de ontem" — inclusive a venda das 23h50.
 */
export function listarVendas({ dia: diaPedido, limite = LIMITE_DIA } = {}) {
  const dia = diaValido(diaPedido) ? diaPedido : hoje()

  return carregar({
    nome: `vendas de ${dia}`,
    exemplo,
    consulta: async (neon) => {
      const { inicio, fim } = limitesDoDia(dia)

      const { data, error } = await neon
        .from('vendas')
        .select(CAMPOS)
        .gte('criado_em', inicio)
        .lt('criado_em', fim)
        .order('criado_em', { ascending: false })
        .limit(limite)

      if (error) throw error
      return (data ?? []).map(paraApp)
    },
  })
}

/** Últimos pedidos, de qualquer data — usado no resumo do dashboard. */
export function listarVendasRecentes(limite = 8) {
  return carregar({
    nome: 'vendas recentes',
    exemplo: exemplo.slice(0, limite),
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('vendas')
        .select(CAMPOS)
        .order('criado_em', { ascending: false })
        .limit(limite)

      if (error) throw error
      return data.map(paraApp)
    },
  })
}

/**
 * O próximo código de pedido, respondido pelo BANCO (migração 10).
 *
 * É o mesmo número que a sequência vai entregar à venda: a função lê a
 * sequência sem consumir nada. Antes a conta era feita aqui (`max(codigo) + 1`),
 * o que divergia do banco assim que um número era queimado por uma transação
 * desfeita — e quebrava quando os códigos passam de quatro dígitos, porque
 * `codigo` é TEXTO ('#10000' vem antes de '#9999').
 *
 * Continua sendo só uma sugestão: o campo nasce vazio e quem numera é o banco.
 */
export async function proximoCodigoVenda() {
  if (!neonConfigurado) return '#4822'

  try {
    const { data, error } = await neon.rpc('proximo_codigo_venda')
    if (error) throw error
    if (typeof data === 'string' && data.startsWith('#')) return data
    throw new Error(`resposta inesperada da função: ${String(JSON.stringify(data)).slice(0, 40)}`)
  } catch (erro) {
    // Banco antigo (sem a função), sem permissão ou sem rede: resta adivinhar
    // pelo último pedido gravado, só para o campo não ficar sem sugestão.
    console.error('[neon] Não foi possível ler o próximo código do pedido.', erro)

    try {
      const { data, error } = await neon
        .from('vendas')
        .select('codigo')
        .order('codigo', { ascending: false })
        .limit(1)

      if (error) throw error

      const ultimo = Number(String(data?.[0]?.codigo ?? '').replace(/\D/g, '')) || 4821
      return `#${ultimo + 1}`
    } catch {
      return `#${String(Date.now()).slice(-5)}`
    }
  }
}

/**
 * Registra a venda inteira pela RPC `registrar_venda` (migração 08).
 *
 * Antes eram três viagens ao banco — INSERT da venda, INSERT dos itens e, se os
 * itens falhassem, DELETE da venda — sem transação, sem estoque e com o total
 * calculado em ponto flutuante no navegador.
 *
 * Agora quem grava é uma função do banco: venda, itens, pesos, total e os
 * movimentos de estoque acontecem juntos, ou nada acontece.
 *
 * `chave` é o selo de idempotência: o formulário gera uma por abertura, e
 * repetir a mesma chave (clique duplo, rede que repetiu o POST, operador que
 * tentou de novo depois de um erro) devolve a MESMA venda em vez de criar
 * outra — e não baixa o estoque duas vezes. Chave nova é venda nova: duas
 * compras iguais são dois pedidos.
 *
 * O preço NÃO vai no corpo da requisição: o banco lê `produtos.preco`, grava
 * uma cópia no item (mudar o cadastro depois não reescreve o passado) e devolve
 * o total que ele mesmo calculou.
 */
export function registrarVenda({
  codigo,
  chave,
  clienteId,
  clienteNome,
  tipoVendaId,
  tipoVendaNome,
  formaPagamentoId,
  formaPagamentoNome,
  formaPagamentoCategoria,
  enderecoEntrega,
  taxaEntrega = 0,
  plataforma,
  pedidoExterno,
  comissaoPercentual = 0,
  taxaAplicativo = 0,
  valorRecebido,
  status,
  pagamento,
  itens,
}) {
  // Total só para a tela: sem banco, é o que aparece no aviso de "entrou só
  // nesta sessão". Com banco, o total que vale — e que volta para a tela — é o
  // que o próprio banco calculou (mesma conta, em `numeric`).
  const centavos = itens.reduce((acc, item) => {
    const preco = Number(item.precoUnitario ?? 0)
    const parcela = item.metodoPeso
      ? Math.round((preco * Number(item.pesoLiquidoGramas ?? 0)) / 10)
      : Math.round(preco * Number(item.quantidade ?? 0) * 100)
    return acc + parcela
  }, 0)
  const totalEstimado = centavos / 100
  const entrega = Number(taxaEntrega) || 0
  const totalCobradoEstimado = Math.round((totalEstimado + entrega) * 100) / 100
  const recebido = Number(valorRecebido)
  const trocoEstimado =
    formaPagamentoCategoria === 'dinheiro' && Number.isFinite(recebido)
      ? Math.max(0, Math.round((recebido - totalCobradoEstimado) * 100) / 100)
      : 0
  const comissaoEstimativa =
    formaPagamentoCategoria === 'aplicativo'
      ? Math.round((totalCobradoEstimado * Number(comissaoPercentual || 0)) / 100 * 100) / 100
      : 0
  const liquidoEstimado = Math.max(
    0,
    Math.round((totalCobradoEstimado - comissaoEstimativa - Number(taxaAplicativo || 0)) * 100) / 100,
  )

  // A linha por peso manda o que foi lido na balança; a linha por unidade
  // manda a quantidade. Em nenhuma das duas o preço sai do navegador.
  const linhas = itens.map((item) =>
    item.metodoPeso
      ? {
          produto_id: item.produtoId,
          metodo_peso: item.metodoPeso,
          peso_bruto_g: item.pesoBrutoGramas,
          tara_g: item.taraGramas,
          peso_liquido_g: item.pesoLiquidoGramas,
          recipiente_id: item.recipienteId,
        }
      : { produto_id: item.produtoId, quantidade: item.quantidade },
  )

  const agora = new Date()

  const paraTela = (linha) => ({
    uuid: linha.id ?? null,
    id: linha.codigo,
    cliente: clienteNome || 'Consumidor',
    itens: Number(linha.itens ?? linhas.length),
    subtotal: Number(linha.total ?? totalEstimado),
    total: Number(linha.total_cobrado ?? totalCobradoEstimado),
    pagamento: linha.forma_pagamento ?? formaPagamentoNome ?? pagamento,
    tipoVenda: linha.tipo_venda ?? tipoVendaNome ?? 'Balcão',
    taxaEntrega: entrega,
    plataforma: plataforma || null,
    pedidoExterno: pedidoExterno || null,
    taxaAplicativo: Number(taxaAplicativo || 0),
    troco: Number(linha.troco ?? trocoEstimado),
    comissaoEstimada: Number(linha.comissao_estimada ?? comissaoEstimativa),
    valorLiquidoEstimado: Number(linha.valor_liquido_estimado ?? liquidoEstimado),
    status: linha.status ?? status,
    hora: hora(linha.criado_em ?? agora.toISOString()),
    jaExistia: Boolean(linha.ja_existia),
    movimentos: Number(linha.movimentos ?? 0),
  })

  const registro = paraTela({
    // Sem banco não existe sequência de pedido: o número mostrado é local e só
    // vale nesta sessão (o aviso da tela diz exatamente isso).
    codigo: String(codigo ?? '').trim() || `#${String(agora.getTime()).slice(-5)}`,
    total: totalEstimado,
    pagamento,
    status,
    criado_em: agora.toISOString(),
    total_cobrado: totalCobradoEstimado,
    forma_pagamento: formaPagamentoNome,
    tipo_venda: tipoVendaNome,
    troco: trocoEstimado,
    comissao_estimada: comissaoEstimativa,
    valor_liquido_estimado: liquidoEstimado,
  })

  return gravar({
    nome: 'venda',
    registro,
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('registrar_venda_completa', {
        p_itens: linhas,
        p_chave: chave || null,
        p_cliente_id: clienteId || null,
        p_tipo_venda_id: tipoVendaId,
        p_forma_pagamento_id: formaPagamentoId,
        p_status: status,
        p_codigo: String(codigo ?? '').trim() || null,
        p_endereco_entrega: enderecoEntrega || null,
        p_taxa_entrega: entrega,
        p_plataforma: plataforma || null,
        p_pedido_externo: pedidoExterno || null,
        p_comissao_percentual: Number(comissaoPercentual || 0),
        p_taxa_aplicativo: Number(taxaAplicativo || 0),
        p_valor_recebido: Number.isFinite(recebido) ? recebido : null,
      })

      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não devolveu a venda registrada.')

      return paraTela(linha)
    },
  })
}

/**
 * Estorna a venda pela RPC `estornar_venda` (migração 11).
 *
 * Estornar não apaga: o livro-razão do estoque é imutável. O banco registra o
 * movimento INVERSO (cliente -> estoque), cancela o pedido e guarda quem
 * estornou, quando e por quê. Por isso o motivo sobe junto — sem ele o estorno
 * não se audita depois.
 *
 * Quem decide é o banco (`vendas.editar`): a tela só esconde o botão de quem
 * não pode. Repetir um estorno que já aconteceu devolve o mesmo resultado, sem
 * devolver o estoque duas vezes.
 */
export function estornarVenda({ vendaId, codigo, motivo }) {
  return gravar({
    nome: 'estorno',
    // Modo demonstração: o registro devolvido é o que a tela mostraria.
    registro: {
      id: codigo ?? '',
      status: 'Cancelada',
      total: 0,
      movimentos: 0,
      jaEstornada: false,
      estornadaEm: new Date().toISOString(),
    },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('estornar_venda', {
        p_venda_id: vendaId,
        p_motivo: motivo,
      })

      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não devolveu o estorno.')

      return {
        id: linha.codigo,
        status: linha.status,
        total: Number(linha.total ?? 0),
        movimentos: Number(linha.movimentos ?? 0),
        jaEstornada: Boolean(linha.ja_estornada),
        estornadaEm: linha.estornada_em ?? null,
      }
    },
  })
}
