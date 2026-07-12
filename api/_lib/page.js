// Página HTML simples e responsiva pra pesquisa de satisfação (sem framework, sem JS
// necessário) — aberta direto do link mandado no WhatsApp, então precisa funcionar bem
// no navegador do celular sozinha.

function renderPage(titulo, corpoHtml) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} — Pissilone</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:2rem 1rem;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#faf6f0;color:#2b2320;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{max-width:420px;width:100%;background:#fff;border-radius:16px;padding:2rem 1.5rem;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{font-size:.95rem;line-height:1.5;color:#5c5049;margin:0 0 1.25rem}
  .notas{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
  .notas a{display:flex;align-items:center;justify-content:center;height:44px;border-radius:10px;background:#f3ece2;color:#2b2320;text-decoration:none;font-weight:700;font-size:1rem;border:1px solid #e6dccb}
  .notas a:hover{background:#e9dcc3}
  .btn-google{display:inline-block;margin-top:.5rem;background:#c99a3d;color:#fff;text-decoration:none;font-weight:700;padding:.85rem 1.5rem;border-radius:10px;font-size:.95rem}
  .emoji{font-size:2rem;margin-bottom:.5rem}
</style>
</head>
<body>
  <div class="card">${corpoHtml}</div>
</body>
</html>`;
}

module.exports = { renderPage };
