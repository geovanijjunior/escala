# Conformidade com o Padrão de Infraestrutura e Desenvolvimento

Checklist do documento **Padrão de Infraestrutura e Desenvolvimento — Projetos
Piloto, v1.1 (setembro de 2026)**, conferido contra o que existe neste
repositório.

> **Leia a coluna dupla antes das marcas.** Há DUAS aplicações aqui, e elas não
> estão no mesmo lugar do padrão:
>
> | | O que é | Situação |
> | --- | --- | --- |
> | **Sistema atual** | Next.js + Supabase, em `src/` | **Em produção, com usuários.** Não segue o padrão. |
> | **Stack nova** | `backend/` + `frontend/` | Segue o padrão. Cobre **1 das 12 telas**. |
>
> Uma marca verde na coluna "Stack nova" não significa que o sistema que as
> pessoas usam hoje atende ao item. Significa que o caminho novo atende — e
> falta migrar o resto.

Legenda: ✅ atende · ⚠️ parcial · ❌ não atende · ➖ não se aplica hoje

---

## 1. Estrutura

| Item | Sistema atual | Stack nova | Observação |
| --- | :---: | :---: | --- |
| Frontend separado do backend | ❌ | ✅ | O Next.js é monolítico, com Server Actions. `frontend/` e `backend/` são projetos distintos. |
| React + Vite | ❌ | ✅ | React 19 + Vite 8. |
| Node.js 24 | ❌ | ✅ | `engines: >=24` nos dois projetos. |
| Fastify | ❌ | ✅ | Fastify 5. |
| Fetch nativo | ❌ | ✅ | O sistema atual fala com o banco por `supabase-js`. O novo usa só `fetch`. |
| Prisma 6 | ❌ | ✅ | Prisma 6.19.3, com os 29 modelos obtidos por introspecção do banco real. |
| SQL Server ou PostgreSQL | ✅ | ✅ | PostgreSQL, o mesmo banco nos dois. |
| WebSocket/Event Bus quando necessário | ➖ | ➖ | Nenhum caso exige atualização imediata hoje. Ver *Decisões em aberto*. |

## 2. Frontend

| Item | Situação | Onde |
| --- | :---: | --- |
| Storybook configurado | ✅ | `frontend/.storybook/`, `npm run storybook` |
| Componentes documentados | ✅ | 4 componentes, 4 arquivos de histórias, com finalidade, propriedades, estados e comportamentos |
| React Icons | ✅ | `react-icons/md`, biblioteca única |
| Identidade visual institucional | ⚠️ | Aplicada, mas **os hexadecimais não passaram por validação de marca** |
| Branco predominante | ✅ | `cores.fundo` e `cores.superficie` são `#FFFFFF` |
| Azul escuro como cor principal | ⚠️ | `#1A4E93` — pendente de validação |
| Azul claro como cor complementar | ⚠️ | `#DCEAF8` — pendente de validação |
| Paleta centralizada | ✅ | `frontend/src/config/tema.ts`, fonte única; o CSS recebe as mesmas cores por `aplicarTema()` |
| Telas separadas dos componentes compartilhados | ✅ | `pages/` e `components/` |
| Autenticação em módulo separado | ✅ | `frontend/src/auth/` |

## 3. Backend

| Item | Situação | Onde |
| --- | :---: | --- |
| Routes | ✅ | `backend/src/routes/` — só expõem e agrupam |
| Controllers | ✅ | `backend/src/controllers/` — entrada e resposta, sem regra |
| Services | ✅ | `backend/src/services/` — regra de negócio |
| Repositories | ✅ | `backend/src/repositories/` — acesso a dados |
| Schemas e validações | ✅ | `backend/src/schemas/` |
| Configurações separadas | ✅ | `backend/src/config/` — ambiente conferido na partida, servidor recusa subir sem |
| Prisma configurado | ✅ | `backend/prisma/schema.prisma`, versionado |

## 4. Autenticação

| Item | Situação | Observação |
| --- | :---: | --- |
| SSO para usuários internos | ⚠️ | **Construído e parado.** Authorization Code + PKCE, 9 testes passando contra um provedor de mentira. Falta configurar o cliente no Keycloak e rotacionar o segredo. |
| MFA com Google Authenticator para usuários externos | ❌ | Não iniciado. Adiado a pedido. |
| Sessões gerenciadas pela aplicação | ✅ | Tabela `sessoes` (migration 0032). Cookie opaco; o banco guarda o SHA-256, nunca o valor. |

## 5. Documentação

