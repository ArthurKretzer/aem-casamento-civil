// Testes de ponta a ponta (Playwright + Chromium).
//
//   npx playwright test                  sobe o site local e testa
//   BASE_URL=https://... npx playwright test   testa o site já publicado
//   SCREENSHOTS=1 npx playwright test screenshots   gera capturas de tela
//
// Nos testes, use sempre page.goto("./"): o caminho relativo preserva o
// subcaminho /presentes-casamento/ do GitHub Pages.

import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

// BASE_URL aponta os testes para outro endereço (por exemplo, a produção).
// Sem ela, os testes usam o servidor local, que imita o subcaminho do Pages.
// A barra no fim é obrigatória: sem ela o navegador troca a última pasta.
const remoteUrl = (process.env.BASE_URL || "").trim();
const baseURL = remoteUrl
  ? remoteUrl.replace(/\/*$/, "/")
  : "http://127.0.0.1:4173/presentes-casamento/";

// Argumentos extras do Chromium, separados por espaço. Vazio no GitHub
// Actions; só é usado em ambientes com proxy HTTPS próprio.
// (Nunca use ignoreHTTPSErrors: ele esconde erros de certificado reais.)
const chromiumArgs = (process.env.PW_CHROMIUM_ARGS || "").split(/\s+/).filter(Boolean);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  // As capturas de tela ficam em test-results/screenshots; o Playwright
  // limpa só esta pasta a cada execução, então elas sobrevivem.
  outputDir: "test-results/artefatos",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: isCI ? [["list"], ["github"]] : "list",

  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // Os testes de "copiar" leem a área de transferência de verdade.
    permissions: ["clipboard-read", "clipboard-write"],
    // Sem animações: capturas, QR Code e contraste ficam estáveis.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    launchOptions: { args: chromiumArgs },
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],

  // Servidor local só quando não há BASE_URL.
  ...(remoteUrl
    ? {}
    : {
        webServer: {
          command: "node scripts/servir.mjs --port 4173",
          url: baseURL,
          reuseExistingServer: !isCI,
          timeout: 20_000,
        },
      }),
});
