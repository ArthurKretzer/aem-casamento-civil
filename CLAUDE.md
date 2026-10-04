# Site do casamento Arthur & Marina

Site estático (HTML/CSS/JS puro, sem build) no GitHub Pages, em SUBCAMINHO:
https://arthurkretzer.github.io/presentes-casamento/. Textos, README e comentários em pt-BR;
nomes de funções e variáveis em inglês.

## Estrutura
- `site/` é a única pasta publicada. Os noivos editam só `site/config.js` (Pix, WhatsApp, prazo)
  e `site/presentes.js` (lista de presentes).
- `site/assets/js/pix.js` (UMD: `PixBR` no navegador, `module.exports` no Node) e `app.js` (página e modal).
  Os `data-testid` do HTML são o contrato com os testes.
- `scripts/` (`servir`, `validar-dados`, `gerar-assets`), `tests/unit` (node --test), `tests/e2e` (Playwright).
- `.github/workflows/pages.yml`: testes em toda branch; só a `main` publica (sem job de verificação pós-deploy).

## Comandos
- `npm run servir` abre http://127.0.0.1:4173/presentes-casamento/
- `npm test` (valida dados + unitários) e `npx playwright test` (desktop e mobile; sobe o servidor sozinho)
- `BASE_URL=<url> npx playwright test` testa a produção (`tests/e2e/site.spec.mjs`, testes de fumaça)
- Atrás de proxy TLS, passe argumentos ao Chromium com `PW_CHROMIUM_ARGS`; nunca use `ignoreHTTPSErrors`.

## Regras
- URLs sempre relativas (`assets/js/app.js`, nunca `/assets/...`): o site vive em `/presentes-casamento/`.
- CSP `default-src 'self'`: nada inline (script, style, onclick). Fontes e libs locais, sem CDN.
- A chave Pix vem SÓ de `site/config.js`, nunca de URL, query string ou campo da página.
  Chave vazia ou inválida mantém `html[data-pix="em-breve"]`.
- Fotos dos presentes: JPEG 960x720, até 150 KB, em `site/assets/img/presentes/`.
- Manter a identidade visual do convite: paleta dourado, marrom e creme; fontes Cormorant Garamond,
  Great Vibes e Montserrat.
- Textos do site em pt-BR, tom caloroso e direto; não inventar dados dos noivos.
- Mudou o DOM, um `data-testid` ou o `config.js`? Atualize testes e README no mesmo commit.
- Antes de publicar, `npm test` e `npx playwright test` precisam passar. Publicar = push na `main`
  (o CI testa e publica). `site/version.txt` é gerado pelo CI: não commitar.
- O site é simples: mantenha os testes enxutos (fumaça + Pix). Mudança pequena não precisa de
  QA extenso, novos specs nem novos jobs de CI; rode `npm test` e `npx playwright test` e publique.
- A seção "Sem intermediários" foi removida de propósito: a experiência é de lista de presentes;
  o Pix é só o meio de pagamento dentro do modal.
