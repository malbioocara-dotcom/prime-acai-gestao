import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js'
import { config } from '../config.js'

/**
 * Cliente do Neon no navegador.
 *
 * Substitui o antigo `createBrowserClient` do Supabase. O `createClient` do
 * `@neondatabase/neon-js` junta duas coisas numa só:
 *
 * - **Managed Better Auth** (login, cadastro, sessão), através do
 *   `SupabaseAuthAdapter`, que expõe a MESMA API que o app já usava
 *   (`auth.signInWithPassword`, `auth.signUp`, `auth.getSession`,
 *   `auth.onAuthStateChange`…). Por isso as telas de autenticação quase não
 *   mudam.
 * - **Data API** (PostgREST), onde as consultas `.from(...).select()` continuam
 *   iguais às do Supabase.
 *
 * Uma única URL resolve os dois: o SDK deriva o endpoint de Auth e o de Data
 * API a partir dela. É a URL HTTPS do banco (host + database), **não** a string
 * de conexão do Postgres. Exemplo:
 *
 *   VITE_NEON_URL=https://ep-xxx.c-2.us-east-2.aws.neon.tech/neondb
 *
 * Sem a variável, `neon` fica `null` e o host deve rodar em modo demonstração
 * (dados de exemplo seus).
 *
 * Segurança: a URL vai no bundle do navegador. Quem protege os dados é o RLS
 * (veja `sql/00_profiles.sql`) — exatamente como era com o Supabase.
 */

/**
 * Atenção ao detalhe: guardamos a variável **crua** e só limpamos o texto na
 * hora de criar o cliente. Se ela sumisse por `?.trim()` aqui em cima,
 * `neonConfigurado` deixaria de ser uma constante conhecida na hora do build e
 * o Rollup NÃO conseguiria remover o SDK quando o `.env` está vazio — o bundle
 * do modo demonstração dobraria de tamanho sem motivo.
 */
const url = import.meta.env.VITE_NEON_URL

export const neonConfigurado = Boolean(url)

export const neon = neonConfigurado
  ? createClient(String(url).trim(), {
      auth: {
        adapter: SupabaseAuthAdapter(),
      },
    })
  : null

/** Retorna o cliente configurado pelo host ou o cliente Neon padrão. */
export function clienteAuth() {
  return config.provedor.cliente ?? neon
}

/** Informa se há um cliente disponível para operações de autenticação. */
export function authConfigurado() {
  return Boolean(clienteAuth())
}

if (!neonConfigurado) {
  console.info(
    '[neon] VITE_NEON_URL ausente no .env — o login está em modo demonstração.',
  )
}
