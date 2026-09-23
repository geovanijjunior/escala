import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../app.ts';
import { prisma } from '../config/prisma.ts';
import type { Ambiente } from '../config/ambiente.ts';

/**
 * O login corporativo, de ponta a ponta, contra um provedor de mentira.
 *
 * De mentira porque o Keycloak de homologação vive na rede interna e nenhum
 * ambiente de teste o alcança — e porque depender dele tornaria esta suíte
 * refém de uma indisponibilidade alheia. O que o provedor falso faz é o que
 * importa: publica descoberta e JWKS, e assina tokens com uma chave de
 * verdade. A verificação de assinatura que o nosso código faz é a mesma que
 * fará em produção.
 *
 * O que ele NÃO prova: que o Keycloak de vocês está configurado com a redirect
 * URI certa e devolve `email` no token. Isso só o primeiro login real mostra.
 *
 * As recusas valem tanto quanto o caminho feliz — mais, até. Um login que
 * aceita o que deveria recusar não dá erro em lugar nenhum: ele funciona, e é
 * exatamente esse o problema.
 */

const PORTA_FALSA = 4477;
const EMISSOR = `http://localhost:${PORTA_FALSA}`;
const CLIENTE = 'cliente-de-teste';
const FRONTEND = 'http://localhost:5173';

// O tipo da chave sai do próprio `generateKeyPair`: `CryptoKey` só existe como
// tipo global em algumas combinações de lib/DOM, e escrevê-lo à mão faz o
// typecheck passar numa máquina e falhar na outra.
let chavePrivada: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let chavePublica: JWK;
let provedor: Server;
let app: FastifyInstance;

/** Controla o que o provedor falso devolve na próxima troca de código. */
let proximaIdentidade: { sub: string; email: string; nome: string; nonce: string } | null = null;

const ambiente: Ambiente = {
  porta: 0,
  ambiente: 'desenvolvimento',
  urlDoFrontend: FRONTEND,
  bancoUrl: process.env.DATABASE_URL ?? '',
  sso: {
    emissor: EMISSOR,
    clienteId: CLIENTE,
    clienteSegredo: 'segredo-de-teste',
    redirecionamento: 'http://localhost:3333/auth/retorno',
  },
  sessao: { horas: 8, cookieSeguro: false, chaveDeAssinatura: 'x'.repeat(40) },
};

