// Gera as imagens estáticas do site a partir do visual do convite:
//   site/assets/img/og.jpg              prévia do link (WhatsApp, redes) — 1200×630
//   site/assets/img/apple-touch-icon.png ícone da tela inicial — 180×180
//   site/assets/img/favicon-32.png      ícone da aba — 32×32
// Uso: node scripts/gerar-assets.mjs   (só precisa rodar de novo se o visual mudar)
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontsDir = path.join(root, "site/assets/fonts");
const outDir = path.join(root, "site/assets/img");
mkdirSync(outDir, { recursive: true });

// Fontes embutidas como data URL: a página é montada com setContent, sem servidor.
const font = (file) => `url(data:font/woff2;base64,${readFileSync(path.join(fontsDir, file)).toString("base64")}) format("woff2")`;
const fontFaces = `
  @font-face { font-family: "Ephesis"; src: ${font("ephesis-latin-400-normal.woff2")}; }
  @font-face { font-family: "Cormorant Garamond"; font-style: normal; font-weight: 500; src: ${font("cormorant-garamond-latin-500-normal.woff2")}; }
  @font-face { font-family: "Cormorant Garamond"; font-style: italic; font-weight: 400; src: ${font("cormorant-garamond-latin-400-italic.woff2")}; }
  @font-face { font-family: "Cormorant Garamond"; font-style: italic; font-weight: 500; src: ${font("cormorant-garamond-latin-500-italic.woff2")}; }
  @font-face { font-family: "Montserrat"; font-weight: 500; src: ${font("montserrat-latin-500-normal.woff2")}; }
`;

// Mesmos ramos decorativos do topo do site (styles.css → .botanical)
const botanical = `
  .botanical { position: absolute; width: 420px; height: 520px; opacity: .56; pointer-events: none;
    background:
      radial-gradient(ellipse at 50% 12%, transparent 0 20%, #e7c995 21% 22%, transparent 23%),
      radial-gradient(ellipse at 25% 30%, transparent 0 19%, #e7c995 20% 21%, transparent 22%),
      radial-gradient(ellipse at 66% 47%, transparent 0 18%, #e7c995 19% 20%, transparent 21%),
      linear-gradient(120deg, transparent 0 47%, rgba(185,138,77,.32) 48% 48.5%, transparent 49%);
    filter: saturate(.7); }
`;

const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fontFaces}
  ${botanical}
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative; color: #6f4f2f;
    background: radial-gradient(circle at 50% 45%, rgba(255,255,255,.95), rgba(255,255,255,0) 45%), #fbfaf7;
    display: grid; place-items: center; text-align: center; }
  .tl { left: -170px; top: -230px; transform: rotate(-18deg); }
  .tr { right: -180px; top: -240px; transform: rotate(28deg); }
  .bl { left: -210px; bottom: -300px; transform: rotate(40deg); }
  .br { right: -200px; bottom: -300px; transform: rotate(-35deg); }
  .frame { position: absolute; inset: 26px; border: 1px solid rgba(156,113,63,.35); }
  .content { position: relative; z-index: 2; }
  .eyebrow { font: 500 20px Montserrat; letter-spacing: .42em; text-transform: uppercase; color: #82643f; margin: 0 0 6px; }
  h1 { margin: 0; font: 400 150px/1.05 "Ephesis"; color: #b98a4d; }
  h1 span { font: italic 400 52px "Cormorant Garamond"; color: #6f4f2f; padding: 0 34px 0 26px; vertical-align: 18px; }
  .line { width: 120px; height: 1px; background: rgba(156,113,63,.6); margin: 18px auto 22px; }
  .intro { margin: 0; font: italic 400 36px/1.25 "Cormorant Garamond"; letter-spacing: .04em; }
  .when { margin: 14px 0 0; font: 500 19px Montserrat; letter-spacing: .3em; text-transform: uppercase; color: #876430; }
</style></head><body>
  <div class="botanical tl"></div><div class="botanical tr"></div><div class="botanical bl"></div><div class="botanical br"></div>
  <div class="frame"></div>
  <div class="content">
    <p class="eyebrow">16 · 11 · 2026</p>
    <h1>Arthur<span>&amp;</span>Marina</h1>
    <div class="line"></div>
    <p class="intro">celebre conosco o nosso casamento civil em um jantar</p>
    <p class="when">segunda-feira · 19h · Florianópolis</p>
  </div>
</body></html>`;

const iconHtml = (size, variant) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fontFaces}
  html, body { margin: 0; }
  body { width: ${size}px; height: ${size}px; overflow: hidden; display: grid; place-items: center;
    background: radial-gradient(circle at 50% 45%, #ffffff, #f5f1ea 75%); color: #b98a4d; }
  .ring { position: absolute; inset: ${Math.round(size * 0.07)}px; border: ${Math.max(1, Math.round(size / 90))}px solid rgba(156,113,63,.55); border-radius: 50%; }
  .mono { position: relative; font: 400 ${Math.round(size * 0.3)}px/1 "Ephesis"; white-space: nowrap; }
  .mono span { font: italic 500 ${Math.round(size * 0.15)}px "Cormorant Garamond"; color: #6f4f2f; padding: 0 ${Math.round(size * 0.015)}px; }
  .amp { font: italic 500 ${Math.round(size * 0.95)}px/1 "Cormorant Garamond"; color: #876430; margin-top: -${Math.round(size * 0.12)}px; }
</style></head><body>
  ${variant === "monogram" ? `<div class="ring"></div><div class="mono">A<span>&amp;</span>M</div>` : `<div class="amp">&amp;</div>`}
</body></html>`;

const browser = await chromium.launch();
try {
  const render = async (html, width, height, file, type, quality) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outDir, file), type, quality });
    await page.close();
    console.log(`✔ ${file}`);
  };
  await render(ogHtml, 1200, 630, "og.jpg", "jpeg", 86);
  await render(iconHtml(180, "monogram"), 180, 180, "apple-touch-icon.png", "png");
  await render(iconHtml(32, "amp"), 32, 32, "favicon-32.png", "png");
} finally {
  await browser.close();
}
