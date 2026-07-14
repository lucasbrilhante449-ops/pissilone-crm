// Edge Function do PSN CRM: ponte HTTP pro agente de IA do WhatsApp (aa.app.br)
// ler/escrever dados do CRM durante a conversa. Ver pissilone-crm-claude-code.md
// (seção "Agente de IA") pro contrato de cada rota e o checklist de deploy.
//
// Autenticação: token estático próprio (AGENT_API_TOKEN), não login Supabase —
// o agente não tem sessão de usuário, então usamos service_role internamente
// depois de validar esse token (mesmo padrão de duas etapas de manage-access/index.ts,
// só que aqui o "chamador" nunca é um usuário Supabase real).
//
// Deploy exige --no-verify-jwt (senão o gateway do Supabase tenta validar o
// header Authorization como um JWT dele mesmo antes de chegar aqui).

import { ApiError, corsHeaders, getSupabase, jsonResponse } from './lib.ts'
import {
  adicionarItemPedido, agendarAtividade, cadastrarCliente, concluirAtividade,
  criarCard, darGanho, darPerda, localizarOuCriarCatalogo, moverCard, verificarEstoque,
} from './routes.ts'

const ROTAS: Record<string, (supabase: ReturnType<typeof getSupabase>, body: any) => Promise<unknown>> = {
  '/criar-card': criarCard,
  '/cadastrar-cliente': cadastrarCliente,
  '/estoque': verificarEstoque,
  '/catalogo/localizar-ou-criar': localizarOuCriarCatalogo,
  '/adicionar-item-pedido': adicionarItemPedido,
  '/dar-ganho': darGanho,
  '/dar-perda': darPerda,
  '/mover-card': moverCard,
  '/atividade/agendar': agendarAtividade,
  '/atividade/concluir': concluirAtividade,
}

function resolveRota(pathname: string): string {
  const partes = pathname.split('/').filter(Boolean)
  const idx = partes.indexOf('pissilone-agent')
  const resto = idx >= 0 ? partes.slice(idx + 1) : partes
  return '/' + resto.join('/')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ erro: 'Método não permitido.' }, 405)

  const agentToken = Deno.env.get('AGENT_API_TOKEN') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!agentToken || !callerToken || callerToken !== agentToken) {
    return jsonResponse({ erro: 'Não autorizado.' }, 401)
  }

  const rota = resolveRota(new URL(req.url).pathname)
  const handler = ROTAS[rota]
  if (!handler) return jsonResponse({ erro: `Rota desconhecida: ${rota}` }, 404)

  try {
    const body = await req.json().catch(() => ({}))
    const resultado = await handler(getSupabase(), body)
    return jsonResponse(resultado, 200)
  } catch (err) {
    if (err instanceof ApiError) return jsonResponse({ erro: err.message }, err.status)
    console.error(err)
    const message = err instanceof Error ? err.message : 'Erro interno desconhecido.'
    return jsonResponse({ erro: message }, 500)
  }
})
