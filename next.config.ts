import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * O anexo do mural sobe por Server Action, e o padrão do Next é 1 MB.
       *
       * Sem esta linha o teto real nunca foi o do código: um comunicado com
       * anexo acima de 1 MB era recusado no corpo da requisição, antes de
       * chegar à validação que dá a mensagem boa — e a falha aparecia como erro
       * de rede, não como "passa do limite".
       *
       * O valor fica acima de `LIMITE_TOTAL_BYTES` (40 MB) porque este limite
       * vale para o corpo HTTP bruto, incluindo o que o `multipart/form-data`
       * acrescenta por arquivo em fronteiras e cabeçalhos. Quem barra o usuário
       * com mensagem legível é `src/lib/anexos.ts`; isto é só a folga para a
       * mensagem conseguir acontecer.
       */
      bodySizeLimit: '42mb',
    },
  },
};

export default nextConfig;
