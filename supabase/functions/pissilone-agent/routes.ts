import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  ApiError, Contato, ItemPedido,
  acharEtapaPorNome, apiSaveContato, catalogoAcharOuCriar, catalogoEstampaVincularProduto, criarEncomendasDoGanho,
  duplicarParaPissifaAuto, enviarImagemWhatsapp, findContatoByTel, getFunil, hojeISO, loadCfg,
  logAction, moverEstoquePedido, normDate, normDateAgente, normTel, normTelBR, novoContato,
  nsFetch, nuvemshopPedidoJaProcessado, parseNegHist, parseValorBR,
  registrarParticipacao, rowToContato,
} from './lib.ts'

function reqStr(body: any, campo: string): string {
  const v = body?.[campo]
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new ApiError(400, `Campo obrigatório: ${campo}.`)
  }
  return String(v).trim()
}

// Acha o contato existente pelo telefone; se não existir, cria na hora (funil D2C,
// 1ª etapa) em vez de falhar com 404. Antes essa rota exigia que /criar-card tivesse
// "pego" primeiro — mas se o telefone chegar em formato levemente diferente entre
// chamadas (ex: com/sem o 9º dígito), o lookup por sufixo pode não bater mesmo com o
// card já existindo, e a venda simplesmente sumia (nunca virava "ganho"). Tolerar/upsert
// aqui garante que a ação do agente nunca se perde — o preço é que, se isso realmente
// acontecer, nasce um card novo "Cliente" em vez de cair no card certo (por isso loga
// com a origem, pra dar pra rastrear quando isso acontece e investigar a causa real).
async function exigirContato(supabase: SupabaseClient, telefone: string, origem: string, overrides: Partial<Contato> = {}): Promise<Contato> {
  const row = await findContatoByTel(supabase, telefone)
  if (row) return rowToContato(row)

  const cfg = await loadCfg(supabase)
  const d2c = getFunil(cfg, 'd2c')
  const etapaId = d2c?.etapas?.[0]?.id
  if (!etapaId) throw new ApiError(500, 'Funil D2C sem etapas configuradas.')

  const novo = novoContato({ nome: 'Cliente', tel: telefone, funil: 'd2c', etapa: etapaId, ...overrides })
  await apiSaveContato(supabase, novo)
  await logAction(supabase, 'contato_criado', `${novo.nome} (auto-criado via ${origem}, tel ${telefone})`)
  return novo
}

// ── /criar-card ──────────────────────────────────────────
export async function criarCard(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const nome = reqStr(body, 'nome')
  const canal = (body?.canal ? String(body.canal).trim() : '') || 'whatsapp'

  const existente = await findContatoByTel(supabase, telefone)
  if (existente) {
    return { ok: true, criado: false, id: existente.id, funil: existente.funil, etapa: existente.etapa }
  }

  const cfg = await loadCfg(supabase)
  const d2c = getFunil(cfg, 'd2c')
  const etapaId = d2c?.etapas?.[0]?.id
  if (!etapaId) throw new ApiError(500, 'Funil D2C sem etapas configuradas.')

  const novo = novoContato({ nome, tel: telefone, canal, funil: 'd2c', etapa: etapaId })
  await apiSaveContato(supabase, novo)
  await logAction(supabase, 'contato_criado', nome)
  return { ok: true, criado: true, id: novo.id, funil: novo.funil, etapa: novo.etapa }
}

// ── /cadastrar-cliente ───────────────────────────────────
export async function cadastrarCliente(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const existente = await findContatoByTel(supabase, telefone)

  let c: Contato
  let criado = false
  if (existente) {
    c = rowToContato(existente)
  } else {
    const cfg = await loadCfg(supabase)
    const d2c = getFunil(cfg, 'd2c')
    const etapaId = d2c?.etapas?.[0]?.id
    if (!etapaId) throw new ApiError(500, 'Funil D2C sem etapas configuradas.')
    c = novoContato({ nome: body?.nome ? String(body.nome).trim() : 'Cliente', tel: telefone, funil: 'd2c', etapa: etapaId })
    criado = true
  }

  if (body?.nome) c.nome = String(body.nome).trim()
  if (body?.email) c.email = String(body.email).trim()
  if (body?.cpf) c.cpf = String(body.cpf).trim()
  if (body?.aniversario) c.aniversario = normDateAgente(body.aniversario, 'aniversario')
  if (body?.endereco) c.endereco = String(body.endereco).trim()
  if (body?.cidade) c.cidade = String(body.cidade).trim()
  if (body?.uf) c.uf = String(body.uf).trim().toUpperCase()
  if (body?.cep) c.cep = String(body.cep).trim()
  if (body?.cod_marketup) c.cod_marketup = String(body.cod_marketup).trim()

  await apiSaveContato(supabase, c)
  await logAction(supabase, criado ? 'contato_criado' : 'contato_editado', c.nome)
  return { ok: true, id: c.id, criado }
}

