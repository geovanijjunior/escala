# Jornada — Frontend

Interface da escala de trabalho, no padrão de infraestrutura para projetos
piloto: **React + Vite + Storybook + React Icons**.

## Objetivo

Telas da Jornada, consumindo a API de `../backend` por HTTP. Hoje cobre o login
e a lista de colaboradores; as demais estão sendo migradas da aplicação Next.js
que ainda está no ar.

## Arquitetura

```
React + Vite
   │  fetch nativo, com cookie de sessão
   ▼
API (Node 24 + Fastify + Prisma 6)
```

### Estrutura

| Diretório | Responsabilidade |
| --- | --- |
| `pages` | Telas e fluxos específicos. |
| `components` | Componentes reutilizáveis entre telas. |
| `services` | Chamadas à API, um módulo por recurso. |
| `hooks` | Lógica reutilizável de React. |
| `utils` | Funções auxiliares. |
| `config` | Tema e variáveis de ambiente. |
| `auth` | Sessão do usuário. |
| `estilos` | CSS de base e aplicação do tema. |

## Tecnologias

React 19 · Vite 8 · Storybook 10 · React Icons · TypeScript.

> **Sobre TypeScript.** O padrão define JavaScript e permite TypeScript para
> maior complexidade de domínio. Aqui vale a exceção, pela mesma razão do
> backend: o domínio da escala já existe em TypeScript com testes, e os tipos da
> API vêm dele — sem isso, uma mudança no backend só apareceria como `undefined`
> na tela. Aberto a revisão de quem mantém o padrão.

## Pré-requisitos

- Node **24** ou superior
- A API de `../backend` rodando

## Instalação

```bash
npm install
cp .env.exemplo .env
```

## Execução

```bash
npm run dev          # http://localhost:5173
npm run build
npm run storybook    # http://localhost:6006
npm run typecheck
npm run lint
```

## Variáveis de ambiente

**Tudo aqui é público**: o Vite embute estas variáveis no pacote que vai para o
navegador. Nada de segredo — o client secret do SSO vive no backend, e é por
isso que a troca do código por token acontece lá.

| Variável | O que é |
| --- | --- |
| `VITE_URL_DA_API` | Endereço da API. Sem ela, a aplicação recusa carregar. |

## Identidade visual

Branco predominante, azul escuro como principal, azul claro como complementar.

A paleta está **inteira** em `src/config/tema.ts`, e é a única fonte: o CSS
recebe as mesmas cores como variáveis, injetadas por `aplicarTema()`. Uma
segunda lista escrita à mão num `.css` divergiria no primeiro ajuste feito só de
um lado, e o resultado seriam dois azuis diferentes na mesma tela.

> Os hexadecimais atuais vieram do protótipo e **não passaram por validação de
> marca**. Antes de produção, confirme com quem responde pela identidade visual
> e troque em `tema.ts` — é o único lugar que precisa mudar.

## Componentes

Documentados no Storybook, com finalidade, propriedades, estados e
comportamentos:

| Componente | Para quê |
| --- | --- |
| `Botao` | Ação clicável. Variantes primário, contorno, discreto e perigo. |
| `Campo` | Entrada de texto com rótulo, ajuda e erro. |
| `Tabela` | Listagem com estados de carregando, vazio e com dados. |
| `Modal` | Janela sobreposta para confirmação e formulário curto. |

Ícones: **React Icons** (`react-icons/md`). Uma biblioteca só — misturar duas
dobra o peso do pacote e produz dois desenhos para o mesmo conceito.

## Autenticação

O módulo `src/auth` guarda a sessão e a oferece por `useSessao()`. O estado tem
três valores — *carregando*, *sem usuário* e *com usuário* — porque tratar os
dois primeiros como um só manda ao login todo mundo que recarrega a página, no
instante entre o React montar e a API responder.

A tela de login **não tem campo de senha**, e isso é o ponto: a senha
corporativa é digitada na tela do provedor de identidade. Um formulário de
usuário e senha aqui significaria que a aplicação vê a senha de rede de todos.

> O SSO está construído no backend e **parado**, aguardando a configuração do
> cliente no Keycloak. Para desenvolver sem ele, abra uma sessão à mão:
> `cd ../backend && npx tsx --env-file=.env scripts/sessao-de-teste.ts <email>`

## Testes

```bash
COOKIE=<valor> CHROMIUM_EXECUTAVEL=/opt/pw-browsers/chromium node verificar.mjs
```

`verificar.mjs` abre a aplicação num navegador de verdade e confere o que um
build verde não prova: a tela pinta, a chamada sai **com o cookie**, os dados
chegam à tabela, a paleta está aplicada e o console fica limpo. O erro mais
comum desta arquitetura — o `credentials: 'include'` esquecido — se manifesta
como um 401 que a tela mostra como "sessão expirou" para quem acabou de entrar,
e compila perfeitamente.

## Observações importantes

- A aplicação ainda não tem roteador. Enquanto só há uma tela migrada, ele seria
  estrutura sem conteúdo; entra junto com a segunda.
- O filtro da lista de colaboradores é do lado do cliente, de propósito: são
  dezenas de pessoas, não dezenas de milhares, e uma ida ao servidor por tecla
  digitada custaria mais do que economiza.
