# Banco de dados (Neon)

Este projeto saiu do Supabase e passou a usar o **Neon**: Postgres gerenciado com
**Neon Data API** (REST, compatível com o PostgREST) e **Managed Better Auth**
(login/cadastro, API compatível com a do Supabase Auth).

## Migrações

| Arquivo | O que faz |
|---|---|
| `00_banco_neon.sql` | Base: tabelas de negócio, índices, funções, views, GRANTs, RLS e (opcionalmente) os dados de exemplo |
| `01_usuarios_permissoes.sql` | Perfis, catálogo de permissões, `pode()`, `minha_organizacao()`, `garantir_perfil()` |
| `02_perfis_colunas.sql` | Colunas de perfil que estavam fora das migrações (`email`, `username`, `aprovado_em`, `last_login_at`) |
| `03_notificacoes.sql` | Notificações: tabela, RLS, RPCs e o trigger de novo usuário |
| `04_produtos_e_recipientes.sql` | Cadastro por tipo de venda (peso/unidade/receita) e recipientes com tara + histórico |
| `05_produtos_rls_permissoes.sql` | Troca o RLS permissivo de `produtos` por políticas por permissão (`estoque.*`) |
| `06_movimentacoes_estoque.sql` | Livro-razão do estoque (`movimentacoes_estoque`), `saldo_estoque()`, os triggers e a consolidação dos saldos iniciais |
| `07_movimentacoes_rpc.sql` | As duas portas de escrita do livro: `registrar_movimentacao()` e `ajustar_saldo()` |
| `08_vendas_transacionais.sql` | A venda inteira numa RPC só: `registrar_venda()`, idempotência por chave, peso calculado pelo banco e o movimento `estoque → cliente` |
| `09_vendas_somente_rpc.sql` | Fecha a escrita direta em `vendas`/`itens_venda`: a RPC passa a ser a **única** porta |
| `10_codigo_do_pedido.sql` | Devolve a sequência do pedido ao maior código gravado e cria `proximo_codigo_venda()` |
| `11_estorno.sql` | Estorno: o movimento inverso com vínculo ao original, o rastro na venda e a RPC `estornar_venda()` |
| `12_vendas_17_19_out.sql` | **Dados de estudo** (não é esquema): vendas, itens, PDV e despesas recorrentes de 17–19/10/2026 — a base só tinha movimento até 16/10. Códigos via `nextval()`, dia = dia local (UTC−3). Não é incluída na aplicação padrão; exige seleção explícita |
| `16_compras_entradas.sql` | Compras: fornecedores, compras/itens, unidades de compra × estoque, lotes/validade, custo médio, RLS e a RPC `confirmar_recebimento_compra()` |
| `17_clientes_lancamentos_rls_permissoes.sql` | Aplica RLS por ação em clientes/financeiro e bloqueia permissões de perfis inativos |
| `18_canais_pagamentos_vendas.sql` | Catálogos de tipos de venda e formas de pagamento; detalhes de delivery/aplicativo; RPC transacional, RLS e faturamento com taxa de entrega |
| `19_imagens_produtos.sql` | Fotos de produto em `bytea`, limite de 512 KiB, RLS e salvamento atômico pela RPC `salvar_produto_com_imagem()` |
| `20_categorias_produtos.sql` | Catálogo de categorias por organização, unicidade normalizada, RLS, importação dos nomes já usados e seed para novas organizações |
| `21_categorias_tipos_venda.sql` | Catálogo de categorias para tipos de venda, mantendo os códigos usados pelo PDV, RLS e isolamento por organização |
| `22_locais_transferencias_estoque.sql` | Estoques geral e da loja, saldos separados, RLS e transferências idempotentes gravadas no livro-razão |
| `23_whatsapp_fornecedores.sql` | Adiciona o telefone de WhatsApp ao cadastro de fornecedores |
| `reverter_08_…` até `reverter_23_…` (e as anteriores) | Reversões conservadoras; a reversão 21 bloqueia categorias personalizadas em uso, a 22 bloqueia movimentos do estoque geral e a 23 impede remover WhatsApps já cadastrados |
| `garantir_perfil_novo.sql` | Versão de `garantir_perfil()` que lê e-mail e convite — **passo manual**, não é `NN_*.sql` |
| `testar-base.mjs` | Testa a base real de ponta a ponta (`npm run testar:base`) |
| `testar-permissoes.mjs` | Testa o banco de permissões contra a base real |
| `validar-migracoes.mjs` | Aplica a cadeia inteira num Postgres **em memória** e exercita os comportamentos (`npm run validar:migracoes`) |
| `verificar-estoque.mjs` | Confere o livro-razão do estoque **na base real** (`npm run verificar:estoque`; `--concorrencia` inclui o teste de duas conexões) |
| `verificar-compras.mjs` | Confere compra total e parcial, estoque, custo médio, lote, bloqueio de duplicidade e permissão do caixa **na base real**, sem gravar nada (`npm run verificar:compras`) |
| `verificar-vendas.mjs` | Confere a venda transacional **na base real**, sem gravar nada (`npm run verificar:vendas`) |
| `testar-estoque-api.mjs` | Testa as RPCs do estoque **pelo Neon Data API**, como o navegador faz (`npm run testar:estoque:api`) |

