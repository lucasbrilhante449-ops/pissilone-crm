import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Helpers desta Edge Function replicam (em TypeScript) as mesmas regras de
// negócio que já existem em index-github.html (navegador). É duplicação
// deliberada — ver pissilone-crm-claude-code.md, seção "Agente de IA", para
// o motivo e o lembrete de manter os dois lados em sincronia quando uma
// regra mudar (ex: como funciona ganho/perda/roteamento de etapa).

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getSupabase(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ── DATA / TELEFONE (replicam hojeISO/normDate/addDiasUteis/marcarDuplicados de index-github.html) ──

export function hojeISO(): string {
  const h = new Date()
  return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0')
}

export function normDate(d: unknown): string {
  if (!d || String(d).trim() === '') return ''
  const s = String(d)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [dd, mm, yyyy] = s.split('/'); return `${yyyy}-${mm}-${dd}` }
  const dt = new Date(s)
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10)
  return ''
}

// Datas que chegam do agente de IA (LLM) precisam ser SEMPRE AAAA-MM-DD (ISO), nunca
// "DD/MM/AAAA" nem "MM/DD/AAAA" — um LLM pode escrever a data no padrão americano
// (mês/dia), e como normDate() assume DD/MM quando vê barras, isso vira uma data
// errada de forma silenciosa (ex: "07/12/2026" pensado como 12 de julho vira 7 de
// dezembro). ISO não tem essa ambiguidade, então é a única forma aceita aqui — se vier
// fora do padrão, erra alto (ApiError) em vez de adivinhar e salvar a data errada.
export function normDateAgente(d: unknown, campo: string): string {
  if (d === undefined || d === null || String(d).trim() === '') return ''
  const s = String(d).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10)
  throw new ApiError(400, `Campo "${campo}" com data inválida: "${s}". Use sempre o formato AAAA-MM-DD (ex: ${hojeISO()}).`)
}

export function addDiasUteis(isoDate: string, dias: number): string {
  const d = new Date((isoDate || hojeISO()) + 'T12:00:00')
  let add = 0
  while (add < dias) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) add++
  }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// Aceita tanto "150.00" quanto "150,00"/"1.500,00" (a IA pode escrever no formato BR).
// Só trata "." como separador de milhar quando há vírgula decimal — senão "150.00" viraria 15000.
export function parseValorBR(v: unknown): number {
  if (v === undefined || v === null) return NaN
  let s = String(v).trim()
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return parseFloat(s)
}

export function normTel(s: unknown): string {
  return String(s || '').replace(/\D/g, '')
}

// {{contact_phone}} às vezes chega sem o 9º dígito de celular brasileiro
// (55 + DDD + 8 dígitos, 12 no total, em vez de 55 + DDD + 9 + 8 dígitos, 13 no
// total) — depende de como o número foi registrado no WhatsApp. Como todo
// contato daqui é atendido por WhatsApp (não linha fixa), é seguro assumir que
// um número de 12 dígitos com DDI 55 é um celular faltando o 9, e completar
// antes de salvar — senão esse contato nunca mais casa por telSuffixMatch()
// com o mesmo número já formatado certo (o deslocamento de 1 dígito quebra o
// comparador de sufixo).
export function normTelBR(s: unknown): string {
  const digits = normTel(s)
  if (digits.length === 12 && digits.startsWith('55')) {
    return digits.slice(0, 4) + '9' + digits.slice(4)
  }
  return digits
}

// Compara telefone normalizado pelos últimos N dígitos (não igualdade exata),
// porque {{contact_phone}} sempre vem com código de país (55...) e o `tel`
// salvo no CRM geralmente não tem — igual ao raciocínio de marcarDuplicados()
// em index-github.html, só que por sufixo em vez de igualdade total.
export function telSuffixMatch(a: unknown, b: unknown): boolean {
  const na = normTel(a), nb = normTel(b)
  if (!na || !nb) return false
  const len = Math.min(na.length, nb.length, 11)
  if (len < 8) return false // muito curto pra considerar confiável
  return na.slice(-len) === nb.slice(-len)
}

