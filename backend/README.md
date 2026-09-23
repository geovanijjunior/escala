# Jornada — API

Backend da escala de trabalho, no padrão de infraestrutura para projetos piloto:
**Node 24 + Fastify + Prisma 6 + PostgreSQL**.

## Objetivo

Concentrar regras, integrações e acesso a dados da Jornada, e entregar ao
frontend uma API HTTP. Hoje cobre a autenticação corporativa; as demais rotas
estão sendo migradas da aplicação Next.js que ainda está no ar.

## Arquitetura

```
Frontend (React + Vite)
   │  fetch, com cookie de sessão
   ▼
API (Node 24 + Fastify)
   │  Prisma 6
   ▼
PostgreSQL
   ▲
   │  OpenID Connect
SSO corporativo (Keycloak)
```

### Camadas

| Pasta | Responsabilidade |
| --- | --- |
| `routes` | Expõe e agrupa as rotas. Nenhuma regra. |
| `controllers` | Lê a requisição, chama o serviço, monta a resposta. |
| `services` | Regras de negócio e orquestração. |
| `repositories` | Acesso a dados via Prisma. |
| `middlewares` | Comportamentos transversais (sessão, papel). |
| `config` | Ambiente e cliente do banco. |

`src/app.ts` monta a aplicação e recebe o ambiente pronto; `src/server.ts`
sobe o processo. A separação existe para o teste montar a mesma aplicação
apontada para um provedor de identidade falso, sem porta e sem rede.

## Tecnologias

Node 24 · Fastify 5 · Prisma 6.19 · PostgreSQL · jose (verificação de JWT) ·
TypeScript.

> **Sobre TypeScript.** O padrão define JavaScript como linguagem e TypeScript
> como alternativa para maior complexidade de domínio. Aqui vale a alternativa:
> o domínio da escala (motor de geração, regimes, ciclos de plantão, validação
> de importação) já existe em TypeScript com testes de propriedade, e reescrevê-lo
> em JavaScript descartaria os tipos que sustentam aquelas regras. A decisão
> está aberta a revisão por quem mantém o padrão.

## Pré-requisitos

- Node **24** ou superior (`node --version`)
- PostgreSQL com as migrations de `../supabase/migrations` aplicadas, até a
  **0032**
- Um cliente cadastrado no Keycloak corporativo, com:
  - fluxo **Authorization Code** habilitado
  - `SSO_REDIRECIONAMENTO` cadastrado como *Valid Redirect URI*
  - escopos `openid profile email`

## Instalação

```bash
npm install
cp .env.exemplo .env    # e preencha
npx prisma generate
```

## Execução

```bash
npm run dev        # tsx watch, recarrega ao salvar
npm start          # produção
npm test           # a suíte do login
npm run typecheck
```

A API sobe em `http://localhost:3333` por padrão.

## Variáveis de ambiente

Todas obrigatórias, salvo indicação. **O servidor recusa subir com qualquer uma
faltando** — a alternativa adia o erro para o primeiro visitante daquele
caminho.

| Variável | O que é |
| --- | --- |
| `PORTA` | Porta da API. Padrão 3333. |
| `NODE_ENV_APP` | `desenvolvimento`, `homologacao` ou `producao`. |
| `URL_DO_FRONTEND` | Origem do frontend. Define o CORS e para onde o login volta. |
| `DATABASE_URL` | Conexão do Postgres. |
| `SSO_EMISSOR` | URL do realm, sem barra final. Exige `https` fora de desenvolvimento. |
| `SSO_CLIENTE_ID` | Client ID no Keycloak. |
| `SSO_CLIENTE_SEGREDO` | Client secret. **Nunca versionar.** |
| `SSO_REDIRECIONAMENTO` | URL pública de `/auth/retorno`. |
| `CHAVE_DE_ASSINATURA` | Assina os cookies de curta duração do login. Mínimo 32 caracteres: `openssl rand -base64 32`. |
| `SESSAO_HORAS` | Duração da sessão. Padrão 8. |