Para aplicar as migrações, na ordem dos nomes:

```bash
node neon/aplicar.mjs
```

O `aplicar.mjs` aplica as migrações numeradas em ordem alfabética, cada arquivo
na própria transação. A migração `12` contém dados de estudo não idempotentes e
fica fora da aplicação padrão; só é executada quando selecionada explicitamente.
Para aplicar só um (ou um prefixo):

```bash
node neon/aplicar.mjs 04
```

Para aplicar os dados de estudo, confira o banco-alvo e execute explicitamente:

```bash
node neon/aplicar.mjs 12
```

Para habilitar o WhatsApp no cadastro de fornecedores, aplique a migração 23
ao banco-alvo antes de publicar o build conectado a ele:

```bash
node neon/aplicar.mjs 23
```

Os arquivos de reversão começam com `reverter_` de propósito: assim **não** casam
com o filtro de migrações numeradas e nunca entram numa aplicação normal. O
aplicador aceita esses arquivos apenas quando o prefixo `reverter_NN` é informado.
Para desfazer:

```bash
node neon/aplicar.mjs reverter_04
```

Um filtro sem correspondência agora termina com erro, em vez de indicar sucesso.

As migrações de estrutura usam operações re-executáveis quando possível
(`if not exists`, `create or replace`). A `12` é exceção: insere dados de estudo
e não deve ser reexecutada; use a reversão correspondente se precisar removê-los.

> A versão antiga (Supabase) foi removida do projeto junto com as dependências.

## Validar as migrações sem tocar em produção

O `aplicar.mjs` contra produção só diz "OK/FALHA" — e produção é o pior lugar
para descobrir um erro de migração. Antes de aplicar qualquer coisa:

```bash
npm run validar:migracoes
```

Esse script sobe um **Postgres em memória** (PGlite — devDependency gratuita,
não vai para o bundle nem para produção), recria os stubs do ambiente Neon
(`auth.uid()`, papéis `anonymous`/`authenticated`, `neon_auth.user`), aplica a
cadeia `NN_*.sql` inteira na mesma ordem do `aplicar.mjs` e depois **exercita**
o que as migrações prometem: as constraints de tipo de venda, o teto de tara, o
histórico gravado por trigger, a conta do peso feita pelo banco e — o principal
— se o RLS barra mesmo o operador de caixa, em vez de só a tela esconder o
botão. No fim ele roda as `reverter_*` e confere que desfizeram tudo.

Ele verifica também os canais e pagamentos iniciais, a taxa de entrega, o
cálculo de troco, a comissão estimada do aplicativo, a idempotência da venda
completa e as permissões dos cadastros. Ele foi o que pegou o defeito da `02`:
as colunas `profiles.email`,
`username`, `aprovado_em` e `last_login_at` não nasciam em migração nenhuma, e
um banco novo quebrava na `03` com `record "new" has no field "aprovado_em"`.

### Armadilha ao simular um usuário por SQL

Um roteiro que fala direto com o Postgres (em vez de passar pelo Data API) precisa
simular a sessão:

```sql
begin;
set local role authenticated;                            -- o papel primeiro…
select set_config('request.jwt.claims', '{"sub":"<uuid>"}', true);  -- …e o claim depois
select public.pode('estoque', 'editar');
rollback;
```

Duas coisas que custam caro se você não souber:

1. **A ordem importa.** Trocar de papel descarta os GUCs já gravados na
   transação: gravar o claim antes do `set local role` não funciona.
2. **A primeira avaliação de `auth.uid()` numa conexão devolve nulo** e leva junto
   o claim daquela transação — a extensão de sessão do Neon se inicializa aí. O
   resultado é `pode()` = `false` numa conexão recém-aberta. O PostgREST gasta a
   primeira transação carregando o cache de schema, então o app real não depende
   disso, mas **os roteiros precisam queimar essa primeira avaliação** com uma
   transação descartável antes de medir qualquer coisa:

   ```sql
   begin; select public.pode('estoque','ver'); rollback;  -- aquecimento
   ```

