// Lista de presentes: a página mostra exatamente o que está em site/presentes.js.

import { expect, test } from "@playwright/test";
import { PRESENTES, brl, injectGifts, openActiveSite, openSite, toCents } from "./helpers.mjs";

test.describe("Presentes", () => {
  test("um card por presente, na mesma ordem e com os mesmos nomes", async ({ page }) => {
    await openSite(page);
    const cards = page.getByTestId("presente-card");
    await expect(cards).toHaveCount(PRESENTES.length);
    await expect(page.getByTestId("presente-nome")).toHaveText(PRESENTES.map((gift) => gift.nome));
    const ids = await cards.evaluateAll((elements) => elements.map((element) => element.dataset.id));
    expect(ids).toEqual(PRESENTES.map((gift) => gift.id));
    // Os cards moram dentro do container da lista.
    await expect(page.getByTestId("presentes-grid").getByTestId("presente-card")).toHaveCount(PRESENTES.length);
  });

  test("cada card traz os centavos corretos e o valor formatado", async ({ page }) => {
    await openSite(page);
    for (const [index, gift] of PRESENTES.entries()) {
      const cents = toCents(gift.valor);
      const card = page.getByTestId("presente-card").nth(index);
      await expect(card, `data-centavos de "${gift.nome}"`).toHaveAttribute("data-centavos", String(cents));
      await expect(card.getByTestId("presente-valor"), `valor de "${gift.nome}"`).toHaveText(brl(cents, true));
    }
  });

  test("todas as fotos carregam (presente sem foto mostra o espaço reservado)", async ({ page }) => {
    await openSite(page);
    for (const [index, gift] of PRESENTES.entries()) {
      const card = page.getByTestId("presente-card").nth(index);
      await card.scrollIntoViewIfNeeded();
      if (!gift.imagem) {
        await expect(card.locator(".gift__placeholder"), `"${gift.nome}" sem foto`).toBeVisible();
        continue;
      }
      const image = card.locator("img");
      await expect(image, `foto de "${gift.nome}"`).toHaveCount(1);
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveAttribute("loading", "lazy");
      await expect
        .poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0), {
          message: `a foto de "${gift.nome}" (${gift.imagem}) não carregou`,
        })
        .toBe(true);
      await expect(card.locator(".gift__placeholder")).toHaveCount(0);
    }
  });

  test("presente sem foto mostra o espaço reservado", async ({ page }) => {
    await injectGifts(page, 'window.PRESENTES[0].imagem = "";');
    await openSite(page);
    const card = page.getByTestId("presente-card").first();
    await expect(card.locator(".gift__placeholder")).toBeVisible();
    await expect(card.locator("img")).toHaveCount(0);
  });

  test("presente esgotado fica desabilitado como \"já presenteado\"", async ({ page }) => {
    // Só o primeiro fica esgotado; os demais ficam disponíveis, seja qual for a lista real.
    await injectGifts(page, "window.PRESENTES.forEach(function (gift, index) { gift.esgotado = index === 0; });");
    await openActiveSite(page);
    const sold = page.getByTestId("presente-card").first();
    await expect(sold).toHaveAttribute("data-esgotado", "true");
    await expect(sold.getByTestId("presente-card-botao")).toBeDisabled();
    await expect(sold.getByTestId("presente-card-botao")).toHaveText(/já presenteado/i);

    // Os demais continuam disponíveis.
    for (let index = 1; index < PRESENTES.length; index++) {
      const other = page.getByTestId("presente-card").nth(index);
      await expect(other).not.toHaveAttribute("data-esgotado", "true");
      await expect(other.getByTestId("presente-card-botao")).toBeEnabled();
    }
  });
});
