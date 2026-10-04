#!/usr/bin/env node
// =====================================================================
// Confere os arquivos que os noivos editam (site/config.js,
// site/presentes.js) e o site/index.html, antes de publicar.
//
//   npm run validar                  (usado no CI)
//   node scripts/validar-dados.mjs [--raiz <pasta>]
//
// ERRO  -> o site quebraria ou o Pix sairia errado: o comando termina com
//          código 1 e o CI para.
// AVISO -> vale a pena olhar, mas não impede a publicação (código 0).
//
// `--raiz` aponta para outra pasta com a mesma estrutura (usado nos testes).
// =====================================================================

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// O validador sempre usa o pix.js deste repositório, mesmo com `--raiz`.
const PixBR = require("../site/assets/js/pix.js");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CONFIG_FILE = "site/config.js";
const GIFTS_FILE = "site/presentes.js";
const INDEX_FILE = "site/index.html";

const MAX_IMAGE_BYTES = 300 * 1024; // acima disso a página fica pesada no celular
const GIFT_ID_RE = /^[a-z0-9-]+$/;
const MIN_VALUE_REAIS = 1;
const MAX_VALUE_REAIS = 100000;

const CONFIG_KEYS = ["pix", "whatsapp", "siteUrl"];
const PIX_KEYS = ["chave", "recebedor", "nomeQr", "cidadeQr"];
// Chave do exemplo oficial do Banco Central: aparece no README e nos testes, nunca no site.
const EXAMPLE_KEY = "123e4567-e12b-12d1-a456-426655440000";
const GIFT_KEYS = ["id", "nome", "valor", "cota", "imagem", "imagemAlt", "descricao", "esgotado"];

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

function isPlainObject(value) {
  // Funciona também para objetos criados dentro do `vm` (outro "realm").
  return Object.prototype.toString.call(value) === "[object Object]";
}

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return String(value);
  }
  return Array.isArray(value) ? "uma lista" : "um bloco { ... }";
}

function plural(count, one, many) {
  return count + " " + (count === 1 ? one : many);
}

/** Carrega um script clássico (`window.X = ...`) como o navegador faria. */
function loadClassicScript(rootDir, relPath, globalName) {
  const file = path.join(rootDir, relPath);
  if (!fs.existsSync(file)) {
    return { error: "arquivo não encontrado." };
  }
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: relPath, timeout: 2000 });
  } catch (error) {
    return { error: describeScriptError(error, relPath) };
  }
  const value = sandbox.window[globalName];
  if (value === undefined || value === null) {
    return {
      error:
        "o arquivo não define window." + globalName + ". Confira se a linha \"window." + globalName + " = ...;\" continua lá.",
    };
  }
  return { value };
}

function describeScriptError(error, relPath) {
  const stack = String((error && error.stack) || "");
  const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = new RegExp(escaped + ":(\\d+)").exec(stack);
  const where = line ? " (linha " + line[1] + ")" : "";
  const kind = error && error.name === "SyntaxError" ? "erro de sintaxe" : "erro ao executar o arquivo";
  const hint = line ? "Confira aspas, vírgulas e chaves perto dessa linha." : "Confira aspas, vírgulas e chaves.";
  return kind + where + ": " + (error && error.message ? error.message : String(error)) + ". " + hint;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Troca o conteúdo dos comentários HTML por espaços, mantendo as linhas. */
function blankHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
}

// ---------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------

/**
 * Valida os dados do site que ficam em `rootDir` (padrão: a raiz do repo).
 * Devolve `{ errors, warnings, giftCount, pixMode }`; cada item de `errors` e
 * `warnings` é `{ file, where, message }`. Não lança exceção por dados ruins.
 */
export function validateData({ rootDir = REPO_ROOT } = {}) {
  const errors = [];
  const warnings = [];
  const addError = (file, where, message) => errors.push({ file, where, message });
  const addWarning = (file, where, message) => warnings.push({ file, where, message });

  const siteDir = path.join(rootDir, "site");

  const configState = checkConfig(rootDir, addError, addWarning);
  const giftCount = checkGifts(rootDir, siteDir, addError, addWarning);
  checkIndexHtml(rootDir, addError);
  checkCssFiles(siteDir, addError);

  return { errors, warnings, giftCount, pixMode: configState.pixMode };
}