Foi exatamente essa armadilha que fez uma verificação da `06`/`07` relatar
`pode()` = `false` para o admin — o banco estava certo, o roteiro é que não.

## Como o saldo do estoque funciona (migração `06`)

O saldo **não é digitado em lugar nenhum**: ele é a soma do livro-razão.

```
saldo = Σ movimentos que entram em 'estoque' − Σ movimentos que saem de 'estoque'
```

`produtos.quantidade` virou **cache** dessa soma, reescrito por trigger
(`produtos_saldo_vem_do_livro`): mesmo um `UPDATE produtos SET quantidade = 999`
é aceito e ignorado — o trigger recoloca a soma do livro. Existe também
`saldo_estoque(produto_id)`, que devolve a soma na hora, para conferência.

Quem escreve no livro são **duas funções**, e mais nada (não há `GRANT` de
`insert`/`update`/`delete` para `authenticated`):

| RPC | Permissão | Para quê |
|---|---|---|
| `registrar_movimentacao(produto, qtd, origem, destino, motivo)` | `estoque.criar` | compra, buffet, sobra, perda, venda |
| `ajustar_saldo(produto, contado, motivo, local)` | `estoque.editar` | contagem física; grava **só a diferença** |

Valem para os dois: `motivo` obrigatório (não vazio), quantidade `> 0`, origem e
destino diferentes, e o livro **nunca** fica negativo — a saída maior que o saldo
é recusada com mensagem em português. `registrar_movimentacao` não aceita
`abertura` nem `contagem` (esses dois só entram por `ajustar_saldo`, que calcula a
diferença contra o saldo do momento).

#### Os locais

| Local | Significado |
|---|---|
| `abertura` | saldo inicial do item |
| `contagem` | contagem física (diferença do ajuste) |
| `fornecedor` | de quem veio a compra |
| `estoque` | o estoque da loja |
| `buffet` | o preparo do buffet |
| `sobra` | sobra reaproveitável |
| `perda` | descarte |
| `cliente` | o que o cliente levou |

#### O livro é imutável

Um trigger (`movimentacao_e_imutavel`) recusa `UPDATE` e `DELETE` em qualquer
movimento. Corrigir um lançamento é **registrar o inverso**, e não reescrever o
passado — é o que mantém o histórico auditável. A `reverter_06` derruba esse
trigger antes de apagar a tabela.

O movimento de venda carrega `item_venda_id`, com índice único: o mesmo item de
venda **não consegue** gerar dois movimentos, o que fecha a porta da dedução
dupla mesmo se a venda for processada duas vezes.

#### Conferindo em produção

```bash
npm run verificar:estoque                 # só leitura: estado, RPCs, imutabilidade, caixa
npm run verificar:estoque:concorrencia    # inclui o teste de duas conexões no mesmo item
```

O segundo **escreve e desfaz** (duas entradas e um ajuste que devolve o saldo) —
é o único jeito de provar que não existe perda de atualização, porque transações
abertas não enxergam uma à outra.

## Como a venda funciona (migrações `08`, `09` e `10`)

A venda inteira acontece **dentro do banco**, numa chamada só:

```sql
select * from public.registrar_venda(
  p_itens, p_chave, p_cliente_id, p_pagamento, p_status, p_codigo
);
```

O navegador manda **itens, cliente, pagamento e uma chave** — nunca preço, nunca
total. Quem decide quanto custa é o cadastro:

- o item por peso guarda **bruto, tara, líquido, o preço do quilo e o total**;
- a `quantidade` do item é o líquido em quilos (`450 g` → `0,450`);
- o total da linha é uma **coluna gerada** (`quantidade × preco_unitario`, 2 casas);
- o total do pedido é a soma das linhas.

### O método do peso

O `metodo_peso` do cadastro decide o que a tela pede, mas o operador pode trocar
por item — há balança que já desconta a tara e balança que não:

| Método | O que o operador informa | O que o banco grava |
|---|---|---|
| `bruto_tara` | peso bruto e tara (a tara pode vir do `recipiente_id`) | bruto, tara e líquido |
| `liquido` | o peso já líquido | bruto e tara **nulos** — não se desconta tara de novo |
| `balanca` | — | recusado: não há integração com balança |

