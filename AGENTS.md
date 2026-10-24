# Instruções para agentes

- Trabalhe no projeto aberto no VS Code; inspecione a estrutura, as instruções e o estado do Git antes de editar.
- Preserve os módulos e dados existentes. Não sobrescreva trabalho local nem use operações destrutivas sem autorização explícita.
- Use Git e GitHub para versionar alterações quando o destino estiver identificado; prefira mudanças pequenas, revisáveis e reversíveis.
- Nunca envie `.env`, credenciais, tokens, chaves privadas, logs sensíveis ou dados reais de clientes ao repositório.
- Alterações de banco devem usar migrações SQL numeradas no padrão existente, manter RLS e incluir reversão segura.
- Execute os testes relevantes, a validação de migrações e o build antes de publicar.
- Depois de concluir e validar qualquer alteração de código solicitada, publique diretamente um preview para testes e análise e atualize também a produção, conforme solicitado pelo usuário. Confirme ambos os deploys e verifique as URLs antes de informar que foram publicados. Se faltar autenticação, configuração, autorização ou validação, não alegue que publicou; informe o impedimento e o que falta.
- Não aplique migrações em produção nem publique um build sem validar o destino e as variáveis necessárias.
- Nunca afirme que testes, commits, pushes, integrações ou deploys ocorreram sem confirmar o resultado.
- Mantenha o README atualizado com instalação, configuração, testes e publicação.