export function parseNegHist(c: { neg_hist?: string }): any[] {
  try { if (c.neg_hist && c.neg_hist !== '') return JSON.parse(c.neg_hist) } catch (_e) { /* ignore */ }
  return []
}

// ── CONFIG (funis/etapas/usuarios) — replicam loadCfg()/getFunil()/getEtapa() ──

export interface Etapa { id: string; nome: string }
export interface Funil { id: string; nome: string; etapas: Etapa[] }
export interface Cfg { funis: Funil[]; usuarios: { id: string; nome: string }[]; campos_personalizados: any[] }

export async function loadCfg(supabase: SupabaseClient): Promise<Cfg> {
  const { data, error } = await supabase.from('config').select('dados').eq('id', 1).maybeSingle()
  if (error || !data?.dados) throw new ApiError(500, 'Não consegui carregar a configuração do CRM (funis/etapas).')
  const cfg = JSON.parse(data.dados)
  if (!cfg?.funis?.length) throw new ApiError(500, 'Configuração do CRM sem funis.')
  if (!cfg.campos_personalizados) cfg.campos_personalizados = []
  return cfg
}

export function getFunil(cfg: Cfg, id: string): Funil | undefined {
  return cfg.funis.find((f) => f.id === id)
}
export function getEtapa(cfg: Cfg, fid: string, eid: string): Etapa | undefined {
  return getFunil(cfg, fid)?.etapas.find((e) => e.id === eid)
}
// Acha uma etapa pelo NOME (case-insensitive, substring) dentro de um funil —
// nunca por id fixo, pelo mesmo motivo de acharEtapaServicosPorNome() no
// navegador: o usuário renomeia etapas livremente na aba Config.
export function acharEtapaPorNome(funil: Funil | undefined, matcher: (nomeLower: string) => boolean): Etapa | undefined {
  return funil?.etapas.find((e) => matcher(e.nome.toLowerCase()))
}

// ── CONTATO (replicam a forma exata de apiSave()/doSync() de index-github.html) ──

export interface Contato {
  id: string; nome: string; tel: string; et: string; canal: string
  valor: number; produto: string; obs: string; data: string; compras: number
  funil: string; etapa: string; usuario: string
  followup: string; motivo_perda: string; atv_data: string; atv_desc: string
  resultado: string; atv_hist: number; neg_hist: string
  aniversario: string; cod_marketup: string; nf_emitida: boolean
  email: string; cpf: string; endereco: string; notas: string; log_hist: any[]
  cidade: string; uf: string; cep: string; nps: number | null
  campos: Record<string, any>; oficinas_hist: any[]; oficina_atual: string
}

export function novoContato(overrides: Partial<Contato>): Contato {
  return {
    id: String(Date.now()), nome: '', tel: '', et: 'atendimento', canal: 'whatsapp',
    valor: 0, produto: '', obs: '', data: new Date().toISOString(), compras: 0,
    funil: 'd2c', etapa: '', usuario: '',
    followup: '', motivo_perda: '', atv_data: '', atv_desc: '',
    resultado: '', atv_hist: 0, neg_hist: '',
    aniversario: '', cod_marketup: '', nf_emitida: false,
    email: '', cpf: '', endereco: '', notas: '', log_hist: [],
    cidade: '', uf: '', cep: '', nps: null,
    campos: {}, oficinas_hist: [], oficina_atual: '',
    ...overrides,
  }
}

