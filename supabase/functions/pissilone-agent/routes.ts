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
  // valor da estampa = preço de venda no site (espelhado por espelharProdutoNs):
  // a mesma camiseta lisa custa diferente conforme a estampa/acabamento.
  const { data, error } = await supabase.from('catalogo').select('nome,descricao,foto_url,valor').eq('tipo', 'estampa').order('nome', { ascending: true })
  if (error) throw new ApiError(500, 'Erro ao consultar catálogo: ' + error.message)
  const rows = data || []

  if (!nome) {
    // Sem foto_url de propósito, pra não estourar o limite de ~8000 caracteres
    // de resposta da aa.app.br quando o catálogo de estampas crescer.
    return { ok: true, tipo: 'estampa', estampas: rows.map((r: any) => ({ nome: r.nome, descricao: r.descricao || '', valor: r.valor !== null ? Number(r.valor) : null })) }
  }
  const nomeNorm = nome.toLowerCase()
  const achado = rows.find((r: any) => String(r.nome || '').trim().toLowerCase() === nomeNorm)
    || rows.find((r: any) => String(r.nome || '').toLowerCase().includes(nomeNorm))
  if (!achado) return { ok: true, tipo: 'estampa', encontrado: false, nome }

  let fotoEnviada = false
  if (achado.foto_url && telefone) {
    fotoEnviada = await enviarImagemWhatsapp(telefone, achado.foto_url, achado.nome)
  }
  return { ok: true, tipo: 'estampa', encontrado: true, nome: achado.nome, descricao: achado.descricao || '', valor: achado.valor !== null ? Number(achado.valor) : null, foto_enviada: fotoEnviada }
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
      // Separador entre produto e estampa no site: "-", "–" (en dash, o mais
      // comum na loja), "—", ":" ou "|".
      let estampa = produtoBase ? nomeBase.slice(String(produtoBase.nome).length).trim().replace(/^[-–—:|]+\s*/, '') : nomeBase
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
  let ctx: ContextoEspelho | null = null
  for (const e of estampas || []) {
    let ids: string[] = []
    try { ids = JSON.parse(e.nuvemshop_produto_ids || '[]') } catch (_err) { continue }
    for (const produtoId of ids) {
      if (idsVistos.has(produtoId)) continue // mesmo produto vinculado 2x por engano não chama 2x
      idsVistos.add(produtoId)
      try {
        const variantId = await acharVariantId(produtoId, cor, tamanho)
        if (!variantId && quantidade > 0) {
          // Cor que acabou de ganhar estoque e o produto ainda não oferece → cria
          // a variação (a estampa é feita sob medida, então vale em qualquer cor lisa).
          ctx = ctx || await carregarContextoEspelho(supabase)
          const produtoNs = await nsFetch(`/products/${produtoId}?fields=id,name,attributes,variants`)
          const r = await completarCoresDoEstoque(produtoNs, classificarProdutoNs(produtoNs, ctx.catalogo), ctx)
          if (r.criadas.length) { ok++; continue }
        }
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

// Alinha TODAS as variações de um produto da Nuvemshop com o estoque do CRM.
// O broadcast acima só toca a cor/tamanho que mudou — variação cuja cor ou
// tamanho não existe no catálogo, ou que nunca ganhou linha em "estoque",
// ficaria com estoque infinito (stock null) na loja. Aqui tudo que o CRM não
// conhece vira 0 com controle de estoque ligado: na dúvida, sem estoque.
interface VarianteNs { id: number; valores: string[]; cor: string; tamanho: string; stock: any; stock_management: any }
interface ProdutoNsClassificado { nome: string; produto: string; temProdutoBase: boolean; estampa: string; variantes: VarianteNs[] }

// Lê um produto da Nuvemshop com as mesmas regras de mapearItensNuvemshop:
// produto base pelo prefixo do nome (senão "Camiseta"), estampa = resto do
// nome, e cor/tamanho de cada variação pelo conteúdo contra o catálogo.
function classificarProdutoNs(produtoNs: any, catalogo: any[]): ProdutoNsClassificado {
  const produtosComVariacao = catalogo.filter((c: any) => c.tipo === 'produto' && c.tem_variacao)
  const cores = catalogo.filter((c: any) => c.tipo === 'cor').map((c: any) => String(c.nome))
  const tamanhos = catalogo.filter((c: any) => c.tipo === 'tamanho').map((c: any) => String(c.nome))

  const nome = nsText(produtoNs?.name).trim()
  const produtoBase = produtosComVariacao.find((p: any) => nome.toLowerCase().startsWith(String(p.nome).toLowerCase()))
  // Sem produto do CRM no começo do nome (ex: "Vestido ...", "Regata ...") não
  // há estoque de peça lisa pra ele: produto vazio → nenhuma linha de estoque
  // bate → todas as variações ficam 0 e nenhuma cor é adicionada.
  const produto = produtoBase ? String(produtoBase.nome) : ''
  const estampa = (produtoBase ? nome.slice(String(produtoBase.nome).length).trim().replace(/^[-–—:|]+\s*/, '') : '') || nome

  const variantes: VarianteNs[] = (produtoNs?.variants || []).map((v: any) => {
    const valores: string[] = (v.values || []).map((x: any) => nsText(x).trim()).filter(Boolean)
    let cor = '', tamanho = ''
    for (const valor of valores) {
      if (!cor) { const m = cores.find((c) => corBate(valor, c)); if (m) cor = m }
      if (!tamanho) { const m = tamanhos.find((t) => normComparar(t) === normComparar(valor)); if (m) tamanho = m }
    }
    return { id: v.id, valores, cor, tamanho, stock: v.stock, stock_management: v.stock_management }
  })
  return { nome, produto, temProdutoBase: Boolean(produtoBase), estampa, variantes }
}

// Grafia que a LOJA já usa pra cada cor do CRM (ex: CRM "Preta" → loja "Preto"),
// pra variação nova não aparecer como uma cor diferente no filtro do site.
// Calculada uma vez por contexto, a partir do catálogo da Nuvemshop.
async function grafiaCorNaLoja(ctx: ContextoEspelho, corCrm: string): Promise<string> {
  if (!ctx.grafiasCor) {
    ctx.grafiasCor = new Map()
    const contagem = new Map<string, Map<string, number>>()
    const cores = ctx.catalogo.filter((c: any) => c.tipo === 'cor').map((c: any) => String(c.nome))
    const produtos: any[] = (await nsFetch('/products?per_page=200&fields=id,variants')) || []
    for (const p of produtos) for (const v of p.variants || []) for (const x of v.values || []) {
      const valor = nsText(x).trim()
      const c = cores.find((nome) => corBate(valor, nome))
      if (!c) continue
      const m = contagem.get(c) || new Map<string, number>()
      m.set(valor, (m.get(valor) || 0) + 1)
      contagem.set(c, m)
    }
    for (const [c, m] of contagem) ctx.grafiasCor.set(c, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0])
  }
  return ctx.grafiasCor.get(corCrm) || corCrm
}


function estoqueCrm(ctx: ContextoEspelho, produto: string, cor: string, tamanho: string): number {
  if (!cor || !tamanho) return 0
  const row = ctx.estoque.find((e: any) => e.produto === produto && e.cor === cor && e.tamanho === tamanho)
  return row ? Math.max(0, parseInt(row.quantidade) || 0) : 0
}

// Campos de variação reenviados no PUT em lote — o PUT /products/{id}/variants
// substitui a coleção inteira, então toda variação existente vai de volta com
// tudo que ela já tinha (foto, SKU, preço...), senão poderia perder dado.
const CAMPOS_VARIANTE = ['values', 'image_id', 'price', 'promotional_price', 'compare_at_price', 'weight', 'width', 'height', 'depth', 'sku', 'barcode', 'mpn', 'age_group', 'gender', 'cost']

// Toda cor lisa que tem estoque no CRM vira variação em toda camiseta — a
// estampa é aplicada sob medida, então qualquer cor com peça lisa disponível
// pode ser vendida. Cria só o que falta, em todos os tamanhos que o produto já
// oferece, com o estoque do CRM (0 nos tamanhos sem peça) e o preço/peso/medidas
// copiados de uma variação existente do mesmo tamanho.
// Um único PUT /products/{id}/variants por produto (existentes + novas): criar
// uma a uma eram ~15 POSTs por camiseta, cada um disparando um product/updated
// de volta pra cá — estourava o limite de requisições da Nuvemshop.
// Padrão da loja: um produto por peça/estampa (nunca um produto por cor), com
// as cores como variação. Não mexe em produto com atributos além de Cor e
// Tamanho. Cor sem estoque não é removida — só fica 0 (esgotada).
async function completarCoresDoEstoque(produtoNs: any, cls: ProdutoNsClassificado, ctx: ContextoEspelho): Promise<{ criadas: string[]; detalhes: string[]; produtoAtualizado?: any }> {
  const criadas: string[] = [], detalhes: string[] = []
  const attrs: string[] = (produtoNs?.attributes || []).map((a: any) => normComparar(nsText(a)))
  const iCor = attrs.findIndex((a) => a.startsWith('cor'))
  const iTam = attrs.findIndex((a) => a.startsWith('tamanho'))
  if (attrs.length !== 2 || iCor < 0 || iTam < 0) return { criadas, detalhes }

  const variantsNs: any[] = produtoNs.variants || []
  const tamanhos = [...new Set(cls.variantes.map((v) => v.tamanho).filter(Boolean))]
  // Só cor cadastrada no Catálogo: cor que existe no estoque mas não no Catálogo
  // não é reconhecida nas variações da loja (classificarProdutoNs), então pareceria
  // sempre "faltando" e seria criada de novo a cada passada.
  const coresCatalogo = new Set(ctx.catalogo.filter((c: any) => c.tipo === 'cor').map((c: any) => String(c.nome)))
  const coresComEstoque = [...new Set(ctx.estoque
    .filter((e: any) => e.produto === cls.produto && (parseInt(e.quantidade) || 0) > 0 && coresCatalogo.has(String(e.cor)))
    .map((e: any) => String(e.cor)))]

  const novas: Record<string, unknown>[] = []
  for (const cor of coresComEstoque) {
    for (const tamanho of tamanhos) {
      if (cls.variantes.some((v) => v.cor === cor && v.tamanho === tamanho)) continue
      const modelo = variantsNs[cls.variantes.findIndex((v) => v.tamanho === tamanho)]
      const values: any[] = []
      values[iCor] = { pt: await grafiaCorNaLoja(ctx, cor) }
      values[iTam] = modelo?.values?.[iTam] ?? { pt: tamanho }
      const nova: Record<string, unknown> = { values, stock_management: true, stock: estoqueCrm(ctx, cls.produto, cor, tamanho) }
      for (const campo of ['price', 'promotional_price', 'compare_at_price', 'weight', 'width', 'height', 'depth', 'cost']) {
        if (modelo?.[campo] !== null && modelo?.[campo] !== undefined) nova[campo] = modelo[campo]
      }
      novas.push(nova)
      criadas.push(`${cor}/${tamanho}`)
    }
  }
  if (!novas.length) return { criadas, detalhes }

  const existentes = variantsNs.map((v: any, i: number) => {
    const o: Record<string, unknown> = {}
    for (const campo of CAMPOS_VARIANTE) if (v[campo] !== null && v[campo] !== undefined) o[campo] = v[campo]
    // Já manda o estoque do CRM também — o sync logo depois não precisa reescrever.
    o.stock_management = true
    o.stock = estoqueCrm(ctx, cls.produto, cls.variantes[i].cor, cls.variantes[i].tamanho)
    return o
  })
  try {
    await nsFetch(`/products/${produtoNs.id}/variants`, 'PUT', [...existentes, ...novas])
  } catch (err) {
    // Produto que acabou de ganhar o atributo Cor (adicionarAtributoCor) recusa o
    // PUT em lote com "Variant values should not be empty" mesmo com os dados
    // certos. Plano B: cria uma a uma (o product/updated que cada POST dispara só
    // acerta estoque, então não há corrida criando repetida).
    const motivo = err instanceof Error ? err.message : 'erro'
    const criadasUmaAUma: string[] = []
    for (let i = 0; i < novas.length; i++) {
      try {
        await nsFetch(`/products/${produtoNs.id}/variants`, 'POST', novas[i])
        criadasUmaAUma.push(criadas[i])
      } catch (err2) {
        detalhes.push(`${cls.nome} (criar ${criadas[i]}): ${err2 instanceof Error ? err2.message : 'erro'} [lote: ${motivo.slice(0, 120)}]`)
      }
    }
    if (!criadasUmaAUma.length) return { criadas: [], detalhes }
    const produtoAtualizado = await nsFetch(`/products/${produtoNs.id}?fields=id,name,attributes,variants,images`)
    return { criadas: criadasUmaAUma, detalhes, produtoAtualizado }
  }
  // Recarrega: o sync seguinte precisa dos ids/estoques atuais das variações.
  const produtoAtualizado = await nsFetch(`/products/${produtoNs.id}?fields=id,name,attributes,variants,images`)
  return { criadas, detalhes, produtoAtualizado }
}

async function sincronizarProdutoNuvemshopCompleto(
  produtoId: string,
  catalogo: any[],
  estoque: any[],
  produtoNsJaCarregado?: any,
): Promise<{ ok: number; falhou: number; detalhes: string[] }> {
  const produtoNs = produtoNsJaCarregado || await nsFetch(`/products/${produtoId}?fields=id,name,variants`)
  const { nome: nomeNs, produto, variantes } = classificarProdutoNs(produtoNs, catalogo)

  let ok = 0, falhou = 0
  const detalhes: string[] = []
  for (const v of variantes) {
    const { valores, cor, tamanho } = v
    const row = cor && tamanho
      ? estoque.find((e: any) => e.produto === produto && e.cor === cor && e.tamanho === tamanho)
      : null
    const quantidade = row ? Math.max(0, parseInt(row.quantidade) || 0) : 0
    if (v.stock_management === true && v.stock !== null && Number(v.stock) === quantidade) { ok++; continue }
    try {
      await nsFetch(`/products/${produtoId}/variants/${v.id}`, 'PUT', { stock_management: true, stock: quantidade })
      ok++
    } catch (err) {
      falhou++
      detalhes.push(`${nomeNs} (${valores.join('/') || 'sem variação'}): ${err instanceof Error ? err.message : 'erro'}`)
    }
  }
  return { ok, falhou, detalhes }
}

async function carregarCatalogoEEstoque(supabase: SupabaseClient): Promise<{ catalogo: any[]; estoque: any[] }> {
  const [{ data: catalogo }, { data: estoque }] = await Promise.all([
    supabase.from('catalogo').select('nome,tipo,tem_variacao'),
    supabase.from('estoque').select('produto,cor,tamanho,quantidade'),
  ])
  return { catalogo: catalogo || [], estoque: estoque || [] }
}

// ── PRODUTO NASCE NA NUVEMSHOP, CRM ESPELHA ───────────────
// Padrão: cadastro de produto (nome, fotos, variações) é feito na Nuvemshop;
// o CRM só controla o estoque da peça lisa. Cada produto que é peça do CRM
// vira/vincula uma estampa no Catálogo e TODAS as variações recebem o estoque
// do CRM (o que o CRM não tem fica 0). Usado pelo webhook (um produto) e pelo
// botão "Sincronizar com a Nuvemshop" (catálogo inteiro).
// Os PUTs de estoque disparam outro product/updated, mas aí tudo já bate e
// sincronizarProdutoNuvemshopCompleto não escreve nada — o ciclo para sozinho.
const EVENTOS_PRODUTO = ['product/created', 'product/updated', 'product/deleted']

function parseIdsVinculados(row: any): string[] {
  try { return (JSON.parse(row?.nuvemshop_produto_ids || '[]') as any[]).map(String) } catch (_err) { return [] }
}

async function garantirWebhooksProduto(): Promise<string[]> {
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const token = Deno.env.get('NS_WEBHOOK_TOKEN') ?? ''
  if (!base || !token) throw new ApiError(500, 'SUPABASE_URL/NS_WEBHOOK_TOKEN não configurados.')
  const url = `${base}/functions/v1/pissilone-agent/webhook-nuvemshop-produto?token=${encodeURIComponent(token)}`
  const existentes: any[] = (await nsFetch('/webhooks')) || []
  const criados: string[] = []
  for (const event of EVENTOS_PRODUTO) {
    if (existentes.some((w: any) => w.event === event && w.url === url)) continue
    await nsFetch('/webhooks', 'POST', { event, url })
    criados.push(event)
  }
  return criados
}

interface ContextoEspelho { catalogo: any[]; estoque: any[]; estampas: any[]; grafiasCor?: Map<string, string> }

async function carregarContextoEspelho(supabase: SupabaseClient): Promise<ContextoEspelho> {
  const [{ catalogo, estoque }, { data: estampas }] = await Promise.all([
    carregarCatalogoEEstoque(supabase),
    supabase.from('catalogo').select('id,nome,foto_url,valor,nuvemshop_produto_ids').eq('tipo', 'estampa'),
  ])
  return { catalogo, estoque, estampas: estampas || [] }
}

// Espelha UM produto já carregado da Nuvemshop (precisa de name, variants, images).
// ctx.estampas é atualizado em memória a cada vínculo/criação, pra uma passada
// pelo catálogo inteiro não criar a mesma estampa 2x (ex: "Camiseta - Cafuné" em 2 produtos).
async function espelharProdutoNs(supabase: SupabaseClient, produtoNs: any, ctx: ContextoEspelho, completarCores = true): Promise<any> {
  const produtoId = String(produtoNs.id)
  const cls = classificarProdutoNs(produtoNs, ctx.catalogo)
  let estampaRow: any = ctx.estampas.find((e: any) => parseIdsVinculados(e).includes(produtoId))

  // Só espelha peça que o CRM controla (nome começa com produto de variação,
  // ex: "Camiseta ...", ou alguma variação com cor+tamanho do catálogo) —
  // caneca/presilha etc. ficam como estão na Nuvemshop.
  const temGrade = cls.variantes.some((v) => v.cor && v.tamanho)
  if (!estampaRow && !cls.temProdutoBase && !temGrade) {
    return { ok: true, ignorado: 'produto sem cor/tamanho do catálogo do CRM' }
  }
  if (!estampaRow && !cls.temProdutoBase) {
    // Peça com cor/tamanho mas que não é produto do CRM (vestido, regata...):
    // não vira estampa no Catálogo, só fica sem estoque em vez de infinito.
    const estoque_sincronizado = await sincronizarProdutoNuvemshopCompleto(produtoId, ctx.catalogo, ctx.estoque, produtoNs)
    return { ok: true, produto: '', variacoes_criadas: [], estoque_sincronizado }
  }

  if (!estampaRow) {
    // Mesmo nome de estampa já cadastrado (ex: mesma estampa em outro produto) → soma o vínculo nele.
    estampaRow = ctx.estampas.find((e: any) => normComparar(e.nome) === normComparar(cls.estampa))
    if (estampaRow) {
      const ids = parseIdsVinculados(estampaRow)
      ids.push(produtoId)
      const { error } = await supabase.from('catalogo').update({ nuvemshop_produto_ids: JSON.stringify(ids) }).eq('id', estampaRow.id)
      if (error) throw new ApiError(500, 'Erro ao vincular estampa: ' + error.message)
      estampaRow.nuvemshop_produto_ids = JSON.stringify(ids)
    } else {
      const { data: nova, error } = await supabase.from('catalogo')
        .insert({ tipo: 'estampa', nome: cls.estampa, nuvemshop_produto_ids: JSON.stringify([produtoId]) })
        .select('id,nome,foto_url,valor,nuvemshop_produto_ids').single()
      if (error) throw new ApiError(500, 'Erro ao criar estampa: ' + error.message)
      estampaRow = nova
      ctx.estampas.push(nova)
    }
  }

  // Foto entra só se a estampa ainda não tem (não sobrescreve foto escolhida no CRM).
  // No product/created as imagens às vezes ainda não subiram — o updated seguinte completa.
  const fotoUrl = primeiraImagem(produtoNs)
  if (fotoUrl && !estampaRow.foto_url) {
    await supabase.from('catalogo').update({ foto_url: fotoUrl }).eq('id', estampaRow.id)
    estampaRow.foto_url = fotoUrl
  }

  // Preço do site vira o valor da estampa no Catálogo (consulta da atendente,
  // valor automático na venda, resposta da Maria). Roda também no
  // product/updated, então mudar o preço na Nuvemshop já reflete no CRM.
  const preco = precoDeVendaNs(produtoNs)
  if (preco !== null && Number(estampaRow.valor) !== preco) {
    await supabase.from('catalogo').update({ valor: preco }).eq('id', estampaRow.id)
    estampaRow.valor = preco
  }

  // Completar cores só fora do product/updated (ver webhookNuvemshopProduto).
  let produtoAtual = produtoNs, clsAtual = cls, repetidas_removidas = 0
  let cores: { criadas: string[]; detalhes: string[]; produtoAtualizado?: any } = { criadas: [], detalhes: [] }
  if (completarCores) {
    const errosRepetidas: string[] = []
    repetidas_removidas = await removerVariacoesRepetidas(produtoAtual, clsAtual, errosRepetidas)
    cores.detalhes.push(...errosRepetidas)
    if (repetidas_removidas) {
      produtoAtual = await nsFetch(`/products/${produtoId}?fields=id,name,attributes,variants,images`)
      clsAtual = classificarProdutoNs(produtoAtual, ctx.catalogo)
    }
    // Variações novas já nascem com o estoque certo; o sync abaixo cuida das existentes.
    const completadas = await completarCoresDoEstoque(produtoAtual, clsAtual, ctx)
    cores = { ...completadas, detalhes: [...cores.detalhes, ...completadas.detalhes] }
  }
  const estoque_sincronizado = await sincronizarProdutoNuvemshopCompleto(produtoId, ctx.catalogo, ctx.estoque, cores.produtoAtualizado || produtoAtual)
  estoque_sincronizado.detalhes.push(...cores.detalhes)
  estoque_sincronizado.falhou += cores.detalhes.length
  return { ok: true, estampa: estampaRow.nome, produto: cls.produto, variacoes_criadas: cores.criadas, repetidas_removidas, estoque_sincronizado }
}

// Preço que o cliente paga no site: promocional quando houver (e for menor),
// senão o normal. Variações podem divergir (ex: uma esquecida em 0,00), então
// vale o preço mais comum entre as variações com preço; empate → o maior.
function precoDeVendaNs(produtoNs: any): number | null {
  const contagem = new Map<number, number>()
  for (const v of produtoNs?.variants || []) {
    const preco = parseFloat(v.price) || 0
    const promo = parseFloat(v.promotional_price) || 0
    const efetivo = promo > 0 && promo < preco ? promo : preco
    if (efetivo > 0) contagem.set(efetivo, (contagem.get(efetivo) || 0) + 1)
  }
  if (!contagem.size) return null
  return [...contagem.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))[0][0]
}

// Variação repetida (mesma cor+tamanho 2x ou mais) aparece quando dois
// espelhamentos do mesmo produto rodam ao mesmo tempo. Fica sempre a de menor
// id (a mais antiga, que pode ter foto associada) — regra fixa, então duas
// execuções simultâneas apagam exatamente as mesmas e nunca as duas cópias.
async function removerVariacoesRepetidas(produtoNs: any, cls: ProdutoNsClassificado, erros: string[] = []): Promise<number> {
  const vistas = new Set<string>()
  let removidas = 0
  const ordenadas = cls.variantes.slice().sort((a, b) => Number(a.id) - Number(b.id))
  for (const v of ordenadas) {
    const chave = v.cor && v.tamanho ? `${v.cor}|${v.tamanho}` : v.valores.map(normComparar).join('|')
    if (!vistas.has(chave)) { vistas.add(chave); continue }
    try {
      await nsFetch(`/products/${produtoNs.id}/variants/${v.id}`, 'DELETE')
      removidas++
    } catch (err) {
      erros.push(`${cls.nome} (remover repetida ${v.cor}/${v.tamanho}): ${err instanceof Error ? err.message : 'erro'}`)
    }
  }
  return removidas
}

// ── /estoque/sincronizar-tudo-nuvemshop ───────────────────
// Botão "Sincronizar com a Nuvemshop" da seção de Estoque. Lê o catálogo
// inteiro em páginas de 200 (1 GET por página, em vez de 1 por produto — com
// ~180 produtos e o limite de 2 req/s da Nuvemshop, ir produto a produto
// estourava o tempo da Edge Function) e só faz PUT no que está diferente.
export async function sincronizarTudoNuvemshop(supabase: SupabaseClient, _body: any) {
  const ctx = await carregarContextoEspelho(supabase)
  let produtos = 0, ignorados = 0, ok = 0, falhou = 0, criadas = 0, repetidas = 0
  let parcial = false
  const detalhes: string[] = []
  const POR_PAGINA = 200
  // Margem antes do limite de tempo da Edge Function: para e avisa; clicar de
  // novo continua (o que já foi feito é pulado, nada é escrito 2x).
  const inicio = Date.now(), LIMITE_MS = 110_000
  paginas: for (let pagina = 1; ; pagina++) {
    const lote: any[] = (await nsFetch(`/products?per_page=${POR_PAGINA}&page=${pagina}&fields=id,name,attributes,variants,images`)) || []
    for (const produtoNs of lote) {
      if (Date.now() - inicio > LIMITE_MS) { parcial = true; break paginas }
      try {
        const r = await espelharProdutoNs(supabase, produtoNs, ctx)
        if (r.ignorado) { ignorados++; continue }
        produtos++
        criadas += r.variacoes_criadas.length
        repetidas += r.repetidas_removidas || 0
        ok += r.estoque_sincronizado.ok; falhou += r.estoque_sincronizado.falhou
        detalhes.push(...r.estoque_sincronizado.detalhes)
      } catch (err) {
        falhou++
        detalhes.push(`${nsText(produtoNs?.name)}: ${err instanceof Error ? err.message : 'erro'}`)
      }
    }
    // Página incompleta = última (pedir a seguinte devolve 404 na Nuvemshop).
    if (lote.length < POR_PAGINA) break
  }

  // Aproveita o botão pra garantir que os webhooks de produto existem — assim
  // não precisa de passo manual de cadastro depois do deploy.
  let webhooks_criados: string[] = []
  try { webhooks_criados = await garantirWebhooksProduto() } catch (err) {
    detalhes.push(`webhooks de produto: ${err instanceof Error ? err.message : 'erro'}`)
  }
  return { ok: true, parcial, produtos, ignorados, variacoes_criadas: criadas, repetidas_removidas: repetidas, variacoes_ok: ok, falhou, detalhes, webhooks_criados }
}

export async function webhookNuvemshopProduto(supabase: SupabaseClient, body: any) {
  const produtoId = body?.id ? String(body.id) : ''
  const evento = String(body?.event || '')
  if (!produtoId) throw new ApiError(400, 'Payload do webhook sem "id" de produto.')

  if (evento === 'product/deleted') {
    // Tira o id do vínculo pra o "Sincronizar" não ficar tentando um produto que não existe mais.
    const { data: estampas } = await supabase.from('catalogo').select('id,nome,nuvemshop_produto_ids').eq('tipo', 'estampa')
    const estampaRow: any = (estampas || []).find((e: any) => parseIdsVinculados(e).includes(produtoId))
    if (!estampaRow) return { ok: true, ignorado: 'produto não vinculado' }
    const ids = parseIdsVinculados(estampaRow).filter((id) => id !== produtoId)
    await supabase.from('catalogo').update({ nuvemshop_produto_ids: JSON.stringify(ids) }).eq('id', estampaRow.id)
    return { ok: true, desvinculado: estampaRow.nome }
  }

  const [produtoNs, ctx] = await Promise.all([
    nsFetch(`/products/${produtoId}?fields=id,name,attributes,variants,images`),
    carregarContextoEspelho(supabase),
  ])
  // product/updated chega em rajada (cada foto/variação/estoque gravado dispara
  // um) e vários rodariam completarCoresDoEstoque ao mesmo tempo no mesmo
  // produto, criando cor repetida. Aqui só acerta estoque; cores são completadas
  // no product/created, no botão Sincronizar e na unificação.
  return { evento, ...(await espelharProdutoNs(supabase, produtoNs, ctx, evento === 'product/created')) }
}

// ── /nuvemshop/unificar-duplicadas ────────────────────────
// Limpeza única do legado "um produto por cor": junta peças cadastradas várias
// vezes com o mesmo nome (ex: 4x "Camiseta Destá") num produto só. Fica o
// publicado (empate: o mais antigo, que tem a URL original); ele recebe as fotos
// e categorias dos outros, os outros são excluídos, e as cores voltam pelo
// estoque do CRM (espelharProdutoNs). Só peça do CRM (caneca etc. fica de fora).
// Sem { executar: true } só devolve o plano, sem mexer em nada. Para antes do
// limite de tempo; chamar de novo continua (o que já foi unificado some da lista).
function chaveNomePeca(nome: string, apelidos: Record<string, string>): string {
  const k = normComparar(nome).replace(/[-–—|:/,.]/g, ' ').replace(/\s+/g, ' ').trim()
  return apelidos[k] || k
}
// Mesmo arquivo enviado 2x vira URLs diferentes só no sufixo numérico do CDN.
function chaveFoto(src: string): string {
  const arquivo = String(src).split('?')[0].split('/').pop() || ''
  return arquivo.replace(/\.[a-z0-9]+$/i, '').replace(/(-\d+)+$/, '')
}

export async function unificarDuplicadasNuvemshop(supabase: SupabaseClient, body: any) {
  const executar = body?.executar === true
  const apelidos: Record<string, string> = {}
  for (const [de, para] of Object.entries(body?.apelidos || {})) apelidos[chaveNomePeca(de, {})] = chaveNomePeca(String(para), {})

  const ctx = await carregarContextoEspelho(supabase)
  const todos: any[] = []
  for (let pagina = 1; ; pagina++) {
    const lote: any[] = (await nsFetch(`/products?per_page=200&page=${pagina}&fields=id,name,attributes,variants,images,categories,published`)) || []
    todos.push(...lote)
    if (lote.length < 200) break
  }

  const grupos = new Map<string, any[]>()
  for (const p of todos) {
    const cls = classificarProdutoNs(p, ctx.catalogo)
    if (!cls.temProdutoBase && !cls.variantes.some((v) => v.cor && v.tamanho)) continue
    const k = chaveNomePeca(cls.nome, apelidos)
    grupos.set(k, [...(grupos.get(k) || []), p])
  }

  const plano: any[] = []
  const inicio = Date.now(), LIMITE_MS = 110_000
  let parcial = false
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue
    lista.sort((a, b) => (Number(b.published) - Number(a.published)) || (Number(a.id) - Number(b.id)))
    const [fica, ...saem] = lista
    const item: any = {
      fica: { id: String(fica.id), nome: nsText(fica.name), publicado: fica.published, fotos: (fica.images || []).length },
      saem: saem.map((p) => ({ id: String(p.id), nome: nsText(p.name), publicado: p.published, fotos: (p.images || []).length })),
    }
    plano.push(item)
    if (!executar) continue
    if (Date.now() - inicio > LIMITE_MS) { parcial = true; item.pulado = 'limite de tempo'; continue }

    try {
      const fotosVistas = new Set((fica.images || []).map((i: any) => chaveFoto(i.src)))
      let posicao = (fica.images || []).length
      let fotosMovidas = 0
      for (const p of saem) {
        for (const img of (p.images || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))) {
          const k = chaveFoto(img.src)
          if (fotosVistas.has(k)) continue
          fotosVistas.add(k)
          await nsFetch(`/products/${fica.id}/images`, 'POST', { src: img.src, position: ++posicao })
          fotosMovidas++
        }
      }
      const categorias = [...new Set([...lista].flatMap((p) => (p.categories || []).map((c: any) => Number(typeof c === 'object' ? c.id : c))))]
      const patch: Record<string, unknown> = { categories: categorias }
      if (lista.some((p) => p.published)) patch.published = true
      await nsFetch(`/products/${fica.id}`, 'PUT', patch)

      // Fotos e categorias garantidas no que fica → aí sim exclui os outros.
      const idsSaem = saem.map((p) => String(p.id))
      for (const id of idsSaem) await nsFetch(`/products/${id}`, 'DELETE')
      for (const e of ctx.estampas) {
        const ids = parseIdsVinculados(e)
        if (!ids.some((id) => idsSaem.includes(id))) continue
        e.nuvemshop_produto_ids = JSON.stringify(ids.filter((id) => !idsSaem.includes(id)))
        await supabase.from('catalogo').update({ nuvemshop_produto_ids: e.nuvemshop_produto_ids }).eq('id', e.id)
      }

      const atualizado = await nsFetch(`/products/${fica.id}?fields=id,name,attributes,variants,images`)
      const espelho = await espelharProdutoNs(supabase, atualizado, ctx)
      Object.assign(item, { ok: true, fotos_movidas: fotosMovidas, cores_criadas: espelho.variacoes_criadas || [] })
    } catch (err) {
      item.erro = err instanceof Error ? err.message : 'erro'
    }
  }
  return { ok: true, executado: executar, parcial, grupos: plano.length, produtos_a_excluir: plano.reduce((n, g) => n + g.saem.length, 0), plano }
}