// ── /estoque ─────────────────────────────────────────────
export async function verificarEstoque(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const tamanho = reqStr(body, 'tamanho')
  const produto = (body?.produto ? String(body.produto).trim() : '') || 'Camiseta'

  const { data: cores, error: coresErr } = await supabase.from('catalogo').select('nome,foto_url').eq('tipo', 'cor').order('nome', { ascending: true })
  if (coresErr) throw new ApiError(500, 'Erro ao ler catálogo de cores: ' + coresErr.message)

  const { data: estoqueRows, error: estErr } = await supabase.from('estoque').select('cor,quantidade').eq('produto', produto).eq('tamanho', tamanho)
  if (estErr) throw new ApiError(500, 'Erro ao ler estoque: ' + estErr.message)

  const qtdPorCor = new Map<string, number>()
  for (const r of estoqueRows || []) qtdPorCor.set(r.cor, parseInt(r.quantidade) || 0)

  const disponiveis = (cores || [])
    .map((cor: any) => ({ cor: cor.nome, foto_url: cor.foto_url || '', quantidade: qtdPorCor.get(cor.nome) || 0 }))
    .filter((c: any) => c.quantidade > 0)

  const resultado: { cor: string; quantidade: number; foto_enviada: boolean }[] = []
  for (const item of disponiveis) {
    let fotoEnviada = false
    if (item.foto_url) {
      fotoEnviada = await enviarImagemWhatsapp(telefone, item.foto_url, `${item.cor} — tamanho ${tamanho} disponível`)
    }
    resultado.push({ cor: item.cor, quantidade: item.quantidade, foto_enviada: fotoEnviada })
  }

  return { ok: true, produto, tamanho, cores: resultado }
}

// ── /adicionar-item-pedido ───────────────────────────────
export async function adicionarItemPedido(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const produto = reqStr(body, 'produto')
  const estampa = body?.estampa ? String(body.estampa).trim() : ''
  const cor = body?.cor ? String(body.cor).trim() : ''
  const tamanho = body?.tamanho ? String(body.tamanho).trim() : ''
  const qty = parseInt(body?.qty) || 1

  // Limpa itens de um carrinho abandonado (>6h) antes de somar um novo, pra
  // não misturar um pedido velho esquecido com uma compra nova.
  const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  await supabase.from('pedido_agente_pendente').delete().eq('telefone', telefone).lt('criado_em', seisHorasAtras)

  const { error: insErr } = await supabase.from('pedido_agente_pendente').insert({ telefone, produto, estampa, cor, tamanho, qty })
  if (insErr) throw new ApiError(500, 'Erro ao adicionar item: ' + insErr.message)

  const { data: itens } = await supabase.from('pedido_agente_pendente').select('produto,estampa,cor,tamanho,qty').eq('telefone', telefone).order('criado_em', { ascending: true })
  return { ok: true, itens: itens || [] }
}

async function lerCarrinho(supabase: SupabaseClient, telefone: string): Promise<ItemPedido[]> {
  const { data } = await supabase.from('pedido_agente_pendente').select('produto,estampa,cor,tamanho,qty').eq('telefone', normTel(telefone)).order('criado_em', { ascending: true })
  return (data || []).map((r: any) => ({ produto: r.produto, estampa: r.estampa, cor: r.cor, tamanho: r.tamanho, qty: parseInt(r.qty) || 1 }))
}
async function limparCarrinho(supabase: SupabaseClient, telefone: string): Promise<void> {
  await supabase.from('pedido_agente_pendente').delete().eq('telefone', normTel(telefone))
}