O banco recusa sozinho: peso ou tara negativos, tara maior que o bruto, tara
acima de 5 kg, líquido zero, item por peso sem peso, peso em item que não é por
peso, e quantidade que não seja o líquido em quilos.

### Uma venda, um movimento

Cada item que controla estoque por movimentação gera **um** movimento
`estoque → cliente`, com autor, motivo e `item_venda_id` (índice único). Venda
com status `Cancelada` entra no histórico **sem** tirar estoque — quem cancela
depois usa o estorno (P4). Faltando saldo, **a venda inteira é recusada**.

### Processamento duplicado

A tela gera uma **chave de idempotência** por abertura de formulário. Se a rede
repetir o `POST`, o banco devolve **a mesma venda** (`ja_existia = true`) e não
cria item nem movimento de novo.

### O número do pedido

O campo nasce **em branco**: quem numera é a sequência do banco
(`vendas_codigo_seq`), o que evita dois caixas receberem o mesmo número. A `10`
sincroniza a sequência com o maior código gravado — `nextval` **não** volta atrás
no rollback, então número entregue a uma transação desfeita fica queimado e abre
buraco na numeração — e cria `proximo_codigo_venda()`, que diz qual número a
próxima venda vai receber **sem consumir nada** (é o que a tela mostra como
sugestão, no `placeholder` do campo).

> `nextval` roda **antes** da validação dos itens: uma venda recusada (peso
> inválido, saldo insuficiente) consome um número. Preferimos assim — numeração
> sem buraco exigiria serializar as vendas e traria de volta a corrida entre
> caixas. Buraco na numeração é o preço de nunca repetir número.

### Duas fases, de propósito

A `08` é **aditiva**; quem **fecha a porta** é a `09`:

1. `node neon/aplicar.mjs 08` — o app que está no ar continua vendendo do jeito dele;
2. publica o frontend novo (que vende pela RPC);
3. `node neon/aplicar.mjs 09` — a escrita direta em `vendas`/`itens_venda` é revogada.

Na ordem inversa existiria uma janela em que a tela antiga (que fazia `insert`
direto) não conseguiria mais vender.

Depois de aplicar SQL que cria **função** nova, o Data API precisa largar o cache
do esquema, senão responde `Could not find the function … in the schema cache`:

```bash
npx neon@latest data-api refresh-schema \
  --project-id nameless-tooth-87377816 --database neondb
```

(Em PostgREST puro, `notify pgrst, 'reload schema'` faz o mesmo — é o que a `10`
deixa escrito. A tela não depende disso: sem a função, ela cai no cálculo pelo
último código gravado.)

#### Conferindo em produção

```bash
npm run verificar:vendas     # tudo dentro de uma transação que termina em ROLLBACK
```

Ele vende de verdade (com o self-service do cadastro, com o perfil de caixa),
confere a conta dos 480 g − 30 g, a idempotência, as recusas, o baixamento do
estoque e a porta única da `09` — e no fim prova, numa conexão nova, que as
contagens e o saldo voltaram ao que eram. Toda venda de teste usa **código
próprio** (`#VERIF-P3-…`, `#VERIF-P4-…`) justamente para não gastar número de
pedido de verdade. A mesma bateria confere o estorno (seção abaixo).

## Como o estorno funciona (migração `11`)

Estornar **não apaga** nada: o livro-razão é imutável (`06`). O que a `11` faz é
registrar o **movimento inverso** e deixar o rastro:

```
venda:     estoque -> cliente   (o que a 08 gravou)
estorno:   cliente -> estoque   (o inverso; mesma quantidade e produto)
```

```sql
select * from public.estornar_venda(p_venda_id, p_motivo);
```

Numa transação só, a função:

- confere `vendas.editar` no banco — **quem só vende não estorna** (o operador de
  caixa tem `vendas.criar`, não `editar`);
- trava a venda (`for update`), então dois estornos simultâneos não se atropelam;
- exige **motivo** (sem ele não há auditoria);
- grava um movimento inverso por movimento original, com o **autor**, o motivo
  (`Estorno #9390: …`) e `estorno_de_id` apontando o movimento desfeito;
- marca a venda como `Cancelada`, com `estornada_em` e `estornada_por`;
- avisa o perfil `admin` por notificação (uma linha por estorno).

### Por que o status vira `Cancelada`

As views de faturamento (`00`) somam `status <> 'Cancelada'`. Estornar é
exatamente tirar o pedido do faturamento — reusar o status que já existe faz a
conta certa sair sozinha, sem tocar em view nenhuma. O que distingue "nasceu
cancelada" de "foi estornada depois" é `vendas.estornada_em`; a tela mostra
**Estornada** no segundo caso.

