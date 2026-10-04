// Modo "Pix em breve": chave vazia ou inválida no config.js. O site nunca pode
// mostrar QR Code, chave ou aceitar valores quando algo não está certo.
// A chave é sempre injetada aqui (e não lida do config.js real), para o teste
// continuar valendo depois que os noivos preencherem a chave de verdade.

import { expect, test } from "@playwright/test";
import {
  COMING_SOON,
  PRESENTES,
  TEST_KEY,
  TEST_RECEIVER,
  injectConfig,
  openComingSoonSite,
  watchPage,
} from "./helpers.mjs";

test.describe("Pix em breve (chave vazia)", () => {
  test("a página inteira entra em modo em breve", async ({ page }) => {
    await openComingSoonSite(page);
    await expect(page.getByTestId("pix-em-breve")).toBeVisible();
    await expect(page.getByTestId("pix-chave")).toBeHidden();
    // Nada de copiar uma chave que não existe.
    const copyKey = page.getByTestId("pix-copiar-chave");
    expect((await copyKey.isVisible()) && (await copyKey.isEnabled()), "copiar chave utilizável").toBe(false);
  });

  test("os botões dos cards ficam desabilitados e dizem \"em breve\"", async ({ page }) => {
    await openComingSoonSite(page);
    const buttons = page.getByTestId("presente-card-botao");
    await expect(buttons).toHaveCount(PRESENTES.length);
    for (const button of await buttons.all()) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveText(/em breve/i);
    }
  });

  test("o valor livre fica desabilitado", async ({ page }) => {
    await openComingSoonSite(page);
    await expect(page.getByTestId("valor-livre-input")).toBeDisabled();
    await expect(page.getByTestId("valor-livre-botao")).toBeDisabled();
  });

  test("nenhum clique abre o modal", async ({ page }) => {
    await openComingSoonSite(page);
    const dialog = page.getByTestId("pix-dialog");
    await page.getByTestId("presente-card-botao").first().click({ force: true });
    await page.getByTestId("valor-livre-botao").click({ force: true });
    await expect(dialog).toBeHidden();
    // Dá tempo de um eventual modal aparecer antes de concluir.
    await page.waitForTimeout(300);
    await expect(dialog).toBeHidden();
    expect(await dialog.evaluate((element) => element.open)).toBe(false);
  });

  test("chave vazia não gera erro nem aviso no console", async ({ page, baseURL }) => {
    const seen = watchPage(page, baseURL);
    await openComingSoonSite(page);
    expect(seen.consoleErrors, "console.error").toEqual([]);
    expect(seen.consoleWarnings, "console.warn").toEqual([]);
    expect(seen.pageErrors, "erros de JavaScript").toEqual([]);
  });
});

test.describe("Pix em breve (configuração com problema)", () => {
  const invalidKeys = ["123", "abc", "529.982.247-24", "12.ABC.345/01DE-36", "joao@"];

  for (const key of invalidKeys) {
    test(`chave inválida ${JSON.stringify(key)}: continua em breve e avisa no console`, async ({ page }) => {
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await injectConfig(page, { chave: key, recebedor: TEST_RECEIVER, whatsapp: "" });
      await page.goto("./");

      // O erro no console é esperado: é ele que avisa os noivos no teste do CI.
      await expect.poll(() => errors.length, { message: "console.error esperado" }).toBeGreaterThan(0);
      await expect(page.locator("html")).toHaveAttribute("data-pix", "em-breve");
      await expect(page.getByTestId("pix-em-breve")).toBeVisible();
      await expect(page.getByTestId("pix-chave")).toBeHidden();
      for (const button of await page.getByTestId("presente-card-botao").all()) {
        await expect(button).toBeDisabled();
      }
      await expect(page.getByTestId("valor-livre-botao")).toBeDisabled();
    });
  }

  test("chave válida sem recebedor também continua em breve", async ({ page }) => {
    await injectConfig(page, { chave: TEST_KEY, recebedor: "", whatsapp: "" });
    await page.goto("./");
    await expect(page.getByTestId("presente-card").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-pix", "em-breve");
    await expect(page.getByTestId("pix-chave")).toBeHidden();
    for (const button of await page.getByTestId("presente-card-botao").all()) {
      await expect(button).toBeDisabled();
    }
  });

  test("recebedor preenchido mas chave vazia: continua em breve, sem erro no console", async ({ page, baseURL }) => {
    const seen = watchPage(page, baseURL);
    await openComingSoonSite(page, { ...COMING_SOON, recebedor: TEST_RECEIVER });
    await expect(page.getByTestId("pix-em-breve")).toBeVisible();
    expect(seen.consoleErrors, "console.error").toEqual([]);
  });
});