// ── /catalogo/localizar-ou-criar ─────────────────────────
// Espelha catSelAddNew() do navegador: acha um item do catálogo por tipo+nome
// (case-insensitive) e, se não existir, cria um item "bare" (sem categoria/
// tem_variacao — quem quiser categorizar ajusta depois na aba Catálogo).
// Existe pra o agente nunca vender um item de nome livre que não bate com
// nada no catálogo (isso quebrava os Insights: a venda entrava, mas o
// produto/estampa não aparecia em nenhum relatório por não estar cadastrado).
export async function localizarOuCriarCatalogo(supabase: SupabaseClient, body: any) {
  const tipo = reqStr(body, 'tipo').toLowerCase()
  if (!['produto', 'estampa', 'cor', 'tamanho'].includes(tipo)) {
    throw new ApiError(400, `Campo "tipo" inválido: "${tipo}". Use produto, estampa, cor ou tamanho.`)
  }
  const nome = reqStr(body, 'nome')

  const { data: existentes, error: selErr } = await supabase.from('catalogo').select('id,nome').eq('tipo', tipo)
  if (selErr) throw new ApiError(500, 'Erro ao consultar catálogo: ' + selErr.message)

  const nomeNorm = nome.trim().toLowerCase()
  const achado = (existentes || []).find((r: any) => String(r.nome || '').trim().toLowerCase() === nomeNorm)
  if (achado) {
    return { ok: true, criado: false, id: achado.id, tipo, nome: achado.nome }
  }

  const { data: novo, error: insErr } = await supabase.from('catalogo').insert({ tipo, nome: nome.trim() }).select('id,nome').single()
  if (insErr) throw new ApiError(500, 'Erro ao cadastrar item no catálogo: ' + insErr.message)

  await logAction(supabase, 'catalogo_item_criado_por_agente', `${tipo}: ${novo.nome}`)
  return { ok: true, criado: true, id: novo.id, tipo, nome: novo.nome }
}

// ── /catalogo/consultar ───────────────────────────────────
// Dá à Maria preço de produto e descrição/foto de estampa numa única
// chamada (evita configurar várias tools novas na aa.app.br). Espelha o
// padrão de /estoque (verificarEstoque acima): busca info + manda foto
// via enviarImagemWhatsapp quando aplicável, tudo no mesmo request.
// "encontrado:false"/"valor:null" voltam como sucesso (2xx), não erro —
// a Maria precisa cair no fallback de faixa de preço do prompt, não
// tratar como falha de ferramenta.
export async function consultarCatalogo(supabase: SupabaseClient, body: any) {
  const tipo = reqStr(body, 'tipo').toLowerCase()
  if (!['produto', 'estampa'].includes(tipo)) {
    throw new ApiError(400, `Campo "tipo" inválido: "${tipo}". Use produto ou estampa.`)
  }
  const nome = body?.nome ? String(body.nome).trim() : ''
  const telefone = body?.telefone ? normTelBR(String(body.telefone).trim()) : ''

  if (tipo === 'produto') {
    const { data, error } = await supabase.from('catalogo').select('nome,valor').eq('tipo', 'produto').order('nome', { ascending: true })
    if (error) throw new ApiError(500, 'Erro ao consultar catálogo: ' + error.message)
    const rows = data || []

    if (!nome) {
      return { ok: true, tipo: 'produto', produtos: rows.map((r: any) => ({ nome: r.nome, valor: r.valor !== null ? Number(r.valor) : null })) }
    }
    const nomeNorm = nome.toLowerCase()
    const achado = rows.find((r: any) => String(r.nome || '').trim().toLowerCase() === nomeNorm)
      || rows.find((r: any) => String(r.nome || '').toLowerCase().includes(nomeNorm))
    if (!achado) return { ok: true, tipo: 'produto', encontrado: false, nome }
    return { ok: true, tipo: 'produto', encontrado: true, nome: achado.nome, valor: achado.valor !== null ? Number(achado.valor) : null }
  }

  // tipo === 'estampa'
  const { data, error } = await supabase.from('catalogo').select('nome,descricao,foto_url').eq('tipo', 'estampa').order('nome', { ascending: true })
  if (error) throw new ApiError(500, 'Erro ao consultar catálogo: ' + error.message)
  const rows = data || []

  if (!nome) {
    // Sem foto_url de propósito, pra não estourar o limite de ~8000 caracteres
    // de resposta da aa.app.br quando o catálogo de estampas crescer.
    return { ok: true, tipo: 'estampa', estampas: rows.map((r: any) => ({ nome: r.nome, descricao: r.descricao || '' })) }
  }
  const nomeNorm = nome.toLowerCase()
  const achado = rows.find((r: any) => String(r.nome || '').trim().toLowerCase() === nomeNorm)
    || rows.find((r: any) => String(r.nome || '').toLowerCase().includes(nomeNorm))
  if (!achado) return { ok: true, tipo: 'estampa', encontrado: false, nome }

  let fotoEnviada = false
  if (achado.foto_url && telefone) {
    fotoEnviada = await enviarImagemWhatsapp(telefone, achado.foto_url, achado.nome)
  }
  return { ok: true, tipo: 'estampa', encontrado: true, nome: achado.nome, descricao: achado.descricao || '', foto_enviada: fotoEnviada }
}