function checkConfig(rootDir, addError, addWarning) {
  const state = { pixMode: "em breve" };
  const loaded = loadClassicScript(rootDir, CONFIG_FILE, "SITE_CONFIG");
  if (loaded.error) {
    addError(CONFIG_FILE, "", loaded.error);
    return state;
  }
  const config = loaded.value;
  const error = (where, message) => addError(CONFIG_FILE, where, message);
  const warning = (where, message) => addWarning(CONFIG_FILE, where, message);

  if (!isPlainObject(config)) {
    error("", "window.SITE_CONFIG precisa ser um bloco { pix: {...}, whatsapp: \"...\", siteUrl: \"...\" }.");
    return state;
  }

  // --- Estrutura ---------------------------------------------------
  const needText = (value, where) => {
    if (typeof value === "string") return true;
    error(where, "precisa ser um texto entre aspas (use \"\" para deixar vazio); veio " + show(value) + ".");
    return false;
  };

  const pix = config.pix;
  let pixOk = false;
  if (isPlainObject(pix)) {
    pixOk = PIX_KEYS.map((key) => needText(pix[key], "pix." + key)).every(Boolean);
    Object.keys(pix)
      .filter((key) => !PIX_KEYS.includes(key))
      .forEach((key) => warning("pix." + key, "campo desconhecido (será ignorado). Confira se não é um erro de digitação."));
  } else {
    error("pix", "precisa ser um bloco { chave, recebedor, nomeQr, cidadeQr }; veio " + show(pix) + ".");
  }
  const whatsappOk = needText(config.whatsapp, "whatsapp");
  const siteUrlOk = needText(config.siteUrl, "siteUrl");
  Object.keys(config)
    .filter((key) => !CONFIG_KEYS.includes(key))
    .forEach((key) => warning(key, "campo desconhecido (será ignorado). Confira se não é um erro de digitação."));

  // --- WhatsApp ----------------------------------------------------
  if (whatsappOk && config.whatsapp !== "" && !/^55\d{10,11}$/.test(config.whatsapp)) {
    error(
      "whatsapp",
      show(config.whatsapp) + " não é válido. Use só números, com o código do país (55) e o DDD, sem espaços, +, parênteses ou traços (12 ou 13 dígitos). Exemplo: \"5548999998888\". Para esconder os botões, deixe \"\"."
    );
  }

  // --- Endereço do site ----------------------------------------------
  if (siteUrlOk) {
    let parsed = null;
    try {
      parsed = new URL(config.siteUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:") {
      error("siteUrl", show(config.siteUrl) + " precisa começar com https:// (ex.: \"https://arthurkretzer.github.io/aem-casamento-civil/\").");
    } else if (!config.siteUrl.endsWith("/")) {
      error("siteUrl", show(config.siteUrl) + " precisa terminar com \"/\" (ex.: \"https://arthurkretzer.github.io/aem-casamento-civil/\").");
    }
  }

  // Sem a estrutura certa do bloco pix não dá para checar o Pix com segurança.
  if (!pixOk) return state;

  // --- Pix ---------------------------------------------------------
  const key = pix.chave.trim();
  const holder = pix.recebedor.trim();
  let keyOk = false;

  if (key !== "") {
    try {
      const normalized = PixBR.normalizeKey(key);
      if (normalized.value === EXAMPLE_KEY) {
        error("pix.chave", "esta é a chave de EXEMPLO do Banco Central (usada na documentação e nos testes), não a de vocês. Cadastre uma chave aleatória no app do banco e cole aqui.");
      } else {
        keyOk = true;
      }
    } catch (caught) {
      if (!(caught instanceof PixBR.PixError)) throw caught;
      error("pix.chave", caught.message);
    }
    if (/^fulano de tal$/i.test(holder)) {
      error("pix.recebedor", "\"Fulano de Tal\" é o nome de exemplo; use o nome do titular exatamente como o app do banco mostra.");
    }
    if (holder === "") {
      error(
        "pix.recebedor",
        "a chave Pix está preenchida, então informe o nome do titular exatamente como o app do banco mostra na hora de pagar (os convidados conferem esse nome)."
      );
    }
  } else if (holder !== "") {
    warning("pix.recebedor", "está preenchido, mas pix.chave está vazia: o site continuará mostrando \"Pix em breve\".");
  }

  const nameOk = checkQrText(pix.nomeQr, "pix.nomeQr", 25, error, warning);
  const cityOk = checkQrText(pix.cidadeQr, "pix.cidadeQr", 15, error, warning);

  if (keyOk && holder !== "" && nameOk && cityOk) {
    // A mesma conta que o site faz antes de ligar o modo Pix.
    try {
      const sample = PixBR.buildPixPayload({ key, name: pix.nomeQr, city: pix.cidadeQr, cents: PixBR.MIN_CENTS });
      const check = PixBR.validatePayload(sample);
      if (check.ok) {
        state.pixMode = "ativo";
      } else {
        error("pix", "o Pix Copia e Cola de teste ficou inválido: " + check.errors.join(" "));
      }
    } catch (caught) {
      if (!(caught instanceof PixBR.PixError)) throw caught;
      error("pix", "não foi possível montar o Pix Copia e Cola de teste: " + caught.message);
    }
  }

  return state;
}

/** nomeQr / cidadeQr: não podem ficar vazios depois de limpos; avisa se mudam. */
function checkQrText(raw, where, maxLength, error, warning) {
  const clean = PixBR.normalizeText(raw, maxLength);
  if (clean === "") {
    error(
      where,
      "ficou vazio depois de remover acentos e símbolos (só valem letras, números, espaço e $ % * + - . / :). Exemplo: \"" +
        (where === "pix.nomeQr" ? "ARTHUR E MARINA" : "SAO JOSE") +
        "\"."
    );
    return false;
  }
  if (clean !== raw.trim()) {
    warning(
      where,
      show(raw) + " será gravado no QR Code como " + show(clean) + " (até " + maxLength + " caracteres, sem acentos nem símbolos)."
    );
  }
  return true;
}

function checkGifts(rootDir, siteDir, addError, addWarning) {
  const loaded = loadClassicScript(rootDir, GIFTS_FILE, "PRESENTES");
  if (loaded.error) {
    addError(GIFTS_FILE, "", loaded.error);
    return 0;
  }
  const gifts = loaded.value;
  if (!Array.isArray(gifts)) {
    addError(GIFTS_FILE, "", "window.PRESENTES precisa ser uma lista: [ { id, nome, valor }, ... ]; veio " + show(gifts) + ".");
    return 0;
  }
  if (gifts.length === 0) {
    addWarning(GIFTS_FILE, "", "a lista de presentes está vazia: o site mostrará só o campo de valor livre.");
  }

  const seenIds = new Map();
  gifts.forEach((gift, index) => {
    const number = index + 1;
    const hasId = isPlainObject(gift) && typeof gift.id === "string" && gift.id.trim() !== "";
    const label = "presente nº " + number + (hasId ? " (" + JSON.stringify(gift.id) + ")" : "");
    const error = (field, message) => addError(GIFTS_FILE, label + (field ? " › " + field : ""), message);
    const warning = (field, message) => addWarning(GIFTS_FILE, label + (field ? " › " + field : ""), message);

    if (!isPlainObject(gift)) {
      error("", "precisa ser um bloco { id: \"...\", nome: \"...\", valor: 150 }; veio " + show(gift) + ".");
      return;
    }
    Object.keys(gift)
      .filter((field) => !GIFT_KEYS.includes(field))
      .forEach((field) => warning(field, "campo desconhecido (será ignorado). Campos válidos: " + GIFT_KEYS.join(", ") + "."));

    // id
    if (typeof gift.id !== "string" || gift.id.trim() === "") {
      error("id", "é obrigatório (um texto curto e único, ex.: \"jantar-especial\").");
    } else if (!GIFT_ID_RE.test(gift.id)) {
      error("id", show(gift.id) + " tem caracteres não permitidos: use só letras minúsculas sem acento, números e \"-\" (ex.: \"jantar-especial\").");
    } else if (seenIds.has(gift.id)) {
      error("id", "repetido: o presente nº " + seenIds.get(gift.id) + " já usa esse id. Cada presente precisa de um id diferente.");
    } else {
      seenIds.set(gift.id, number);
    }

    // nome
    if (typeof gift.nome !== "string" || gift.nome.trim() === "") {
      error("nome", "é obrigatório (o texto que aparece no card).");
    }

    // valor
    const valueProblem = describeValueProblem(gift.valor);
    if (valueProblem) error("valor", valueProblem);

    // cota (opcional): o convidado escolhe quantas cotas dar; nada é contado.
    if (gift.cota !== undefined) {
      const quotaProblem = describeValueProblem(gift.cota);
      if (quotaProblem) {
        error("cota", quotaProblem);
      } else if (!valueProblem) {
        const quotaCents = Math.round(gift.cota * 100);
        const totalCents = Math.round(gift.valor * 100);
        if (quotaCents > totalCents) {
          error("cota", "a cota (" + gift.cota + ") não pode ser maior que o valor do presente (" + gift.valor + ").");
        } else if (totalCents % quotaCents !== 0) {
          const max = Math.floor(totalCents / quotaCents);
          warning("cota", "o valor do presente (" + gift.valor + ") não é múltiplo da cota (" + gift.cota + "): o convidado poderá dar até " + max + " cotas = R$ " + ((max * quotaCents) / 100).toFixed(2).replace(".", ",") + ".");
        }
      }
    }

    // campos opcionais
    if (gift.descricao !== undefined && typeof gift.descricao !== "string") {
      error("descricao", "precisa ser um texto entre aspas.");
    }
    if (gift.esgotado !== undefined && typeof gift.esgotado !== "boolean") {
      error("esgotado", "precisa ser true ou false, sem aspas (veio " + show(gift.esgotado) + ").");
    }
    if (gift.imagemAlt !== undefined && typeof gift.imagemAlt !== "string") {
      error("imagemAlt", "precisa ser um texto entre aspas.");
    }
    if (gift.imagem !== undefined && typeof gift.imagem !== "string") {
      error("imagem", "precisa ser um texto entre aspas com o caminho da foto.");
    } else if (typeof gift.imagem === "string" && gift.imagem.trim() !== "") {
      checkGiftImage(gift, siteDir, error, warning);
    }
  });

  return gifts.length;
}

function describeValueProblem(value) {
  if (typeof value === "string" && Number.isFinite(Number(value)) && value.trim() !== "") {
    return "veio " + show(value) + " entre aspas; escreva só o número, sem aspas (ex.: 150 ou 150.5).";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "precisa ser um número em reais, sem aspas e com ponto decimal (ex.: 150 ou 150.5); veio " + show(value) + ".";
  }
  if (value <= 0) return "precisa ser maior que zero (veio " + value + ").";
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
    return "tem mais de 2 casas decimais (veio " + value + "). Use no máximo centavos, ex.: 150.5 ou 150.55.";
  }
  if (value < MIN_VALUE_REAIS || value > MAX_VALUE_REAIS) {
    return "fora do limite permitido (de R$ 1,00 a R$ 100.000,00); veio " + value + ".";
  }
  return null;
}