| Item | Situação | Onde |
| --- | :---: | --- |
| README | ✅ | `backend/README.md` e `frontend/README.md`, no formato do padrão |
| Documentação técnica | ⚠️ | O conteúdo existe no `README.md` da raiz — modelo de dados, como o motor decide, decisões técnicas —, mas descreve a **arquitetura antiga** e não está no formato que o padrão pede |
| Storybook | ✅ | 4 componentes |
| APIs documentadas | ✅ | Tabela de rotas em `backend/README.md` |
| Fluxos principais documentados | ⚠️ | O fluxo de login está documentado; geração de escala, plano do mês, solicitações e triagem estão só no README antigo |
| Regras de negócio documentadas | ⚠️ | "Como o motor decide" no README da raiz; falta trazer para a documentação técnica nova |
| Funções relevantes documentadas | ✅ | Comentário de intenção e regra em todo módulo, nos dois projetos |

## 6. Antes de implantar em produção (§14.1)

O padrão define um fluxo obrigatório: **Desenvolvimento → Correções → QA →
Reteste → Aprovação → Produção**.

| Etapa | Situação |
| --- | :---: |
| Revisão pelo time de desenvolvimento | ❌ não iniciada |
| Correção técnica | ➖ |
| Validação pela equipe de QA | ❌ não iniciada |
| Correção e reteste | ➖ |
| Aprovação para implantação | ❌ |
| Preparação da implantação (observabilidade, suporte, falhas) | ❌ |

> **Aviso.** O sistema atual **já está em produção**, com usuários reais, sem ter
> passado por esse fluxo. Isso não se corrige para trás; a decisão de como
> regularizar é de quem responde pelo padrão.

---

## O tamanho do que falta

**1 das 12 telas** foi migrada.

| Migrada | Faltam |
| --- | --- |
| Colaboradores | Início, Calendário, Gerar, Hoje, Minha escala, Mural, Ocupação, Parâmetros, Planos, Solicitações, Usuários |

E, junto com elas, **as 75 policies de RLS**. Hoje a autorização mora no
Postgres, que barra a consulta mesmo quando o código esquece. Com o Prisma
conectando como um usuário só, essa rede some — cada policy precisa virar
código, e cada uma precisa do teste de paridade que compara o recorte novo com
a resposta da policy, pessoa por pessoa (`backend/src/services/colaboradores.teste.ts`
é o modelo).

É a parte mais longa e a mais arriscada: um recorte largo demais não dá erro.
As telas funcionam, os dados aparecem, e o que mudou é que alguém passou a
enxergar o que não devia.

---

## Decisões em aberto

Três pontos em que este repositório se afasta do padrão, ou em que o padrão
deixa a escolha para o projeto. Estão registrados para serem confirmados ou
revertidos por quem mantém o padrão.

### TypeScript em vez de JavaScript

O padrão define JavaScript e permite TypeScript para "domínio complexo ou
projeto maior". Os dois projetos usam TypeScript.

**Por quê:** o domínio da escala — motor de geração, regimes, ciclos de plantão,
validação de importação — já existe em TypeScript com testes de propriedade.
Reescrevê-lo em JavaScript descartaria os tipos que sustentam aquelas regras, e
o recurso mais valioso do sistema atual é justamente esse módulo.

### Migrations em SQL, não `prisma migrate`

O padrão pede `schema.prisma` versionado, e ele está. As migrations, porém,
continuam sendo os arquivos de `supabase/migrations/`, aplicados em ordem.

**Por quê:** a base em produção é gerida por aqueles arquivos, com um auditor
(`supabase/o-que-falta-rodar.sql`) que diz o que falta aplicar. Adotar
`prisma migrate` com o histórico fora do Prisma criaria duas fontes de verdade
durante a transição. A troca deve acontecer depois do corte, numa migration de
baseline.

### WebSocket/Event Bus

Marcado como não aplicável. O sistema tem mural e notificações, mas ambos são
resolvidos na carga da página, e ninguém depende de ver a mudança no mesmo
segundo.

**Quando reavaliar:** se a publicação de escala passar a exigir aviso imediato à
equipe, ou se a triagem de solicitações virar trabalho simultâneo de várias
pessoas.

---

## Registro de validação

Conforme §"Registro de validação" do padrão.

| Campo | Preenchimento |
| --- | --- |
| Projeto | Jornada — escala de trabalho |
| Responsável técnico | |
| Data da revisão | |
| Revisor | |
| Resultado | ☐ Aprovado ☐ Aprovado com ressalvas ☐ Ajustes necessários |
| Observações | |
