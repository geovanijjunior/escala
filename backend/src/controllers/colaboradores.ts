import type { FastifyReply, FastifyRequest } from 'fastify';
import * as servico from '../services/colaboradores.ts';
import { filtrosDaLista } from '../schemas/colaboradores.ts';

/** Entrada e saída das requisições de colaboradores. Nenhuma regra mora aqui. */
export const listar = async (req: FastifyRequest, resp: FastifyReply) => {
  try {
    const filtros = filtrosDaLista(req.query);
    return await servico.listarParaSessao(req.sessao!, filtros);
  } catch (e) {
    if (e instanceof servico.SemArea) return resp.code(403).send({ erro: e.message });
    throw e;
  }
};

export const resumo = async (req: FastifyRequest, resp: FastifyReply) => {
  try {
    return await servico.resumoParaSessao(req.sessao!);
  } catch (e) {
    if (e instanceof servico.SemArea) return resp.code(403).send({ erro: e.message });
    throw e;
  }
};