// ── /nuvemshop/diagnostico-produto ────────────────────────
// Só leitura: variações cruas de um produto pela API (por id) e como vêm na
// listagem paginada, pra comparar quando algo não bate com o painel.
export async function diagnosticoProdutoNuvemshop(_supabase: SupabaseClient, body: any) {
  const id = reqStr(body, 'produto_id')
  const resumir = (p: any) => ({
    attributes: p?.attributes,
    variantes: (p?.variants || []).map((v: any) => ({ id: v.id, values: v.values, stock: v.stock })),
  })
  const direto = await nsFetch(`/products/${id}?fields=id,name,attributes,variants`)
  const lista: any[] = (await nsFetch(`/products?ids=${id}&fields=id,name,attributes,variants`)) || []
  return { ok: true, direto: resumir(direto), na_listagem: lista.length ? resumir(lista[0]) : null }
}

// ── /nuvemshop/adicionar-atributo-cor ─────────────────────
// Camisetas cadastradas só com "Tamanho" não recebem cores (completarCores
// exige Cor+Tamanho). Aqui o produto ganha o atributo Cor; as variações que já
// existem recebem uma cor padrão (Preto — a foto não diz a cor, e logo depois
// todas as cores com estoque entram mesmo) mantendo id/preço, e o espelhamento
// completa as demais cores e o estoque.
// Sem { executar: true } só lista; { produto_id } restringe a um produto (teste).
export async function adicionarAtributoCor(supabase: SupabaseClient, body: any) {
  const executar = body?.executar === true
  const soId = body?.produto_id ? String(body.produto_id) : ''
  const ctx = await carregarContextoEspelho(supabase)
  const candidatos: any[] = []
  if (soId) {
    candidatos.push(await nsFetch(`/products/${soId}?fields=id,name,attributes,variants,images`))
  } else {
    for (let pagina = 1; ; pagina++) {
      const lote: any[] = (await nsFetch(`/products?per_page=200&page=${pagina}&fields=id,name,attributes,variants,images`)) || []
      candidatos.push(...lote)
      if (lote.length < 200) break
    }
  }

  const corCrm = ctx.catalogo.some((c: any) => c.tipo === 'cor' && c.nome === 'Preta') ? 'Preta' : ''
  const plano: any[] = []
  // Cada produto custa ~35 requisições (cores criadas uma a uma); para antes do
  // limite da Edge Function. Chamar de novo continua: o que já ganhou Cor sai da lista.
  const inicio = Date.now(), LIMITE_MS = 100_000
  for (const p of candidatos) {
    const nome = nsText(p?.name).trim()
    const attrs: string[] = (p?.attributes || []).map((a: any) => normComparar(nsText(a)))
    if (!normComparar(nome).startsWith('camiseta') || attrs.length !== 1 || attrs[0] !== 'tamanho') continue
    const item: any = { id: String(p.id), nome, variacoes: (p.variants || []).length }
    plano.push(item)
    if (!executar) continue
    if (Date.now() - inicio > LIMITE_MS) { item.pulado = 'limite de tempo'; continue }
    try {
      const cor = corCrm ? await grafiaCorNaLoja(ctx, corCrm) : 'Preto'
      const passos: string[] = []
      // A ordem que a API aceita não é documentada: tenta atributo primeiro e,
      // se recusar, ajusta as variações primeiro.
      const valoresNovos = (p.variants || []).map((v: any) => ({ id: v.id, values: [{ pt: cor }, v.values?.[0] ?? { pt: '' }] }))
      try {
        await nsFetch(`/products/${p.id}`, 'PUT', { attributes: [{ pt: 'Cor' }, { pt: 'Tamanho' }] })
        passos.push('atributo')
        await nsFetch(`/products/${p.id}/variants`, 'PATCH', valoresNovos)
        passos.push('variações')
      } catch (err1) {
        item.tentativa1 = err1 instanceof Error ? err1.message.slice(0, 300) : 'erro'
        await nsFetch(`/products/${p.id}/variants`, 'PATCH', valoresNovos)
        passos.push('variações')
        await nsFetch(`/products/${p.id}`, 'PUT', { attributes: [{ pt: 'Cor' }, { pt: 'Tamanho' }] })
        passos.push('atributo')
      }
      const atualizado = await nsFetch(`/products/${p.id}?fields=id,name,attributes,variants,images`)
      const espelho = await espelharProdutoNs(supabase, atualizado, ctx)
      Object.assign(item, { ok: true, passos, cor_padrao: cor, cores_criadas: (espelho.variacoes_criadas || []).length })
    } catch (err) {
      item.erro = err instanceof Error ? err.message.slice(0, 400) : 'erro'
    }
  }
  return { ok: true, executado: executar, produtos: plano.length, plano }
}

