// Links fixos da página: mapa, Waze, agenda e arquivo .ics.

import { expect, test } from "@playwright/test";
import { openSite } from "./helpers.mjs";

async function hrefOf(page, testId) {
  const link = page.getByTestId(testId);
  await expect(link, testId).toBeVisible();
  return new URL(await link.getAttribute("href"), page.url());
}

test.describe("Links", () => {
  test("Google Maps", async ({ page }) => {
    await openSite(page);
    const url = await hrefOf(page, "link-maps");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toMatch(/(^|\.)google\.com$/);
    expect(url.pathname).toMatch(/^\/maps/);
  });

  test("Waze", async ({ page }) => {
    await openSite(page);
    const url = await hrefOf(page, "link-waze");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toMatch(/(^|\.)waze\.com$/);
    expect(url.pathname).toMatch(/^\/ul/);
  });

  test("Google Agenda leva a data e a hora certas (UTC)", async ({ page }) => {
    await openSite(page);
    const url = await hrefOf(page, "link-gcal");
    expect(url.hostname).toBe("calendar.google.com");
    // 16/11/2026 19h em Florianópolis (UTC-3) = 22h UTC; fim às 23h locais.
    expect(url.searchParams.get("dates")).toBe("20261116T220000Z/20261117T020000Z");
  });

  test("link do arquivo .ics aponta para um calendário válido", async ({ page, request }) => {
    await openSite(page);
    await expect(page.getByTestId("link-ics")).toHaveAttribute("href", "casamento.ics");

    const response = await request.get("casamento.ics");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/text\/calendar/);

    const body = await response.text();
    for (const line of [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "DTSTART:20261116T220000Z",
      "DTEND:20261117T020000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ]) {
      expect(body, `linha "${line}"`).toContain(`${line}\r\n`);
    }
    // iCalendar exige CRLF em todas as quebras de linha, inclusive a última.
    expect(body.replace(/\r\n/g, ""), "quebras de linha que não são CRLF").not.toMatch(/[\r\n]/);
  });

  test("links que abrem em outra aba usam rel=noopener", async ({ page }) => {
    await openSite(page);
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll('a[target="_blank"]')]
        .filter((link) => !/\bnoopener\b/.test(link.getAttribute("rel") || ""))
        .map((link) => link.dataset.testid || link.textContent.trim()),
    );
    expect(missing, "links sem rel=noopener").toEqual([]);
  });

  test("âncoras internas apontam para ids que existem", async ({ page }) => {
    await openSite(page);
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')]
        .map((link) => link.getAttribute("href"))
        .filter((href) => href.length > 1 && !document.getElementById(decodeURIComponent(href.slice(1)))),
    );
    expect(broken, "âncoras quebradas").toEqual([]);
  });
});