// Espelha doSync(): desserializa uma linha crua da tabela `contatos` (com `meta` em JSON)
// pro formato em memória usado por todas as rotas.
export function rowToContato(row: any): Contato {
  let meta: any = {}
  try { meta = JSON.parse(row.meta || '{}') } catch (_e) { /* ignore */ }
  return {
    id: String(row.id || ''), nome: String(row.nome || ''), tel: String(row.tel || ''),
    et: String(row.et || ''), canal: String(row.canal || 'outro'),
    valor: parseFloat(row.valor) || 0, produto: String(row.produto || ''),
    obs: String(row.obs || ''), data: String(row.data || new Date().toISOString()),
    compras: parseInt(row.compras) || 0, funil: String(row.funil || 'd2c'),
    etapa: String(row.etapa || 'd2c-bv'), usuario: String(row.usuario || ''),
    followup: normDate(row.followup),
    motivo_perda: String(row.motivo_perda || ''),
    atv_data: normDate(row.atv_data),
    atv_desc: String(row.atv_desc || ''),
    resultado: String(row.resultado || ''), atv_hist: parseInt(row.atv_hist) || 0,
    neg_hist: String(row.neg_hist || ''),
    email: String(meta.email || ''), cpf: String(meta.cpf || ''),
    endereco: String(meta.endereco || ''), notas: String(meta.notas || ''),
    log_hist: Array.isArray(meta.log_hist) ? meta.log_hist : [],
    cidade: String(meta.cidade || ''), uf: String(meta.uf || ''), cep: String(meta.cep || ''),
    aniversario: normDate(row.aniversario),
    cod_marketup: String(row.cod_marketup || ''), nf_emitida: Boolean(row.nf_emitida) || false,
    nps: (meta.nps !== undefined && meta.nps !== null && meta.nps !== '') ? parseInt(meta.nps) : null,
    campos: (meta.campos && typeof meta.campos === 'object' && !Array.isArray(meta.campos)) ? meta.campos : {},
    oficinas_hist: Array.isArray(meta.oficinas_hist) ? meta.oficinas_hist : [],
    oficina_atual: String(meta.oficina_atual || ''),
  }
}

// Espelha apiSave(): serializa o objeto em memória de volta pro shape de linha da tabela `contatos`.
export async function apiSaveContato(supabase: SupabaseClient, c: Contato): Promise<void> {
  const row = {
    id: c.id, nome: c.nome, tel: c.tel, et: c.et, canal: c.canal,
    valor: c.valor, produto: c.produto, obs: c.obs, data: c.data, compras: c.compras,
    funil: c.funil, etapa: c.etapa, usuario: c.usuario, followup: c.followup || null,
    motivo_perda: c.motivo_perda || null, atv_data: c.atv_data || null,
    atv_desc: c.atv_desc || '', resultado: c.resultado || '',
    atv_hist: c.atv_hist || 0, neg_hist: c.neg_hist || '',
    aniversario: c.aniversario || null, cod_marketup: c.cod_marketup || '', nf_emitida: c.nf_emitida || false,
    meta: JSON.stringify({
      email: c.email || '', cpf: c.cpf || '', endereco: c.endereco || '', notas: c.notas || '',
      log_hist: c.log_hist || [], campos: c.campos || {}, cidade: c.cidade || '', uf: c.uf || '', cep: c.cep || '',
      nps: (c.nps != null) ? c.nps : null, oficinas_hist: c.oficinas_hist || [], oficina_atual: c.oficina_atual || '',
    }),
  }
  const { error } = await supabase.from('contatos').upsert(row)
  if (error) throw new ApiError(500, 'Erro ao salvar contato: ' + error.message)
}

// Acha o contato mais recente cujo telefone bate (qualquer funil) — não existe
// índice/id compartilhado com a plataforma do agente, então telefone é a
// única chave confiável entre chamadas.
export async function findContatoByTel(supabase: SupabaseClient, telefone: string): Promise<any | null> {
  const { data, error } = await supabase.from('contatos').select('*').order('data', { ascending: false })
  if (error || !data) return null
  return data.find((row: any) => telSuffixMatch(row.tel, telefone)) || null
}

export async function logAction(supabase: SupabaseClient, action: string, details: string): Promise<void> {
  try { await supabase.from('usage_log').insert({ action, details: details || '' }) } catch (_e) { /* fire-and-forget */ }
}

// ── ESTOQUE / ENCOMENDAS (replicam moverEstoquePedido()/criarEncomendasDoGanho()) ──

