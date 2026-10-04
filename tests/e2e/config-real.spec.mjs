// A configuração REAL (site/config.js, sem nenhuma injeção). Serve de trava
// antes de publicar: se os noivos preencherem a chave Pix, estes testes
// conferem, com a chave de verdade, que a página, o Copia e Cola e o QR Code
// de cada presente estão corretos. Com a chave vazia, só conferem o modo.

import { expect, test } from "@playwright/test";
import {
  AVAILABLE_GIFTS,
  PixBR,
  SITE_CONFIG,
  expectDialogContent,
  expectQrToEncode,
  openGift,
  watchPage,
} from "./helpers.mjs";

// O que a página deveria decidir a partir do config.js real.
function expectedFromConfig() {
  const rawKey = String(SITE_CONFIG.pix.chave || "").trim();
  const receiver = String(SITE_CONFIG.pix.recebedor || "").trim();
  if (!rawKey) return { mode: "em-breve", reason: "chave vazia" };
  try {
    const key = PixBR.normalizeKey(rawKey).value;
    if (!receiver) return { mode: "em-breve", reason: "recebedor vazio" };
    return { mode: "ativo", key, receiver };
  } catch (error) {
    return { mode: "em-breve", reason: `chave inválida (${error.message})` };
  }
}

const expected = expectedFromConfig();

test.describe("Configuração real do config.js", () => {
  test(`o modo da página é "${expected.mode}"${expected.reason ? ` (${expected.reason})` : ""}`, async ({ page, baseURL }) => {
    const seen = watchPage(page, baseURL);
    await page.goto("./");
    await expect(page.getByTestId("presente-card").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-pix", expected.mode);
    // Se a chave está preenchida mas errada, o site avisa no console: aqui isso reprova.
    expect(seen.consoleErrors, "console.error com a configuração real").toEqual([]);
  });

  test.describe("com chave Pix real preenchida", () => {
    test.skip(expected.mode !== "ativo", "config.js ainda está sem chave Pix: nada a conferir.");

    test("a seção Pix mostra a chave e o recebedor reais", async ({ page }) => {
      await page.goto("./");
      await expect(page.getByTestId("pix-chave")).toHaveText(expected.key);
      await expect(page.getByTestId("pix-recebedor")).toContainText(expected.receiver);
    });

    // Presentes esgotados não abrem o modal e ficam de fora.
    for (const target of AVAILABLE_GIFTS) {
      test(`presente "${target.name}": Copia e Cola e QR Code corretos`, async ({ page }) => {
        await page.goto("./");
        await expect(page.getByTestId("presente-card").nth(target.index)).toBeVisible();
        await openGift(page, target.index);
        const payload = await expectDialogContent(page, { ...target, key: expected.key });
        await expectQrToEncode(page, payload);
        await expect(page.getByTestId("pix-recebedor-modal")).toContainText(expected.receiver);
      });
    }
  });
});