### Não devolve duas vezes

Duas travas, as duas no banco:

1. **Venda**: a linha é travada e, se `estornada_em` já estiver preenchido, a RPC
   devolve o mesmo resultado com `ja_estornada = true` e **zero** movimentos —
   repetir o clique (ou a resposta perdida) não devolve estoque de novo.
2. **Movimento**: o índice único parcial `mov_estoque_estorno_unico`, em
   `estorno_de_id`, recusa um segundo inverso do mesmo movimento **mesmo escrito
   à mão**, direto na tabela.

Venda que **nasceu** `Cancelada` não tem o que estornar: a `08` não tirou
estoque, e a RPC responde "já está cancelado".

### Conferindo o estorno em produção

```bash
npm run verificar:vendas
```

A seção *estorno* da bateria (tudo em `ROLLBACK`) vende 450 g, estorna com um
perfil que tem `vendas.editar`, e confere: estoque de volta, movimento
`cliente → estoque` ligado ao original, `estornada_por`/`estornada_em`, a
repetição sem devolução dupla, a recusa de quem **não** tem a permissão e a
recusa de motivo em branco. No fim, prova que nada ficou gravado — nem a
notificação.

### Reverter a `11`

```bash
node neon/aplicar.mjs reverter_11
```

Derruba a função, o índice e as colunas — mas **não** apaga as linhas que já
foram criadas por um estorno (o livro é imutável) nem devolve o status de uma
venda estornada para `Concluída`.

## Antes de rodar o SQL

No **Console do Neon**, na sua branch:

1. **Postgres database → Data API → Enable**, marcando **“Use Neon Auth”**.
   - Isso cria o schema `neon_auth` (onde vivem as contas) e os papéis
     `authenticated` / `anonymous`.
   - Deixe **“Grant public schema access”** ligado: o script já ajusta os
     privilégios por cima.
2. Copie a **URL base** no botão **Connect** (host + database), por exemplo:
   `https://ep-xxx.c-2.us-east-2.aws.neon.tech/neondb`
   — **não** a string `postgresql://...`.
3. No **SQL Editor**, cole e rode o `00_banco_neon.sql` inteiro.

> O script é re-executável. A **seção 10 (seed)** insere os dados de exemplo, mas
> agora **se recusa a rodar numa base que já tenha dados**: ela levanta
> `Seed abortado: a base já tem N registros de negócio.` em vez de apagar as
> vendas. O `raise` derruba a transação inteira do arquivo, então nem a metade
> anterior da `00` fica aplicada pela metade.
>
> Isso protege o caso perigoso: o `aplicar.mjs` **sem filtro** roda as
> migrações numeradas, exceto a geração de dados de estudo `12`, inclusive a `00`.
> Numa base com dados reais ele agora para com a
> mensagem acima em vez de zerar a loja. Ainda assim, em produção aplique por
> prefixo, um arquivo por vez (`node neon/aplicar.mjs 04`), e confira depois.
> Para semear de propósito numa base que já tem dados (ambiente de estudo), rode
> `set app.semear = 'on';` antes do arquivo.

## O que mudou em relação ao Supabase

| Assunto | Supabase | Neon |
|---|---|---|
| Consultas | Data API (PostgREST) | **Neon Data API** — igual, `client.from(...)` |
| Login/cadastro | Supabase Auth | **Managed Better Auth** via `SupabaseAuthAdapter` |
| Papéis do RLS | `anon`, `authenticated`, `service_role` | `anonymous`, `authenticated` (não há `service_role`) |
| `auth.uid()` | sim | **sim** (mesmo nome; devolve o `sub` do JWT em UUID) |
| Contas | `auth.users` | **`neon_auth.user`** (singular; colunas em camelCase) |
| Criação do perfil | trigger em `auth.users` | função **`garantir_perfil()`**, chamada pelo app ao entrar |
| Logomarca | Storage (bucket `logos`) | tabela **`company_logos`** (base64 no Postgres) |
| Senhas | migram por hash | **não migram** — todo mundo redefine a senha |

## Ordem de execução

É um script só (`00_banco_neon.sql`), com as seções nesta ordem:

1. extensões
2. tabelas de negócio (produtos, clientes, vendas, itens_venda, lancamentos)
3. índices
4. `organizations` e `profiles`
5. funções (`eh_admin`, `eh_gestor`, `minha_organizacao`, `garantir_perfil`,
   `definir_papel_do_usuario`, `definir_ativo_do_usuario`)