// ── /dar-ganho ───────────────────────────────────────────
export async function darGanho(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const formaPagamento = reqStr(body, 'forma_pagamento')
  const valor = parseValorBR(body?.valor)
  if (isNaN(valor) || valor <= 0) throw new ApiError(400, 'Campo obrigatório: valor (maior que zero).')

  const c = await exigirContato(supabase, telefone, '/dar-ganho')
  const itensGanho = await lerCarrinho(supabase, telefone)
  if (!itensGanho.length) throw new ApiError(400, 'Nenhum item no pedido. Chame /adicionar-item-pedido antes de dar ganho.')

  const hist = parseNegHist(c)
  const ganhosAnt = hist.filter((h: any) => h.r === 'ganho')
  const isSegundoGanhoD2c = ganhosAnt.length === 1 && c.funil === 'd2c'
  const dataGanho = normDateAgente(body?.data, 'data') || hojeISO()
  const vendaId = c.id + '_' + Date.now()

  hist.push({ r: 'ganho', d: dataGanho, m: '', v: valor, itens: itensGanho, nf: false, fp: formaPagamento, venda_id: vendaId })
  c.neg_hist = JSON.stringify(hist)
  c.valor = valor; c.et = 'fechado'; c.motivo_perda = ''; c.resultado = ''

  const cfg = await loadCfg(supabase)
  if (c.funil === 'pissifa') {
    c.etapa = 'psf-ativo'
  } else if (c.funil === 'd2c') {
    c.etapa = 'd2c-cn'
  } else if (c.funil === 'servicos') {
    const etapaInscrito = acharEtapaPorNome(getFunil(cfg, 'servicos'), (n) => n.includes('inscrito'))
    if (etapaInscrito) c.etapa = etapaInscrito.id
    registrarParticipacao(c, 'inscrito')
  }

  await apiSaveContato(supabase, c)
  await moverEstoquePedido(supabase, itensGanho, -1)
  await criarEncomendasDoGanho(supabase, c.id, c.nome, itensGanho, dataGanho, vendaId)
  await logAction(supabase, 'ganho_confirmado', c.nome + (valor ? ' - R$' + valor : ''))
  if (isSegundoGanhoD2c) await duplicarParaPissifaAuto(supabase, cfg, c)
  await limparCarrinho(supabase, telefone)

  return { ok: true, id: c.id, funil: c.funil, etapa: c.etapa, venda_id: vendaId, itens: itensGanho }
}

// ── /dar-perda ───────────────────────────────────────────
export async function darPerda(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const motivo = (body?.motivo ? String(body.motivo).trim() : '') || 'Não informado'

  const c = await exigirContato(supabase, telefone, '/dar-perda')
  const hist = parseNegHist(c)
  hist.push({ r: 'perda', d: hojeISO(), m: motivo })
  c.neg_hist = JSON.stringify(hist)
  c.motivo_perda = motivo; c.et = 'perdido'; c.resultado = 'perda'

  if (c.funil === 'pissifa') { c.etapa = 'psf-inativo'; c.resultado = '' }
  else if (c.funil === 'd2c') { c.etapa = 'd2c-cr'; c.resultado = '' }
  else if (c.funil === 'servicos') { registrarParticipacao(c, 'cancelado') }

  await apiSaveContato(supabase, c)
  await logAction(supabase, 'perda_confirmada', c.nome + ' - ' + motivo)
  await limparCarrinho(supabase, telefone)

  return { ok: true, id: c.id, funil: c.funil, etapa: c.etapa }
}

