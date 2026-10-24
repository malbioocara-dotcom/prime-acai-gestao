# Integração — passo a passo

Guia para levar o **Login_projetos** para um projeto novo (SPA em Vite +
JavaScript puro) usando Neon Auth + Data API.

> Autorização de verdade acontece **no banco** (RLS + funções
> `security definer`). O JavaScript só mostra e esconde. Nenhuma tela deste
> módulo libera dados por conta própria.

---

## Resumo do fluxo

```
[ seu app ]                       [ Neon ]
  tela de login  ──signIn──▶  Neon Auth (neon_auth)
  sessaoAtual()  ──rpc────▶  garantir_perfil()  ──▶ cria/atualiza public.profiles
  rotas          ◀──sessão──  JWT + Data API (RLS)
```

---

## 1. Pré-requisitos

- Node 20+ e um projeto Vite (`npm create vite@latest`).
- Uma conta no [Neon](https://neon.tech) com um projeto e uma branch.
- Duas dependências no seu app (peerDependencies do módulo):

```bash
npm install @neondatabase/neon-js lucide
```

---

## 2. Preparar o Neon

1. No painel do Neon, abra a branch e habilite o **Data API** marcando
   **"Use Neon Auth"**. Isso cria o schema `neon_auth`, onde vivem as contas.
2. Em **Auth → Domains**, autorize o endereço onde o app roda
   (`http://localhost:5173` no desenvolvimento e o domínio de produção).
   *Sem isso, o login falha mesmo com tudo certo.*
3. Anote a URL HTTPS do banco (host + database), algo como:
   `https://ep-xxxxx.c-2.us-east-2.aws.neon.tech/neondb`.
   É **essa** URL que vai no `.env` — não a string de conexão do Postgres.
4. Rode os scripts, nesta ordem, no **SQL Editor**:
   - `sql/00_profiles.sql`
   - `sql/01_garantir_perfil.sql`

   Depois que a primeira pessoa se cadastrar e entrar (o perfil é criado pelo
   `garantir_perfil()`), promova-a a administradora:

   ```sql
   update public.profiles
      set role = 'admin', is_active = true, aprovado_em = now()
    where email = 'voce@exemplo.com';
   ```

---

## 3. Instalar o módulo

Duas formas. Escolha uma:

**a) Copiar a pasta** (mais simples, sem npm):

```
seu-projeto/
├── src/
└── login-projetos/        ← cole a pasta Login_projetos aqui
```

Aí os imports ficam relativos (`./login-projetos`).

**b) Como dependência local** (o `package.json` já está pronto):

```bash
npm install ../Login_projetos
```

E os imports ficam por nome de pacote (`login-projetos`).

---

## 4. Variáveis de ambiente

Copie `.env.example` para a raiz do seu projeto e preencha:

```ini
VITE_NEON_URL=https://ep-xxxxx.c-2.us-east-2.aws.neon.tech/neondb
VITE_APP_URL=https://seu-dominio.example
VITE_CADASTRO_PUBLICO=true
```

`VITE_APP_URL` é opcional; quando definida, é a origem/base usada para compor
os links de redefinição enviados por e-mail. Sem ela, usa-se a URL aberta no
navegador.

> Variáveis `VITE_*` são públicas e vão para o bundle. Nunca coloque
> `DATABASE_URL`, senhas, tokens, chave administrativa ou `service_role` nelas.

---

## 5. Configurar o módulo (uma vez, no boot)

```js
import { configurarLogin } from 'login-projetos'

configurarLogin({
  marca: {
    nome: 'Doce Vida',
    assinatura: 'Gestão',
    icone: 'ice-cream-cone',       // nome de um ícone do Lucide
    chamada: 'A gestão da sua loja em um só lugar.',
    descricao: 'Pedidos, estoque e caixa sempre à mão.',
    pontos: ['Pedidos em tempo real', 'Estoque com reposição'],
  },
  rotas: {
    login: '/entrar',
    cadastro: '/criar-conta',
    recuperar: '/esqueci-minha-senha',
    redefinir: '/nova-senha',
    depoisDoLogin: '/',
    depoisDoLogout: '/entrar',
  },
  funcionalidades: {
    login: true,
    cadastro: true,
    recuperacaoSenha: true,
    redefinicaoSenha: true,
  },
  aprovacaoManual: true,
  papeis: { admin: 'Dono', manager: 'Gerente', cashier: 'Atendente' },
  senhaMinima: 8,
})
```