6. `company_settings`
7. `company_logos`
8. views
9. GRANTs e RLS
10. dados de exemplo (**aborta se a base já tiver dados**)
11. conferência

## Tabelas

| Tabela | Papel |
|---|---|
| `produtos` | Produtos e insumos: tipo de venda, preço, controle de estoque e ponto de reposição |
| `recipientes` | Tipos de embalagem e a **tara** em gramas (peso da embalagem vazia) |
| `recipientes_historico` | Quem mudou a tara, de quanto para quanto e quando (só trigger escreve) |
| `clientes` | Cadastro e classificação (Novo / Recorrente / VIP) |
| `vendas` | Cabeçalho do pedido: cliente, status, pagamento, total |
| `itens_venda` | Itens de cada venda (liga a `produtos`) |
| `lancamentos` | Entradas e saídas do caixa |
| `organizations` | A loja. Hoje tem uma linha só ("Prime Açaí") |
| `profiles` | Dados do usuário, presa a `neon_auth.user(id)` (quando o papel permitir) |
| `company_settings` | Dados da empresa e preferências (uma linha por organização) |
| `company_logos` | A logomarca (uma linha por organização) |

### `produtos`: tipo de venda e controle de estoque

A migração `04` acrescenta a `produtos`:

| Coluna | Valores | Observação |
|---|---|---|
| `descricao` | texto até 500 | opcional |
| `tipo_venda` | `unidade` \| `peso` \| `receita` | como o item é vendido (padrão `unidade`) |
| `metodo_peso` | `liquido` \| `bruto_tara` \| `balanca` | só existe quando `tipo_venda = 'peso'` |
| `controla_estoque` | boolean | item sem controle não entra em saldo nem em reposição |
| `metodo_estoque` | `movimentacoes` \| `fechamento` \| `nenhum` | como o saldo é apurado |

Três regras que o banco faz cumprir por `check` (não pela interface):

1. `tipo_venda` só aceita os três valores.
2. `(tipo_venda = 'peso') = (metodo_peso is not null)` — produto por peso **sempre**
   tem método, e qualquer outro **nunca** tem.
3. `controla_estoque = false` exige `metodo_estoque = 'nenhum'`.

`balanca` está no domínio mas **não é executável** neste sistema: a entrada de
peso é manual e validada, e a integração com balança é uma costura reservada.

**A unidade de venda não é coluna.** Ela é derivada do tipo, para não existirem
duas colunas que possam divergir:

| `tipo_venda` | unidade de venda | o que é `preco` |
|---|---|---|
| `peso` | `kg` | preço do **quilo** (self-service) |
| `receita` | `porção` | preço fechado da porção/receita |
| `unidade` | `un` | preço da peça |

`produtos.unidade` continua sendo a unidade de **estoque** (como o item é
contado), que pode ser outra.

### `recipientes` (tara)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `uuid` | PK |
| `organization_id` | `uuid` | `default minha_organizacao()` — quem decide é o banco |
| `nome` | `text` | 1 a 80 caracteres |
| `tara_g` | `integer` | `>= 0` e `<= 5000` (teto de sanidade) |
| `ativo` | `boolean` | recipiente fora de uso não é apagado, vira inativo |

- **`nome` é único entre os ATIVOS** (índice parcial com `lower(btrim(nome))`):
  desativar um nome libera o nome para um cadastro novo.
- Recipiente **não tem `DELETE`**: o histórico de vendas antigas precisa continuar
  explicável.
- Quem grava o histórico é um trigger (`security definer`), nunca o navegador.


