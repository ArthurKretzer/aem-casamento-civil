// A página abre limpa: sem erros, sem requisições quebradas, com os metadados
// certos e sem depender de nada externo.

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SITE_CONFIG, SITE_DIR, scrollThroughPage, settlePage, watchPage } from "./helpers.mjs";

test.describe("Carga da página", () => {
  test("abre sem erros no console nem requisições com falha", async ({ page, baseURL }) => {
    const seen = watchPage(page, baseURL);
    await page.goto("./");
    await expect(page.getByTestId("presente-card").first()).toBeVisible();
    await scrollThroughPage(page);
    await page.waitForLoadState("networkidle");

    expect(seen.consoleErrors, "console.error").toEqual([]);
    expect(seen.pageErrors, "erros de JavaScript não tratados").toEqual([]);
    expect(seen.failedRequests, "requisições que falharam").toEqual([]);
    expect(seen.badResponses, "respostas com status 400 ou mais (mesma origem)").toEqual([]);
  });

  test("não pede scripts, estilos nem fontes de outros endereços", async ({ page, baseURL }) => {
    const seen = watchPage(page, baseURL);
    await page.goto("./");
    await settlePage(page);
    await page.waitForLoadState("networkidle");
    expect(seen.foreignRequests, "tudo deve vir do próprio site (CSP default-src 'self')").toEqual([]);
  });

  test("título, idioma e metadados de busca", async ({ page }) => {
    await page.goto("./");
    await expect(page).toHaveTitle(/Arthur & Marina/);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /width=device-width/);
  });

  test("prévia de compartilhamento usa endereços absolutos (https) de arquivos que existem", async ({ page }) => {
    await page.goto("./");
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    expect(ogImage, "og:image").toMatch(/^https:\/\//);
    expect(ogUrl, "og:url").toMatch(/^https:\/\//);

    // O robô do WhatsApp busca a imagem em produção: o arquivo precisa estar no repositório.
    if (ogImage.startsWith(SITE_CONFIG.siteUrl)) {
      const relative = decodeURIComponent(ogImage.slice(SITE_CONFIG.siteUrl.length).split(/[?#]/)[0]);
      expect(fs.existsSync(path.join(SITE_DIR, relative)), `site/${relative} não existe`).toBe(true);
    }
  });

  test("CSP restritiva e nada inline (script, estilo ou manipulador de evento)", async ({ page }) => {
    await page.goto("./");
    const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(csp).toHaveAttribute("content", /default-src 'self'/);

    const inline = await page.evaluate(() => ({
      scripts: [...document.querySelectorAll("script:not([src])")].length,
      styles: [...document.querySelectorAll("style")].length,
      handlers: [...document.querySelectorAll("*")]
        .flatMap((element) => [...element.attributes].map((attr) => `${element.tagName.toLowerCase()}[${attr.name}]`))
        .filter((name) => /\[on[a-z]+\]$/.test(name)),
    }));
    expect(inline.scripts, "<script> sem src").toBe(0);
    expect(inline.styles, "<style> inline").toBe(0);
    expect(inline.handlers, "atributos onclick/onload/...").toEqual([]);
  });
});