## APIs

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/saude` | Diz se o processo está de pé **e alcança o banco**. |
| `GET` | `/auth/entrar` | Começa o login: desvia para o Keycloak. Aceita `?destino=/caminho` interno. |
| `GET` | `/auth/retorno` | Retorno do Keycloak. Sempre termina em desvio para o frontend. |
| `GET` | `/auth/eu` | Quem está na sessão. `401` quando não há. |
| `POST` | `/auth/sair` | Encerra a sessão. `POST` porque um `GET` seria disparado por qualquer imagem apontando para ele. |

## Autenticação

**Authorization Code + PKCE**, contra o SSO corporativo.

O fluxo `grant_type=password` não é usado de propósito: nele a nossa tela
coletaria a senha corporativa e a repassaria ao provedor, que é o que o SSO
existe para evitar — e que impede o MFA, feito na tela do provedor.

### Como o acesso é decidido

Autenticar no SSO **não dá acesso**. Quem entra no Keycloak corporativo é
qualquer pessoa do hospital; a escala é de uma área. Então:

1. O SSO responde **quem é** a pessoa (o `sub` do token).
2. O cadastro daqui responde **se ela pode** — precisa já ter perfil, criado
   por quem administra a área.
3. O primeiro login apenas **liga** os dois, por e-mail.

Quem não tem perfil é recusado com a mensagem do que fazer. Um e-mail já ligado
a outra identidade também é recusado, em vez de trocar o vínculo — é o caso do
endereço reaproveitado depois que alguém sai.

### Sessões

Geridas pela aplicação, como manda o padrão. O cookie leva um valor opaco; o
que ele encontra é uma linha de `sessoes`. O que fica gravado é o **SHA-256** do
valor, nunca o valor — um dump do banco não entrega sessão de ninguém.

Duram 8 horas, caem após 2 horas sem uso, e são apagadas 7 dias depois de
vencer (o prazo existe para responder "de onde esta pessoa entrou na terça?").

## Banco de dados

PostgreSQL, o mesmo do sistema atual. `prisma/schema.prisma` é versionado e
gerado por introspecção (`npm run prisma:pull`) — as migrations continuam sendo
os arquivos SQL de `../supabase/migrations`, aplicados em ordem.

> **Por que não `prisma migrate`.** A base em produção é gerida por aqueles
> arquivos, com um auditor (`../supabase/o-que-falta-rodar.sql`) que diz o que
> falta aplicar. Adotar `prisma migrate` com o histórico fora do Prisma criaria
> duas fontes de verdade durante a transição. A troca deve acontecer depois do
> corte, numa migration de baseline.

A **0032** é a migration desta etapa: solta `perfis` do `auth.users` do
Supabase, cria `perfis.sso_sub` e a tabela `sessoes`. É aditiva — o sistema
atual continua funcionando enquanto esta API é construída ao lado.

## Testes

```bash
npm test
```

A suíte do login sobe um **provedor OpenID de mentira** — com descoberta, JWKS
e tokens assinados por uma chave real — e exercita o fluxo inteiro: ida com
PKCE, volta, abertura de sessão, e as recusas que mais importam (sem cadastro,
bloqueado, estado trocado, e-mail já ligado a outra identidade, token assinado
por outra chave).

**O que ela não prova:** que o Keycloak de vocês está configurado com a redirect
URI certa e devolve `email` no token. Isso só o primeiro login real mostra.

## Observações importantes

- O Keycloak de homologação (`rh-sso-hom.einstein.br`) está na rede interna e
  não é alcançável de fora dela. O primeiro teste real precisa rodar de um
  ambiente com essa rota.
- `SSO_CLIENTE_SEGREDO` e `CHAVE_DE_ASSINATURA` não vão para o repositório. O
  `.gitignore` cobre `.env`.
