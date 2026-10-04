// =====================================================================
// Testes dos dados que os noivos editam (site/config.js e
// site/presentes.js) e do validador scripts/validar-dados.mjs.
// Rodar: npm run test:unit   (ou: node --test tests/unit/*.test.mjs)
//
// 1. Os arquivos REAIS do repositório são carregados como o navegador faz
//    (script clássico, `window.X = ...`) e conferidos.
// 2. Para cada presente (e para um valor livre) o Pix é gerado e validado
//    pelo nosso `validatePayload` e pelo `parsePix` da pix-utils.
// 3. O validador (`npm run validar`) é testado contra pastas de exemplo
//    criadas em um diretório temporário, uma regra de cada vez.
// =====================================================================

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { validateData, formatReport } from "../../scripts/validar-dados.mjs";

const require = createRequire(import.meta.url);
const PixBR = require("../../site/assets/js/pix.js");
const pixUtils = require("pix-utils");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "scripts", "validar-dados.mjs");

/** Chave de teste (exemplo oficial do BCB). */
const TEST_KEY = "123e4567-e12b-12d1-a456-426655440000";
/**
 * Chave aleatória fictícia para os testes do validador: ele recusa de propósito a
 * chave de exemplo do BCB (TEST_KEY), para ninguém publicar o site com ela.
 */
const VALIDATOR_KEY = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

// ---------------------------------------------------------------------
// Carregamento dos arquivos reais (como o navegador faria)
// ---------------------------------------------------------------------

function loadClassicScript(relPath, globalName) {
  const source = readFileSync(path.join(ROOT, relPath), "utf8");
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(source, sandbox, { filename: relPath, timeout: 2000 });
  } catch (error) {
    throw new Error(`Não consegui carregar ${relPath}: ${error.message}`);
  }
  return sandbox.window[globalName];
}

// Objetos criados dentro do `vm` pertencem a outro "realm"; para comparar com
// literais (deepStrictEqual) usamos uma cópia via JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

const config = loadClassicScript("site/config.js", "SITE_CONFIG");
const presentes = loadClassicScript("site/presentes.js", "PRESENTES");

const isRealIsoDate = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

// ---------------------------------------------------------------------
// site/config.js
// ---------------------------------------------------------------------

describe("site/config.js", () => {
  it("define window.SITE_CONFIG com pix, whatsapp, rsvpPrazo e siteUrl", () => {
    assert.ok(config, "window.SITE_CONFIG não foi definido");
    assert.equal(typeof config, "object");
    for (const key of ["pix", "whatsapp", "rsvpPrazo", "siteUrl"]) {
      assert.ok(key in config, `falta ${key}`);
    }
  });

  it("pix: chave, recebedor, nomeQr e cidadeQr são textos", () => {
    assert.equal(typeof config.pix, "object");
    for (const key of ["chave", "recebedor", "nomeQr", "cidadeQr"]) {
      assert.equal(typeof config.pix[key], "string", `pix.${key} precisa ser texto`);
    }
  });

  it("whatsapp é vazio ou só dígitos com DDI 55 (12 ou 13 dígitos)", () => {
    assert.equal(typeof config.whatsapp, "string");
    if (config.whatsapp !== "") assert.match(config.whatsapp, /^55\d{10,11}$/);
  });

  it("rsvpPrazo é uma data AAAA-MM-DD que existe no calendário", () => {
    assert.equal(typeof config.rsvpPrazo, "string");
    assert.ok(isRealIsoDate(config.rsvpPrazo), `rsvpPrazo inválido: ${config.rsvpPrazo}`);
  });

  it("siteUrl é https e termina com /", () => {
    assert.equal(typeof config.siteUrl, "string");
    assert.match(config.siteUrl, /^https:\/\/[^/\s]+(\/[^\s]*)?\/$/);
    assert.doesNotThrow(() => new URL(config.siteUrl));
  });

  it("nomeQr e cidadeQr não ficam vazios depois de normalizar", () => {
    assert.notEqual(PixBR.normalizeText(config.pix.nomeQr, 25), "", "nomeQr ficou vazio");
    assert.notEqual(PixBR.normalizeText(config.pix.cidadeQr, 15), "", "cidadeQr ficou vazio");
  });
});

// ---------------------------------------------------------------------
// site/presentes.js
// ---------------------------------------------------------------------

