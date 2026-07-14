import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  ApiError, Contato, ItemPedido,
  acharEtapaPorNome, apiSaveContato, criarEncomendasDoGanho,
  duplicarParaPissifaAuto, enviarImagemWhatsapp, findContatoByTel, getFunil, hojeISO, loadCfg,
  logAction, moverEstoquePedido, normDateAgente, normTel, normTelBR, novoContato, parseNegHist, parseValorBR,
  registrarParticipacao, rowToContato,
} from './lib.ts'

function reqStr(body: any, campo: string): string {
  const v = body?.[campo]
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new ApiError(400, `Campo obrigatório: ${campo}.`)
  }
  return String(v).trim()
}

// Acha o contato existente pelo telefone, ou lança erro pedindo pra chamar /criar-card antes.
async function exigirContato(supabase: SupabaseClient, telefone: string): Promise<Contato> {
  const row = await findContatoByTel(supabase, telefone)
  if (!row) throw new ApiError(404, 'Contato não encontrado para esse telefone. Chame /criar-card primeiro.')
  return rowToContato(row)
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
  const telefone = reqStr(body, 'telefone')
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
  const telefone = normTel(reqStr(body, 'telefone'))
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

// ── /dar-ganho ───────────────────────────────────────────
export async function darGanho(supabase: SupabaseClient, body: any) {
  const telefone = reqStr(body, 'telefone')
  const formaPagamento = reqStr(body, 'forma_pagamento')
  const valor = parseValorBR(body?.valor)
  if (isNaN(valor) || valor <= 0) throw new ApiError(400, 'Campo obrigatório: valor (maior que zero).')

  const c = await exigirContato(supabase, telefone)
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
  const telefone = reqStr(body, 'telefone')
  const motivo = (body?.motivo ? String(body.motivo).trim() : '') || 'Não informado'

  const c = await exigirContato(supabase, telefone)
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
  const telefone = reqStr(body, 'telefone')
  const etapaNome = reqStr(body, 'etapa_nome')

  const c = await exigirContato(supabase, telefone)
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
  const telefone = reqStr(body, 'telefone')
  const dataNorm = normDateAgente(reqStr(body, 'data'), 'data')
  if (!dataNorm) throw new ApiError(400, 'Data inválida. Use o formato AAAA-MM-DD.')
  const descricao = body?.descricao ? String(body.descricao).trim() : ''

  const c = await exigirContato(supabase, telefone)
  c.atv_data = dataNorm
  c.atv_desc = descricao
  if (!Array.isArray(c.log_hist)) c.log_hist = []
  c.log_hist.push({ tipo: 'atv_criada', d: new Date().toISOString(), txt: descricao || 'Atividade', data_agendada: dataNorm })

  await apiSaveContato(supabase, c)
  return { ok: true, id: c.id, atv_data: c.atv_data, atv_desc: c.atv_desc }
}

// ── /atividade/concluir ──────────────────────────────────
export async function concluirAtividade(supabase: SupabaseClient, body: any) {
  const telefone = reqStr(body, 'telefone')
  const c = await exigirContato(supabase, telefone)
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
