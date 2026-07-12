// Vercel Cron (ver vercel.json, 09:00 horário de Brasília / 12:00 UTC todo dia).
// Varre os contatos, manda parabéns automático pra quem faz aniversário hoje e ainda
// não recebeu a mensagem este ano, e marca o ano em contatos.meta.aniversario_ano_enviado
// pra não reenviar. Fora do escopo da Maria (agente de IA) — ver decisão registrada em
// pissilone-crm-claude-code.md.

const { sbGet, hojeISO, patchContatoMeta, logAction, enviarWhatsapp, parseMeta, autorizadoCron } = require('../_lib/supabase');

function mensagemAniversario(nome) {
  const primeiroNome = (nome || '').trim().split(/\s+/)[0] || '';
  const saudacao = primeiroNome ? `Parabéns, ${primeiroNome}!` : 'Parabéns!';
  return `${saudacao} 🎂 A equipe da Pissilone deseja um dia muito especial pra você, com todo carinho do sertão. Um abraço da gente! Para celebrar esse momento, queremos te dar um mimo de presente que você pode buscar pessoalmente no ateliê em até 30 dias. Será um prazer te receber pra tomar um café.`;
}

module.exports = async (req, res) => {
  if (!autorizadoCron(req)) {
    res.status(401).json({ erro: 'Não autorizado.' });
    return;
  }

  try {
    const hj = hojeISO();
    const mmdd = hj.slice(5);
    const anoAtual = hj.slice(0, 4);

    const contatos = await sbGet('contatos', 'select=id,nome,tel,aniversario,meta');

    let enviados = 0;
    for (const row of contatos || []) {
      const aniv = String(row.aniversario || '');
      if (aniv.slice(5, 10) !== mmdd) continue;
      if (!row.tel) continue;
      const meta = parseMeta(row);
      if (meta.aniversario_ano_enviado === anoAtual) continue;

      try {
        const ok = await enviarWhatsapp(row.tel, mensagemAniversario(row.nome));
        if (ok) {
          await patchContatoMeta(row.id, { aniversario_ano_enviado: anoAtual });
          await logAction('parabens_enviados', row.nome || row.id);
          enviados++;
        }
      } catch (e) {
        console.error(`Falha ao processar aniversário do contato ${row.id}:`, e);
      }
    }

    res.status(200).json({ ok: true, enviados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err instanceof Error ? err.message : 'Erro interno.' });
  }
};
