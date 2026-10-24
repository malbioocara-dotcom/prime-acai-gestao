/**
 * Dados de exemplo (mock) para dar vida à interface antes da integração
 * com o banco. Com o Neon configurado, as telas começam vazias enquanto
 * carregam dados reais e nunca apresentam estes exemplos como dados da loja.
 */

import { neonConfigurado } from 'login-projetos/neon'
import { dadosTesteHabilitados, produtosTeste } from './demo-test-data.js'

export const resumo = neonConfigurado ? {
  faturamentoMes: 0,
  faturamentoDelta: 0,
  faturamentoHoje: 0,
  faturamentoHojeDelta: 0,
  vendasHoje: 0,
  vendasHojeDelta: 0,
  cancelamentos: 0,
  ticketMedio: 0,
  ticketMedioDelta: 0,
  clientesAtivos: 0,
  clientesAtivosDelta: 0,
  novosClientes: 0,
} : {
  faturamentoMes: 48750.9,
  faturamentoDelta: 12.4,
  faturamentoHoje: 4520.0,
  faturamentoHojeDelta: 16.2,
  vendasHoje: 138,
  vendasHojeDelta: -3.1,
  cancelamentos: 2,
  ticketMedio: 32.75,
  ticketMedioDelta: 5.2,
  clientesAtivos: 342,
  clientesAtivosDelta: 8.7,
  novosClientes: 12,
}

export const faturamento7Dias = neonConfigurado ? {
  labels: [],
  valores: [],
} : {
  labels: ['10/10', '11/10', '12/10', '13/10', '14/10', '15/10', '16/10'],
  valores: [3420, 4180, 2650, 2980, 3310, 3890, 4520],
}

export const vendasPorCategoria = neonConfigurado ? {
  labels: [],
  valores: [],
} : {
  labels: ['Açaí', 'Adicionais', 'Frutas', 'Embalagens'],
  valores: [32000, 8500, 5200, 3050],
}

/** status: 'Concluída' | 'Em preparo' | 'Aguardando' | 'Cancelada' */
export const vendas = neonConfigurado ? [] : [
  { id: '#4821', cliente: 'Maria Souza', itens: 3, total: 64.5, pagamento: 'Pix', status: 'Concluída', hora: '14:32' },
  { id: '#4820', cliente: 'Carlos Lima', itens: 1, total: 21.9, pagamento: 'Crédito', status: 'Em preparo', hora: '14:18' },
  { id: '#4819', cliente: 'Ana Beatriz', itens: 5, total: 108.4, pagamento: 'Débito', status: 'Concluída', hora: '13:55' },
  { id: '#4818', cliente: 'Pedro Alves', itens: 2, total: 43.8, pagamento: 'Dinheiro', status: 'Concluída', hora: '13:41' },
  { id: '#4817', cliente: 'Juliana Reis', itens: 4, total: 87.2, pagamento: 'Pix', status: 'Aguardando', hora: '13:22' },
  { id: '#4816', cliente: 'Rafael Nunes', itens: 1, total: 18.0, pagamento: 'Pix', status: 'Cancelada', hora: '12:58' },
  { id: '#4815', cliente: 'Fernanda Dias', itens: 6, total: 132.7, pagamento: 'Crédito', status: 'Concluída', hora: '12:30' },
  { id: '#4814', cliente: 'Lucas Moreira', itens: 2, total: 39.6, pagamento: 'Débito', status: 'Concluída', hora: '12:04' },
]

/**
 * Produto de exemplo no formato que as telas usam — já com os campos do
 * cadastro por tipo de venda (migração 04). Os padrões repetem os que o banco
 * aplica, para o modo demonstração nunca exibir um estado que o banco não
 * aceitaria (ex.: tipo 'peso' sem método de peso).
 */
const produto = (p) => ({
  descricao: '',
  tipoVenda: 'unidade',
  controlaEstoque: true,
  metodoEstoque: 'movimentacoes',
  metodoPeso: null,
  ativo: true,
  ...p,
})