// ── /nuvemshop/ajustar-precos-camisetas ───────────────────
// Tabela definida pelo dono da loja (2026-10-18): camiseta sem detalhe artesanal
// (crochê, bordado, macramê) custa 89,90; quem já está em 99,90 ou mais mantém.
// Camiseta com detalhe artesanal não é tocada. Referência do produto = maior
// preço entre as variações (há produto com variação esquecida em 0,00).
// Promoção existente fica, a não ser que deixe de ser menor que o preço novo.
// Sem { executar: true } só devolve o plano.
const PRECO_CAMISETA = 89.9
const PRECO_MANTEM_A_PARTIR = 99.9

export async function ajustarPrecosCamisetas(_supabase: SupabaseClient, body: any) {
  const executar = body?.executar === true
  const plano: any[] = []
  const inicio = Date.now(), LIMITE_MS = 110_000
  let parcial = false
  for (let pagina = 1; ; pagina++) {
    const lote: any[] = (await nsFetch(`/products?per_page=200&page=${pagina}&fields=id,name,variants`)) || []
    for (const p of lote) {
      const nome = nsText(p.name).trim()
      if (!normComparar(nome).startsWith('camiseta')) continue
      if (/croch|bordad|macram/i.test(normComparar(nome))) continue
      const variantes: any[] = p.variants || []
      const ref = Math.max(0, ...variantes.map((v: any) => parseFloat(v.price) || 0))
      if (ref >= PRECO_MANTEM_A_PARTIR) continue
      const mudar = variantes.filter((v: any) => Math.abs((parseFloat(v.price) || 0) - PRECO_CAMISETA) > 0.001)
      if (!mudar.length) continue
      const item: any = { id: String(p.id), nome, de: [...new Set(mudar.map((v: any) => String(v.price)))], variacoes: mudar.length }
      plano.push(item)
      if (!executar) continue
      if (Date.now() - inicio > LIMITE_MS) { parcial = true; item.pulado = 'limite de tempo'; continue }
      try {
        await nsFetch(`/products/${p.id}/variants`, 'PATCH', mudar.map((v: any) => {
          const o: Record<string, unknown> = { id: v.id, price: PRECO_CAMISETA.toFixed(2) }
          const promo = parseFloat(v.promotional_price)
          if (promo && promo >= PRECO_CAMISETA) o.promotional_price = null
          return o
        }))
        item.ok = true
      } catch (err) {
        item.erro = err instanceof Error ? err.message : 'erro'
      }
    }
    if (lote.length < 200) break
  }
  return { ok: true, executado: executar, parcial, produtos: plano.length, plano }
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

function primeiraImagem(produto: any): string {
  const imagens = (produto?.images || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
  return imagens[0]?.src || ''
}

// ── /catalogo/buscar-produtos-nuvemshop ───────────────────
// Busca por nome na API da Nuvemshop (GET /products?q=...) — usada pelo botão
// "Vincular" do Catálogo quando uma estampa ainda não tem produto associado.
export async function buscarProdutosNuvemshop(supabase: SupabaseClient, body: any) {
  const q = reqStr(body, 'q')
  const resultado = await nsFetch(`/products?q=${encodeURIComponent(q)}&per_page=20&fields=id,name,images`)
  const produtos = (Array.isArray(resultado) ? resultado : []).map((p: any) => ({
    id: String(p.id), nome: nsText(p.name), imagem: primeiraImagem(p),
  }))
  return { ok: true, produtos }
}

// ── /catalogo/vincular-estampa ────────────────────────────
// Confirma o vínculo escolhido no botão "Vincular": soma o product_id aos já
// vinculados da estampa e puxa a primeira imagem do produto pra foto_url.
export async function vincularEstampaNuvemshop(supabase: SupabaseClient, body: any) {
  const estampaId = reqStr(body, 'estampa_id')
  const produtoId = reqStr(body, 'produto_id')

  const { data: row, error: selErr } = await supabase.from('catalogo').select('id,nuvemshop_produto_ids').eq('id', estampaId).eq('tipo', 'estampa').maybeSingle()
  if (selErr) throw new ApiError(500, 'Erro ao consultar catálogo: ' + selErr.message)
  if (!row) throw new ApiError(404, 'Estampa não encontrada.')

  let ids: string[] = []
  try { ids = row.nuvemshop_produto_ids ? JSON.parse(row.nuvemshop_produto_ids) : [] } catch (_err) { ids = [] }
  if (!ids.includes(produtoId)) ids.push(produtoId)

  const produto = await nsFetch(`/products/${produtoId}?fields=id,images`)
  const fotoUrl = primeiraImagem(produto)

  const patch: Record<string, string> = { nuvemshop_produto_ids: JSON.stringify(ids) }
  if (fotoUrl) patch.foto_url = fotoUrl
  const { error: updErr } = await supabase.from('catalogo').update(patch).eq('id', estampaId)
  if (updErr) throw new ApiError(500, 'Erro ao vincular: ' + updErr.message)

  // Produto recém-vinculado já entra alinhado com o estoque do CRM — variação
  // que o CRM não tem fica 0, nunca infinita. Falha aqui não desfaz o vínculo.
  let estoque_sincronizado: unknown = null
  try {
    const { catalogo, estoque } = await carregarCatalogoEEstoque(supabase)
    estoque_sincronizado = await sincronizarProdutoNuvemshopCompleto(produtoId, catalogo, estoque)
  } catch (err) {
    console.error(`sincronização de estoque pós-vínculo falhou (produto ${produtoId}):`, err)
  }

  return { ok: true, nuvemshop_produto_ids: ids, foto_url: fotoUrl, estoque_sincronizado }
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
