// Capturas de tela para conferir o visual (desktop e celular).
// Só roda quando pedido:
//
//   SCREENSHOTS=1 npx playwright test screenshots
//
// Os PNGs vão para test-results/screenshots/<projeto>-<nome>.png

import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import {
  REPO_ROOT,
  openActiveSite,
  openComingSoonSite,
  openGift,
  settlePage,
} from "./helpers.mjs";

test.skip(process.env.SCREENSHOTS !== "1", "Defina SCREENSHOTS=1 para gerar as capturas de tela.");

const OUTPUT_DIR = path.join(REPO_ROOT, "test-results", "screenshots");

async function capture(page, testInfo, name, options = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path: file, animations: "disabled", ...options });
  console.log(`captura: ${path.relative(REPO_ROOT, file)}`);
}

// Páginas muito altas em telas de alta densidade passam do limite de textura
// do Chromium; nesse caso a captura sai em 1 pixel por pixel CSS.
async function fullPage(page, testInfo, name) {
  await settlePage(page);
  const { height, ratio } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    ratio: window.devicePixelRatio,
  }));
  await capture(page, testInfo, name, {
    fullPage: true,
    scale: height * ratio > 15000 ? "css" : "device",
  });
}

test.describe("Capturas de tela", () => {
  test("página inteira, Pix em breve", async ({ page }, testInfo) => {
    await openComingSoonSite(page);
    await fullPage(page, testInfo, "em-breve");
  });

  test("página inteira, Pix ativo", async ({ page }, testInfo) => {
    await openActiveSite(page);
    await fullPage(page, testInfo, "ativo");
  });

  test("modal Pix aberto", async ({ page }, testInfo) => {
    await openActiveSite(page);
    await openGift(page, 1);
    await page.getByTestId("pix-qr").evaluate((image) => image.decode());
    await capture(page, testInfo, "modal");
  });

  test("página inteira em 360px, Pix ativo", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openActiveSite(page);
    await fullPage(page, testInfo, "360px");
  });

  test("página inteira em 360px, Pix em breve", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openComingSoonSite(page);
    await fullPage(page, testInfo, "360px-em-breve");
  });
});