export async function ajustarEstoque(supabase: SupabaseClient, produto: string, cor: string, tamanho: string, delta: number): Promise<void> {
  if (!produto || !cor || !tamanho || !delta) return
  // RPC atômica (estoque_ajustar, ver supabase-migration-agente-ia.sql) em vez do padrão
  // ler-depois-escrever do navegador — aqui a corrida entre vendas simultâneas é real.
  const { error } = await supabase.rpc('estoque_ajustar', { p_produto: produto, p_cor: cor, p_tamanho: tamanho, p_delta: delta })
  if (error) console.error('ajustarEstoque error:', error.message)
}

export interface ItemPedido { produto: string; estampa?: string; cor?: string; tamanho?: string; qty: number }

export async function moverEstoquePedido(supabase: SupabaseClient, itens: ItemPedido[], sinal: 1 | -1): Promise<void> {
  for (const it of itens) {
    if (it?.cor && it?.tamanho) await ajustarEstoque(supabase, it.produto, it.cor, it.tamanho, sinal * (it.qty || 1))
  }
}

export async function criarEncomendasDoGanho(
  supabase: SupabaseClient, contatoId: string, contatoNome: string, itensGanho: ItemPedido[], dataGanho: string, vendaId: string,
): Promise<void> {
  const itensProducao = itensGanho.filter((it) => it?.cor && it?.tamanho)
  if (!itensProducao.length) return
  const rows = itensProducao.map((it) => ({
    contato_id: contatoId, contato_nome: contatoNome, venda_id: vendaId || '',
    produto: it.produto || '', estampa: it.estampa || '', cor: it.cor || '', tamanho: it.tamanho || '',
    qty: it.qty || 1, data_pedido: dataGanho, prazo: addDiasUteis(dataGanho, 2), entregue: false,
  }))
  const { error } = await supabase.from('encomendas').insert(rows)
  if (error) console.error('criarEncomendasDoGanho error:', error.message)
}

export function registrarParticipacao(c: Contato, status: string): void {
  if (!Array.isArray(c.oficinas_hist)) c.oficinas_hist = []
  c.oficinas_hist.push({ oficina: c.produto || '', data_inscricao: hojeISO(), status, data_oficina: '' })
}

// Espelha duplicarParaPissifaAuto(): 2º ganho D2C do mesmo telefone cria uma
// cópia no funil Pissifã, sem duplicar se já existir uma lá.
export async function duplicarParaPissifaAuto(supabase: SupabaseClient, cfg: Cfg, orig: Contato): Promise<void> {
  const funilPsf = getFunil(cfg, 'pissifa')
  if (!funilPsf || !funilPsf.etapas.length) return
  const { data } = await supabase.from('contatos').select('tel').eq('funil', 'pissifa')
  const jaExiste = orig.tel && (data || []).some((x: any) => telSuffixMatch(x.tel, orig.tel))
  if (jaExiste) return
  const novo = novoContato({
    id: String(Date.now()), nome: orig.nome, tel: orig.tel, et: 'atendimento', canal: orig.canal,
    valor: orig.valor, produto: orig.produto, obs: orig.obs, data: new Date().toISOString(), compras: orig.compras,
    funil: 'pissifa', etapa: funilPsf.etapas[0].id, usuario: orig.usuario,
    email: orig.email || '', cpf: orig.cpf || '', endereco: orig.endereco || '', aniversario: orig.aniversario || '',
    notas: orig.notas || '', cod_marketup: orig.cod_marketup || '',
  })
  await apiSaveContato(supabase, novo)
}

// ── ENVIO DE MENSAGEM (Parte 2 do doc de integração — aa.app.br) ──

export async function enviarImagemWhatsapp(numero: string, mediaUrl: string, legenda: string): Promise<boolean> {
  const token = Deno.env.get('AA_SEND_TOKEN') ?? ''
  const instanceName = Deno.env.get('AA_INSTANCE_NAME') ?? ''
  if (!token || !instanceName) { console.warn('AA_SEND_TOKEN/AA_INSTANCE_NAME não configurados — pulando envio de imagem.'); return false }
  try {
    const resp = await fetch('https://aa.app.br/api/v1/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName, number: numero, type: 'image', mediaUrl, message: legenda }),
    })
    return resp.ok
  } catch (e) {
    console.error('enviarImagemWhatsapp error:', e)
    return false
  }
}
