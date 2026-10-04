// Modo ativo: chave de teste injetada. Cobre o fluxo que o convidado faz de
// verdade: escolher o presente, copiar o código Pix, ler o QR Code, baixar a
// imagem e fechar o modal.
//
// "O 2º presente" é o 2º que ainda está disponível em presentes.js (os
// esgotados não abrem o modal), para o teste não quebrar se os noivos
// marcarem algum como "já presenteado".

import fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  CLIPBOARD_MARKER,
  PRESENTES,
  TEST_KEY,
  TEST_RECEIVER,
  TEST_WHATSAPP,
  backdropPoint,
  decodeQrPng,
  expectDialogContent,
  expectQrToEncode,
  openActiveSite,
  openGift,
  readClipboard,
  requireGift,
  seedClipboard,
  watchPage,
} from "./helpers.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe("Pix ativo: página", () => {
  test("a seção Pix mostra a chave normalizada e o recebedor", async ({ page }) => {
    await openActiveSite(page);
    await expect(page.getByTestId("pix-em-breve")).toBeHidden();
    await expect(page.getByTestId("pix-chave")).toBeVisible();
    await expect(page.getByTestId("pix-chave")).toHaveText(TEST_KEY);
    await expect(page.getByTestId("pix-recebedor")).toContainText(TEST_RECEIVER);
  });

  test("os botões dos cards e o valor livre ficam habilitados", async ({ page }) => {
    await openActiveSite(page);
    const buttons = page.getByTestId("presente-card-botao");
    await expect(buttons).toHaveCount(PRESENTES.length);
    for (const [index, gift] of PRESENTES.entries()) {
      const button = buttons.nth(index);
      if (gift.esgotado) {
        await expect(button).toBeDisabled();
        continue;
      }
      await expect(button, `botão de "${gift.nome}"`).toBeEnabled();
      await expect(button).toHaveText(/presentear →/);
    }
    await expect(page.getByTestId("valor-livre-input")).toBeEnabled();
    await expect(page.getByTestId("valor-livre-botao")).toBeEnabled();
  });

  test("sem erros no console durante o fluxo completo", async ({ page, baseURL }) => {
    const target = requireGift(1);
    const seen = watchPage(page, baseURL);
    await openActiveSite(page);
    await openGift(page, target.index);
    await page.keyboard.press("Escape");
    expect(seen.consoleErrors, "console.error").toEqual([]);
    expect(seen.pageErrors, "erros de JavaScript").toEqual([]);
  });
});

test.describe("Pix ativo: modal", () => {
  test("o 2º presente abre o modal com valor, nome e Copia e Cola corretos", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    await openGift(page, target.index);
    const payload = await expectDialogContent(page, target);
    // O campo é somente leitura: o convidado só pode copiar.
    await expect(page.getByTestId("pix-payload")).toHaveJSProperty("readOnly", true);
    expect(payload).toContain("br.gov.bcb.pix");
  });

  test("o QR Code tem pelo menos 280px e decodifica exatamente o Copia e Cola", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    await openGift(page, target.index);
    const payload = await expectDialogContent(page, target);

    const qr = page.getByTestId("pix-qr");
    await expect(qr).toHaveAttribute("data-ready", "true");
    await qr.scrollIntoViewIfNeeded();
    const box = await qr.boundingBox();
    expect(box.width, "largura renderizada do QR Code").toBeGreaterThanOrEqual(280);
    expect(box.height, "altura renderizada do QR Code").toBeGreaterThanOrEqual(280);
    await expectQrToEncode(page, payload);
  });

  test("copiar o código Pix coloca o Copia e Cola na área de transferência", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    await openGift(page, target.index);
    const payload = await expectDialogContent(page, target);

    await seedClipboard(page);
    await page.getByTestId("pix-copiar").click();
    await expect.poll(() => readClipboard(page), { message: "área de transferência" }).toBe(payload);
    await expect(page.getByTestId("pix-feedback")).toHaveText(/copiad/i);
  });

  test("se a cópia automática falhar, o código fica selecionado e aparece um aviso", async ({ page }) => {
    const target = requireGift(1);
    // Simula navegadores que bloqueiam a área de transferência (ex.: dentro de apps).
    await page.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new DOMException("bloqueado pelo teste", "NotAllowedError")),
      });
      document.execCommand = () => false;
    });
    await openActiveSite(page);
    await openGift(page, target.index);
    const payload = await expectDialogContent(page, target);

    await seedClipboard(page);
    await page.getByTestId("pix-copiar").click();
    const feedback = page.getByTestId("pix-feedback");
    await expect(feedback).toHaveText(/\S/);
    await expect(feedback, "o aviso não pode dizer que copiou").not.toHaveText(/copiado/i);
    expect(await readClipboard(page), "nada foi copiado de verdade").toBe(CLIPBOARD_MARKER);
    const selection = await page.getByTestId("pix-payload").evaluate((field) => ({
      start: field.selectionStart,
      end: field.selectionEnd,
      length: field.value.length,
    }));
    expect(selection).toEqual({ start: 0, end: payload.length, length: payload.length });
  });

  test("copiar só a chave pelo modal usa a chave normalizada", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    await openGift(page, target.index);
    await seedClipboard(page);
    await page.getByTestId("pix-copiar-chave-modal").click();
    await expect.poll(() => readClipboard(page), { message: "área de transferência" }).toBe(TEST_KEY);
  });

  test("copiar a chave pela seção Pix usa a chave normalizada", async ({ page }) => {
    await openActiveSite(page);
    await seedClipboard(page);
    await page.getByTestId("pix-copiar-chave").click();
    await expect.poll(() => readClipboard(page), { message: "área de transferência" }).toBe(TEST_KEY);
  });

  test("salvar o QR Code baixa um PNG que decodifica para o mesmo Copia e Cola", async ({ page }, testInfo) => {
    const target = requireGift(1);
    await openActiveSite(page);
    const dialog = await openGift(page, target.index);
    const payload = await expectDialogContent(page, target);

    const link = dialog.getByTestId("pix-salvar");
    await expect(link).toHaveAttribute("download", /\.png$/i);
    await expect(link).toHaveAttribute("href", /^data:image\/png/);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/i);

    const file = testInfo.outputPath("qr-baixado.png");
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), "assinatura PNG").toBe(true);
    expect(decodeQrPng(bytes), "conteúdo do QR Code baixado").toBe(payload);
  });

  test("o recebedor aparece no modal e na seção Pix", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    await expect(page.getByTestId("pix-recebedor")).toContainText(TEST_RECEIVER);
    const dialog = await openGift(page, target.index);
    await expect(dialog.getByTestId("pix-recebedor-modal")).toBeVisible();
    await expect(dialog.getByTestId("pix-recebedor-modal")).toContainText(TEST_RECEIVER);
  });

  test("\"avisar os noivos\" aponta para o WhatsApp configurado", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    const dialog = await openGift(page, target.index);
    const link = dialog.getByTestId("pix-avisar");
    await expect(link).toBeVisible();
    const url = new URL(await link.getAttribute("href"));
    expect(`${url.origin}${url.pathname}`).toBe(`https://wa.me/${TEST_WHATSAPP}`);
    expect(url.searchParams.get("text"), "texto pré-preenchido").toMatch(/\S/);
  });

  test("sem WhatsApp configurado, o aviso aos noivos fica oculto", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page, { whatsapp: "" });
    const dialog = await openGift(page, target.index);
    await expect(dialog.getByTestId("pix-avisar")).toBeHidden();
  });

  test("reabrir com outro presente atualiza valor, código e QR Code", async ({ page }) => {
    const first = requireGift(0);
    const other = requireGift(2); // se houver menos presentes, repete o último
    await openActiveSite(page);
    const dialog = await openGift(page, first.index);
    await expectDialogContent(page, first);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await openGift(page, other.index);
    const payload = await expectDialogContent(page, other);
    await expectQrToEncode(page, payload);
  });
});