### `profiles`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `uuid` | PK; FK opcional para `neon_auth.user(id)` |
| `full_name` | `text` | 1 a 120 caracteres |
| `organization_id` | `uuid` | `references organizations(id)` |
| `role` | `text` | `admin` \| `manager` \| `cashier` |
| `is_active` | `boolean` | conta desativada não entra |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` por trigger |

**Nenhuma senha mora aqui.** Quem guarda senha é o Managed Better Auth, no
schema `neon_auth`.

### `company_settings` e `company_logos`

`company_settings` é igual à versão anterior, **sem a coluna `logo_path`**: a
imagem passou para a tabela `company_logos` (`organization_id`, `mime`,
`conteudo` em base64, `atualizado_em`).

## Views de leitura

As mesmas de antes, todas com `security_invoker = on` (exige PostgreSQL 15+; o
Neon é 17): `vw_resumo`, `vw_clientes_resumo`, `vw_faturamento_diario`,
`vw_vendas_por_categoria`, `vw_fluxo_mensal`, `vw_fluxo_mesmo_periodo`.

## Segurança

### `anonymous` não tem nada

Com o login em pé, as políticas valem para `authenticated` e o papel
`anonymous` perdeu até o `GRANT` — quem não está logado nem começa a consulta.

### `produtos` deixou de ser `using (true)`

Antes da migração `05`, qualquer pessoa logada lia **e escrevia** em `produtos`.
Agora são quatro políticas, uma por ação, sempre chamando `public.pode()`
(`estoque.consultar` / `criar` / `editar` / `excluir`). O `pode()` vai dentro de
`(select public.pode(...))` para o Postgres avaliar uma vez só por consulta.

Na prática:

- `admin` e `manager` leem, criam, editam e excluem (têm `estoque.*`).
- `cashier` **lê** — tem `estoque.consultar`, que é o que o Estoque e o Dashboard
  precisam — mas criar, editar e excluir não passa. Em `INSERT` o Postgres
  devolve erro de RLS; em `UPDATE`/`DELETE` ele **filtra a linha em silêncio**
  (0 linhas afetadas e o dado intacto) — é assim que o Postgres funciona, não é
  falha de política.

Esconder o botão na tela é conveniência; quem barra é o RLS.

### A coluna `role` não pode ser escalada

No Neon, ao habilitar o Data API com “Grant public schema access”, o papel
`authenticated` ganha `INSERT/UPDATE/DELETE` em **todas** as tabelas do schema
`public` — inclusive `UPDATE` em `profiles.role`. Por isso o script **revoga** o
`UPDATE` amplo e concede **por coluna**, só `full_name`:

```sql
revoke update on public.profiles from authenticated;
grant  update (full_name) on public.profiles to authenticated;
```

Assim, um `PATCH` tentando escrever `role`, `organization_id` ou `is_active`
morre no Postgres antes de qualquer política. Promover alguém só passa pelas
funções `definir_papel_do_usuario` e `definir_ativo_do_usuario` (`security
definer`, que checam `eh_admin()`).

### Papel e organização nunca vêm do navegador

- `profiles` não tem política de `INSERT` nem de `DELETE`: quem cria a linha é
  `garantir_perfil()`, e ela some junto com a conta (cascade, quando a FK pôde
  ser criada).
- `company_settings.organization_id` e `company_logos.organization_id` têm
  `default public.minha_organizacao()`. Quem decide de qual empresa é a linha é
  o **banco**, a partir da sessão.

### A logomarca

Não há Storage. A imagem (até 2 MB) vai como base64 para `company_logos`, com o
mesmo RLS da configuração da empresa (lê quem é da organização; grava só
admin/gerente). O app monta um data URL para exibir — **não existe URL pública**.
O tipo é conferido pelos **primeiros bytes do arquivo**, e o limite de tamanho
existe também no banco (`check`).

## Autenticação

### Como o cadastro cria o perfil

O Managed Better Auth cria a conta em `neon_auth.user`. Em vez de pendurar um
trigger num schema gerenciado, o app chama, logo depois de entrar:

```js
await neon.rpc('garantir_perfil')
```

A função é `security definer`, fixa `role = 'cashier'` e a organização padrão no
banco, e usa `neon_auth.user.name` (ou o trecho antes do `@`) como nome. Se o
navegador mandasse `role`, seria ignorado.

### Confirmação de e-mail precisa estar **desligada**

O adapter (`SupabaseAuthAdapter`) exige que o `signUp` já devolva sessão. Com a
verificação de e-mail ligada, o cadastro falha. Deixe-a desligada no Neon Auth.

### Nova senha por token

Não existe `updateUser({ password })`. O link de recuperação traz um `token`, e
a tela chama:

```js
await neon.auth.getBetterAuthInstance().resetPassword({ newPassword, token })
```

### Definir a senha de um usuário (plugin admin do Neon Auth)

O CLI do Neon **não** mexe em senha (`neon-auth user` só tem `create`, `delete` e
`set-role`). Quem mexe é o plugin `admin` do Better Auth, que o Neon Auth já traz
ligado — a prova está no próprio schema: `neon_auth.user.role/banned/banExpires`
e `session.impersonatedBy` são campos desse plugin.

```http
POST {Auth}/admin/set-user-password   { "userId": "<uuid>", "newPassword": "…" }
```

A chamada exige uma **sessão cuja linha em `neon_auth.user` tenha
`role = 'admin'`**. Nenhum usuário do app tem isso (o "admin" do app vive em
`public.profiles.role`), então a receita é criar uma sessão descartável, elevar
só ela, usar e apagar:

1. `POST /auth/sign-up/email` num e-mail descartável — **sem** chamar
   `garantir_perfil`, que é o que cria `profiles` (logo, sem perfil e sem
   notificação no caminho).
2. `update neon_auth.user set role = 'admin' where id = '<descartável>'`.
3. `POST /auth/admin/set-user-password` com o `cookie` da sessão descartável e o
   `userId` do alvo.
4. Apagar a conta descartável.
5. **Conferir de verdade**: `POST /auth/sign-in/email` com a senha nova tem de
   devolver HTTP 200.

Nada pode ficar com `role = 'admin'` no schema de autenticação: isso é papel do
Neon Auth, não do app, e dá poder administrativo sobre todas as contas.

### O primeiro administrador

O cadastro pelo app **sempre** cria `cashier`. Para o primeiro admin, use o SQL
Editor (a conta precisa já existir em `neon_auth.user`):

```sql
update public.profiles set role = 'admin'
 where id = (select id from neon_auth.user where email = 'voce@exemplo.com');
