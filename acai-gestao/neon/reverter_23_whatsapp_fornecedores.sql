do $$
begin
  if exists (
    select 1
      from public.fornecedores
     where whatsapp is not null
       and btrim(whatsapp) <> ''
  ) then
    raise exception
      'Existem WhatsApps cadastrados em fornecedores. Exporte esses dados antes de reverter esta migração.';
  end if;
end;
$$;

alter table public.fornecedores
  drop column if exists whatsapp;