test.describe("Pix ativo: fechar o modal", () => {
  test("fecha com Esc", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    const dialog = await openGift(page, target.index);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("fecha com o botão ×", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    const dialog = await openGift(page, target.index);
    await dialog.getByTestId("pix-fechar").click();
    await expect(dialog).toBeHidden();
  });

  test("fecha ao clicar fora, no fundo escurecido", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    const dialog = await openGift(page, target.index);
    const { x, y } = await backdropPoint(page, dialog);
    await page.mouse.click(x, y);
    await expect(dialog).toBeHidden();
  });

  test("o foco entra no modal ao abrir e volta ao botão do presente ao fechar", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    const trigger = page.getByTestId("presente-card").nth(target.index).getByTestId("presente-card-botao");
    const dialog = await openGift(page, target.index);

    const insideDialog = () =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="pix-dialog"]')));
    expect(await insideDialog(), "foco dentro do modal aberto").toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger, "foco de volta ao botão que abriu o modal").toBeFocused();
  });

  test("clicar dentro da caixa do modal não fecha", async ({ page }) => {
    const target = requireGift(1);
    await openActiveSite(page);
    const dialog = await openGift(page, target.index);
    await dialog.getByTestId("pix-valor").click();
    await dialog.getByTestId("pix-presente").click();
    await expect(dialog).toBeVisible();
  });
});

// Cada tipo de chave Pix aceito precisa chegar íntegro (normalizado) à tela,
// à área de transferência e ao Copia e Cola.
test.describe("Pix ativo: tipos de chave", () => {
  const cases = [
    { tipo: "aleatória em maiúsculas", raw: "123E4567-E12B-12D1-A456-426655440000", normalized: TEST_KEY },
    { tipo: "CPF com pontuação", raw: "529.982.247-25", normalized: "52998224725" },
    { tipo: "CNPJ numérico", raw: "11.222.333/0001-81", normalized: "11222333000181" },
    { tipo: "CNPJ alfanumérico", raw: "12.ABC.345/01DE-35", normalized: "12ABC34501DE35" },
    { tipo: "e-mail com espaços e maiúsculas", raw: "  Arthur.Marina@Example.com ", normalized: "arthur.marina@example.com" },
    { tipo: "telefone formatado", raw: "+55 (48) 99999-8888", normalized: "+5548999998888" },
  ];

  for (const { tipo, raw, normalized } of cases) {
    test(`chave ${tipo}`, async ({ page }) => {
      const target = requireGift(1);
      await openActiveSite(page, { chave: raw });
      await expect(page.getByTestId("pix-chave")).toHaveText(normalized);
      await seedClipboard(page);
      await page.getByTestId("pix-copiar-chave").click();
      await expect.poll(() => readClipboard(page), { message: "área de transferência" }).toBe(normalized);

      await openGift(page, target.index);
      await expectDialogContent(page, { ...target, key: normalized });
    });
  }
});
