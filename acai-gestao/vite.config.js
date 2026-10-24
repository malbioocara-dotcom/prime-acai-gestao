import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Configuração do Vite.
 *
 * O pacote `Login_projetos` (login/cadastro/recuperação de senha) mora FORA
 * desta pasta e é instalado como dependência local (`file:../Login_projetos`).
 * No Windows o npm pode deixar o link do pacote quebrado (pasta vazia), e aí
 * TODO o app para de buildar. Para não depender disso, os imports de
 * `login-projetos` são resolvidos por alias direto na pasta real do pacote.
 *
 *  - `resolve.alias`: aponta cada subcaminho do pacote para o arquivo real,
 *    sem passar pelo `node_modules`.
 *  - `resolve.dedupe`: os imports de `lucide` e `@neondatabase/neon-js` feitos
 *    DENTRO do pacote precisam resolver por esta pasta (a raiz do app), senão o
 *    Vite procuraria `node_modules` do lado do pacote e não acharia.
 *  - `server.fs.allow`: o dev server precisa de permissão para servir arquivos
 *    que estão um nível acima da raiz do projeto.
 */
const loginSrc = fileURLToPath(new URL('../Login_projetos/src', import.meta.url)).replace(/\\/g, '/')

export default defineConfig({
  resolve: {
    dedupe: ['lucide', '@neondatabase/neon-js'],
    alias: [
      { find: /^login-projetos\/estilo\.css$/, replacement: `${loginSrc}/styles/auth.css` },
      { find: /^login-projetos\/pages\/(.+)$/, replacement: `${loginSrc}/pages/$1.js` },
      { find: /^login-projetos\/(config|sessao|validacao|auth-ui|ui)$/, replacement: `${loginSrc}/$1.js` },
      { find: /^login-projetos\/auth$/, replacement: `${loginSrc}/services/auth.js` },
      { find: /^login-projetos\/neon$/, replacement: `${loginSrc}/lib/neon.js` },
      { find: /^login-projetos\/icons$/, replacement: `${loginSrc}/lib/icons.js` },
      { find: /^login-projetos$/, replacement: `${loginSrc}/index.js` },
    ],
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
