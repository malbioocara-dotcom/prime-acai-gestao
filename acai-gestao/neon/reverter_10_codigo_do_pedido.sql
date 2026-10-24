-- ============================================================================
-- Desfaz a 10 (o código do pedido).
-- ============================================================================
--
-- A 10 tem duas partes, e só uma delas é "esquema":
--
--   • a POSIÇÃO da sequência (`vendas_codigo_seq`) não tem estado anterior a
--     restaurar. Antes dela a sequência estava adiantada por número(s)
--     queimado(s) em transação desfeita — devolver isso seria devolver o buraco
--     na numeração de propósito. A sequência em si foi criada pela 08 e é a
--     `reverter_08_vendas_transacionais.sql` que cuida dela.
--
--   • a FUNÇÃO `public.proximo_codigo_venda()` foi criada pela 10, e é isso que
--     este arquivo derruba. Quem chama (a tela de Vendas) cai no cálculo pelo
--     último código gravado quando a função não existe.
-- ============================================================================

drop function if exists public.proximo_codigo_venda();

-- Mesmo aviso da 10, pelo mesmo motivo: o cache do Data API precisa largar a
-- função (no Neon: `npx neon data-api refresh-schema`).
notify pgrst, 'reload schema';
