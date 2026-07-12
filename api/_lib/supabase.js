// Helpers compartilhados pelas funções serverless da Vercel (cron + páginas de
// avaliação). Espelham o mesmo estilo de acesso direto ao REST do Supabase já
// usado em index-github.html (sbGet/sbUpsert) e em supabase/functions/pissilone-agent/lib.ts,
// só que aqui com a service_role key (bypassa RLS) em vez da chave anon do navegador.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_REVIEW_LINK = 'https://g.page/r/CdbBaO5k62FVEAE/review';

function sbHeaders(prefer) {
  const h = {
    'Content-Type': 'application/json',
    'apikey': SERVICE_KEY,
    'Authorization': 'Bearer ' + SERVICE_KEY,
  };
  if (prefer) h['Prefer'] = prefer;
  return h;
}

async function sbGet(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`sbGet ${table} falhou: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPatch(table, filtro, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filtro}`, {
    method: 'PATCH', headers: sbHeaders('return=minimal'), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPatch ${table} falhou: ${r.status} ${await r.text()}`);
}

async function sbPost(table, body, prefer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: sbHeaders(prefer || 'return=minimal'), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPost ${table} falhou: ${r.status} ${await r.text()}`);
  return prefer && prefer.includes('representation') ? r.json() : null;
}

function hojeISO() {
  const h = new Date();
  return h.getUTCFullYear() + '-' + String(h.getUTCMonth() + 1).padStart(2, '0') + '-' + String(h.getUTCDate()).padStart(2, '0');
}

function diasDesde(dataISO) {
  if (!dataISO) return -1;
  const [ay, am, ad] = dataISO.slice(0, 10).split('-').map(Number);
  const [hy, hm, hd] = hojeISO().split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(hy, hm - 1, hd);
  return Math.floor((b - a) / 86400000);
}

// Replica a lógica de waTel em index-github.html: só dígitos, prefixa 55 se vier sem DDI.
function normTel(tel) {
  const digits = String(tel || '').replace(/\D/g, '');
  if (digits && digits.length <= 11) return '55' + digits;
  return digits;
}

function parseNegHist(row) {
  try { if (row.neg_hist) return JSON.parse(row.neg_hist); } catch (e) { /* ignore */ }
  return [];
}

function parseMeta(row) {
  try { return JSON.parse(row.meta || '{}'); } catch (e) { return {}; }
}

// Faz merge de novas chaves dentro do JSON de meta sem apagar o resto (email, notas,
// log_hist, nps, etc.) — o mesmo cuidado que apiSave()/apiSaveContato() já tomam.
async function patchContatoMeta(id, partialMeta) {
  const rows = await sbGet('contatos', `id=eq.${encodeURIComponent(id)}&select=meta`);
  const atual = rows && rows[0] ? parseMeta(rows[0]) : {};
  const novo = { ...atual, ...partialMeta };
  await sbPatch('contatos', `id=eq.${encodeURIComponent(id)}`, { meta: JSON.stringify(novo) });
}

async function logAction(action, details) {
  try { await sbPost('usage_log', { action, details: details || '' }); } catch (e) { /* fire-and-forget */ }
}

async function enviarWhatsapp(numero, mensagem) {
  const token = process.env.AA_SEND_TOKEN || '';
  const instanceName = process.env.AA_INSTANCE_NAME || '';
  if (!token || !instanceName) { console.warn('AA_SEND_TOKEN/AA_INSTANCE_NAME não configurados — pulando envio.'); return false; }
  try {
    const resp = await fetch('https://aa.app.br/api/v1/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName, number: normTel(numero), type: 'text', message: mensagem }),
    });
    return resp.ok;
  } catch (e) {
    console.error('enviarWhatsapp error:', e);
    return false;
  }
}

// Confere o header que a própria Vercel envia automaticamente nas chamadas de cron
// quando a env var CRON_SECRET está configurada no projeto.
function autorizadoCron(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${secret}`;
}

module.exports = {
  GOOGLE_REVIEW_LINK,
  sbGet, sbPatch, sbPost,
  hojeISO, diasDesde, normTel,
  parseNegHist, parseMeta, patchContatoMeta,
  logAction, enviarWhatsapp, autorizadoCron,
};