function checkGiftImage(gift, siteDir, error, warning) {
  const image = gift.imagem.trim();

  if (/^data:/i.test(image)) {
    // Imagem embutida no próprio texto; nada a conferir no disco.
  } else if (/^(https?:)?\/\//i.test(image)) {
    warning("imagem", "aponta para a internet (" + image + "). Prefira guardar a foto no repositório, em site/assets/img/presentes/, para o site não depender de outro servidor.");
  } else if (image.startsWith("/")) {
    error("imagem", show(image) + " começa com \"/\". O site é publicado em um subcaminho; use um caminho relativo, ex.: \"assets/img/presentes/foto.jpg\".");
  } else {
    let relative = image.replace(/[?#].*$/, "");
    try {
      relative = decodeURIComponent(relative);
    } catch {
      // mantém o texto como veio
    }
    const resolved = path.resolve(siteDir, relative);
    const inside = path.relative(siteDir, resolved);
    if (inside === ".." || inside.startsWith(".." + path.sep) || path.isAbsolute(inside)) {
      error("imagem", show(image) + " aponta para fora da pasta site/, que é a única publicada.");
    } else {
      let stat = null;
      try {
        stat = fs.statSync(resolved);
      } catch {
        stat = null;
      }
      const display = "site/" + inside.split(path.sep).join("/");
      // O GitHub Pages diferencia maiúsculas de minúsculas, mesmo que o disco local não diferencie.
      const exactName = stat && stat.isFile() && fs.readdirSync(path.dirname(resolved)).includes(path.basename(resolved));
      if (!stat || !stat.isFile() || !exactName) {
        error(
          "imagem",
          "foto não encontrada: " + display + ". Confira o nome do arquivo (inclusive maiúsculas e minúsculas) e se a foto foi enviada para site/assets/img/presentes/."
        );
      } else if (stat.size > MAX_IMAGE_BYTES) {
        warning(
          "imagem",
          display + " tem " + Math.round(stat.size / 1024) + " KB; acima de " + MAX_IMAGE_BYTES / 1024 + " KB a página fica pesada no celular. Reduza para cerca de 960×720 e uns 150 KB."
        );
      }
    }
  }

  if (typeof gift.imagemAlt !== "string" || gift.imagemAlt.trim() === "") {
    warning("imagemAlt", "está vazio: descreva a foto em poucas palavras para quem usa leitor de tela.");
  }
}

function checkIndexHtml(rootDir, addError) {
  const file = path.join(rootDir, INDEX_FILE);
  if (!fs.existsSync(file)) {
    addError(INDEX_FILE, "", "arquivo não encontrado.");
    return;
  }
  const html = blankHtmlComments(fs.readFileSync(file, "utf8"));
  // src="/..." ou href="/..." (exceto "//" e "#"): quebram no subcaminho do GitHub Pages.
  const pattern = /(?<![\w-])(src|href|poster|action|srcset|data-src)\s*=\s*["']?\s*\/(?!\/)([^\s"'>]*)/gi;
  for (const match of html.matchAll(pattern)) {
    const attribute = match[1].toLowerCase();
    addError(
      INDEX_FILE,
      "linha " + lineOf(html, match.index),
      attribute + "=\"/" + match[2] + "\" começa com \"/\". O site é publicado em um subcaminho (…/aem-casamento-civil/), então use caminho relativo: " +
        attribute + "=\"" + (match[2] || "./") + "\"."
    );
  }
}

function checkCssFiles(siteDir, addError) {
  if (!fs.existsSync(siteDir)) return;
  const cssFiles = fs
    .readdirSync(siteDir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".css"))
    .sort();
  for (const name of cssFiles) {
    const relative = "site/" + name.split(path.sep).join("/");
    const css = fs.readFileSync(path.join(siteDir, name), "utf8");
    const pattern = /(?:url\(\s*|@import\s+)["']?\/(?!\/)([^\s"')]*)/gi;
    for (const match of css.matchAll(pattern)) {
      addError(
        relative,
        "linha " + lineOf(css, match.index),
        "o endereço \"/" + match[1] + "\" começa com \"/\". O site é publicado em um subcaminho; use caminho relativo ao arquivo CSS."
      );
    }
  }
}

// ---------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------

export function formatReport(report, { color = false } = {}) {
  const paint = (code, text) => (color ? "\u001b[" + code + "m" + text + "\u001b[0m" : text);
  const render = (symbol, code, issue) =>
    "  " + paint(code, symbol) + " " + issue.file + (issue.where ? " › " + issue.where : "") + "\n      " + issue.message;
  const out = [];

  if (report.errors.length > 0) {
    out.push(paint("31;1", "ERROS (" + report.errors.length + ") — precisam ser corrigidos antes de publicar:"));
    report.errors.forEach((issue) => out.push(render("✖", "31", issue)));
    out.push("");
  }
  if (report.warnings.length > 0) {
    out.push(paint("33;1", "AVISOS (" + report.warnings.length + ") — não impedem a publicação:"));
    report.warnings.forEach((issue) => out.push(render("⚠", "33", issue)));
    out.push("");
  }

  if (report.errors.length > 0) {
    const counts = plural(report.errors.length, "erro", "erros") + " e " + plural(report.warnings.length, "aviso", "avisos");
    out.push(paint("31;1", "✖ " + counts + ". Corrija os erros acima."));
  } else {
    out.push(paint("32;1", "✔ " + plural(report.giftCount, "presente", "presentes") + ", modo Pix: " + report.pixMode));
  }
  return out.join("\n");
}

function main(argv) {
  let rootDir = REPO_ROOT;
  const flag = argv.indexOf("--raiz");
  if (flag !== -1) {
    if (!argv[flag + 1]) {
      console.error("Uso: node scripts/validar-dados.mjs [--raiz <pasta>]");
      return 2;
    }
    rootDir = path.resolve(argv[flag + 1]);
  }

  console.log("Conferindo " + [CONFIG_FILE, GIFTS_FILE, INDEX_FILE].join(", ") + "…\n");
  const report = validateData({ rootDir });
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  console.log(formatReport(report, { color }));
  return report.errors.length > 0 ? 1 : 0;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = main(process.argv.slice(2));
}
