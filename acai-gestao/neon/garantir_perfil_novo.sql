create or replace function public.garantir_perfil()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  org   uuid;
  nome  text;
  mail  text;
  conv  public.invites;
  linha public.profiles;
  ativo_inicial boolean := false;
begin
  if uid is null then
    raise exception 'Sem sessao ativa.' using errcode = '42501';
  end if;

  select id into org from public.organizations order by created_at, id limit 1;
  if org is null then
    raise exception 'Nenhuma organizacao cadastrada.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)),
         lower(u.email)
    into nome, mail
    from neon_auth.user u
   where u.id = uid;

  select * into conv
    from public.invites
   where organization_id = org
     and lower(email) = mail
     and accepted_at is null
   order by created_at desc
   limit 1;

  if conv.id is not null then
    ativo_inicial := conv.is_active;
  end if;

  insert into public.profiles (id, full_name, email, organization_id, role, is_active, aprovado_em)
  values (uid, left(coalesce(nome, 'Usuario'), 120), mail, org, 'cashier', ativo_inicial,
          case when ativo_inicial then now() else null end)
  on conflict (id) do nothing;

  if conv.id is not null then
    update public.profiles
       set role = conv.role, is_active = conv.is_active, full_name = coalesce(nullif(conv.full_name,''), full_name),
           aprovado_em = now()
     where id = uid;

    insert into public.user_permissions (user_id, permission_id, allowed)
    select uid, ip.permission_id, ip.allowed
      from public.invite_permissions ip
     where ip.invite_id = conv.id
    on conflict (user_id, permission_id)
    do update set allowed = excluded.allowed, updated_at = now();

    update public.invites
       set accepted_at = now(), accepted_user_id = uid
     where id = conv.id;

    insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
    values (org, uid, uid, 'convite_aceito', jsonb_build_object('email', mail));
  end if;

  update public.profiles set last_login_at = now() where id = uid;

  select * into linha from public.profiles where id = uid;
  return linha;
end;
$$;