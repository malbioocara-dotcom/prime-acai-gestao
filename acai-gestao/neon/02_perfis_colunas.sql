-- ============================================================================
-- 02. Colunas de perfil que estavam fora das migrações
--
-- POR QUE ESTE ARQUIVO EXISTE
--   `00_banco_neon.sql` cria `profiles` com id, full_name, organization_id,
--   role, is_active, created_at e updated_at — só isso. As colunas de e-mail,
--   usuário, aprovação e último acesso nasceram depois, na evolução do login,
--   foram aplicadas à mão no SQL Editor e ficaram FORA do repositório.
--
--   A conta disso: um banco novo montado com 00 -> 01 -> 03 QUEBRA. O trigger
--   de notificação de novo usuário (03) lê `new.aprovado_em`, e a coluna não
--   existia em migração nenhuma. `01` também lê `pr.email`, `pr.username` e
--   `pr.last_login_at` na função `listar_usuarios()`.
--
--   (Descoberto rodando a cadeia inteira num Postgres de teste, não por leitura.)
--
-- O QUE ESTE ARQUIVO NÃO FAZ
--   Não substitui `garantir_perfil()`. Existe um `garantir_perfil_novo.sql`
--   solto, com a versão que lê e-mail e convite; ele continua sendo aplicado à
--   parte, de propósito — trocar uma função que está em produção sem poder
--   conferir a versão de lá é mais arriscado do que deixar isso explícito.
--
-- SEM REVERTER, DE PROPÓSITO
--   Derrubar estas colunas apagaria dado real (e-mail, data de aprovação,
--   último acesso). Desfazer não é uma operação segura aqui, então não é
--   oferecida.
--
-- É PURO `add column if not exists`: num banco que já tem as colunas (a
-- produção, hoje) não muda absolutamente nada; num banco novo, cria o que falta.
-- ============================================================================

alter table public.profiles add column if not exists email         text;
alter table public.profiles add column if not exists username      text;
alter table public.profiles add column if not exists aprovado_em   timestamptz;
alter table public.profiles add column if not exists last_login_at timestamptz;

comment on column public.profiles.aprovado_em is
  'Quando o cadastro foi aprovado. NULL junto com is_active = false é cadastro pendente.';

comment on column public.profiles.last_login_at is
  'Último acesso, carimbado por garantir_perfil().';

comment on column public.profiles.email is
  'E-mail da conta (espelho de neon_auth.user.email), usado para casar convite.';

-- ------------------------------------------------------------- conferência --
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name in ('email', 'username', 'aprovado_em', 'last_login_at')
     group by table_name
    having count(*) = 4
  ) then
    raise exception '02: public.profiles ficou sem alguma das colunas esperadas';
  end if;
end
$$;
