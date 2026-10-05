// Testes de fumaça do site (Playwright): o essencial para publicar com
// segurança, sem cobrir cada detalhe. Rodam em desktop e celular.
//   npx playwright test                       (servidor local)
//   BASE_URL=https://.../ npx playwright test (site publicado)
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import pngjs from "pngjs";

const require = createRequire(import.meta.url);
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../site");
const PixBR = require(path.join(SITE, "assets/js/pix.js"));

function loadSiteData(file, name) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, file), "utf8"), sandbox);
  return sandbox.window[name];
}
const CONFIG = loadSiteData("config.js", "SITE_CONFIG");
const GIFTS = loadSiteData("presentes.js", "PRESENTES");
const AVAILABLE = GIFTS.map((gift, index) => ({ ...gift, index })).filter((gift) => !gift.esgotado);
/** Valor do Pix ao abrir o presente: o presente inteiro, ou 1 cota se ele for em cotas. */
const openingCents = (gift) => PixBR.parseAmountCents(gift.cota ?? gift.valor);

// Chave do exemplo oficial do Banco Central: só existe nos testes.
const TEST = { chave: "123e4567-e12b-12d1-a456-426655440000", recebedor: "Fulano de Tal", whatsapp: "5548999998888" };
const NO_KEY = { chave: "", recebedor: "", whatsapp: "" };

/**
 * Troca a chave/recebedor/WhatsApp só no navegador do teste (o config.js real
 * não muda). O corpo vem do config.js local, sem ir à rede, para funcionar
 * igual contra o servidor local e contra o site publicado.
 */
async function useConfig(page, { chave, recebedor, whatsapp }) {
  const original = fs.readFileSync(path.join(SITE, "config.js"), "utf8");
  const extra = `\nwindow.SITE_CONFIG.pix.chave = ${JSON.stringify(chave)};` +
    `\nwindow.SITE_CONFIG.pix.recebedor = ${JSON.stringify(recebedor)};` +
    `\nwindow.SITE_CONFIG.whatsapp = ${JSON.stringify(whatsapp)};`;
  await page.route(/\/config\.js(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: original + extra }));
}

/** Erros de console e respostas com falha (mesma origem) durante o teste. */
function watchErrors(page) {
  const errors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith(new URL(page.url() || "about:blank").origin)) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

async function openSite(page, config) {
  if (config) await useConfig(page, config);
  await page.goto("./");
  await expect(page.getByTestId("presente-card").first()).toBeVisible();
}

/** Código Pix esperado, com o presente na mensagem e no identificador. */
function expectedPayload(cents, gift, chave = TEST.chave) {
  const reference = PixBR.describeGift(gift, chave);
  return PixBR.buildPixPayload({ key: PixBR.normalizeKey(chave).value, name: CONFIG.pix.nomeQr, city: CONFIG.pix.cidadeQr, cents, ...reference });
}
const asGift = (gift, quantity = 1) => ({ id: gift.id, name: gift.nome, quantity, quotas: Boolean(gift.cota) });
const CUSTOM = { id: "valor-livre", name: "Contribuição livre" };

async function readQr(locator) {
  const png = pngjs.PNG.sync.read(await locator.screenshot());
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
}

test("carrega sem erros, com título, noindex e prévia para o WhatsApp", async ({ page }) => {
  const errors = watchErrors(page);
  await openSite(page, NO_KEY);
  await expect(page).toHaveTitle(/Arthur & Marina/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\/.+\/og\.jpg$/);
  expect(errors).toEqual([]);
});

test("um card por presente, com nome, valor e foto", async ({ page }) => {
  await openSite(page, NO_KEY);
  const cards = page.getByTestId("presente-card");
  await expect(cards).toHaveCount(GIFTS.length);
  for (const [index, gift] of GIFTS.entries()) {
    const card = cards.nth(index);
    const price = PixBR.formatBRL(openingCents(gift), { compact: true });
    await expect(card.getByTestId("presente-nome")).toHaveText(gift.nome);
    await expect(card.getByTestId("presente-valor")).toHaveText(gift.cota ? `${price} a cota` : price);
    if (gift.imagem) {
      const image = card.locator("img");
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0), { message: gift.imagem }).toBe(true);
    }
  }
});