Tudo é opcional: o que não for passado fica no padrão (`src/config.js`).
`cadastroPublico` e `VITE_CADASTRO_PUBLICO=false` também podem desabilitar o
cadastro. `telasAuth()` só registra funcionalidades habilitadas; se o host
mantiver suas próprias rotas, deve encaminhar rotas de autenticação desativadas
para um destino seguro usando `ehRotaAuthConfigurada(path)` e
`rotaAuthHabilitada(path)`. Mantenha `login: true` a menos que o host forneça
uma tela substituta. O app Prime Açaí usa a configuração em
`acai-gestao/src/login-config.js`.

### Adaptador de provedor

Neon Auth + Data API é o provedor nativo e padrão. Para usar outro provedor,
configure um adaptador que exponha o mesmo contrato do cliente do módulo; não
basta trocar o nome do provedor:

```js
configurarLogin({
  provedor: {
    nome: 'meu-adaptador',
    cliente: clientePublicoCompatível,
    redefinirSenha: async ({ senha, token }) => meuClienteTrocaSenha(senha, token),
  },
})
```

O cliente adaptador precisa expor:

- `auth.getSession()`, `signInWithPassword()`, `signUp()`, `signOut()`,
  `resetPasswordForEmail()`, `getUser()` e `onAuthStateChange()`, com respostas
  compatíveis com o adapter usado pelo Neon (`{ data, error }`);
- `rpc(nome)` e o cliente PostgREST `from(tabela)` com as operações de perfil
  usadas pelo serviço (`select/eq/maybeSingle` e `update/eq/select/single`);
- para redefinir senha, ou `auth.getBetterAuthInstance().resetPassword()`
  (padrão Neon), ou a função `provedor.redefinirSenha` mostrada acima. A função
  pode lançar um erro ou devolver `{ error }`.

Use apenas SDKs/adaptadores configurados com variáveis públicas no navegador.
O cliente precisa autenticar chamadas com a sessão do usuário; jamais injete
uma chave administrativa. A autorização continua sendo responsabilidade do
backend e das políticas RLS. Um provedor que não use uma API compatível precisa
de um adaptador específico antes de poder ser integrado.

---

## 6. Rotas e guarda de sessão

As quatro telas vêm prontas em `telasAuth()`:

```js
import {
  avisarSessao, config, ehRotaAuth, ehRotaAuthConfigurada,
  rotaAuthHabilitada, estadoSessao, observarAuth,
  renderIcons, sair, sessaoAtual, telaDeEspera, telasAuth, carregarFonteAuth,
} from 'login-projetos'

const rotas = { ...telasAuth(), '/': minhaHome }
```

O guarda é o coração da integração:

```js
async function atualizarSessao() {
  estadoSessao.carregando = true
  try {
    const sessao = await sessaoAtual()
    estadoSessao.usuario = sessao?.usuario ?? null
    estadoSessao.perfil  = sessao?.perfil  ?? null

    // Conta sem perfil ativo não recebe acesso; o banco também aplica RLS.
    if (estadoSessao.usuario && !estadoSessao.perfil?.ativo) {
      try {
        await sair()
      } catch (erroLogout) {
        console.error('[auth] Não foi possível encerrar uma sessão sem acesso.', erroLogout)
      }
      estadoSessao.usuario = estadoSessao.perfil = null
      estadoSessao.aviso = 'A sua conta não está ativa. Fale com um administrador.'
      window.location.hash = config.rotas.login
    }
  } catch (erro) {
    console.error('[auth] Não foi possível verificar a sessão.', erro)
    estadoSessao.usuario = estadoSessao.perfil = null
    estadoSessao.permissoes = new Set()
    estadoSessao.aviso = 'Não foi possível verificar a sua sessão. Entre novamente.'
  } finally {
    estadoSessao.carregando = false
    desenhar()
  }
}

window.addEventListener('sessao-mudou', atualizarSessao) // login/cadastro avisam
observarAuth(() => avisarSessao())                      // mudou em outra aba
```

E, ao renderizar, o guarda:

