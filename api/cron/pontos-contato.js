// Vercel Cron (ver vercel.json, 09:00 horário de Brasília / 12:00 UTC todo dia).
// Varre neg_hist de cada contato à procura de vendas ('ganho') com 5+ dias e que ainda
// não geraram um ponto de contato (tabela pontos_contato). Pra cada venda elegível, cria
// a linha e manda uma mensagem com o link da pesquisa de satisfação (/avaliacao?tok=...).
// Só 1 venda pendente por contato por execução, pra não estourar várias mensagens de uma vez.
// Fora do escopo da Maria (agente de IA) — ver decisão registrada em pissilone-crm-claude-code.md.

const { sbGet, sbPost, diasDesde, parseNegHist, enviarWhatsapp, autorizadoCron } = require('../_lib/supabase');
const crypto = require('crypto');

function mensagemPontoContato(nome, link) {
  const primeiroNome = (nome || '').trim().split(/\s+/)[0] || '';
  const saudacao = primeiroNome ? `Oi, ${primeiroNome}!` : 'Oi!';
  return `${saudacao} Aqui é a Maria da Pissilone 💛 Tudo bem com você? A opinião dos nossos pissifãs é muito importante pra gente, e a sua principalmente. Por isso queria te perguntar: se você pudesse avaliar sua experiência com a Pissilone com uma nota de 0 a 10, qual seria? Deixa sua nota aqui: ${link}\n\nSua opinião é muito importante.`;
}

module.exports = async (req, res) => {
  if (!autorizadoCron(req)) {
    res.status(401).json({ erro: 'Não autorizado.' });
    return;
  }

  const baseUrl = process.env.PUBLIC_SITE_URL || '';
  if (!baseUrl) {
    res.status(500).json({ erro: 'PUBLIC_SITE_URL não configurada.' });
    return;
  }

  try {
    const existentes = await sbGet('pontos_contato', 'select=venda_id');
    const vendasProcessadas = new Set((existentes || []).map((r) => r.venda_id));

    const contatos = await sbGet('contatos', 'select=id,nome,tel,neg_hist');

    let criados = 0;
    for (const row of contatos || []) {
      if (!row.tel) continue;
      const hist = parseNegHist(row);
      const vendaElegivel = hist.find((ev) => ev && ev.r === 'ganho' && ev.venda_id && !vendasProcessadas.has(ev.venda_id) && diasDesde(ev.d) >= 5);
      if (!vendaElegivel) continue;

      try {
        const tok = crypto.randomUUID();
        await sbPost('pontos_contato', {
          id: tok,
          contato_id: row.id,
          contato_nome: row.nome || '',
          contato_tel: row.tel || '',
          venda_id: vendaElegivel.venda_id,
          data_compra: vendaElegivel.d || null,
        });
        vendasProcessadas.add(vendaElegivel.venda_id);

        const link = `${baseUrl.replace(/\/$/, '')}/avaliacao?tok=${tok}`;
        await enviarWhatsapp(row.tel, mensagemPontoContato(row.nome, link));
        criados++;
      } catch (e) {
        console.error(`Falha ao processar ponto de contato do contato ${row.id}:`, e);
      }
    }

    res.status(200).json({ ok: true, criados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err instanceof Error ? err.message : 'Erro interno.' });
  }
};
