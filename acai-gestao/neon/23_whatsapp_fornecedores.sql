-- Contato de WhatsApp dos fornecedores, separado do telefone comercial.
alter table public.fornecedores
  add column if not exists whatsapp text;

comment on column public.fornecedores.whatsapp is
  'Telefone de WhatsApp do fornecedor, armazenado com máscara brasileira.';
