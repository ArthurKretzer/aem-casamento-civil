// Layout em telas estreitas: nada pode vazar para o lado.

import { expect, test } from "@playwright/test";
import { COMING_SOON, openActiveSite, openGift, openSite, settlePage } from "./helpers.mjs";

const NARROW = { width: 360, height: 740 };

const horizontalOverflow = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

test.describe("Layout", () => {
  test("360px, Pix em breve: sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openSite(page, COMING_SOON);
    await settlePage(page);
    const { scrollWidth } = await horizontalOverflow(page);
    expect(scrollWidth, "document.documentElement.scrollWidth").toBeLessThanOrEqual(NARROW.width);
  });

  test("360px, Pix ativo: sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openActiveSite(page);
    await settlePage(page);
    const { scrollWidth } = await horizontalOverflow(page);
    expect(scrollWidth, "document.documentElement.scrollWidth").toBeLessThanOrEqual(NARROW.width);
  });

  test("tamanho padrão do projeto: sem rolagem horizontal", async ({ page }) => {
    await openActiveSite(page);
    await settlePage(page);
    const { scrollWidth, innerWidth } = await horizontalOverflow(page);
    expect(scrollWidth, "document.documentElement.scrollWidth").toBeLessThanOrEqual(innerWidth);
  });

  test("360px: o modal Pix cabe na tela e o QR Code tem pelo menos 280px", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openActiveSite(page);
    const dialog = await openGift(page, 1);

    const qr = dialog.getByTestId("pix-qr");
    await expect(qr).toHaveAttribute("data-ready", "true");
    await qr.scrollIntoViewIfNeeded();
    const qrBox = await qr.boundingBox();
    expect(qrBox.width, "largura do QR Code").toBeGreaterThanOrEqual(280);

    const box = await dialog.boundingBox();
    expect(box.x, "borda esquerda do modal").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "borda direita do modal").toBeLessThanOrEqual(NARROW.width);

    const { scrollWidth } = await horizontalOverflow(page);
    expect(scrollWidth, "página com o modal aberto").toBeLessThanOrEqual(NARROW.width);

    // O botão de fechar precisa estar à vista.
    const close = await dialog.getByTestId("pix-fechar").boundingBox();
    expect(close.x).toBeGreaterThanOrEqual(0);
    expect(close.x + close.width).toBeLessThanOrEqual(NARROW.width);
  });
});
