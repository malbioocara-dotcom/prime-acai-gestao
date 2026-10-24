-- ============================================================================
-- Central de notificacoes
-- ============================================================================
-- Persistencia, RLS e RPCs do sino de notificacoes.
--
-- Regras aplicadas no banco (nao so na interface):
--   * cada usuario so enxerga as notificacoes enderecadas a ele
--     (recipient_user_id = auth.uid()) ou ao perfil dele (recipient_role);
--   * marcar como lida valida o mesmo criterio;
--   * o evento "novo usuario pendente" e gerado por trigger em profiles,
--     nunca pelo frontend.
-- ============================================================================

create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid references public.organizations(id) on delete cascade,
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  recipient_role    text,
  tipo              text not null,
  titulo            text not null,
  mensagem          text not null,
  link              text,
  lida              boolean not null default false,
  lida_em           timestamptz,
  actor_user_id     uuid,
  criado_em         timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_user_id, lida, criado_em desc);
create index if not exists notifications_role_idx
  on public.notifications (recipient_role, lida, criado_em desc);

alter table public.notifications enable row level security;

drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications
  for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    or (
      recipient_role is not null
      and exists (
        select 1 from public.profiles
        where id = (select auth.uid()) and role = notifications.recipient_role
      )
    )
  );

-- ---------------------------------------------------------------- RPCs ----

create or replace function public.contar_notificacoes_nao_lidas()
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.notifications
  where (
    recipient_user_id = (select auth.uid())
    or (
      recipient_role is not null
      and exists (
        select 1 from public.profiles
        where id = (select auth.uid()) and role = notifications.recipient_role
      )
    )
  )
  and lida = false;
$$;

drop function if exists public.listar_notificacoes(integer);
create or replace function public.listar_notificacoes(p_limite int default 20)
returns table (
  id uuid, tipo text, titulo text, mensagem text, link text,
  lida boolean, criado_em timestamptz, actor text, actor_id uuid
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
  select n.id, n.tipo, n.titulo, n.mensagem, n.link, n.lida, n.criado_em,
         pa.full_name, n.actor_user_id
  from public.notifications n
  left join public.profiles pa on pa.id = n.actor_user_id
  where (
    n.recipient_user_id = (select auth.uid())
    or (
      n.recipient_role is not null
      and exists (
        select 1 from public.profiles pr
        where pr.id = (select auth.uid()) and pr.role = n.recipient_role
      )
    )
  )
  order by n.criado_em desc
  limit greatest(1, least(coalesce(p_limite, 20), 100));
end;
$$;

create or replace function public.marcar_notificacao_lida(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.notifications
     set lida = true, lida_em = now()
   where id = p_id
     and (
       recipient_user_id = (select auth.uid())
       or (
         recipient_role is not null
         and exists (
           select 1 from public.profiles pr
           where pr.id = (select auth.uid()) and pr.role = notifications.recipient_role
         )
       )
     );
end;
$$;

create or replace function public.marcar_todas_lidas()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.notifications
     set lida = true, lida_em = now()
   where (
     recipient_user_id = (select auth.uid())
     or (
       recipient_role is not null
       and exists (
         select 1 from public.profiles pr
         where pr.id = (select auth.uid()) and pr.role = notifications.recipient_role
       )
     )
   )
   and lida = false;
end;
$$;

revoke execute on function public.contar_notificacoes_nao_lidas() from public, anonymous;
revoke execute on function public.listar_notificacoes(integer) from public, anonymous;
revoke execute on function public.marcar_notificacao_lida(uuid) from public, anonymous;
revoke execute on function public.marcar_todas_lidas() from public, anonymous;
grant execute on function public.contar_notificacoes_nao_lidas() to authenticated;
grant execute on function public.listar_notificacoes(integer) to authenticated;
grant execute on function public.marcar_notificacao_lida(uuid) to authenticated;
grant execute on function public.marcar_todas_lidas() to authenticated;

-- ------------------------------------------------------------- Eventos ----
-- Novo cadastro pendente -> notifica os administradores da organizacao.
-- Dispara uma unica vez por perfil inserido (sem duplicidade).

create or replace function public.notificar_novo_usuario_pendente()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_active = false and new.aprovado_em is null then
    insert into public.notifications
      (organization_id, recipient_role, tipo, titulo, mensagem, link, actor_user_id)
    values (
      new.organization_id, 'admin', 'novo_usuario_pendente',
      'Novo usuario pendente de aprovacao',
      coalesce(new.full_name, new.email) || ' solicitou acesso ao sistema.',
      '/configuracoes', new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_novo_usuario on public.profiles;
create trigger trg_notif_novo_usuario
  after insert on public.profiles
  for each row execute function public.notificar_novo_usuario_pendente();
