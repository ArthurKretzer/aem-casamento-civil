// Acessibilidade com axe-core. Todas as violações aparecem no console e nas
// anotações do teste; o teste só FALHA em violações de impacto "critical".

import { test } from "@playwright/test";
import { checkAccessibility, openActiveSite, openComingSoonSite, openGift, settlePage } from "./helpers.mjs";

test.describe("Acessibilidade (axe)", () => {
  test("página com Pix em breve", async ({ page }, testInfo) => {
    await openComingSoonSite(page);
    await settlePage(page);
    await checkAccessibility(page, testInfo, "em breve");
  });

  test("página com Pix ativo", async ({ page }, testInfo) => {
    await openActiveSite(page);
    await settlePage(page);
    await checkAccessibility(page, testInfo, "ativo");
  });

  test("modal Pix aberto", async ({ page }, testInfo) => {
    await openActiveSite(page);
    await openGift(page, 1);
    await checkAccessibility(page, testInfo, "modal aberto");
  });
});
