// Ajudantes compartilhados pelos testes de ponta a ponta.
//
// Os valores "esperados" vêm de fora da página: config.js e presentes.js são
// lidos do disco e pix.js roda no Node. Assim o teste compara o que o
// navegador mostrou com o que deveria aparecer, e não a página com ela mesma.
// Os testes funcionam no site local e no publicado (BASE_URL).

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import pngjs from "pngjs";
import { hasError, parsePix } from "pix-utils";

const { PNG } = pngjs;
const require = createRequire(import.meta.url);

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SITE_DIR = path.join(REPO_ROOT, "site");

// ---------- Dados do site, lidos do disco ----------
function loadSiteData(fileName, globalName) {
  const source = fs.readFileSync(path.join(SITE_DIR, fileName), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: fileName });
  // Passa por JSON para sair do contexto isolado do vm (comparações do expect).
  return JSON.parse(JSON.stringify(sandbox.window[globalName]));
}

export const SITE_CONFIG = loadSiteData("config.js", "SITE_CONFIG");
export const PRESENTES = loadSiteData("presentes.js", "PRESENTES");
export const PixBR = require(path.join(SITE_DIR, "assets", "js", "pix.js"));

// ---------- Configurações injetadas nos testes ----------
// Chave de teste do Banco Central (exemplo da documentação do BR Code).
export const TEST_KEY = "123e4567-e12b-12d1-a456-426655440000";
export const TEST_RECEIVER = "Fulano de Tal";
export const TEST_WHATSAPP = "5548999998888";

export const ACTIVE = { chave: TEST_KEY, recebedor: TEST_RECEIVER, whatsapp: TEST_WHATSAPP };
export const COMING_SOON = { chave: "", recebedor: "", whatsapp: "" };

// Acrescenta código ao final de um script do site, interceptando a resposta.
// Funciona igual contra o site local e contra a produção.
async function appendToScript(page, pattern, code) {
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response }); // deixa o erro real aparecer na página
      return;
    }
    const original = await response.text();
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: `${original}\n;${code}\n`,
    });
  });
}

// Sobrescreve campos de config.js. Aceita chave, recebedor, nomeQr, cidadeQr
// (vão para SITE_CONFIG.pix) e whatsapp, rsvpPrazo, siteUrl (nível de cima).
// Chame ANTES de page.goto().
export async function injectConfig(page, overrides = {}) {
  const { chave, recebedor, nomeQr, cidadeQr, ...top } = overrides;
  const pix = Object.fromEntries(
    Object.entries({ chave, recebedor, nomeQr, cidadeQr }).filter(([, value]) => value !== undefined),
  );
  await appendToScript(
    page,
    /\/config\.js(\?.*)?$/,
    `(function () {
      var config = (window.SITE_CONFIG = window.SITE_CONFIG || {});
      config.pix = Object.assign({}, config.pix, ${JSON.stringify(pix)});
      Object.assign(config, ${JSON.stringify(top)});
    })();`,
  );
}

// Roda código extra depois de presentes.js (ex.: marcar um item como esgotado).
export async function injectGifts(page, code) {
  await appendToScript(page, /\/presentes\.js(\?.*)?$/, code);
}

// Abre o site. Com `overrides`, injeta a configuração antes de carregar.
export async function openSite(page, overrides) {
  if (overrides) await injectConfig(page, overrides);
  await page.goto("./");
  await expect(page.getByTestId("presente-card").first()).toBeVisible();
}

export async function openActiveSite(page, overrides = {}) {
  await openSite(page, { ...ACTIVE, ...overrides });
  await expect(page.locator("html")).toHaveAttribute("data-pix", "ativo");
}

export async function openComingSoonSite(page, overrides = {}) {
  await openSite(page, { ...COMING_SOON, ...overrides });
  await expect(page.locator("html")).toHaveAttribute("data-pix", "em-breve");
}