```

## Cliente no navegador

`src/lib/neon.js` cria o cliente com uma URL só:

```js
createClient(import.meta.env.VITE_NEON_URL, {
  auth: { adapter: SupabaseAuthAdapter() },
})
```

O SDK deriva os dois endpoints dessa URL:

```
VITE_NEON_URL = https://ep-xxx.c-2.us-east-2.aws.neon.tech/neondb
  Auth      -> https://ep-xxx.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth
  Data API  -> https://ep-xxx.apirest.c-2.us-east-2.aws.neon.tech/neondb/rest/v1
```

Como o export chama-se `neon` e a API de consulta é a mesma, os serviços
(`src/services/*`) continuam usando `neon.from(...)` sem outras mudanças.

## Testar a base real

Com o `.env` preenchido **e uma conta de teste**:

```env
VITE_NEON_URL=https://ep-xxx.c-2.us-east-2.aws.neon.tech/neondb
VITE_TESTE_EMAIL=voce@exemplo.com
VITE_TESTE_SENHA=sua-senha
```

As duas da conta também podem vir do ambiente — melhor, porque o `.env` é lido
pelo Vite no build e ninguém quer senha passeando por arquivo de frontend:

```powershell
$env:VITE_TESTE_EMAIL = 'voce@exemplo.com'
$env:VITE_TESTE_SENHA = 'sua-senha'
npm run testar:base
```

A conta é necessária porque o RLS é restrito: sem JWT o Data API recusa tudo
(`missing authentication credentials: required authorization bearer token in
JWT format`). O roteiro entra por `POST /auth/sign-in/email`.

Duas armadilhas do Managed Better Auth que custaram tempo:

1. **`Origin` é obrigatório.** Sem o header, o login responde
   `Missing or null Origin` — use o domínio publicado
   (`https://prime-acai-gestao.pages.dev`, ou `$env:ORIGEM_TESTE`).
2. **O `token` do login não é JWT.** O corpo do `sign-in/email` traz um token de
   sessão **opaco**; enviá-lo como `Bearer` devolve
   `Provided authentication token is not a valid JWT encoding`. Quem devolve o
   JWT de verdade é o `GET /auth/get-session`, no header `set-auth-jwt` — é o
   que o SDK do navegador faz a cada carregamento.

Sem as variáveis ele avisa e sai sem erro; sai com código **1** se algum teste
falhar.

Ele **grava de verdade** — sempre em registros marcados (`C-TESTE-001` e
`#TESTE-01`), removidos na limpeza. O script confere no fim se as contagens
voltaram ao valor inicial.

## O .env é lido em tempo de build

O Vite injeta as variáveis `VITE_*` **no momento do build**. Com o `.env`
preenchido o bundle é maior (traz o SDK inteiro). Com o `.env` vazio,
`neonConfigurado` vira `false` na compilação e o cliente é dobrado para `null`,
o que faz o Rollup descartar a maior parte do SDK — o app sobe no **modo
demonstração** (dados de `src/data.js`, sem login). Sobra ainda uma parte do
cliente de autenticação que não dá para remover sem mexer na config de build;
por isso o modo demonstração não fica tão pequeno quanto o do Supabase.

Preencha o `.env` **antes** de buildar para produção, senão o app publicado nunca
vai alcançar o banco: o código nem estará no arquivo.
