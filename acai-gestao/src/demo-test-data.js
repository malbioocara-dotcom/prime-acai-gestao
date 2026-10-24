import { neonConfigurado } from 'login-projetos/neon'

export const dadosTesteHabilitados =
  !neonConfigurado && import.meta.env.VITE_DADOS_TESTE === 'true'

export const categoriasProdutoTeste = [
  {
    id: 'demo-categoria-sazonal',
    nome: 'TESTE - Linha sazonal',
    descricao: 'Categoria fictícia para validar filtros e associação com produtos.',
    ativo: true,
    criado_em: '2026-10-20T12:00:00.000Z',
    atualizado_em: '2026-10-20T12:00:00.000Z',
  },
  {
    id: 'demo-categoria-arquivada',
    nome: 'TESTE - Categoria arquivada',
    descricao: 'Categoria fictícia inativa para validar preservação em edições.',
    ativo: false,
    criado_em: '2026-10-19T12:00:00.000Z',
    atualizado_em: '2026-10-21T12:00:00.000Z',
  },
]

export const categoriasTipoVendaTeste = [
  {
    id: 'demo-categoria-venda-evento',
    codigo: 'teste_evento',
    nome: 'TESTE - Evento sazonal',
    descricao: 'Categoria fictícia para testar tipos de venda de eventos.',
    ativo: true,
    criado_em: '2026-10-20T13:00:00.000Z',
    atualizado_em: '2026-10-20T13:00:00.000Z',
  },
  {
    id: 'demo-categoria-venda-inativa',
    codigo: 'teste_inativa',
    nome: 'TESTE - Categoria de venda inativa',
    descricao: 'Categoria fictícia inativa para validar filtros e edição.',
    ativo: false,
    criado_em: '2026-10-18T13:00:00.000Z',
    atualizado_em: '2026-10-21T13:00:00.000Z',
  },
]

export const tiposVendaTeste = [
  {
    id: 'demo-tipo-retirada',
    codigo: 'teste_retirada',
    nome: 'TESTE - Retirada agendada',
    categoria: 'balcao',
    ativo: true,
  },
  {
    id: 'demo-tipo-inativo',
    codigo: 'teste_tipo_inativo',
    nome: 'TESTE - Canal inativo',
    categoria: 'personalizado',
    ativo: false,
  },
]

export const formasPagamentoTeste = [
  {
    id: 'demo-pagamento-voucher',
    codigo: 'teste_voucher',
    nome: 'TESTE - Voucher fictício',
    categoria: 'outros',
    ativo: true,
  },
]

export const produtosTeste = [
  {
    id: 'P011',
    nome: 'TESTE - Açaí self-service por kg',
    descricao: 'Item fictício vendido por peso; imagem propositalmente não cadastrada.',
    categoria: 'TESTE - Linha sazonal',
    quantidade: 12.5,
    minimo: 8,
    unidade: 'kg',
    custo: 18,
    preco: 69.9,
    tipoVenda: 'peso',
    metodoPeso: 'bruto_tara',
    controlaEstoque: true,
    metodoEstoque: 'movimentacoes',
    ativo: true,
  },
  {
    id: 'P012',
    nome: 'TESTE - Bowl energia',
    descricao: 'Produto fictício vendido por receita/porção.',
    categoria: 'TESTE - Linha sazonal',
    quantidade: 8,
    minimo: 3,
    unidade: 'un',
    custo: 7.5,
    preco: 24.9,
    tipoVenda: 'receita',
    metodoPeso: null,
    controlaEstoque: true,
    metodoEstoque: 'movimentacoes',
    ativo: true,
  },
  {
    id: 'P013',
    nome: 'TESTE - Creme sazonal inativo',
    descricao: 'Produto fictício inativo para validar filtros e reativação.',
    categoria: 'TESTE - Categoria arquivada',
    quantidade: 0,
    minimo: 2,
    unidade: 'un',
    custo: 4,
    preco: 14.9,
    tipoVenda: 'unidade',
    metodoPeso: null,
    controlaEstoque: true,
    metodoEstoque: 'movimentacoes',
    ativo: false,
  },
]

export const saldosEstoqueTeste = [
  { produtoId: 'P005', geral: 6.5, loja: 9 },
  { produtoId: 'P008', geral: 18, loja: 21 },
  { produtoId: 'P009', geral: 1200, loja: 640 },
  { produtoId: 'P011', geral: 17.5, loja: 12.5 },
  { produtoId: 'P012', geral: 4, loja: 8 },
  { produtoId: 'P013', geral: 0, loja: 0 },
]

export const movimentacoesEstoqueTeste = [
  {
    uuid: 'demo-movimento-p011-entrada',
    produtoId: 'P011',
    quantidade: 30,
    origem: 'fornecedor',
    destino: 'estoque_geral',
    motivo: 'Dado fictício: entrada inicial de demonstração',
    saldo: 12.5,
    quando: '2026-10-22T09:00:00.000Z',
    quem: 'Usuário de demonstração',
    vendaId: null,
  },
  {
    uuid: 'demo-movimento-p011-transferencia',
    produtoId: 'P011',
    quantidade: 12.5,
    origem: 'estoque_geral',
    destino: 'estoque',
    motivo: 'Dado fictício: reposição da loja',
    saldo: 12.5,
    quando: '2026-10-22T10:30:00.000Z',
    quem: 'Usuário de demonstração',
    vendaId: null,
  },
  {
    uuid: 'demo-movimento-p008-entrada',
    produtoId: 'P008',
    quantidade: 18,
    origem: 'fornecedor',
    destino: 'estoque_geral',
    motivo: 'Dado fictício: entrada no estoque geral',
    saldo: 21,
    quando: '2026-10-21T14:00:00.000Z',
    quem: 'Usuário de demonstração',
    vendaId: null,
  },
]