async function assinarIdToken(d: { sub: string; email: string; nome: string; nonce: string }) {
  return new SignJWT({ email: d.email, name: d.nome, nonce: d.nonce, sid: 'sessao-do-provedor' })
    .setProtectedHeader({ alg: 'RS256', kid: 'teste' })
    .setIssuer(EMISSOR)
    .setAudience(CLIENTE)
    .setSubject(d.sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(chavePrivada);
}

before(async () => {
  const par = await generateKeyPair('RS256');
  chavePrivada = par.privateKey;
  chavePublica = { ...await exportJWK(par.publicKey), kid: 'teste', alg: 'RS256', use: 'sig' };

  provedor = createServer(async (req, resp) => {
    const url = new URL(req.url ?? '/', EMISSOR);
    if (url.pathname === '/.well-known/openid-configuration') {
      resp.writeHead(200, { 'Content-Type': 'application/json' });
      return resp.end(JSON.stringify({
        issuer: EMISSOR,
        authorization_endpoint: `${EMISSOR}/autorizar`,
        token_endpoint: `${EMISSOR}/token`,
        end_session_endpoint: `${EMISSOR}/sair`,
        jwks_uri: `${EMISSOR}/jwks`,
      }));
    }
    if (url.pathname === '/jwks') {
      resp.writeHead(200, { 'Content-Type': 'application/json' });
      return resp.end(JSON.stringify({ keys: [chavePublica] }));
    }
    if (url.pathname === '/token') {
      if (!proximaIdentidade) {
        resp.writeHead(400);
        return resp.end('{"error":"invalid_grant"}');
      }
      const idToken = await assinarIdToken(proximaIdentidade);
      resp.writeHead(200, { 'Content-Type': 'application/json' });
      return resp.end(JSON.stringify({
        access_token: 'acesso', id_token: idToken, refresh_token: 'renovar', expires_in: 300,
      }));
    }
    resp.writeHead(404);
    resp.end();
  });
  await new Promise<void>(ok => provedor.listen(PORTA_FALSA, ok));

  app = await construirApp(ambiente);
  await app.ready();
});

after(async () => {
  await app.close();
  await new Promise<void>(ok => provedor.close(() => ok()));
  await prisma.sessoes.deleteMany({ where: { perfis: { email: { endsWith: '@teste-sso.local' } } } });
  await prisma.perfis.deleteMany({ where: { email: { endsWith: '@teste-sso.local' } } });
  await prisma.$disconnect();
});

/** Um perfil na base, como o Planejamento teria criado. */
async function criarPerfil(d: { email: string; bloqueado?: boolean; ssoSub?: string }) {
  const conta = await prisma.contas.findFirst();
  return prisma.perfis.create({
    data: {
      id: randomUUID(),
      conta_id: conta?.id ?? null,
      nome: 'Pessoa de Teste',
      email: d.email,
      papel: 'colaborador',
      bloqueado: d.bloqueado ?? false,
      sso_sub: d.ssoSub ?? null,
    },
  });
}

/** Faz a ida ao provedor e devolve o cookie de login e o `state` sorteado. */
async function iniciarLogin() {
  const r = await app.inject({ method: 'GET', url: '/auth/entrar' });
  assert.equal(r.statusCode, 302, 'a ida ao provedor é um desvio');
  const destino = new URL(r.headers.location as string);
  const cookie = (r.headers['set-cookie'] as string[] | string);
  const bruto = Array.isArray(cookie) ? cookie[0]! : cookie;
  return {
    estado: destino.searchParams.get('state')!,
    desafio: destino.searchParams.get('code_challenge')!,
    metodo: destino.searchParams.get('code_challenge_method')!,
    cookieDeLogin: bruto.split(';')[0]!,
    url: destino,
  };
}

describe('ida ao provedor', () => {
  it('leva PKCE, estado e nonce, e pede o escopo de e-mail', async () => {
    const { url, metodo, desafio } = await iniciarLogin();
    assert.equal(url.origin + url.pathname, `${EMISSOR}/autorizar`);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(metodo, 'S256', 'o desafio é o hash, nunca o verificador em claro');
    assert.ok(desafio.length >= 43, 'o desafio tem o tamanho de um SHA-256 em base64url');
    assert.ok(url.searchParams.get('nonce'), 'sem nonce, um token de outra sessão seria aceito aqui');
    assert.match(url.searchParams.get('scope')!, /\bemail\b/);
  });

  it('não repete o estado entre duas tentativas', async () => {
    const a = await iniciarLogin();
    const b = await iniciarLogin();
    assert.notEqual(a.estado, b.estado);
    assert.notEqual(a.desafio, b.desafio);
  });
});

describe('volta do provedor', () => {
  it('abre a sessão de quem já tem cadastro', async () => {
    const email = `ana.${Date.now()}@teste-sso.local`;
    const perfil = await criarPerfil({ email });
    const { estado, cookieDeLogin, url } = await iniciarLogin();
    proximaIdentidade = { sub: `sub-${perfil.id}`, email, nome: 'Ana do SSO', nonce: url.searchParams.get('nonce')! };

    const r = await app.inject({
      method: 'GET',
      url: `/auth/retorno?code=abc&state=${encodeURIComponent(estado)}`,
      headers: { cookie: cookieDeLogin },
    });

    assert.equal(r.statusCode, 302);
    assert.equal(r.headers.location, `${FRONTEND}/`);

    const posto = ([] as string[]).concat(r.headers['set-cookie'] as string[]).join(';');
    assert.match(posto, /jornada_sessao=/, 'a sessão foi posta no cookie');
    assert.match(posto, /HttpOnly/i, 'o cookie de sessão não pode ser lido por script da página');

    // O vínculo com a identidade do provedor ficou gravado.
    const depois = await prisma.perfis.findUnique({ where: { id: perfil.id } });
    assert.equal(depois?.sso_sub, `sub-${perfil.id}`);
    // E o nome do provedor passou a valer.
    assert.equal(depois?.nome, 'Ana do SSO');

    // A sessão existe no banco — e o que está gravado NÃO é o valor do cookie.
    const valor = posto.match(/jornada_sessao=([^;]+)/)![1]!;
    const naBase = await prisma.sessoes.findFirst({ where: { perfil_id: perfil.id } });
    assert.ok(naBase, 'a sessão é da aplicação, e mora no banco');
    assert.notEqual(naBase!.id, valor, 'o que se guarda é a impressão do valor, não o valor');

    // E ela abre a porta.
    const eu = await app.inject({ method: 'GET', url: '/auth/eu', headers: { cookie: `jornada_sessao=${valor}` } });
    assert.equal(eu.statusCode, 200);
    assert.equal(eu.json().email, email);

    // Sair encerra de verdade: o mesmo cookie deixa de valer.
    const saiu = await app.inject({ method: 'POST', url: '/auth/sair', headers: { cookie: `jornada_sessao=${valor}` } });
    assert.equal(saiu.statusCode, 200);
    const depoisDeSair = await app.inject({ method: 'GET', url: '/auth/eu', headers: { cookie: `jornada_sessao=${valor}` } });
    assert.equal(depoisDeSair.statusCode, 401, 'sessão encerrada não volta a valer');
  });

  it('recusa quem autentica no SSO sem ter cadastro aqui', async () => {
    const { estado, cookieDeLogin, url } = await iniciarLogin();
    proximaIdentidade = {
      sub: 'sub-de-quem-nao-tem-cadastro',
      email: `estranho.${Date.now()}@teste-sso.local`,
      nome: 'Alguém do Hospital',
      nonce: url.searchParams.get('nonce')!,
    };

    const r = await app.inject({
      method: 'GET',
      url: `/auth/retorno?code=abc&state=${encodeURIComponent(estado)}`,
      headers: { cookie: cookieDeLogin },
    });

    assert.equal(r.statusCode, 302);
    const destino = String(r.headers.location);
    assert.match(destino, /\/login\?erro=/, 'volta ao login com o motivo');
    assert.match(decodeURIComponent(destino), /não tem cadastro/i);
    assert.equal(
      await prisma.perfis.count({ where: { sso_sub: 'sub-de-quem-nao-tem-cadastro' } }), 0,
      'autenticar no SSO corporativo não pode criar acesso — senão todo o hospital entra',
    );
  });

  it('recusa quem está bloqueado', async () => {
    const email = `bloqueado.${Date.now()}@teste-sso.local`;
    const perfil = await criarPerfil({ email, bloqueado: true });
    const { estado, cookieDeLogin, url } = await iniciarLogin();
    proximaIdentidade = { sub: `sub-${perfil.id}`, email, nome: 'Bloqueado', nonce: url.searchParams.get('nonce')! };

    const r = await app.inject({
      method: 'GET',
      url: `/auth/retorno?code=abc&state=${encodeURIComponent(estado)}`,
      headers: { cookie: cookieDeLogin },
    });
    assert.match(decodeURIComponent(String(r.headers.location)), /bloqueado/i);
    assert.equal(await prisma.sessoes.count({ where: { perfil_id: perfil.id } }), 0);
  });

  it('não entrega a conta de alguém a outra identidade com o mesmo e-mail', async () => {
    // O endereço reaproveitado depois que a pessoa anterior saiu.
    const email = `reaproveitado.${Date.now()}@teste-sso.local`;
    const perfil = await criarPerfil({ email, ssoSub: 'sub-da-pessoa-anterior' });
    const { estado, cookieDeLogin, url } = await iniciarLogin();
    proximaIdentidade = { sub: 'sub-de-quem-chegou-agora', email, nome: 'Quem Chegou', nonce: url.searchParams.get('nonce')! };

    const r = await app.inject({
      method: 'GET',
      url: `/auth/retorno?code=abc&state=${encodeURIComponent(estado)}`,
      headers: { cookie: cookieDeLogin },
    });
    assert.match(decodeURIComponent(String(r.headers.location)), /outra identidade/i);
    const depois = await prisma.perfis.findUnique({ where: { id: perfil.id } });
    assert.equal(depois?.sso_sub, 'sub-da-pessoa-anterior', 'o vínculo antigo não foi trocado');
  });

  it('recusa quando o estado não confere', async () => {
    const { cookieDeLogin, url } = await iniciarLogin();
    proximaIdentidade = { sub: 's', email: 'x@teste-sso.local', nome: 'X', nonce: url.searchParams.get('nonce')! };

    const r = await app.inject({
      method: 'GET',
      url: '/auth/retorno?code=abc&state=estado-de-outra-pessoa',
      headers: { cookie: cookieDeLogin },
    });
    assert.match(decodeURIComponent(String(r.headers.location)), /não confere/i);
  });

  it('recusa quando não há cookie da tentativa', async () => {
    const r = await app.inject({ method: 'GET', url: '/auth/retorno?code=abc&state=qualquer' });
    assert.match(decodeURIComponent(String(r.headers.location)), /expirou/i);
  });

  it('recusa um token assinado por outra chave', async () => {
    // O ataque que a verificação de assinatura existe para barrar: um token
    // com os campos certos, montado por quem não é o provedor.
    const email = `impostor.${Date.now()}@teste-sso.local`;
    const perfil = await criarPerfil({ email });
    const outra = await generateKeyPair('RS256');
    const { estado, cookieDeLogin, url } = await iniciarLogin();

    const forjado = await new SignJWT({ email, name: 'Impostor', nonce: url.searchParams.get('nonce')! })
      .setProtectedHeader({ alg: 'RS256', kid: 'teste' })
      .setIssuer(EMISSOR).setAudience(CLIENTE).setSubject(`sub-${perfil.id}`)
      .setIssuedAt().setExpirationTime('5m')
      .sign(outra.privateKey);

    // O provedor falso devolve o token forjado desta vez.
    const antes = provedor.listeners('request');
    provedor.removeAllListeners('request');
    provedor.on('request', async (req, resp) => {
      const u = new URL(req.url ?? '/', EMISSOR);
      if (u.pathname === '/token') {
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        return resp.end(JSON.stringify({ access_token: 'a', id_token: forjado, expires_in: 300 }));
      }
      (antes[0] as (a: unknown, b: unknown) => void)(req, resp);
    });

    const r = await app.inject({
      method: 'GET',
      url: `/auth/retorno?code=abc&state=${encodeURIComponent(estado)}`,
      headers: { cookie: cookieDeLogin },
    });

    provedor.removeAllListeners('request');
    for (const l of antes) provedor.on('request', l as () => void);

    assert.match(decodeURIComponent(String(r.headers.location)), /\/login\?erro=/);
    assert.equal(await prisma.sessoes.count({ where: { perfil_id: perfil.id } }), 0,
      'token forjado não abre sessão');
  });
});
