-- Reversão conservadora: remove a porta de escrita, mas preserva a tabela e
-- as imagens dos produtos para evitar perda de dados. A remoção definitiva
-- requer exportação/backup e uma ação explícita do responsável pelo banco.
drop function if exists public.salvar_produto_com_imagem(jsonb, text, bytea, boolean);