// ── /mover-card ──────────────────────────────────────────
export async function moverCard(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const etapaNome = reqStr(body, 'etapa_nome')

  const c = await exigirContato(supabase, telefone, '/mover-card')
  const cfg = await loadCfg(supabase)
  const funil = getFunil(cfg, c.funil)
  if (!funil) throw new ApiError(500, `Funil "${c.funil}" não encontrado na configuração.`)

  const nomeAlvo = etapaNome.toLowerCase()
  const etapa = funil.etapas.find((e) => e.nome.toLowerCase() === nomeAlvo) || funil.etapas.find((e) => e.nome.toLowerCase().includes(nomeAlvo))
  if (!etapa) {
    const disponiveis = funil.etapas.map((e) => e.nome).join(', ')
    throw new ApiError(400, `Etapa "${etapaNome}" não encontrada no funil ${funil.nome}. Etapas disponíveis: ${disponiveis}.`)
  }

  c.etapa = etapa.id
  c.et = 'atendimento'
  await apiSaveContato(supabase, c)
  return { ok: true, id: c.id, etapa: c.etapa, etapa_nome: etapa.nome }
}

// ── /atividade/agendar ───────────────────────────────────
export async function agendarAtividade(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const dataNorm = normDateAgente(reqStr(body, 'data'), 'data')
  if (!dataNorm) throw new ApiError(400, 'Data inválida. Use o formato AAAA-MM-DD.')
  const descricao = body?.descricao ? String(body.descricao).trim() : ''

  const c = await exigirContato(supabase, telefone, '/atividade/agendar')
  c.atv_data = dataNorm
  c.atv_desc = descricao
  if (!Array.isArray(c.log_hist)) c.log_hist = []
  c.log_hist.push({ tipo: 'atv_criada', d: new Date().toISOString(), txt: descricao || 'Atividade', data_agendada: dataNorm })

  await apiSaveContato(supabase, c)
  return { ok: true, id: c.id, atv_data: c.atv_data, atv_desc: c.atv_desc }
}

// ── /registrar-nota ───────────────────────────────────────
// Espelha saveDetNota() do navegador: sobrescreve o "resumo atual" em c.notas e
// empilha o texto na linha do tempo (log_hist, tipo 'nota') — mesmo padrão exibido
// na coluna central do modal de detalhe do contato (campo "Anotações").
export async function registrarNota(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const nota = reqStr(body, 'nota')

  const c = await exigirContato(supabase, telefone, '/registrar-nota')
  c.notas = nota
  if (!Array.isArray(c.log_hist)) c.log_hist = []
  c.log_hist.push({ tipo: 'nota', d: new Date().toISOString(), txt: nota })

  await apiSaveContato(supabase, c)
  return { ok: true, id: c.id }
}

// ── /webhook-nuvemshop-pedido ─────────────────────────────
// Chamada pela Nuvemshop quando um pedido do site é pago (evento "order/paid").
// O corpo do webhook só traz {store_id, event, id} — busca o pedido completo na
// API da Nuvemshop (nsFetch) e espelha o MESMO fluxo de /dar-ganho: acha/cria o
// contato pelo telefone, grava o ganho no neg_hist, desconta estoque, cria as
// encomendas (fila de produção) e replica pro Pissifã se for a 2ª compra.
//
// Formato validado contra um pedido real (GET /orders/{id} puro, não o formato
// "achatado" que o conector MCP devolve, que é diferente):
// - itens ficam em order.products (não order.items)
// - cada item.variant_values é um array de TEXTO por posição, ex: ["GG","Laranja"]
//   — sem nome dizendo qual é cor e qual é tamanho, e a ordem muda de produto pra
//   produto. Por isso cada valor é casado contra o catálogo de cores/tamanhos já
//   cadastrado, nunca por posição.
// - item.name_without_variants já vem sem o "(GG, Laranja)" no final — usa isso
//   em vez de tentar extrair o nome base na mão.
// - telefone/nome/email do cliente: order.customer.phone às vezes vem vazio
//   mesmo em pedido válido — o campo confiável é order.contact_phone (idem
//   contact_name/contact_email).
// - data: order.paid_at é texto ISO puro; order.completed_at é um OBJETO
//   ({date, timezone}), não texto — por isso prefere paid_at.
// - forma de pagamento: não existe order.payment_method_name; o campo real é
//   order.payment_details.method (credit_card/debit_card/ticket/...).