test("sem chave Pix, os presentes aparecem como 'disponível em breve'", async ({ page }) => {
  await openSite(page, NO_KEY);
  await expect(page.locator("html")).toHaveAttribute("data-pix", "em-breve");
  for (const button of await page.getByTestId("presente-card-botao").all()) {
    await expect(button).toBeDisabled();
    await expect(button).toContainText(/em breve|já presenteado/);
  }
  await expect(page.getByTestId("valor-livre-botao")).toBeDisabled();
  await expect(page.getByTestId("pix-dialog")).not.toBeVisible();
});

test("presentear abre o modal com o Pix (com o presente na mensagem) e um QR Code que lê o mesmo código", async ({ page }) => {
  const errors = watchErrors(page);
  await openSite(page, TEST);
  const gift = AVAILABLE[Math.min(1, AVAILABLE.length - 1)];
  const cents = openingCents(gift);
  await page.getByTestId("presente-card-botao").nth(gift.index).click();

  const dialog = page.getByTestId("pix-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("pix-presente")).toHaveText(gift.nome);
  await expect(page.getByTestId("pix-valor")).toHaveText(PixBR.formatBRL(cents));
  await expect(page.getByTestId("pix-recebedor-modal")).toHaveText(TEST.recebedor);

  const payload = await page.getByTestId("pix-payload").inputValue();
  expect(payload).toBe(expectedPayload(cents, asGift(gift)));
  expect(PixBR.validatePayload(payload).ok).toBe(true);
  expect(PixBR.validatePayload(payload).fields["26"]["02"]).toBe(PixBR.describeGift(asGift(gift), TEST.chave).message);

  const qr = page.getByTestId("pix-qr");
  await expect(qr).toHaveAttribute("data-ready", "true");
  expect((await qr.boundingBox()).width).toBeGreaterThanOrEqual(240);
  expect(await readQr(qr)).toBe(payload);

  await page.getByTestId("pix-copiar").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(payload);
  await expect(page.getByTestId("pix-feedback")).toContainText(/copiado/i);

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("valor livre: '150,50' gera o Pix de R$ 150,50 e valor inválido mostra erro", async ({ page }) => {
  await openSite(page, TEST);
  const input = page.getByTestId("valor-livre-input");
  await input.fill("abc");
  await page.getByTestId("valor-livre-botao").click();
  await expect(page.getByTestId("valor-livre-erro")).toBeVisible();
  await expect(page.getByTestId("pix-dialog")).not.toBeVisible();

  await input.fill("150,50");
  await page.getByTestId("valor-livre-botao").click();
  await expect(page.getByTestId("pix-dialog")).toBeVisible();
  expect(await page.getByTestId("pix-payload").inputValue()).toBe(expectedPayload(15050, CUSTOM));
});

test("presente em cotas: o convidado escolhe quantas cotas e o Pix acompanha", async ({ page }) => {
  const gift = { id: "lua-de-mel-teste", nome: "Lua de mel (teste)", valor: 1000, cota: 250 };
  const gifts = fs.readFileSync(path.join(SITE, "presentes.js"), "utf8") + `\nwindow.PRESENTES.push(${JSON.stringify(gift)});`;
  await page.route(/\/presentes\.js(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: gifts }));
  await openSite(page, TEST);

  const card = page.getByTestId("presente-card").last();
  await expect(card.getByTestId("presente-valor")).toHaveText(`${PixBR.formatBRL(25000, { compact: true })} a cota`);
  await expect(card.getByTestId("presente-cota")).toContainText(PixBR.formatBRL(100000, { compact: true }));
  await card.getByTestId("presente-card-botao").click();

  await expect(page.getByTestId("pix-cotas")).toBeVisible();
  expect(await page.getByTestId("pix-payload").inputValue()).toBe(expectedPayload(25000, asGift(gift, 1)));
  await page.getByTestId("pix-cotas-mais").click();
  await page.getByTestId("pix-cotas-mais").click();
  await expect(page.getByTestId("pix-cotas-quantidade")).toHaveText("3");
  await expect(page.getByTestId("pix-valor")).toHaveText(PixBR.formatBRL(75000));
  const payload = await page.getByTestId("pix-payload").inputValue();
  expect(payload).toBe(expectedPayload(75000, asGift(gift, 3)));
  expect(await readQr(page.getByTestId("pix-qr"))).toBe(payload);

  await page.getByTestId("pix-cotas-mais").click(); // 4 cotas = presente completo
  await expect(page.getByTestId("pix-cotas-mais")).toBeDisabled();
  await expect(page.getByTestId("pix-valor")).toHaveText(PixBR.formatBRL(100000));
});

test("menu leva às seções; traje casual; presença pelo Google Forms, sem WhatsApp nem prazo", async ({ page }) => {
  await openSite(page, TEST);
  const menu = page.getByTestId("menu");
  await expect(menu.getByRole("link", { name: "Celebração" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Presença" })).toBeVisible();
  await menu.getByRole("link", { name: "Presentes" }).click();
  const heading = page.locator("#presentes h2");
  await expect(heading).toBeInViewport();
  await expect.poll(async () => (await heading.boundingBox()).y).toBeGreaterThanOrEqual((await menu.boundingBox()).height);

  await expect(page.getByTestId("traje")).toContainText(/casual/i);
  const rsvp = page.getByTestId("rsvp");
  await expect(rsvp).toContainText(/confirme sua presença/i);
  await expect(rsvp.locator('a[href*="wa.me"]')).toHaveCount(0);
  if (CONFIG.formularioPresenca) {
    await expect(page.getByTestId("rsvp-botao")).toHaveAttribute("href", CONFIG.formularioPresenca);
    await expect(page.getByTestId("rsvp-botao")).toHaveAttribute("target", "_blank");
  }
  await expect(rsvp).not.toContainText(/\d{1,2} de \w+|até/);
});

test("no celular (360px) não há rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openSite(page, TEST);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("a chave Pix só vem do config.js (parâmetros na URL são ignorados)", async ({ page }) => {
  await useConfig(page, TEST);
  await page.goto("./?chave=ATACANTE&recebedor=Fraudador#chave=ATACANTE");
  await page.getByTestId("presente-card-botao").nth(AVAILABLE[0].index).click();
  const payload = await page.getByTestId("pix-payload").inputValue();
  expect(payload).toContain(`0136${TEST.chave}`);
  expect(payload).not.toContain("ATACANTE");
  await expect(page.getByTestId("pix-recebedor-modal")).toHaveText(TEST.recebedor);
});

test("chave real do config.js (quando preenchida) gera um Pix válido em cada presente", async ({ page }) => {
  test.skip(!String(CONFIG.pix.chave || "").trim(), "pix.chave ainda está vazia no config.js");
  const errors = watchErrors(page);
  await openSite(page); // config.js real, sem injeção
  await expect(page.locator("html")).toHaveAttribute("data-pix", "ativo");
  for (const gift of AVAILABLE) {
    const cents = openingCents(gift);
    await page.getByTestId("presente-card-botao").nth(gift.index).click();
    const payload = await page.getByTestId("pix-payload").inputValue();
    expect(payload).toBe(expectedPayload(cents, asGift(gift), CONFIG.pix.chave));
    await expect(page.getByTestId("pix-recebedor-modal")).toHaveText(CONFIG.pix.recebedor.trim());
    await page.keyboard.press("Escape");
  }
  expect(errors).toEqual([]);
});