```js
const rota = window.location.hash.replace(/^#/, '').split('?')[0]
const logado = Boolean(estadoSessao.usuario && estadoSessao.perfil?.ativo)

if (
  ehRotaAuthConfigurada(rota)
  && !rotaAuthHabilitada(rota)
  && rota !== config.rotas.login
) {
  return irPara(config.rotas.login)
}
if (logado && ehRotaAuth(rota)) return irPara(config.rotas.depoisDoLogin)
if (!logado && !ehRotaAuth(rota)) return irPara(config.rotas.login)

const pagina = rotas[rota]()
app.innerHTML = pagina.html
renderIcons(app)
pagina.mount?.(app)
if (ehRotaAuth(rota)) carregarFonteAuth()
```

O exemplo completo e comentado está em **`exemplos/main.exemplo.js`** —
copie e ajuste.

---

## 7. CSS

O módulo traz o estilo das telas em `src/styles/auth.css` (autocontido, tudo
dentro de `.auth`):

```js
import 'login-projetos/estilo.css'
```

Para mudar as cores, edite só o bloco de variáveis `--a-*` no topo do arquivo.

---

## 8. Perfil do usuário (`perfil`)

`sessaoAtual()` devolve `{ usuario, perfil }`. O objeto `perfil` é:

```js
{
  id, nome, email, papel, papelRotulo, organizacao, ativo, aprovadoEm
}
```

Use `estadoSessao.perfil?.papel` para decidir o que montar na interface. Mas
lembre: **esconder um botão não protege nada** — a política no banco é que manda.

---

## 9. Checklist de segurança

- [ ] A `DATABASE_URL` **não** está no `.env` do app nem no código.
- [ ] O RLS está ligado nas tabelas (`alter table ... enable row level security`).
- [ ] `profiles` concede **apenas** `select` e `update (full_name)` ao papel
      `authenticated` (o `00_profiles.sql` já faz isso).
- [ ] `garantir_perfil()` é `security definer` e **fixa** papel/organização.
- [ ] As funções `security definer` têm `set search_path = ''`.
- [ ] O domínio de produção está autorizado em **Neon Auth → Domains**.
- [ ] Contas novas entram como `cashier` (nunca escolhem o próprio papel).

---

## 10. Rodar os testes do módulo

```bash
cd Login_projetos
npm install          # traz o lucide (peerDependency) para o teste de layout
npm test
```

Sem `npm install`, os testes puros (config, validação, sessão) rodam e o teste
de layout é pulado — `npm test` continua passando.

---

## 11. Personalização — onde mexer

| Quero mudar…              | Lugar                                                        |
| ------------------------- | ------------------------------------------------------------ |
| Nome/logo/textos da marca | `configurarLogin({ marca })`                                 |
| Rotas e redirecionamentos | `configurarLogin({ rotas })`                                 |
| Telas/operações disponíveis | `configurarLogin({ funcionalidades })`                       |
| Provedor de autenticação  | `configurarLogin({ provedor })` (Neon ou adaptador compatível) |
| Tamanho mínimo de senha   | `configurarLogin({ senhaMinima })`                           |
| Rótulos de papel          | `configurarLogin({ papeis })`                                |
| Textos das telas          | `configurarLogin({ textos })`                                |
| Aprovação obrigatória     | `configurarLogin({ aprovacaoManual })` + SQL do item 2       |
| Cores do login            | variáveis `--a-*` no topo de `src/styles/auth.css`           |
| Códigos de erro traduzidos| `MENSAGENS` em `src/validacao.js`                            |

---

## 12. Solução de problemas

| Sintoma | Causa provável |
| --- | --- |
| "Não foi possível falar com o servidor" | `VITE_NEON_URL` ausente/errada, ou Data API desligada. |
| Login certo mas volta 401/403 nas consultas | Domínio não autorizado em Neon Auth → Domains, ou JWT ainda não propagou (o `garantirPerfil` já tenta de novo). |
| Sessão aberta porém sem perfil | `garantir_perfil()` não foi criada/rodada (`sql/01_...`), ou o schema `neon_auth` não existe. |
| Link de redefinição aponta para a origem errada | Configure `VITE_APP_URL` na origem pública autorizada em Neon Auth → Domains. |
| Todos entram como "Caixa" | Comportamento esperado: o papel inicial é `cashier` e um admin promove. |
| "Conta criada! Aguarde a aprovação" e ninguém entra | Fluxo com aprovação: promova em `public.profiles` (`is_active = true`, `aprovado_em = now()`). |
| Ícone não aparece | O nome em `marca.icone` não está na lista de `src/lib/icons.js`. |
