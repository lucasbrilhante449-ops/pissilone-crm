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
  adicionarItemPedido, agendarAtividade, ajustarPrecosCamisetas, buscarProdutosNuvemshop, cadastrarCliente, concluirAtividade,
  consultarCatalogo, criarCard, diagnosticoProdutoNuvemshop, darGanho, darPerda, localizarOuCriarCatalogo, moverCard,
  registrarNota, sincronizarEstoqueNuvemshop, sincronizarTudoNuvemshop, unificarDuplicadasNuvemshop, verificarEstoque, vincularEstampaNuvemshop, webhookNuvemshopPedido, webhookNuvemshopProduto,
} from './routes.ts'

const ROTAS: Record<string, (supabase: ReturnType<typeof getSupabase>, body: any) => Promise<unknown>> = {
  '/criar-card': criarCard,
  '/cadastrar-cliente': cadastrarCliente,
  '/estoque': verificarEstoque,
  '/catalogo/localizar-ou-criar': localizarOuCriarCatalogo,
  '/catalogo/consultar': consultarCatalogo,
  '/adicionar-item-pedido': adicionarItemPedido,
  '/dar-ganho': darGanho,
  '/dar-perda': darPerda,
  '/mover-card': moverCard,
  '/atividade/agendar': agendarAtividade,
  '/atividade/concluir': concluirAtividade,
  '/registrar-nota': registrarNota,
}

// Rotas chamadas por um webhook externo (não pelo agente de IA via aa.app.br),
// que não manda o header Authorization com AGENT_API_TOKEN. Autenticadas por um
// token próprio na query string da URL do webhook (NS_WEBHOOK_TOKEN) em vez disso
// — a Nuvemshop não permite configurar headers customizados ao cadastrar um
// webhook, só a URL de destino.
const ROTAS_WEBHOOK: Record<string, (supabase: ReturnType<typeof getSupabase>, body: any) => Promise<unknown>> = {
  '/webhook-nuvemshop-pedido': webhookNuvemshopPedido,
  '/webhook-nuvemshop-produto': webhookNuvemshopProduto,
}

// Rotas chamadas pelo PRÓPRIO navegador do CRM (usuário já logado via Supabase
// Auth), não pelo agente de IA nem por um webhook externo — autenticadas pelo
// token de sessão do usuário (o mesmo que o navegador já usa pra falar com o
// Supabase direto), validado aqui contra o Auth do projeto.
const ROTAS_USUARIO: Record<string, (supabase: ReturnType<typeof getSupabase>, body: any) => Promise<unknown>> = {
  '/estoque/sincronizar-nuvemshop': sincronizarEstoqueNuvemshop,
  '/estoque/sincronizar-tudo-nuvemshop': sincronizarTudoNuvemshop,
  '/catalogo/buscar-produtos-nuvemshop': buscarProdutosNuvemshop,
  '/catalogo/vincular-estampa': vincularEstampaNuvemshop,
  '/nuvemshop/unificar-duplicadas': unificarDuplicadasNuvemshop,
  '/nuvemshop/ajustar-precos-camisetas': ajustarPrecosCamisetas,
  '/nuvemshop/diagnostico-produto': diagnosticoProdutoNuvemshop,
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

  const url = new URL(req.url)
  const rota = resolveRota(url.pathname)

  const handlerWebhook = ROTAS_WEBHOOK[rota]
  if (handlerWebhook) {
    const webhookToken = Deno.env.get('NS_WEBHOOK_TOKEN') ?? ''
    const callerToken = url.searchParams.get('token') ?? ''
    if (!webhookToken || !callerToken || callerToken !== webhookToken) {
      return jsonResponse({ erro: 'Não autorizado.' }, 401)
    }
    try {
      const body = await req.json().catch(() => ({}))
      const resultado = await handlerWebhook(getSupabase(), body)
      return jsonResponse(resultado, 200)
    } catch (err) {
      if (err instanceof ApiError) return jsonResponse({ erro: err.message }, err.status)
      console.error(err)
      const message = err instanceof Error ? err.message : 'Erro interno desconhecido.'
      return jsonResponse({ erro: message }, 500)
    }
  }

  const handlerUsuario = ROTAS_USUARIO[rota]
  if (handlerUsuario) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!jwt) return jsonResponse({ erro: 'Não autorizado.' }, 401)
    const supabase = getSupabase()
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
    if (userErr || !userData?.user) return jsonResponse({ erro: 'Não autorizado.' }, 401)
    try {
      const body = await req.json().catch(() => ({}))
      const resultado = await handlerUsuario(supabase, body)
      return jsonResponse(resultado, 200)
    } catch (err) {
      if (err instanceof ApiError) return jsonResponse({ erro: err.message }, err.status)
      console.error(err)
      const message = err instanceof Error ? err.message : 'Erro interno desconhecido.'
      return jsonResponse({ erro: message }, 500)
    }
  }

  const agentToken = Deno.env.get('AGENT_API_TOKEN') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!agentToken || !callerToken || callerToken !== agentToken) {
    return jsonResponse({ erro: 'Não autorizado.' }, 401)
  }

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
