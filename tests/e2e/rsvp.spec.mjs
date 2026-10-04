// Confirmação de presença: botão do WhatsApp (só se houver número) e prazo.

import { expect, test } from "@playwright/test";
import { COMING_SOON, SITE_CONFIG, TEST_WHATSAPP, injectConfig, openSite } from "./helpers.mjs";

// "2026-10-15" -> { day: 15, month: "outubro" }, sem depender do fuso da máquina.
function deadlineParts(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(date);
  return { day, month: monthName };
}

const deadlinePattern = ({ day, month }) => new RegExp(`\\b${day}º? de ${month}\\b`, "i");

test.describe("Confirmação de presença", () => {
  test("sem WhatsApp: botão oculto e texto alternativo visível", async ({ page }) => {
    await openSite(page, COMING_SOON);
    await expect(page.getByTestId("rsvp-botao")).toBeHidden();
    await expect(page.getByTestId("rsvp-sem-whatsapp")).toBeVisible();
    await expect(page.getByTestId("rsvp-sem-whatsapp")).toHaveText(/\S/);
  });

  test("com WhatsApp: botão visível apontando para o wa.me, sem texto alternativo", async ({ page }) => {
    await openSite(page, { whatsapp: TEST_WHATSAPP });
    const button = page.getByTestId("rsvp-botao");
    await expect(button).toBeVisible();
    await expect(page.getByTestId("rsvp-sem-whatsapp")).toBeHidden();

    const href = await button.getAttribute("href");
    expect(href).toMatch(new RegExp(`^https://wa\\.me/${TEST_WHATSAPP}\\?text=.+`));
    expect(new URL(href).searchParams.get("text"), "mensagem pré-preenchida").toMatch(/\S/);
  });

  test("mostra o prazo do config.js", async ({ page }) => {
    await openSite(page);
    await expect(page.getByTestId("rsvp-prazo")).toHaveText(deadlinePattern(deadlineParts(SITE_CONFIG.rsvpPrazo)));
  });

  test("o prazo acompanha o config.js (não está escrito à mão no HTML)", async ({ page }) => {
    await injectConfig(page, { rsvpPrazo: "2026-12-08" });
    await page.goto("./");
    await expect(page.getByTestId("rsvp-prazo")).toHaveText(deadlinePattern({ day: 8, month: "dezembro" }));
  });
});