function nsText(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return String(v.pt || v.es || v.en || Object.values(v)[0] || '')
  return String(v)
}
function nsNumber(v: any): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'object') return parseFloat(v.amount) || 0
  return parseFloat(v) || 0
}
// completed_at/paid_at podem vir como texto ISO ou como {date, timezone, timezone_type}.
function nsData(v: any): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v.date) return String(v.date)
  return ''
}
function mapearFormaPagamento(order: any): string {
  const metodo = String(order?.payment_details?.method || '').toLowerCase()
  const gateway = String(order?.gateway_name || '').toLowerCase()
  if (metodo.includes('pix') || gateway.includes('pix')) return 'pix'
  if (metodo.includes('debit')) return 'debito'
  if (metodo.includes('credit')) return 'credito_vista'
  if (metodo === 'cash' || metodo.includes('efectivo')) return 'dinheiro'
  // boleto/ticket e gateways não reconhecidos ficam em branco — melhor vazio
  // (editável depois no CRM) do que rotular errado a forma de pagamento.
  return ''
}

// Normaliza pra comparar cor/tamanho tolerando acento e maiúscula/minúscula.
function normComparar(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
// Bate um valor vindo do pedido (ex: "Branco") contra um nome de cor do catálogo
// (ex: "Branca", ou composto "Coral / Laranja") tolerando: (1) nome composto —
// casa se QUALQUER parte separada por "/" bater; (2) variação de gênero da cor
// em português (branco/branca, preto/preta, vermelho/vermelha) — compara a
// "raiz" sem o -o/-a final. A Nuvemshop usa o masculino (concorda com "Produto"),
// o CRM usa o feminino (concorda com "Camiseta") — o mesmo texto nunca bate 100%.
function corBate(valorPedido: string, nomeCatalogo: string): boolean {
  const alvo = normComparar(valorPedido)
  const raizAlvo = alvo.replace(/[oa]$/, '')
  return String(nomeCatalogo).split('/').some((parte) => {
    const p = normComparar(parte)
    return p === alvo || p.replace(/[oa]$/, '') === raizAlvo
  })
}

async function mapearItensNuvemshop(supabase: SupabaseClient, order: any): Promise<ItemPedido[]> {
  const itensBrutos: any[] = order.products || order.items || []
  const { data: catalogo } = await supabase.from('catalogo').select('nome,tipo,tem_variacao')
  const produtosComVariacao = (catalogo || []).filter((c: any) => c.tipo === 'produto' && c.tem_variacao)
  const coresConhecidas = (catalogo || []).filter((c: any) => c.tipo === 'cor').map((c: any) => String(c.nome))
  const tamanhosConhecidos = (catalogo || []).filter((c: any) => c.tipo === 'tamanho').map((c: any) => String(c.nome))

  const resultado: ItemPedido[] = []
  for (const it of itensBrutos) {
    const nomeBase = (nsText(it.name_without_variants) || nsText(it.name)).trim()
    const qty = parseInt(it.quantity) || 1
    const valoresBrutos: any[] = it.variant_values || it.properties || []
    const valoresTexto = valoresBrutos.map((v) => nsText(v).trim()).filter(Boolean)

    // Classifica cada valor pelo CONTEÚDO (bate contra catálogo de cores/tamanhos
    // já cadastrado), nunca pela posição — a Nuvemshop não garante ordem fixa.
    // Guarda o nome do CATÁLOGO (não o valor cru do pedido), pra "estoque"/
    // "encomendas" usarem sempre a mesma grafia cadastrada no CRM.
    let cor = '', tamanho = ''
    for (const valor of valoresTexto) {
      if (!cor) { const m = coresConhecidas.find((c) => corBate(valor, c)); if (m) cor = m; }
      if (!tamanho) { const m = tamanhosConhecidos.find((t) => normComparar(t) === normComparar(valor)); if (m) tamanho = m; }
    }

    if (cor && tamanho) {
      const produtoBase = produtosComVariacao.find((p: any) => nomeBase.toLowerCase().startsWith(String(p.nome).toLowerCase()))
      const produto = produtoBase ? String(produtoBase.nome) : 'Camiseta'
      let estampa = produtoBase ? nomeBase.slice(String(produtoBase.nome).length).trim().replace(/^[-—:]\s*/, '') : nomeBase
      if (!estampa) estampa = nomeBase
      estampa = await catalogoAcharOuCriar(supabase, 'estampa', estampa)
      if (it.product_id) await catalogoEstampaVincularProduto(supabase, estampa, String(it.product_id))
      resultado.push({ produto, estampa, cor, tamanho, qty })
    } else {
      // Item simples (sem cor/tamanho, ex: caneca/chaveiro) — entra no pedido e no
      // valor total, mas não gera encomenda nem desconta estoque (mesma regra do
      // fluxo manual: só peça com cor+tamanho vai pra fila de produção).
      resultado.push({ produto: nomeBase, qty })
    }
  }
  return resultado
}

export async function webhookNuvemshopPedido(supabase: SupabaseClient, body: any) {
  const orderId = body?.id
  if (!orderId) throw new ApiError(400, 'Payload do webhook sem "id" de pedido.')

  if (await nuvemshopPedidoJaProcessado(supabase, orderId)) {
    return { ok: true, ja_processado: true }
  }

  const order = await nsFetch(`/orders/${orderId}`)
  if (order.payment_status !== 'paid') {
    return { ok: true, ignorado: `payment_status=${order.payment_status}` }
  }

  const telefoneBruto = nsText(order?.contact_phone) || nsText(order?.customer?.phone)
  if (!telefoneBruto) {
    console.error(`Pedido Nuvemshop ${orderId} pago sem telefone de cliente — não dá pra criar/achar card automaticamente.`)
    return { ok: false, erro: 'Pedido sem telefone de cliente.' }
  }
  const telefone = normTelBR(telefoneBruto)
  const cfg = await loadCfg(supabase)

  const c = await exigirContato(supabase, telefone, 'webhook Nuvemshop', {
    nome: nsText(order?.contact_name) || nsText(order?.customer?.name) || 'Cliente',
    canal: 'site',
    email: nsText(order?.contact_email) || nsText(order?.customer?.email),
    usuario: cfg.nuvemshop_responsavel_padrao || '',
  })

  const itensGanho = await mapearItensNuvemshop(supabase, order)
  const hist = parseNegHist(c)
  const ganhosAnt = hist.filter((h: any) => h.r === 'ganho')
  const isSegundoGanhoD2c = ganhosAnt.length === 1 && c.funil === 'd2c'
  const dataGanho = normDate(nsData(order.paid_at) || nsData(order.completed_at)) || hojeISO()
  const vendaId = c.id + '_' + Date.now()
  const valor = nsNumber(order.total)

  hist.push({
    r: 'ganho', d: dataGanho, m: '', v: valor, itens: itensGanho, nf: false,
    fp: mapearFormaPagamento(order), venda_id: vendaId,
    origem: 'nuvemshop', pedido_nuvemshop: String(orderId),
  })
  c.neg_hist = JSON.stringify(hist)
  c.valor = valor; c.et = 'fechado'; c.motivo_perda = ''; c.resultado = ''

  if (c.funil === 'pissifa') {
    c.etapa = 'psf-ativo'
  } else if (c.funil === 'd2c') {
    c.etapa = 'd2c-cn'
  } else if (c.funil === 'servicos') {
    const etapaInscrito = acharEtapaPorNome(getFunil(cfg, 'servicos'), (n) => n.includes('inscrito'))
    if (etapaInscrito) c.etapa = etapaInscrito.id
    registrarParticipacao(c, 'inscrito')
  }

  await apiSaveContato(supabase, c)
  await moverEstoquePedido(supabase, itensGanho, -1)
  await criarEncomendasDoGanho(supabase, c.id, c.nome, itensGanho, dataGanho, vendaId)
  await logAction(supabase, 'ganho_confirmado', `${c.nome} (venda no site, pedido #${orderId}) - R$${valor}`)
  if (isSegundoGanhoD2c) await duplicarParaPissifaAuto(supabase, cfg, c)

  // A Nuvemshop já desconta sozinha o estoque do produto que vendeu — mas o
  // "estoque único" promete o MESMO número em toda estampa vinculada daquela
  // cor/tamanho, então precisa reescrever nos outros produtos também. Roda
  // depois de salvar tudo (não trava o fluxo principal do pedido se falhar).
  for (const it of itensGanho) {
    if (!it.cor || !it.tamanho) continue
    try {
      const { data: estRow } = await supabase.from('estoque').select('quantidade').eq('produto', it.produto).eq('cor', it.cor).eq('tamanho', it.tamanho).maybeSingle()
      const novaQtd = estRow ? parseInt(estRow.quantidade) || 0 : 0
      await broadcastEstoqueNuvemshop(supabase, it.produto, it.cor, it.tamanho, novaQtd)
    } catch (err) {
      console.error(`broadcast de estoque pós-venda do site falhou (${it.produto}/${it.cor}/${it.tamanho}):`, err)
    }
  }

  return { ok: true, id: c.id, funil: c.funil, etapa: c.etapa, venda_id: vendaId, itens: itensGanho.length }
}

// ── ESTOQUE COMPARTILHADO (broadcast pra todos os produtos vinculados) ───
// A Nuvemshop guarda estoque por produto, sem noção de "pool compartilhado" —
// por isso toda vez que o estoque de peça lisa (produto+cor+tamanho) muda no
// CRM, reescreve o MESMO número absoluto em CADA produto vinculado que tem
// essa cor/tamanho. Sempre absoluto (nunca delta por produto): se um produto
// ficar dessincronizado por qualquer motivo, a próxima chamada já corrige.
async function acharVariantId(produtoId: string, cor: string, tamanho: string): Promise<number | null> {
  const produto = await nsFetch(`/products/${produtoId}?fields=id,variants`)
  const variantes: any[] = produto?.variants || []
  for (const v of variantes) {
    const valores: string[] = (v.values || []).map((x: any) => nsText(x))
    const temCor = valores.some((val: string) => corBate(val, cor))
    const temTamanho = valores.some((val: string) => normComparar(val) === normComparar(tamanho))
    if (temCor && temTamanho) return v.id
  }
  return null
}

export async function broadcastEstoqueNuvemshop(supabase: SupabaseClient, produto: string, cor: string, tamanho: string, quantidade: number): Promise<{ ok: number; falhou: number; detalhes: string[] }> {
  const { data: estampas } = await supabase.from('catalogo').select('nome,nuvemshop_produto_ids').eq('tipo', 'estampa').not('nuvemshop_produto_ids', 'is', null)
  let ok = 0, falhou = 0
  const detalhes: string[] = []
  const idsVistos = new Set<string>()
  for (const e of estampas || []) {
    let ids: string[] = []
    try { ids = JSON.parse(e.nuvemshop_produto_ids || '[]') } catch (_err) { continue }
    for (const produtoId of ids) {
      if (idsVistos.has(produtoId)) continue // mesmo produto vinculado 2x por engano não chama 2x
      idsVistos.add(produtoId)
      try {
        const variantId = await acharVariantId(produtoId, cor, tamanho)
        if (!variantId) { falhou++; detalhes.push(`${e.nome} (produto ${produtoId}): sem variação ${cor}/${tamanho}`); continue }
        await nsFetch(`/products/${produtoId}/variants/${variantId}`, 'PUT', { stock_management: true, stock: quantidade })
        ok++
      } catch (err) {
        falhou++
        detalhes.push(`${e.nome} (produto ${produtoId}): ${err instanceof Error ? err.message : 'erro'}`)
      }
    }
  }
  return { ok, falhou, detalhes }
}

// ── /estoque/sincronizar-nuvemshop ────────────────────────
// Chamada pelo PRÓPRIO navegador do CRM (usuário logado, não o agente de IA)
// sempre que o estoque de peça lisa muda por ação manual: célula editada na
// grade de Estoque, ou Ganho/reabertura/edição de card. Ver broadcastEstoqueNuvemshop.
export async function sincronizarEstoqueNuvemshop(supabase: SupabaseClient, body: any) {
  const produto = reqStr(body, 'produto')
  const cor = reqStr(body, 'cor')
  const tamanho = reqStr(body, 'tamanho')
  const quantidade = parseInt(body?.quantidade)
  if (isNaN(quantidade) || quantidade < 0) throw new ApiError(400, 'Campo "quantidade" inválido (precisa ser 0 ou maior).')
  const resultado = await broadcastEstoqueNuvemshop(supabase, produto, cor, tamanho, quantidade)
  return { ok: true, ...resultado }
}

// ── /atividade/concluir ──────────────────────────────────
export async function concluirAtividade(supabase: SupabaseClient, body: any) {
  const telefone = normTelBR(reqStr(body, 'telefone'))
  const c = await exigirContato(supabase, telefone, '/atividade/concluir')
  if (!c.atv_data) throw new ApiError(400, 'Não há atividade agendada pra concluir.')

  const descAtv = c.atv_desc || ''
  if (!Array.isArray(c.log_hist)) c.log_hist = []
  c.log_hist.push({ tipo: 'atv_concluida', d: new Date().toISOString(), txt: descAtv || 'Atividade' })
  c.atv_hist = (c.atv_hist || 0) + 1
  c.atv_data = ''; c.atv_desc = ''

  await apiSaveContato(supabase, c)
  await logAction(supabase, 'atividade_concluida', (c.nome || telefone) + (descAtv ? ' - ' + descAtv : ''))
  return { ok: true, id: c.id }
}
