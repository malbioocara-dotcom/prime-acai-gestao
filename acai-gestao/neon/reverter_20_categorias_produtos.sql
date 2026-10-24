-- Reversão conservadora: interrompe a atualização automática da auditoria, mas
-- mantém as categorias cadastradas para não perder dados de negócio. A tabela
-- e o RLS permanecem disponíveis até uma migração de remoção explícita.
drop trigger if exists categorias_produtos_atualizado_em on public.categorias_produtos;
drop function if exists public.tocar_atualizado_em_categoria_produto();
drop trigger if exists organizations_categorias_produtos on public.organizations;
drop function if exists public.seed_categorias_produtos_nova_organizacao();