export const produtos = neonConfigurado ? [] : [
  produto({ id: 'P001', nome: 'Açaí tradicional 300ml', categoria: 'Açaí', quantidade: 86, minimo: 40, unidade: 'un', custo: 5.2, preco: 15.9 }),
  produto({ id: 'P002', nome: 'Açaí tradicional 500ml', categoria: 'Açaí', quantidade: 48, minimo: 45, unidade: 'un', custo: 9.4, preco: 21.9 }),
  produto({ id: 'P003', nome: 'Açaí tradicional 700ml', categoria: 'Açaí', quantidade: 22, minimo: 30, unidade: 'un', custo: 12.8, preco: 28.5 }),
  produto({ id: 'P004', nome: 'Açaí zero açúcar 500ml', categoria: 'Açaí', quantidade: 31, minimo: 25, unidade: 'un', custo: 10.1, preco: 23.9 }),
  produto({ id: 'P005', nome: 'Granola crocante', categoria: 'Adicionais', quantidade: 9, minimo: 15, unidade: 'kg', custo: 18.0, preco: 3.5 }),
  produto({ id: 'P006', nome: 'Leite em pó', categoria: 'Adicionais', quantidade: 14, minimo: 10, unidade: 'kg', custo: 32.0, preco: 4.0 }),
  produto({ id: 'P007', nome: 'Morango fresco', categoria: 'Frutas', quantidade: 6, minimo: 12, unidade: 'kg', custo: 24.5, preco: 5.0 }),
  produto({ id: 'P008', nome: 'Banana prata', categoria: 'Frutas', quantidade: 21, minimo: 10, unidade: 'kg', custo: 6.8, preco: 3.0 }),
  produto({ id: 'P009', nome: 'Copo 500ml com tampa', categoria: 'Embalagens', quantidade: 640, minimo: 300, unidade: 'un', custo: 0.42, preco: 0 }),
  produto({ id: 'P010', nome: 'Colher descartável', categoria: 'Embalagens', quantidade: 250, minimo: 400, unidade: 'un', custo: 0.08, preco: 0 }),
  ...(dadosTesteHabilitados ? produtosTeste : []),
]

/**
 * Tipos de recipiente e a tara em gramas (migração 04). A tara é o peso da
 * embalagem vazia: é o que se desconta do peso bruto para chegar ao líquido.
 */
export const recipientes = neonConfigurado ? [] : [
  { uuid: 'R-300', nome: 'Copo 300ml com tampa', tara: 12, ativo: true },
  { uuid: 'R-500', nome: 'Copo 500ml com tampa', tara: 16, ativo: true },
  { uuid: 'R-700', nome: 'Copo 700ml com tampa', tara: 22, ativo: true },
  { uuid: 'R-BAN', nome: 'Bandeja de buffet', tara: 180, ativo: true },
  { uuid: 'R-TIG', nome: 'Tigela de inox', tara: 240, ativo: false },
]

/** tipo: 'entrada' | 'saida' */
export const lancamentos = neonConfigurado ? [] : [
  { id: 'L-2041', data: '2026-10-16', descricao: 'Vendas do dia (PDV)', categoria: 'Vendas', tipo: 'entrada', valor: 4520.0, forma: 'Misto' },
  { id: 'L-2040', data: '2026-10-16', descricao: 'Compra de polpa de açaí', categoria: 'Insumos', tipo: 'saida', valor: 1280.0, forma: 'Pix' },
  { id: 'L-2039', data: '2026-10-15', descricao: 'Vendas do dia (PDV)', categoria: 'Vendas', tipo: 'entrada', valor: 3890.0, forma: 'Misto' },
  { id: 'L-2038', data: '2026-10-15', descricao: 'Energia elétrica', categoria: 'Contas fixas', tipo: 'saida', valor: 742.35, forma: 'Débito automático' },
  { id: 'L-2037', data: '2026-10-14', descricao: 'Vendas do dia (PDV)', categoria: 'Vendas', tipo: 'entrada', valor: 3310.0, forma: 'Misto' },
  { id: 'L-2036', data: '2026-10-14', descricao: 'Embalagens e descartáveis', categoria: 'Insumos', tipo: 'saida', valor: 415.9, forma: 'Crédito' },
  { id: 'L-2035', data: '2026-10-13', descricao: 'Vendas do dia (PDV)', categoria: 'Vendas', tipo: 'entrada', valor: 2980.0, forma: 'Misto' },
  { id: 'L-2034', data: '2026-10-13', descricao: 'Pagamento de funcionário', categoria: 'Pessoal', tipo: 'saida', valor: 1850.0, forma: 'Transferência' },
]

