// "Outro valor": o convidado digita quanto quer dar. Valores válidos abrem o
// modal com o Pix certo; inválidos mostram o erro e nunca geram QR Code.

import { expect, test } from "@playwright/test";
import {
  brl,
  expectDialogContent,
  expectQrToEncode,
  openActiveSite,
  PixBR,
  submitCustomAmount,
} from "./helpers.mjs";

const FREE_GIFT_NAME = "Contribuição livre";

test.describe("Valor livre: valores válidos", () => {
  const valid = [
    { texto: "150,50", cents: 15050 },
    { texto: "1.500", cents: 150000 },
    { texto: "R$ 20", cents: 2000 },
    { texto: "1", cents: 100 },
  ];

  for (const { texto, cents } of valid) {
    test(`${JSON.stringify(texto)} abre o modal com ${cents} centavos`, async ({ page }) => {
      await openActiveSite(page);
      await submitCustomAmount(page, texto);

      const payload = await expectDialogContent(page, { cents, name: FREE_GIFT_NAME });
      // Campo 54 do BR Code: o valor em reais com ponto e duas casas ("150.50").
      expect(PixBR.validatePayload(payload).fields["54"]).toBe((cents / 100).toFixed(2));
      await expect(page.getByTestId("valor-livre-erro")).toBeHidden();
    });
  }

  test("\"150,50\" gera o campo 54 igual a 150.50 e um QR Code que lê esse código", async ({ page }) => {
    await openActiveSite(page);
    await submitCustomAmount(page, "150,50");
    const payload = await expectDialogContent(page, { cents: 15050, name: FREE_GIFT_NAME });
    // Campo 54 com 6 caracteres: "54" + "06" + "150.50".
    expect(payload).toContain("5406150.50");
    await expect(page.getByTestId("pix-valor")).toHaveText(brl(15050));
    await expectQrToEncode(page, payload);
  });

  test("Enter no campo também envia o valor", async ({ page }) => {
    await openActiveSite(page);
    await page.getByTestId("valor-livre-input").fill("75,90");
    await page.getByTestId("valor-livre-input").press("Enter");
    await expectDialogContent(page, { cents: 7590, name: FREE_GIFT_NAME });
  });

  test("corrigir um valor inválido some com o erro e abre o modal", async ({ page }) => {
    await openActiveSite(page);
    const error = page.getByTestId("valor-livre-erro");
    const input = page.getByTestId("valor-livre-input");

    await submitCustomAmount(page, "abc");
    await expect(error).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");

    await submitCustomAmount(page, "50");
    await expectDialogContent(page, { cents: 5000, name: FREE_GIFT_NAME });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pix-dialog")).toBeHidden();
    await expect(error).toBeHidden();
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("Valor livre: valores inválidos", () => {
  // "" vazio, texto, zero, abaixo de R$ 1,00 e acima de R$ 100.000,00.
  for (const texto of ["", "abc", "0", "0,50", "200000"]) {
    test(`${JSON.stringify(texto)} mostra o erro e não abre o modal`, async ({ page }) => {
      await openActiveSite(page);
      await submitCustomAmount(page, texto);

      const error = page.getByTestId("valor-livre-erro");
      await expect(error).toBeVisible();
      await expect(error).toHaveText(/\S/);
      await expect(error).toHaveAttribute("role", "alert");
      await expect(page.getByTestId("valor-livre-input")).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("pix-dialog")).toBeHidden();
    });
  }

  test("o campo e o botão fazem parte de um formulário", async ({ page }) => {
    await openActiveSite(page);
    const input = page.getByTestId("valor-livre-input");
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveAttribute("inputmode", "decimal");
    await expect(page.getByTestId("valor-livre-botao")).toHaveAttribute("type", "submit");
    expect(await input.evaluate((element) => Boolean(element.form))).toBe(true);
  });
});

test("reabrir com outro valor livre atualiza o código e o QR Code", async ({ page }) => {
  await openActiveSite(page);
  await submitCustomAmount(page, "10");
  const first = await expectDialogContent(page, { cents: 1000, name: FREE_GIFT_NAME });
  await expectQrToEncode(page, first);
  await page.keyboard.press("Escape");

  await submitCustomAmount(page, "25,5");
  const second = await expectDialogContent(page, { cents: 2550, name: FREE_GIFT_NAME });
  expect(second).not.toBe(first);
  await expectQrToEncode(page, second);
});