// ---------- Observação da página ----------
// Junta erros de console, exceções e problemas de rede para conferir no fim.
// Cancelamentos (ERR_ABORTED) não contam: o navegador cancela sozinho, por
// exemplo, imagens que saem da tela.
export function watchPage(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const seen = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    foreignRequests: [],
  };
  const isNetwork = (url) => /^https?:/i.test(url);

  page.on("console", (message) => {
    if (message.type() === "error") seen.consoleErrors.push(message.text());
    if (message.type() === "warning") seen.consoleWarnings.push(message.text());
  });
  page.on("pageerror", (error) => seen.pageErrors.push(String(error.message || error)));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!isNetwork(url) || new URL(url).origin !== origin) return;
    const reason = request.failure()?.errorText || "falhou";
    if (reason.includes("ERR_ABORTED")) return;
    seen.failedRequests.push(`${request.method()} ${url} (${reason})`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isNetwork(url) && new URL(url).origin === origin && response.status() >= 400) {
      seen.badResponses.push(`${response.status()} ${url}`);
    }
  });
  page.on("request", (request) => {
    const url = request.url();
    // Fotos de outros endereços são permitidas pela CSP; código e fontes não.
    if (isNetwork(url) && new URL(url).origin !== origin && request.resourceType() !== "image") {
      seen.foreignRequests.push(`${request.resourceType()} ${url}`);
    }
  });
  return seen;
}

// Rola a página inteira para disparar imagens com loading="lazy".
export async function scrollThroughPage(page) {
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const height = () => document.documentElement.scrollHeight;
    for (let y = 0; y < height(); y += step) {
      window.scrollTo({ top: y, behavior: "instant" });
      await wait(60);
    }
    window.scrollTo({ top: height(), behavior: "instant" });
    await wait(150);
    window.scrollTo({ top: 0, behavior: "instant" });
  });
}

// Espera todas as <img> da página terminarem de carregar (ou de falhar).
export async function waitForImages(page) {
  await expect
    .poll(() => page.evaluate(() => [...document.images].every((image) => image.complete)), {
      message: "imagens ainda carregando",
    })
    .toBe(true);
}

// Deixa a página pronta para captura: rolou tudo, imagens e fontes carregadas.
export async function settlePage(page) {
  await scrollThroughPage(page);
  await waitForImages(page);
  await page.evaluate(() => document.fonts.ready);
}

// ---------- Pix: valores esperados ----------
export const toCents = (valor) => Math.round(valor * 100);

// Presentes que o convidado consegue escolher (os esgotados ficam de fora),
// com a posição de cada um na página. Os testes do modal usam estes, para não
// quebrarem se os noivos marcarem um presente como "já presenteado".
export const AVAILABLE_GIFTS = PRESENTES.map((gift, index) => ({
  index,
  gift,
  name: gift.nome,
  cents: toCents(gift.valor),
})).filter(({ gift }) => !gift.esgotado);

// n-ésimo presente disponível (0 = o primeiro); se houver menos, o último.
export function requireGift(position) {
  const pick = AVAILABLE_GIFTS[Math.min(position, AVAILABLE_GIFTS.length - 1)];
  test.skip(!pick, "Todos os presentes estão esgotados: não há o que escolher no modal.");
  return pick;
}

// Intl usa espaço sem quebra entre "R$" e o número; normalizamos para comparar.
export const brl = (cents, compact = false) =>
  PixBR.formatBRL(cents, { compact }).replace(/\u00a0/g, " ");

export function expectedPayload(cents, key = TEST_KEY) {
  return PixBR.buildPixPayload({
    key,
    name: SITE_CONFIG.pix.nomeQr,
    city: SITE_CONFIG.pix.cidadeQr,
    cents,
  });
}