describe("site/presentes.js", () => {
  it("é uma lista com pelo menos um presente", () => {
    assert.ok(Array.isArray(presentes), "window.PRESENTES precisa ser uma lista");
    assert.ok(presentes.length >= 1);
  });

  it("cada presente tem id, nome e valor", () => {
    for (const [index, gift] of presentes.entries()) {
      const where = `presente nº ${index + 1} (${gift && gift.id})`;
      assert.equal(typeof gift, "object", where);
      assert.equal(typeof gift.id, "string", `${where}: id`);
      assert.notEqual(gift.id.trim(), "", `${where}: id vazio`);
      assert.equal(typeof gift.nome, "string", `${where}: nome`);
      assert.notEqual(gift.nome.trim(), "", `${where}: nome vazio`);
      assert.equal(typeof gift.valor, "number", `${where}: valor`);
    }
  });

  it("os ids são únicos e só têm letras minúsculas, números e hífen", () => {
    const ids = presentes.map((gift) => gift.id);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `id inválido: ${id}`);
    assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(", ")}`);
  });

  it("o valor é um número de reais entre 1 e 100000, com no máximo 2 casas", () => {
    for (const gift of presentes) {
      assert.ok(Number.isFinite(gift.valor), `${gift.id}: valor não numérico`);
      assert.ok(gift.valor >= 1 && gift.valor <= 100000, `${gift.id}: valor fora do limite (${gift.valor})`);
      const cents = PixBR.parseAmountCents(gift.valor);
      assert.ok(Number.isInteger(cents), `${gift.id}: ${gift.valor} não vira centavos inteiros`);
    }
  });

  it("os campos opcionais têm o tipo certo", () => {
    for (const gift of presentes) {
      for (const field of ["imagem", "imagemAlt", "descricao"]) {
        if (gift[field] !== undefined) assert.equal(typeof gift[field], "string", `${gift.id}: ${field}`);
      }
      if (gift.esgotado !== undefined) assert.equal(typeof gift.esgotado, "boolean", `${gift.id}: esgotado`);
    }
  });

  it("imagens locais não começam com / (o site fica em um subcaminho)", () => {
    for (const gift of presentes) {
      if (typeof gift.imagem === "string" && !/^(https?:)?\/\//i.test(gift.imagem)) {
        assert.ok(!gift.imagem.startsWith("/"), `${gift.id}: imagem com caminho absoluto (${gift.imagem})`);
      }
    }
  });
});

// ---------------------------------------------------------------------
// Pix gerado com os dados do site
// ---------------------------------------------------------------------

/** Gera o Pix e confere com o nosso validatePayload e com o parsePix da pix-utils. */
function checkPayloadFor({ key, cents }) {
  const payload = PixBR.buildPixPayload({ key, name: config.pix.nomeQr, city: config.pix.cidadeQr, cents });

  const result = PixBR.validatePayload(payload);
  assert.equal(result.ok, true, result.errors.join(" | "));

  const parsed = pixUtils.parsePix(payload);
  assert.equal(pixUtils.hasError(parsed), false, `parsePix recusou: ${JSON.stringify(parsed)}`);
  assert.equal(parsed.type, "STATIC");
  assert.equal(parsed.pixKey, PixBR.normalizeKey(key).value);
  assert.equal(parsed.transactionAmount, cents / 100);
  assert.equal(parsed.merchantName, PixBR.normalizeText(config.pix.nomeQr, 25));
  assert.equal(parsed.merchantCity, PixBR.normalizeText(config.pix.cidadeQr, 15));
  assert.ok(parsed.merchantName.length <= 25 && parsed.merchantCity.length <= 15);
  return payload;
}

describe("Pix gerado com os dados do site (chave de teste)", () => {
  for (const gift of presentes) {
    it(`presente "${gift.id}" (R$ ${gift.valor})`, () => {
      const cents = PixBR.parseAmountCents(gift.valor);
      assert.ok(Number.isInteger(cents));
      checkPayloadFor({ key: TEST_KEY, cents });
    });
  }

  it("valor livre de exemplo (R$ 37,50 digitado como texto)", () => {
    const cents = PixBR.parseAmountCents("R$ 37,50");
    assert.equal(cents, 3750);
    const payload = checkPayloadFor({ key: TEST_KEY, cents });
    assert.ok(payload.includes("540537.50"));
  });

  it("os limites do valor livre (R$ 1,00 e R$ 100.000,00)", () => {
    checkPayloadFor({ key: TEST_KEY, cents: PixBR.MIN_CENTS });
    checkPayloadFor({ key: TEST_KEY, cents: PixBR.MAX_CENTS });
  });

  it("cada presente gera um Pix diferente", () => {
    const payloads = presentes.map((gift) =>
      PixBR.buildPixPayload({ key: TEST_KEY, name: config.pix.nomeQr, city: config.pix.cidadeQr, cents: PixBR.parseAmountCents(gift.valor) })
    );
    const distinctValues = new Set(presentes.map((gift) => gift.valor));
    assert.equal(new Set(payloads).size, distinctValues.size);
  });
});

const realKey = typeof config.pix.chave === "string" ? config.pix.chave.trim() : "";

describe("Pix gerado com a chave real do config", { skip: realKey === "" ? 'pix.chave está vazia (modo "Pix em breve")' : false }, () => {
  it("a chave é válida e o recebedor está preenchido", () => {
    assert.doesNotThrow(() => PixBR.normalizeKey(realKey));
    assert.equal(typeof config.pix.recebedor, "string");
    assert.notEqual(config.pix.recebedor.trim(), "", "pix.recebedor não pode ficar vazio quando há chave");
  });

  for (const gift of presentes) {
    it(`presente "${gift.id}" (R$ ${gift.valor})`, () => {
      checkPayloadFor({ key: realKey, cents: PixBR.parseAmountCents(gift.valor) });
    });
  }

  it("valor livre de exemplo", () => {
    checkPayloadFor({ key: realKey, cents: PixBR.parseAmountCents("R$ 37,50") });
  });
});

// ---------------------------------------------------------------------
// O repositório de verdade passa no validador
// ---------------------------------------------------------------------

describe("repositório atual", () => {
  it("validateData() não encontra nenhum ERRO", () => {
    const report = validateData();
    const text = report.errors.map((issue) => `${issue.file} › ${issue.where}: ${issue.message}`).join("\n");
    assert.equal(report.errors.length, 0, "\n" + text);
    assert.equal(report.giftCount, presentes.length);
    assert.equal(report.pixMode, realKey !== "" && config.pix.recebedor.trim() !== "" ? "ativo" : "em breve");
  });

  it("`node scripts/validar-dados.mjs` termina com código 0 e mostra o resumo", () => {
    const run = spawnSync(process.execPath, [CLI], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /✔ \d+ presentes?, modo Pix: (em breve|ativo)\n?$/);
    assert.equal(run.stderr, "");
  });
});

// ---------------------------------------------------------------------
// Validador: pastas de exemplo
// ---------------------------------------------------------------------

const BASE_CONFIG = Object.freeze({
  pix: Object.freeze({ chave: "", recebedor: "", nomeQr: "ARTHUR E MARINA", cidadeQr: "SAO JOSE" }),
  whatsapp: "",
  rsvpPrazo: "2026-10-15",
  siteUrl: "https://arthurkretzer.github.io/presentes-casamento/",
});

const BASE_GIFTS = Object.freeze([
  { id: "pequeno-gesto", nome: "Um pequeno gesto", valor: 100 },
  { id: "jantar-especial", nome: "Um jantar especial", valor: 150.5 },
  { id: "nova-casa", nome: "Nossa nova casa", valor: 300, esgotado: true },
]);

const BASE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Arthur &amp; Marina</title>
  <link rel="stylesheet" href="assets/css/styles.css">
</head>
<body>
  <a href="#presentes">presentes</a>
  <a href="https://wa.me/">whatsapp</a>
  <script src="config.js"></script>
</body>
</html>
`;

const folders = [];
after(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Cria uma pasta com a mesma estrutura do repositório e devolve o caminho. */
function makeSite({ config: configPatch, gifts = BASE_GIFTS, configSource, giftsSource, html = BASE_HTML, files = {}, noIndex = false } = {}) {
  const folder = mkdtempSync(path.join(tmpdir(), "validar-dados-"));
  folders.push(folder);
  const write = (relative, content) => {
    const file = path.join(folder, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const merged = { ...BASE_CONFIG, ...configPatch, pix: { ...BASE_CONFIG.pix, ...(configPatch && configPatch.pix) } };
  write("site/config.js", configSource ?? `window.SITE_CONFIG = ${JSON.stringify(merged, null, 2)};\n`);
  write("site/presentes.js", giftsSource ?? `window.PRESENTES = ${JSON.stringify(gifts, null, 2)};\n`);
  if (!noIndex) write("site/index.html", html);
  for (const [relative, content] of Object.entries(files)) write(relative, content);
  return folder;
}

const validate = (options) => validateData({ rootDir: makeSite(options) });

const describeIssues = (list) => JSON.stringify(list.map((issue) => `${issue.file} › ${issue.where}: ${issue.message}`), null, 1);

/** Confere que existe um problema com esse arquivo/campo/mensagem. */
function assertHas(list, { file, where, pattern }) {
  const found = list.some(
    (issue) => (file === undefined || issue.file === file) && (where === undefined || issue.where === where) && pattern.test(issue.message)
  );
  assert.ok(found, `faltou { file: ${file}, where: ${where}, ${pattern} } em ${describeIssues(list)}`);
}

const CONFIG_FILE = "site/config.js";
const GIFTS_FILE = "site/presentes.js";
const INDEX_FILE = "site/index.html";

describe("validar-dados: dados corretos", () => {
  it("o exemplo base não tem erros nem avisos", () => {
    const report = validate();
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.giftCount, 3);
    assert.equal(report.pixMode, "em breve");
  });

  it("chave + recebedor preenchidos = modo Pix ativo", () => {
    const report = validate({ config: { pix: { chave: VALIDATOR_KEY, recebedor: "Marina Teste" } } });
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.pixMode, "ativo");
  });

  it("aceita chave de qualquer tipo, com formatação", () => {
    for (const chave of ["529.982.247-25", "11.222.333/0001-81", "12.ABC.345/01DE-35", "+55 (48) 99999-8888", "Marina@Gmail.com"]) {
      const report = validate({ config: { pix: { chave, recebedor: "Marina" } } });
      assert.deepEqual(report.errors, [], chave);
      assert.equal(report.pixMode, "ativo", chave);
    }
  });

  it("aceita WhatsApp com 12 ou 13 dígitos e o vazio", () => {
    for (const whatsapp of ["", "5548999998888", "554833334444"]) {
      assert.deepEqual(validate({ config: { whatsapp } }).errors, [], whatsapp);
    }
  });

  it("aceita datas reais no prazo da confirmação (inclusive 29 de fevereiro de ano bissexto)", () => {
    for (const rsvpPrazo of ["2026-10-15", "2028-02-29", "2026-12-31", "2027-01-01"]) {
      assert.deepEqual(validate({ config: { rsvpPrazo } }).errors, [], rsvpPrazo);
    }
  });

  it("aceita os limites de valor (R$ 1 e R$ 100.000) e centavos", () => {
    const gifts = [
      { id: "a", nome: "A", valor: 1 },
      { id: "b", nome: "B", valor: 100000 },
      { id: "c", nome: "C", valor: 19.99 },
      { id: "d", nome: "D", valor: 1234.5 },
    ];
    assert.deepEqual(validate({ gifts }).errors, []);
  });

  it("não considera erro URLs com // ou # no index.html", () => {
    const html = `<link href="//fonts.example.com/x.css"><a href="#topo">a</a><a href="https://x.y/z">b</a><img src="data:image/png;base64,AAAA"><a href="./x">c</a><a data-href="/ok">d</a>`;
    assert.deepEqual(validate({ html }).errors, []);
  });

  it("ignora URL absoluta dentro de comentário HTML", () => {
    const html = `<!-- <script src="/antigo.js"></script> --><p>oi</p>`;
    assert.deepEqual(validate({ html }).errors, []);
  });
});

describe("validar-dados: ERROS em config.js", () => {
  const cases = [
    {
      name: "erro de sintaxe no JavaScript (com a linha)",
      options: { configSource: "window.SITE_CONFIG = {\n  pix: {,\n};\n" },
      expect: { file: CONFIG_FILE, where: "", pattern: /erro de sintaxe \(linha 2\)/ },
    },
    {
      name: "erro ao executar o arquivo",
      options: { configSource: "\n\nwindow.SITE_CONFIG = naoExiste.pix;\n" },
      expect: { file: CONFIG_FILE, where: "", pattern: /erro ao executar o arquivo \(linha 3\).*naoExiste/ },
    },
    {
      name: "não define window.SITE_CONFIG",
      options: { configSource: "var SITE_CONFIG = {};\n" },
      expect: { file: CONFIG_FILE, where: "", pattern: /não define window\.SITE_CONFIG/ },
    },
    {
      name: "SITE_CONFIG não é um bloco",
      options: { configSource: "window.SITE_CONFIG = [1, 2];\n" },
      expect: { file: CONFIG_FILE, where: "", pattern: /precisa ser um bloco/ },
    },
    {
      name: "falta o bloco pix",
      options: { configSource: 'window.SITE_CONFIG = { whatsapp: "", rsvpPrazo: "2026-10-15", siteUrl: "https://a.b/c/" };\n' },
      expect: { file: CONFIG_FILE, where: "pix", pattern: /precisa ser um bloco/ },
    },
    {
      name: "pix.chave que não é texto",
      options: { configSource: 'window.SITE_CONFIG = { pix: { chave: 123, recebedor: "", nomeQr: "A", cidadeQr: "B" }, whatsapp: "", rsvpPrazo: "2026-10-15", siteUrl: "https://a.b/c/" };\n' },
      expect: { file: CONFIG_FILE, where: "pix.chave", pattern: /texto entre aspas/ },
    },
    {
      name: "whatsapp que não é texto",
      options: { configSource: 'window.SITE_CONFIG = { pix: { chave: "", recebedor: "", nomeQr: "A", cidadeQr: "B" }, whatsapp: 5548999998888, rsvpPrazo: "2026-10-15", siteUrl: "https://a.b/c/" };\n' },
      expect: { file: CONFIG_FILE, where: "whatsapp", pattern: /texto entre aspas/ },
    },
    ...["48999998888", "(48) 99999-8888", "+5548999998888", "5548", "55489999888", "5548 99999 8888", "5548999998888 ", "55489999988889", "5448999998888"].map((whatsapp) => ({
      name: `whatsapp ${JSON.stringify(whatsapp)}`,
      options: { config: { whatsapp } },
      expect: { file: CONFIG_FILE, where: "whatsapp", pattern: /não é válido.*55.*5548999998888/ },
    })),
    ...["15/10/2026", "2026-13-01", "2026-00-10", "2026-02-30", "2026-02-29", "2026-04-31", "2026-01-00", "2026-1-5", "2026-10-15T00:00:00Z", "", "amanhã"].map((rsvpPrazo) => ({
      name: `rsvpPrazo ${JSON.stringify(rsvpPrazo)}`,
      options: { config: { rsvpPrazo } },
      expect: { file: CONFIG_FILE, where: "rsvpPrazo", pattern: /AAAA-MM-DD/ },
    })),
    ...["http://arthurkretzer.github.io/presentes-casamento/", "arthurkretzer.github.io/presentes-casamento/", "//arthurkretzer.github.io/", "", "ftp://x.y/"].map((siteUrl) => ({
      name: `siteUrl ${JSON.stringify(siteUrl)} (não é https)`,
      options: { config: { siteUrl } },
      expect: { file: CONFIG_FILE, where: "siteUrl", pattern: /https:\/\// },
    })),
    ...["https://arthurkretzer.github.io/presentes-casamento", "https://arthurkretzer.github.io"].map((siteUrl) => ({
      name: `siteUrl ${JSON.stringify(siteUrl)} (sem "/" no fim)`,
      options: { config: { siteUrl } },
      expect: { file: CONFIG_FILE, where: "siteUrl", pattern: /terminar com "\/"/ },
    })),
    ...[
      ["lixo", /Chave Pix inválida/],
      ["SUA-CHAVE-PIX-AQUI", /Chave Pix inválida/],
      ["529.982.247-26", /CPF inválido/],
      ["48999998888", /\+55DDNÚMERO/],
      ["11.222.333/0001-82", /CNPJ inválido/],
      ["a@b", /E-mail inválido/],
      ["+1 555 123 4567", /\+55/],
    ].map(([chave, pattern]) => ({
      name: `chave Pix ${JSON.stringify(chave)} inválida (mostra a mensagem do PixError)`,
      options: { config: { pix: { chave, recebedor: "Marina" } } },
      expect: { file: CONFIG_FILE, where: "pix.chave", pattern },
    })),
    ...["", "   "].map((recebedor) => ({
      name: `chave preenchida com recebedor ${JSON.stringify(recebedor)}`,
      options: { config: { pix: { chave: VALIDATOR_KEY, recebedor } } },
      expect: { file: CONFIG_FILE, where: "pix.recebedor", pattern: /nome do titular/ },
    })),
    ...["", "   ", "@#!", "😀"].map((nomeQr) => ({
      name: `nomeQr ${JSON.stringify(nomeQr)} vazio depois de normalizar`,
      options: { config: { pix: { nomeQr } } },
      expect: { file: CONFIG_FILE, where: "pix.nomeQr", pattern: /ficou vazio/ },
    })),
    ...["", "???"].map((cidadeQr) => ({
      name: `cidadeQr ${JSON.stringify(cidadeQr)} vazio depois de normalizar`,
      options: { config: { pix: { cidadeQr } } },
      expect: { file: CONFIG_FILE, where: "pix.cidadeQr", pattern: /ficou vazio/ },
    })),
  ];

  for (const { name, options, expect } of cases) {
    it(name, () => {
      const report = validate(options);
      assertHas(report.errors, expect);
    });
  }

  it("um erro de config não esconde os outros", () => {
    const report = validate({ config: { whatsapp: "123", rsvpPrazo: "x", siteUrl: "http://a/" } });
    assert.deepEqual(
      report.errors.map((issue) => issue.where).sort(),
      ["rsvpPrazo", "siteUrl", "whatsapp"]
    );
  });

  it("com erro no config o modo Pix continua 'em breve'", () => {
    assert.equal(validate({ config: { pix: { chave: "lixo", recebedor: "Marina" } } }).pixMode, "em breve");
    assert.equal(validate({ config: { pix: { chave: VALIDATOR_KEY, recebedor: "" } } }).pixMode, "em breve");
  });
});

describe("validar-dados: ERROS em presentes.js", () => {
  const withGifts = (gifts) => ({ gifts });
  const good = { id: "ok", nome: "Ok", valor: 100 };
  const cases = [
    {
      name: "erro de sintaxe no JavaScript",
      options: { giftsSource: 'window.PRESENTES = [\n  { id: "a" nome: "A", valor: 100 },\n];\n' },
      expect: { file: GIFTS_FILE, where: "", pattern: /erro de sintaxe \(linha 2\)/ },
    },
    {
      name: "não define window.PRESENTES",
      options: { giftsSource: "var PRESENTES = [];\n" },
      expect: { file: GIFTS_FILE, where: "", pattern: /não define window\.PRESENTES/ },
    },
    {
      name: "PRESENTES não é uma lista",
      options: { giftsSource: 'window.PRESENTES = { id: "a" };\n' },
      expect: { file: GIFTS_FILE, where: "", pattern: /precisa ser uma lista/ },
    },
    {
      name: "item que não é um bloco",
      options: withGifts([good, "oi"]),
      expect: { file: GIFTS_FILE, where: "presente nº 2", pattern: /precisa ser um bloco/ },
    },
    {
      name: "presente sem id",
      options: withGifts([{ nome: "A", valor: 100 }]),
      expect: { file: GIFTS_FILE, where: "presente nº 1 › id", pattern: /obrigatório/ },
    },
    {
      name: "id vazio",
      options: withGifts([{ id: "  ", nome: "A", valor: 100 }]),
      expect: { file: GIFTS_FILE, where: "presente nº 1 › id", pattern: /obrigatório/ },
    },
    {
      name: "presente sem nome",
      options: withGifts([{ id: "a", valor: 100 }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › nome', pattern: /obrigatório/ },
    },
    {
      name: "nome só com espaços",
      options: withGifts([{ id: "a", nome: "   ", valor: 100 }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › nome', pattern: /obrigatório/ },
    },
    {
      name: "id repetido",
      options: withGifts([{ id: "a", nome: "A", valor: 100 }, good, { id: "a", nome: "Outro A", valor: 200 }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 3 ("a") › id', pattern: /repetido.*nº 1/ },
    },
    ...["Nova Casa", "nova_casa", "NOVA", "casá", "a b", "a/b", "a.b"].map((id) => ({
      name: `id ${JSON.stringify(id)} fora de /^[a-z0-9-]+$/`,
      options: withGifts([{ id, nome: "A", valor: 100 }]),
      expect: { file: GIFTS_FILE, where: `presente nº 1 ("${id}") › id`, pattern: /caracteres não permitidos/ },
    })),
    ...[
      ["150", /entre aspas/],
      ["", /precisa ser um número/],
      [null, /precisa ser um número/],
      [undefined, /precisa ser um número/],
      [true, /precisa ser um número/],
      [[150], /precisa ser um número/],
      [0, /maior que zero/],
      [-5, /maior que zero/],
      [150.555, /mais de 2 casas/],
      [0.001, /mais de 2 casas/],
      [0.5, /fora do limite/],
      [0.99, /fora do limite/],
      [100000.01, /fora do limite/],
      [100001, /fora do limite/],
      [1e9, /fora do limite/],
    ].map(([valor, pattern]) => ({
      name: `valor ${JSON.stringify(valor)}`,
      options: withGifts([{ id: "a", nome: "A", valor }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › valor', pattern },
    })),
    ...["NaN", "Infinity", "-Infinity"].map((literal) => ({
      name: `valor ${literal} (escrito no arquivo)`,
      options: { giftsSource: `window.PRESENTES = [{ id: "a", nome: "A", valor: ${literal} }];\n` },
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › valor', pattern: /precisa ser um número/ },
    })),
    {
      name: "esgotado escrito como texto",
      options: withGifts([{ id: "a", nome: "A", valor: 100, esgotado: "true" }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › esgotado', pattern: /true ou false/ },
    },
    {
      name: "descricao que não é texto",
      options: withGifts([{ id: "a", nome: "A", valor: 100, descricao: 5 }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › descricao', pattern: /texto/ },
    },
    {
      name: "imagem que não é texto",
      options: withGifts([{ id: "a", nome: "A", valor: 100, imagem: 5 }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagem', pattern: /texto/ },
    },
    {
      name: "imagemAlt que não é texto",
      options: withGifts([{ id: "a", nome: "A", valor: 100, imagemAlt: 5 }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagemAlt', pattern: /texto/ },
    },
    {
      name: 'imagem com caminho que começa com "/"',
      options: withGifts([{ id: "a", nome: "A", valor: 100, imagem: "/assets/img/presentes/a.jpg", imagemAlt: "x" }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagem', pattern: /começa com "\/".*subcaminho/ },
    },
    {
      name: "imagem fora da pasta site/",
      options: withGifts([{ id: "a", nome: "A", valor: 100, imagem: "../segredo.jpg", imagemAlt: "x" }]),
      expect: { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagem', pattern: /fora da pasta site/ },
    },
  ];

  for (const { name, options, expect } of cases) {
    it(name, () => {
      assertHas(validate(options).errors, expect);
    });
  }

  it("lista vários problemas de uma vez, cada um no seu presente", () => {
    const report = validate({
      gifts: [
        { id: "a", nome: "A", valor: 0 },
        { id: "b", nome: "", valor: 100 },
        { id: "c", nome: "C", valor: 100 },
      ],
    });
    assert.deepEqual(
      report.errors.map((issue) => issue.where),
      ['presente nº 1 ("a") › valor', 'presente nº 2 ("b") › nome']
    );
    assert.equal(report.giftCount, 3);
  });
});

describe("validar-dados: ERROS em index.html e CSS (URLs absolutas de raiz)", () => {
  const bad = [
    ['<img src="/assets/img/a.png">', /src="\/assets\/img\/a\.png"/],
    ['<link rel="stylesheet" href="/styles.css">', /href="\/styles\.css"/],
    ["<script src='/app.js'></script>", /src="\/app\.js"/],
    ['<a href="/">início</a>', /href="\/"/],
    ['<a href="/#presentes">presentes</a>', /href="\/#presentes"/],
    ["<img src=/logo.png>", /src="\/logo\.png"/],
    ['<form action="/enviar">', /action="\/enviar"/],
    ['<video poster="/capa.jpg">', /poster="\/capa\.jpg"/],
    ['<IMG SRC = "/x.png">', /src="\/x\.png"/],
  ];
  for (const [snippet, pattern] of bad) {
    it(`index.html: ${snippet}`, () => {
      const html = `<!doctype html>\n<html>\n<body>\n${snippet}\n</body>\n</html>\n`;
      const report = validate({ html });
      assertHas(report.errors, { file: INDEX_FILE, where: "linha 4", pattern });
      assertHas(report.errors, { file: INDEX_FILE, pattern: /subcaminho/ });
    });
  }

  it("index.html: lista todas as ocorrências, cada uma com a sua linha", () => {
    const html = '<link href="/a.css">\n<p>ok</p>\n<script src="/b.js"></script>\n';
    const report = validate({ html });
    assert.deepEqual(
      report.errors.map((issue) => issue.where),
      ["linha 1", "linha 3"]
    );
  });

  it("index.html ausente é um erro", () => {
    assertHas(validate({ noIndex: true }).errors, { file: INDEX_FILE, where: "", pattern: /não encontrado/ });
  });

  it("CSS com url(/...) ou @import /... é um erro", () => {
    for (const css of ['body { background: url(/img/fundo.png); }', 'a { background: url("/img/a.png"); }', "@import '/outro.css';"]) {
      const report = validate({ files: { "site/assets/css/styles.css": css } });
      assertHas(report.errors, { file: "site/assets/css/styles.css", where: "linha 1", pattern: /subcaminho/ });
    }
  });

  it("CSS com url relativa, data: ou // não é erro", () => {
    const css = 'a { background: url(img/a.png); }\nb { background: url("../img/b.png"); }\nc { background: url(data:image/png;base64,AAAA); }\nd { background: url(//cdn.example.com/x.png); }\n';
    assert.deepEqual(validate({ files: { "site/assets/css/styles.css": css } }).errors, []);
  });
});

describe("validar-dados: AVISOS", () => {
  const withImage = (extra = {}) => ({
    gifts: [{ id: "a", nome: "A", valor: 100, imagem: "assets/img/presentes/a.jpg", imagemAlt: "Uma foto", ...extra }],
  });
  const IMAGE_PATH = "site/assets/img/presentes/a.jpg";

  it("imagem local inexistente em site/ é ERRO (o card ficaria quebrado no ar)", () => {
    const report = validate(withImage());
    assertHas(report.errors, { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagem', pattern: /foto não encontrada: site\/assets\/img\/presentes\/a\.jpg/ });
  });

  it("imagem com maiúsculas/minúsculas diferentes do arquivo é ERRO (o Pages diferencia)", () => {
    const report = validate({ ...withImage({ imagem: "assets/img/presentes/A.JPG" }), files: { [IMAGE_PATH]: Buffer.alloc(10) } });
    assertHas(report.errors, { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagem', pattern: /maiúsculas e minúsculas/ });
  });

  it("imagem local que existe e é pequena: sem aviso", () => {
    const report = validate({ ...withImage(), files: { [IMAGE_PATH]: Buffer.alloc(150 * 1024) } });
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
  });

  it("imagem local com query string ou %20 é encontrada", () => {
    const withQuery = validate({ ...withImage({ imagem: "assets/img/presentes/a.jpg?v=2" }), files: { [IMAGE_PATH]: Buffer.alloc(10) } });
    assert.deepEqual(withQuery.warnings, []);
    const withSpace = validate({
      ...withImage({ imagem: "assets/img/presentes/minha%20foto.jpg" }),
      files: { "site/assets/img/presentes/minha foto.jpg": Buffer.alloc(10) },
    });
    assert.deepEqual(withSpace.warnings, []);
  });

  it("imagem data: (embutida) e nome de arquivo com % solto não dão erro nem aviso", () => {
    const embedded = validate(withImage({ imagem: "data:image/png;base64,AAAA" }));
    assert.deepEqual(embedded.errors, []);
    assert.deepEqual(embedded.warnings, []);
    const percent = validate({
      ...withImage({ imagem: "assets/img/presentes/100%.jpg" }),
      files: { "site/assets/img/presentes/100%.jpg": Buffer.alloc(10) },
    });
    assert.deepEqual(percent.errors, []);
    assert.deepEqual(percent.warnings, []);
  });

  it("imagem com mais de 300 KB (exatamente 300 KB não avisa)", () => {
    const exactly = validate({ ...withImage(), files: { [IMAGE_PATH]: Buffer.alloc(300 * 1024) } });
    assert.deepEqual(exactly.warnings, []);
    const over = validate({ ...withImage(), files: { [IMAGE_PATH]: Buffer.alloc(300 * 1024 + 1) } });
    assert.deepEqual(over.errors, []);
    assertHas(over.warnings, { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagem', pattern: /tem 300 KB; acima de 300 KB/ });
    const big = validate({ ...withImage(), files: { [IMAGE_PATH]: Buffer.alloc(512 * 1024) } });
    assertHas(big.warnings, { where: 'presente nº 1 ("a") › imagem', pattern: /512 KB/ });
  });

  it("imagem remota (http, https ou //): prefira guardar a foto no repositório", () => {
    for (const imagem of ["https://images.unsplash.com/photo-1.jpg", "http://exemplo.com/a.jpg", "//cdn.exemplo.com/a.jpg"]) {
      const report = validate(withImage({ imagem }));
      assert.deepEqual(report.errors, [], imagem);
      assertHas(report.warnings, { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagem', pattern: /Prefira guardar a foto no repositório/ });
    }
  });

  it("imagemAlt vazio ou ausente, quando há imagem", () => {
    for (const imagemAlt of ["", "   ", undefined]) {
      const report = validate({ ...withImage({ imagemAlt }), files: { [IMAGE_PATH]: Buffer.alloc(10) } });
      assert.deepEqual(report.errors, []);
      assertHas(report.warnings, { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagemAlt', pattern: /leitor de tela/ });
    }
  });

  it("sem imagem não há aviso de imagem nem de imagemAlt", () => {
    assert.deepEqual(validate({ gifts: [{ id: "a", nome: "A", valor: 100, imagemAlt: "" }] }).warnings, []);
  });

  it("recebedor preenchido mas chave vazia", () => {
    const report = validate({ config: { pix: { chave: "", recebedor: "Marina" } } });
    assert.deepEqual(report.errors, []);
    assertHas(report.warnings, { file: CONFIG_FILE, where: "pix.recebedor", pattern: /pix\.chave está vazia/ });
    assert.equal(report.pixMode, "em breve");
  });

  it("campos desconhecidos (erro de digitação)", () => {
    const report = validate({
      config: { whatsap: "5548999998888", pix: { chaves: "x" } },
      gifts: [{ id: "a", nome: "A", valor: 100, imagemalt: "x" }],
    });
    assert.deepEqual(report.errors, []);
    assertHas(report.warnings, { file: CONFIG_FILE, where: "whatsap", pattern: /campo desconhecido/ });
    assertHas(report.warnings, { file: CONFIG_FILE, where: "pix.chaves", pattern: /campo desconhecido/ });
    assertHas(report.warnings, { file: GIFTS_FILE, where: 'presente nº 1 ("a") › imagemalt', pattern: /campo desconhecido.*imagemAlt/ });
  });

  it("nomeQr/cidadeQr que serão ajustados no QR Code", () => {
    const report = validate({ config: { pix: { nomeQr: "Arthur & Marina", cidadeQr: "São José dos Pinhais" } } });
    assert.deepEqual(report.errors, []);
    assertHas(report.warnings, { file: CONFIG_FILE, where: "pix.nomeQr", pattern: /"Arthur E Marina"/ });
    assertHas(report.warnings, { file: CONFIG_FILE, where: "pix.cidadeQr", pattern: /"Sao Jose dos Pi"/ });
  });

  it("lista de presentes vazia", () => {
    const report = validate({ gifts: [] });
    assert.deepEqual(report.errors, []);
    assert.equal(report.giftCount, 0);
    assertHas(report.warnings, { file: GIFTS_FILE, where: "", pattern: /vazia/ });
  });

  it("avisos nunca viram erro (mesmo com tudo para avisar)", () => {
    const report = validate({
      config: { pix: { recebedor: "Marina", nomeQr: "Arthur & Marina" } },
      gifts: [{ id: "a", nome: "A", valor: 100, imagem: "https://exemplo.com/a.jpg" }],
    });
    assert.deepEqual(report.errors, []);
    assert.ok(report.warnings.length >= 4, describeIssues(report.warnings));
  });
});

describe("validar-dados: linha de comando", () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

  it("dados corretos: código 0 e resumo", () => {
    const result = run("--raiz", makeSite());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /✔ 3 presentes, modo Pix: em breve\n?$/);
    assert.doesNotMatch(result.stdout, /ERROS|AVISOS/);
  });

  it("modo Pix ativo no resumo", () => {
    const result = run("--raiz", makeSite({ config: { pix: { chave: VALIDATOR_KEY, recebedor: "Marina" } } }));
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /✔ 3 presentes, modo Pix: ativo\n?$/);
  });

  it("só avisos: código 0, avisos listados, resumo com ✔", () => {
    const result = run(
      "--raiz",
      makeSite({
        gifts: [{ id: "a", nome: "A", valor: 100, imagem: "assets/img/presentes/a.jpg", imagemAlt: "" }],
        files: { "site/assets/img/presentes/a.jpg": Buffer.alloc(10) },
      })
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /AVISOS \(1\)/);
    assert.match(result.stdout, /⚠ site\/presentes\.js › presente nº 1 \("a"\) › imagemAlt\n\s+está vazio/);
    assert.match(result.stdout, /✔ 1 presente, modo Pix: em breve\n?$/);
    assert.doesNotMatch(result.stdout, /ERROS/);
  });

  it("com erro: código 1, erro legível e sem o ✔", () => {
    const result = run("--raiz", makeSite({ config: { whatsapp: "48999998888", pix: { chave: "lixo", recebedor: "X" } } }));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /ERROS \(2\)/);
    assert.match(result.stdout, /✖ site\/config\.js › whatsapp\n\s+"48999998888" não é válido/);
    assert.match(result.stdout, /✖ site\/config\.js › pix\.chave\n\s+Chave Pix inválida/);
    assert.match(result.stdout, /✖ 2 erros e 0 avisos\. Corrija os erros acima\./);
    assert.doesNotMatch(result.stdout, /✔/);
  });

  it("erro de sintaxe: código 1 com a linha", () => {
    const result = run("--raiz", makeSite({ configSource: "window.SITE_CONFIG = {\n  pix: {,\n};\n" }));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /site\/config\.js\n\s+erro de sintaxe \(linha 2\)/);
  });

  it("URL absoluta de raiz no index.html: código 1", () => {
    const result = run("--raiz", makeSite({ html: '<script src="/app.js"></script>' }));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /✖ site\/index\.html › linha 1/);
  });

  it("pasta vazia: código 1 (arquivos não encontrados)", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "validar-dados-"));
    folders.push(empty);
    const result = run("--raiz", empty);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /site\/config\.js\n\s+arquivo não encontrado/);
    assert.match(result.stdout, /site\/presentes\.js\n\s+arquivo não encontrado/);
    assert.match(result.stdout, /site\/index\.html\n\s+arquivo não encontrado/);
  });

  it("--raiz sem pasta: mostra o uso e termina com código 2", () => {
    const result = run("--raiz");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Uso: node scripts\/validar-dados\.mjs/);
  });

  it("formatReport usa singular e plural e só põe cor quando pedido", () => {
    const issue = { file: "site/config.js", where: "whatsapp", message: "ruim" };
    const one = formatReport({ errors: [issue], warnings: [], giftCount: 1, pixMode: "em breve" });
    assert.match(one, /✖ 1 erro e 0 avisos\./);
    assert.doesNotMatch(one, /\u001b\[/);
    const colored = formatReport({ errors: [], warnings: [issue], giftCount: 1, pixMode: "ativo" }, { color: true });
    assert.match(colored, /\u001b\[33;1mAVISOS \(1\)/);
    assert.match(formatReport({ errors: [], warnings: [], giftCount: 1, pixMode: "ativo" }), /^✔ 1 presente, modo Pix: ativo$/);
    assert.match(formatReport({ errors: [], warnings: [], giftCount: 4, pixMode: "em breve" }), /^✔ 4 presentes, modo Pix: em breve$/);
  });
});

describe("validar-dados: o validador usa as mesmas regras do pix.js", () => {
  it("toda chave que normalizeKey aceita vira modo ativo; toda que recusa vira erro", () => {
    const keys = ["", "lixo", VALIDATOR_KEY, "529.982.247-25", "529.982.247-26", "48999998888", "+55 (48) 99999-8888", "a@b.co", "a@b", "11.222.333/0001-81", "12.ABC.345/01DE-35"];
    for (const chave of keys) {
      let accepted = true;
      try {
        PixBR.normalizeKey(chave);
      } catch {
        accepted = false;
      }
      const report = validate({ config: { pix: { chave, recebedor: "Marina" } } });
      if (chave === "") {
        assert.equal(report.pixMode, "em breve");
      } else if (accepted) {
        assert.equal(report.pixMode, "ativo", chave);
        assert.deepEqual(report.errors, [], chave);
      } else {
        assert.equal(report.pixMode, "em breve", chave);
        assertHas(report.errors, { where: "pix.chave", pattern: /./ });
      }
    }
  });

  it("todo valor aceito pelo validador gera centavos inteiros e um Pix válido", () => {
    for (const valor of [1, 1.5, 19.99, 100, 150.5, 1234.56, 99999.99, 100000]) {
      const report = validate({ gifts: [{ id: "a", nome: "A", valor }] });
      assert.deepEqual(report.errors, [], String(valor));
      const cents = PixBR.parseAmountCents(valor);
      assert.ok(Number.isInteger(cents), String(valor));
      assert.equal(PixBR.validatePayload(PixBR.buildPixPayload({ key: TEST_KEY, name: "A", city: "B", cents })).ok, true);
    }
  });
});

describe("validar-dados: dados de exemplo não podem ir ao ar", () => {
  it("a chave de exemplo do BCB é recusada (em qualquer caixa)", () => {
    for (const chave of [TEST_KEY, TEST_KEY.toUpperCase()]) {
      const report = validate({ config: { pix: { chave, recebedor: "Marina" } } });
      assert.equal(report.pixMode, "em breve", chave);
      assertHas(report.errors, { file: CONFIG_FILE, where: "pix.chave", pattern: /chave de EXEMPLO do Banco Central/ });
    }
  });

  it('o recebedor de exemplo "Fulano de Tal" é recusado', () => {
    const report = validate({ config: { pix: { chave: VALIDATOR_KEY, recebedor: "Fulano de Tal" } } });
    assertHas(report.errors, { file: CONFIG_FILE, where: "pix.recebedor", pattern: /nome de exemplo/ });
  });
});
