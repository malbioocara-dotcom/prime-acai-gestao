import { clientes as exemplo } from '../data.js'
import { carregar, gravar, hoje } from './base.js'

const CAMPOS = 'id, codigo, nome, telefone, email, desde, tier, pedidos, total, ultima_compra'

/** Converte a linha de vw_clientes_resumo para o formato que a tela usa. */
const paraApp = (linha) => ({
  uuid: linha.id,
  id: linha.codigo,
  nome: linha.nome,
  telefone: linha.telefone ?? '—',
  email: linha.email ?? '—',
  desde: linha.desde,
  pedidos: Number(linha.pedidos ?? 0),
  total: Number(linha.total ?? 0),
  ultimaCompra: linha.ultima_compra ?? linha.desde,
  tier: linha.tier,
})

export function listarClientes() {
  return carregar({
    nome: 'clientes',
    exemplo,
    consulta: async (neon) => {
      // A view já entrega pedidos, total gasto e última compra calculados.
      const { data, error } = await neon
        .from('vw_clientes_resumo')
        .select(CAMPOS)
        .order('total', { ascending: false })

      if (error) throw error
      return data.map(paraApp)
    },
  })
}

/** Sugere o próximo código livre a partir dos já cadastrados (C-0912, C-1531...). */
export function proximoCodigoCliente(lista) {
  const maior = lista.reduce((acc, c) => {
    const n = Number(String(c.id).replace(/\D/g, ''))
    return Number.isFinite(n) && n > acc ? n : acc
  }, 0)

  return `C-${String(maior + 1).padStart(4, '0')}`
}

/** Grava um cliente novo. */
export function criarCliente(valores) {
  const registro = {
    codigo: valores.codigo.trim().toUpperCase(),
    nome: valores.nome.trim(),
    telefone: valores.telefone.trim() || null,
    email: valores.email.trim() || null,
    desde: valores.desde || hoje(),
    tier: valores.tier,
    observacoes: valores.observacoes.trim() || null,
  }

  return gravar({
    nome: 'cliente',
    registro: {
      uuid: null,
      id: registro.codigo,
      nome: registro.nome,
      telefone: registro.telefone ?? '—',
      email: registro.email ?? '—',
      desde: registro.desde,
      pedidos: 0,
      total: 0,
      ultimaCompra: registro.desde,
      tier: registro.tier,
    },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('clientes')
        .insert(registro)
        .select('id, codigo, nome, telefone, email, desde, tier')
        .single()

      if (error) throw error

      // Cliente recém-criado ainda não tem compras: o resumo começa zerado.
      return paraApp({ ...data, pedidos: 0, total: 0, ultima_compra: data.desde })
    },
  })
}