// CRC16/CCITT-FALSE escrito aqui de novo, de propósito: confere o CRC sem
// depender do pix.js que está sendo testado.
export function crc16(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Confere um Copia e Cola por três caminhos: o validador do site, um CRC
// independente e a biblioteca de terceiros pix-utils (que lê como um banco).
export function expectValidPayload(payload, { cents, key = TEST_KEY }) {
  const check = PixBR.validatePayload(payload);
  expect(check.errors, "erros do validatePayload").toEqual([]);
  expect(check.ok).toBe(true);

  expect(payload.slice(-4), "CRC16 calculado de forma independente").toBe(crc16(payload.slice(0, -4)));

  const parsed = parsePix(payload);
  expect(hasError(parsed), `pix-utils recusou o código: ${JSON.stringify(parsed)}`).toBe(false);
  expect(parsed).toMatchObject({
    type: "STATIC",
    pixKey: key,
    merchantName: PixBR.normalizeText(SITE_CONFIG.pix.nomeQr, 25),
    merchantCity: PixBR.normalizeText(SITE_CONFIG.pix.cidadeQr, 15),
    transactionAmount: cents / 100,
  });
}

// ---------- Modal Pix ----------
export async function openGift(page, index) {
  await page.getByTestId("presente-card").nth(index).getByTestId("presente-card-botao").click();
  const dialog = page.getByTestId("pix-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function submitCustomAmount(page, text) {
  await page.getByTestId("valor-livre-input").fill(text);
  await page.getByTestId("valor-livre-botao").click();
}

// Confere valor, nome e Copia e Cola do modal aberto. Devolve o Copia e Cola.
export async function expectDialogContent(page, { cents, name, key = TEST_KEY }) {
  const dialog = page.getByTestId("pix-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("pix-valor")).toHaveText(brl(cents));
  await expect(dialog.getByTestId("pix-presente")).toHaveText(name);
  const payload = expectedPayload(cents, key);
  await expect(dialog.getByTestId("pix-payload")).toHaveValue(payload);
  expectValidPayload(payload, { cents, key });
  return payload;
}

export function decodeQrPng(buffer) {
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

// Tira um "print" do QR Code, como uma câmera veria, e confere o conteúdo.
export async function expectQrToEncode(page, payload) {
  const qr = page.getByTestId("pix-qr");
  await expect(qr).toHaveAttribute("data-ready", "true");
  await expect
    .poll(() => qr.evaluate((image) => image.complete && image.naturalWidth > 0), {
      message: "imagem do QR Code não carregou",
    })
    .toBe(true);
  await expect
    .poll(async () => decodeQrPng(await qr.screenshot({ animations: "disabled" })), {
      message: "o QR Code não decodificou para o Copia e Cola esperado",
    })
    .toBe(payload);
}

// Ponto do "fundo" (fora da caixa do modal) para simular o clique fora.
export async function backdropPoint(page, dialog) {
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  const corners = [
    { x: 2, y: 2 },
    { x: viewport.width - 3, y: 2 },
    { x: 2, y: viewport.height - 3 },
    { x: viewport.width - 3, y: viewport.height - 3 },
  ];
  const outside = ({ x, y }) =>
    x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height;
  const point = corners.find(outside);
  if (!point) throw new Error("O modal ocupa a tela toda: não há fundo para clicar.");
  return point;
}

// Lê a área de transferência sem estourar: devolve o motivo se falhar.
export function readClipboard(page) {
  return page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      return `ERRO ao ler a área de transferência: ${error.name}: ${error.message}`;
    }
  });
}

// Põe um texto "marcador" na área de transferência antes de copiar. Sem isso,
// um teste poderia passar por engano com o que outro teste copiou antes (o
// Chromium compartilha a área de transferência entre os testes de um worker).
export const CLIPBOARD_MARKER = "(marcador do teste)";

export async function seedClipboard(page, text = CLIPBOARD_MARKER) {
  await page.evaluate((value) => Clipboard.prototype.writeText.call(navigator.clipboard, value), text);
  expect(await readClipboard(page), "marcador na área de transferência").toBe(text);
}

// ---------- Acessibilidade ----------
// Registra todas as violações (anotações + console) e só falha nas críticas.
export async function checkAccessibility(page, testInfo, label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();

  for (const violation of violations) {
    const targets = violation.nodes
      .slice(0, 3)
      .map((node) => node.target.join(" "))
      .join(" | ");
    const description = `[${label}] ${violation.id}: ${violation.help} (${violation.nodes.length} elemento(s)) ${targets}`;
    testInfo.annotations.push({ type: `axe-${violation.impact}`, description });
    console.log(`axe ${violation.impact} ${description}`);
  }

  const critical = violations
    .filter((violation) => violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.help}`);
  expect(critical, `violações críticas de acessibilidade (${label})`).toEqual([]);
  return violations;
}