export const fluxoMensal = neonConfigurado ? {
  labels: [],
  entradas: [],
  saidas: [],
} : {
  labels: ['Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out'],
  entradas: [38200, 41500, 39800, 44300, 46900, 48750],
  saidas: [26100, 28400, 27900, 29800, 31200, 32150],
}

/**
 * Entradas do mesmo trecho do mês passado (do dia 1 até o dia de hoje), que é
 * a referência da etiqueta de variação do Financeiro. Comparar o mês em curso,
 * que ainda está pela metade, com o mês anterior inteiro daria uma queda que
 * não existe.
 */
export const comparativoMensal = neonConfigurado ? {
  entradasAnterior: 0,
} : {
  entradasAnterior: 46900,
}

/** tier: 'Novo' | 'Recorrente' | 'VIP' */
export const clientes = neonConfigurado ? [] : [
  { id: 'C-0912', nome: 'Fernanda Dias', telefone: '(11) 98812-4471', email: 'fernanda.dias@email.com', desde: '2024-03-11', pedidos: 84, total: 2680.4, ultimaCompra: '2026-10-16', tier: 'VIP' },
  { id: 'C-0887', nome: 'Maria Souza', telefone: '(11) 99145-2210', email: 'maria.souza@email.com', desde: '2024-06-02', pedidos: 61, total: 1892.7, ultimaCompra: '2026-10-16', tier: 'VIP' },
  { id: 'C-1104', nome: 'Ana Beatriz', telefone: '(11) 97733-8102', email: 'ana.beatriz@email.com', desde: '2025-01-19', pedidos: 43, total: 1245.9, ultimaCompra: '2026-10-16', tier: 'Recorrente' },
  { id: 'C-1207', nome: 'Juliana Reis', telefone: '(11) 98120-9944', email: 'juliana.reis@email.com', desde: '2025-04-27', pedidos: 38, total: 1108.3, ultimaCompra: '2026-10-16', tier: 'Recorrente' },
  { id: 'C-1330', nome: 'Carlos Lima', telefone: '(11) 99671-3320', email: 'carlos.lima@email.com', desde: '2025-08-14', pedidos: 27, total: 742.6, ultimaCompra: '2026-10-16', tier: 'Recorrente' },
  { id: 'C-1455', nome: 'Pedro Alves', telefone: '(11) 98402-1177', email: 'pedro.alves@email.com', desde: '2026-01-08', pedidos: 14, total: 388.2, ultimaCompra: '2026-10-16', tier: 'Recorrente' },
  { id: 'C-1502', nome: 'Lucas Moreira', telefone: '(11) 99033-7765', email: 'lucas.moreira@email.com', desde: '2026-07-22', pedidos: 5, total: 121.4, ultimaCompra: '2026-10-16', tier: 'Novo' },
  { id: 'C-1531', nome: 'Rafael Nunes', telefone: '(11) 98890-4402', email: 'rafael.nunes@email.com', desde: '2026-09-30', pedidos: 2, total: 41.8, ultimaCompra: '2026-10-16', tier: 'Novo' },
]
