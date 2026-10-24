# Deploy no Cloudflare Pages

Guia de publicação do **Prime Açaí · Gestão**.

- **Produção:** https://prime-acai-gestao.pages.dev
- **Projeto:** `prime-acai-gestao` (Cloudflare Pages)
- **Conta Cloudflare:** `cfed5f08224d3a6d0f9d547c81b67a5d`

O app é um SPA (Vite) com roteamento por *hash*, então a hospedagem é 100% estática.
Os dados ficam no **Neon** (Postgres + Data API + Auth), protegidos por RLS.

---

## Publicar uma atualização

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
cd acai-gestao

$env:CLOUDFLARE_API_TOKEN = '<token com permissão "Cloudflare Pages: Editar">'
$env:CLOUDFLARE_ACCOUNT_ID = 'cfed5f08224d3a6d0f9d547c81b67a5d'

npm run deploy:cloudflare
```

O script `deploy:cloudflare` roda `npm run build` e
`wrangler pages deploy dist --project-name=prime-acai-gestao`.

> Na criação do projeto foi preciso `--force` uma única vez (o `wrangler` novo
> tenta migrar Pages → Workers). Como o projeto **já existe**, os deploys
> seguintes rodam direto.

---

## Arquivos envolvidos

| Arquivo | Função |
|---|---|
| `wrangler.toml` | Nome do projeto Pages e pasta de build (`dist`). |
| `public/_redirects` | Fallback de SPA (`/*  /index.html  200`). |
| `package.json` | Script `deploy:cloudflare` + `wrangler` em devDependencies. |

---

## Autorizar o domínio no Neon Auth

O login só funciona se a origem estiver autorizada no Neon Auth.

```bash
npx neon@latest neon-auth domain list --project-id nameless-tooth-87377816
npx neon@latest neon-auth domain add https://prime-acai-gestao.pages.dev \
  --project-id nameless-tooth-87377816
```

Domínios autorizados atualmente: `https://prime-acai-gestao.pages.dev`.

---

## Domínio próprio (opcional)

Em **Workers e Pages → prime-acai-gestao → Domínios personalizados →
Configurar domínio**. Se o DNS do domínio já está no Cloudflare é automático;
caso contrário, o painel mostra os registros CNAME a criar. Depois, autorize o
novo domínio no Neon Auth (comando acima).

---

## Histórico

O site era hospedado no Netlify (`prime-acai-gestao.netlify.app`) e foi migrado
para o Cloudflare Pages. A migração está concluída: o projeto não depende mais
do Netlify e **o site antigo foi excluído** (a URL do Netlify não existe mais).
A hospedagem oficial é o Cloudflare Pages.
