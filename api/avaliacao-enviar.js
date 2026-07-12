// Grava a nota escolhida em /avaliacao. Idempotente: um token só pode ser respondido
// uma vez (respondido_em trava reenvio/alteração da nota). Espelha a nota em
// contatos.meta.nps pra alimentar o card de NPS que já existe na aba Insights do CRM,
// sem precisar de UI nova.

const { sbGet, sbPatch, patchContatoMeta, logAction, GOOGLE_REVIEW_LINK } = require('./_lib/supabase');
const { renderPage } = require('./_lib/page');

module.exports = async (req, res) => {
  const tok = String(req.query.tok || '').trim();
  const nota = parseInt(req.query.nota, 10);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!tok || isNaN(nota) || nota < 0 || nota > 10) {
    res.status(400).send(renderPage('Link inválido', '<div class="emoji">🤔</div><h1>Link inválido</h1><p>Não conseguimos entender essa avaliação. Confere se copiou o link certinho.</p>'));
    return;
  }

  try {
    const rows = await sbGet('pontos_contato', `id=eq.${encodeURIComponent(tok)}&select=id,contato_id,contato_nome,respondido_em`);
    const row = rows && rows[0];

    if (!row) {
      res.status(404).send(renderPage('Pesquisa não encontrada', '<div class="emoji">🤔</div><h1>Não encontramos essa pesquisa</h1><p>O link pode ter expirado. Fica à vontade pra chamar a gente no WhatsApp.</p>'));
      return;
    }

    if (row.respondido_em) {
      res.status(200).send(renderPage('Já avaliado', '<div class="emoji">💛</div><h1>Você já avaliou, obrigada!</h1><p>Já recebemos sua nota. Agradecemos demais o carinho de responder.</p>'));
      return;
    }

    await sbPatch('pontos_contato', `id=eq.${encodeURIComponent(tok)}`, { nota, respondido_em: new Date().toISOString() });
    await patchContatoMeta(row.contato_id, { nps: nota });
    await logAction('nps_registrado', (row.contato_nome || row.contato_id) + ' - nota ' + nota);

    const primeiroNome = (row.contato_nome || '').trim().split(/\s+/)[0] || '';

    if (nota > 8) {
      const corpo = `
        <div class="emoji">🎉</div>
        <h1>Eita que coisa boa!</h1>
        <p>Ficamos todos tão felizes com essa sua nota. Nesse caso, sua opinião nos ajuda demais a sermos vistos. Você consegue deixar uma avaliação no Google da Pissilone? Leva no máximo 2 minutos, e eu te prometo pessoalmente um desconto de 10% na sua próxima compra. 💛 É só acessar o link:</p>
        <a class="btn-google" href="${GOOGLE_REVIEW_LINK}" target="_blank" rel="noopener">Avaliar no Google</a>
      `;
      res.status(200).send(renderPage('Obrigada!', corpo));
    } else {
      const corpo = `
        <div class="emoji">💛</div>
        <h1>${primeiroNome ? `Eita, ${primeiroNome}.` : 'Eita!'}</h1>
        <p>Eu agradeço muito seu feedback, mas como uma das coisas que mais prezamos é a sua experiência, nos conta o que faltou para chegarmos ao 10.</p>
      `;
      res.status(200).send(renderPage('Obrigada!', corpo));
    }
  } catch (err) {
    console.error(err);
    res.status(500).send(renderPage('Erro', '<div class="emoji">😕</div><h1>Deu um erro por aqui</h1><p>Tenta de novo em instantes.</p>'));
  }
};
