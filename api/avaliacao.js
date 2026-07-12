// Página pública (link mandado pelo cron de pontos-contato). Mostra os botões de nota
// 0–10 pra um token de pesquisa ainda não respondido. Sem JS — cada nota é um link.

const { sbGet } = require('./_lib/supabase');
const { renderPage } = require('./_lib/page');

module.exports = async (req, res) => {
  const tok = String(req.query.tok || '').trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!tok) {
    res.status(400).send(renderPage('Link inválido', '<div class="emoji">🤔</div><h1>Link inválido</h1><p>Não encontramos essa pesquisa. Confere se copiou o link certinho.</p>'));
    return;
  }

  try {
    const rows = await sbGet('pontos_contato', `id=eq.${encodeURIComponent(tok)}&select=id,contato_nome,nota,respondido_em`);
    const row = rows && rows[0];

    if (!row) {
      res.status(404).send(renderPage('Pesquisa não encontrada', '<div class="emoji">🤔</div><h1>Não encontramos essa pesquisa</h1><p>O link pode ter expirado. Fica à vontade pra chamar a gente no WhatsApp.</p>'));
      return;
    }

    if (row.respondido_em) {
      res.status(200).send(renderPage('Já avaliado', '<div class="emoji">💛</div><h1>Você já avaliou, obrigada!</h1><p>Já recebemos sua nota. Agradecemos demais o carinho de responder.</p>'));
      return;
    }

    const primeiroNome = (row.contato_nome || '').trim().split(/\s+/)[0] || '';
    const notas = Array.from({ length: 11 }, (_, n) => n);
    const botoes = notas.map((n) => `<a href="/avaliacao-enviar?tok=${encodeURIComponent(tok)}&nota=${n}">${n}</a>`).join('');

    const corpo = `
      <div class="emoji">💛</div>
      <h1>${primeiroNome ? `Oi, ${primeiroNome}!` : 'Oi!'}</h1>
      <p>Como foi sua experiência com a compra na Pissilone? Dá uma nota de 0 a 10 pra gente:</p>
      <div class="notas">${botoes}</div>
    `;
    res.status(200).send(renderPage('Como foi sua experiência?', corpo));
  } catch (err) {
    console.error(err);
    res.status(500).send(renderPage('Erro', '<div class="emoji">😕</div><h1>Deu um erro por aqui</h1><p>Tenta de novo em instantes.</p>'));
  }
};
