// =====================================================================
// Testes do módulo site/assets/js/pix.js (Pix "Copia e Cola").
// Rodar: npm run test:unit   (ou: node --test tests/unit/*.test.mjs)
//
// O mesmo arquivo que vai para o navegador é carregado aqui via CommonJS.
// Como "oráculos" independentes usamos o vetor oficial do Banco Central, a
// biblioteca pix-utils (parse/geração), qrcode-generator + jsqr (QR Code)
// e vetores conhecidos de CPF/CNPJ.
// =====================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const PIX_PATH = require.resolve("../../site/assets/js/pix.js");
const PixBR = require("../../site/assets/js/pix.js");
const {
  PixError,
  MIN_CENTS,
  MAX_CENTS,
  normalizeText,
  tlv,
  crc16,
  normalizeKey,
  parseAmountCents,
  formatAmountEMV,
  formatBRL,
  buildPixPayload,
  validatePayload,
} = PixBR;

const pixUtils = require("pix-utils");
const qrcode = require("qrcode-generator");
const jsQR = require("jsqr");

// ---------------------------------------------------------------------
// Constantes e utilidades dos testes
// ---------------------------------------------------------------------

const NBSP = "\u00a0";

/** Exemplo oficial do Manual de Padrões para Iniciação do Pix (BCB). */
const BCB_KEY = "123e4567-e12b-12d1-a456-426655440000";
const BCB_PAYLOAD =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

const SAMPLE = { key: BCB_KEY, name: "ARTHUR E MARINA", city: "SAO JOSE" };

/** Mostra o NBSP de forma visível nos títulos dos testes. */
const visible = (value) => (typeof value === "string" ? JSON.stringify(value).replace(/\u00a0/g, "\\u00a0") : String(value));

function assertPixError(fn, code, messagePattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof PixError, "esperava um PixError, veio " + error);
    assert.ok(error instanceof Error);
    assert.equal(error.name, "PixError");
    assert.equal(error.code, code);
    if (messagePattern) assert.match(error.message, messagePattern);
    return true;
  });
}

/** Divide um payload em [id, valor] (só para conferir a ordem dos campos). */
function splitTlv(payload) {
  const fields = [];
  for (let pos = 0; pos < payload.length; ) {
    const size = Number(payload.slice(pos + 2, pos + 4));
    fields.push([payload.slice(pos, pos + 2), payload.slice(pos + 4, pos + 4 + size)]);
    pos += 4 + size;
  }
  return fields;
}

/** Monta um payload a partir de [id, valor] e fecha com o CRC correto. */
function sealed(parts) {
  const body = parts.map(([id, value]) => tlv(id, value)).join("") + "6304";
  return body + crc16(body);
}

/** Payload "padrão" decomposto, para criar variações com defeitos. */
const BASE_PARTS = Object.freeze([
  ["00", "01"],
  ["26", tlv("00", "br.gov.bcb.pix") + tlv("01", BCB_KEY)],
  ["52", "0000"],
  ["53", "986"],
  ["54", "150.00"],
  ["58", "BR"],
  ["59", "ARTHUR E MARINA"],
  ["60", "SAO JOSE"],
  ["62", tlv("05", "***")],
]);
const without = (id) => BASE_PARTS.filter(([partId]) => partId !== id);
const replacing = (id, value) => BASE_PARTS.map(([partId, partValue]) => [partId, partId === id ? value : partValue]);

/** Gerador pseudoaleatório com semente (mulberry32): os testes são repetíveis. */
function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHANUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const randomInt = (random, min, max) => min + Math.floor(random() * (max - min + 1));
const randomPick = (random, list) => list[Math.floor(random() * list.length)];
const randomString = (random, alphabet, length) => Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");

/** CPF válido a partir de 9 dígitos (fórmula "soma × 10 mod 11 mod 10"). */
function cpfFrom(nineDigits) {
  const digit = (digits) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (digits.length + 1 - i), 0);
    return ((sum * 10) % 11) % 10;
  };
  const digits = nineDigits.split("").map(Number);
  const first = digit(digits);
  const second = digit([...digits, first]);
  return nineDigits + first + second;
}

/** CNPJ válido (numérico ou alfanumérico) a partir de 12 caracteres [0-9A-Z]. */
function cnpjFrom(twelveChars) {
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const digit = (values, weights) => {
    const rest = values.reduce((acc, v, i) => acc + v * weights[i], 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const values = twelveChars.split("").map((ch) => ch.charCodeAt(0) - 48);
  const first = digit(values, weights1);
  const second = digit([...values, first], weights2);
  return twelveChars + first + second;
}

/** Uma chave válida de cada tipo, sorteada. */
function randomKeys(random) {
  const hex = (n) => randomString(random, "0123456789abcdef", n);
  const nine = () => randomString(random, "0123456789", 9);
  return {
    aleatoria: [hex(8), hex(4), hex(4), hex(4), hex(12)].join("-"),
    email: randomString(random, "abcdefghijklmnopqrstuvwxyz0123456789", randomInt(random, 3, 30)) + "@" + randomPick(random, ["example.com", "gmail.com", "dominio.com.br"]),
    telefone: "+55" + randomInt(random, 1, 9) + randomInt(random, 1, 9) + "9" + randomString(random, "0123456789", 8),
    cpf: cpfFrom(nine()),
    cnpj: cnpjFrom(randomString(random, ALPHANUM, 12)),
    cnpjNumerico: cnpjFrom(randomString(random, "0123456789", 12)),
  };
}

// ---------------------------------------------------------------------
// API e carregamento
// ---------------------------------------------------------------------

describe("API pública e carregamento", () => {
  const source = readFileSync(PIX_PATH, "utf8");

  it("exporta exatamente o que está no contrato", () => {
    assert.deepEqual(Object.keys(PixBR).sort(), [
      "MAX_CENTS",
      "MIN_CENTS",
      "PixError",
      "buildPixPayload",
      "crc16",
      "describeGift",
      "formatAmountEMV",
      "formatBRL",
      "messageRoom",
      "normalizeKey",
      "normalizeText",
      "parseAmountCents",
      "tlv",
      "validatePayload",
    ]);
    assert.equal(Object.isFrozen(PixBR), true);
  });

  it("limites de valor: R$ 1,00 a R$ 100.000,00", () => {
    assert.equal(MIN_CENTS, 100);
    assert.equal(MAX_CENTS, 10000000);
  });

  it("PixError é um Error com name, code e mensagem", () => {
    const error = new PixError("CHAVE_VAZIA", "teste");
    assert.ok(error instanceof Error);
    assert.ok(error instanceof PixError);
    assert.equal(error.name, "PixError");
    assert.equal(error.code, "CHAVE_VAZIA");
    assert.equal(error.message, "teste");
  });

  it("no navegador (script clássico) define só window.PixBR, com a mesma API", () => {
    const context = vm.createContext({ TextEncoder }); // TextEncoder existe em todo navegador
    context.window = context;
    context.self = context;
    vm.runInContext(source, context, { filename: "pix.js" });

    assert.deepEqual(Object.keys(context).sort(), ["PixBR", "TextEncoder", "self", "window"]);
    assert.deepEqual(Object.keys(context.PixBR).sort(), Object.keys(PixBR).sort());
    assert.equal(context.PixBR.MIN_CENTS, MIN_CENTS);
    assert.equal(
      context.PixBR.buildPixPayload({ key: BCB_KEY, name: "Fulano de Tal", city: "BRASILIA" }),
      BCB_PAYLOAD
    );
    // O erro lançado dentro do "navegador" também é um PixError com code.
    assert.throws(() => context.PixBR.normalizeKey(""), (error) => error.name === "PixError" && error.code === "CHAVE_VAZIA");
  });

  it("é um script clássico: compila sem import/export e sem eval", () => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: "pix.js" }));
    assert.doesNotMatch(source, /^\s*(import|export)\s/m);
    assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\b/);
  });

  it("não depende do navegador (DOM, rede ou armazenamento)", () => {
    assert.doesNotMatch(source, /\b(document|localStorage|sessionStorage|XMLHttpRequest)\b|\bfetch\s*\(/);
  });
});

// ---------------------------------------------------------------------
// CRC16
// ---------------------------------------------------------------------

describe("crc16", () => {
  it('"123456789" -> "29B1" (vetor padrão do CRC16/CCITT-FALSE)', () => {
    assert.equal(crc16("123456789"), "29B1");
  });

  it('texto vazio -> "FFFF" (valor inicial)', () => {
    assert.equal(crc16(""), "FFFF");
  });

  it("vetor oficial do BCB: o CRC do exemplo é 1D3D", () => {
    assert.equal(crc16(BCB_PAYLOAD.slice(0, -4)), "1D3D");
  });

  it("sempre devolve 4 hexadecimais maiúsculos, com zeros à esquerda", () => {
    let withLeadingZero = null;
    for (let n = 0; n < 5000 && withLeadingZero === null; n++) {
      if (crc16("x" + n).startsWith("0")) withLeadingZero = "x" + n;
    }
    assert.ok(withLeadingZero, "devia existir algum texto cujo CRC começa com 0");
    assert.match(crc16(withLeadingZero), /^0[0-9A-F]{3}$/);
    for (const text of ["", "a", "abc", BCB_PAYLOAD, "0".repeat(300)]) {
      assert.match(crc16(text), /^[0-9A-F]{4}$/);
    }
  });

  it("calcula sobre os bytes em UTF-8, igual à pix-utils (texto com acentos e emoji)", () => {
    const { computeCRC } = require("pix-utils/dist/main/crc.js");
    for (const text of ["ç", "Açaí", "你好", "😀", "123456789", "Fulano de Tal"]) {
      assert.equal(crc16(text), computeCRC(text), JSON.stringify(text));
    }
  });

  it("bate com o CRC da pix-utils em 300 textos ASCII aleatórios", () => {
    const { computeCRC } = require("pix-utils/dist/main/crc.js");
    const random = createRandom(2026);
    for (let i = 0; i < 300; i++) {
      // A pix-utils remove um "6304XXXX" no fim antes de calcular; evitamos esse caso.
      const text = randomString(random, "0123456789ABCDEF abc*.:-", randomInt(random, 0, 200)) + "#";
      assert.equal(crc16(text), computeCRC(text), JSON.stringify(text));
    }
  });

  it("recusa o que não é texto", () => {
    assertPixError(() => crc16(undefined), "PAYLOAD_INVALIDO");
    assertPixError(() => crc16(123), "PAYLOAD_INVALIDO");
  });
});

// ---------------------------------------------------------------------
// TLV
// ---------------------------------------------------------------------

describe("tlv", () => {
  it("id + tamanho com 2 dígitos + valor", () => {
    assert.equal(tlv("00", "01"), "000201");
    assert.equal(tlv("58", "BR"), "5802BR");
    assert.equal(tlv("59", "Fulano de Tal"), "5913Fulano de Tal");
    assert.equal(tlv("54", "150.00"), "5406150.00");
  });

  it("completa o tamanho com zero à esquerda", () => {
    assert.equal(tlv("05", "A"), "0501A");
    assert.equal(tlv("62", tlv("05", "***")), "62070503***");
  });

  it("aceita 99 caracteres e recusa 100 (PAYLOAD_INVALIDO)", () => {
    assert.equal(tlv("26", "x".repeat(99)), "2699" + "x".repeat(99));
    assertPixError(() => tlv("26", "x".repeat(100)), "PAYLOAD_INVALIDO", /26.*100.*99/);
  });

  it("recusa id fora de 2 dígitos e valor que não é texto", () => {
    for (const id of ["0", "000", "ab", "", undefined, null, -1, 100, 1.5]) {
      assertPixError(() => tlv(id, "x"), "PAYLOAD_INVALIDO");
    }
    for (const value of [undefined, null, {}, [], true, NaN]) {
      assertPixError(() => tlv("59", value), "PAYLOAD_INVALIDO");
    }
  });

  it("aceita valor vazio (campo de tamanho 00)", () => {
    assert.equal(tlv("59", ""), "5900");
  });
});

// ---------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------

describe("normalizeText", () => {
  const cases = [
    ["Arthur & Marina", 25, "Arthur E Marina"],
    ["ARTHUR E MARINA", 25, "ARTHUR E MARINA"],
    ["São José", 15, "Sao Jose"],
    ["Açaí & Coração", 25, "Acai E Coracao"],
    ["ÀÉÎÕÜ àéîõü çÇ ñÑ", 25, "AEIOU aeiou cC nN"],
    ["aBc XyZ", 25, "aBc XyZ"], // não mexe em maiúsculas/minúsculas
    ["  muitos    espaços  ", 25, "muitos espacos"],
    ["a\tb\nc\u00a0d", 25, "a b c d"],
    ["A&B", 25, "A E B"],
    ["& Marina", 25, "E Marina"],
    ["R$ 10,00 (50%) + 2*3 = x/y:z-w.", 40, "R$ 1000 50% + 2*3 x/y:z-w."],
    ["O'Brien, \"Jr\" _x_ @#!", 25, "OBrien Jr x"],
    ["emoji 😀 ok", 25, "emoji ok"],
    ["@#!?", 25, ""],
    ["", 25, ""],
    ["e\u0301 e é", 25, "e e e"], // NFD e NFC dão o mesmo resultado
    // corte no tamanho máximo
    ["Sao Jose dos Pinhais", 8, "Sao Jose"],
    ["Sao Jose dos Pinhais", 9, "Sao Jose"], // o espaço do fim do corte é removido
    ["Sao Jose dos Pinhais", 4, "Sao"],
    ["São José dos Pinhais do Sul", 15, "Sao Jose dos Pi"],
    ["ARTHUR E MARINA DOS SANTOS PEREIRA", 25, "ARTHUR E MARINA DOS SANTO"],
    ["abc", 0, ""],
  ];
  for (const [input, max, expected] of cases) {
    it(`${visible(input)} (máx. ${max}) -> ${visible(expected)}`, () => {
      assert.equal(normalizeText(input, max), expected);
    });
  }

  it("sem maxLength não corta", () => {
    assert.equal(normalizeText("a".repeat(100)), "a".repeat(100));
  });

  it("aceita null, undefined e números", () => {
    assert.equal(normalizeText(null, 25), "");
    assert.equal(normalizeText(undefined, 25), "");
    assert.equal(normalizeText(2026, 25), "2026");
  });

  it("propriedade: o resultado só tem o alfabeto permitido, sem espaços sobrando e dentro do limite", () => {
    const random = createRandom(7);
    const pool = "abcXYZ019 &$%*+-./:;,_@#!?()[]{}'\"áéíóúâêôãõçñÁÉÇ\t\n\u00a0\u0301😀你";
    for (let i = 0; i < 500; i++) {
      const max = randomInt(random, 1, 30);
      const text = normalizeText(randomString(random, Array.from(pool), randomInt(random, 0, 60)), max);
      assert.match(text, /^[A-Za-z0-9 $%*+\-./:]*$/, JSON.stringify(text));
      assert.doesNotMatch(text, /^ | $| {2}/, JSON.stringify(text));
      assert.ok(text.length <= max, JSON.stringify(text));
    }
  });
});

// ---------------------------------------------------------------------
// normalizeKey
// ---------------------------------------------------------------------

describe("normalizeKey", () => {
  const valid = [
    // chave aleatória (UUID): minúsculas
    [BCB_KEY, "aleatoria", BCB_KEY],
    ["123E4567-E12B-12D1-A456-426655440000", "aleatoria", BCB_KEY],
    ["  123e4567-e12b-12d1-a456-426655440000\n", "aleatoria", BCB_KEY],
    ["00000000-0000-0000-0000-000000000000", "aleatoria", "00000000-0000-0000-0000-000000000000"],
    // e-mail: minúsculas
    ["Arthur.Silva@Example.COM", "email", "arthur.silva@example.com"],
    ["marina+pix@gmail.com", "email", "marina+pix@gmail.com"],
    ["arthur@exemplo.com.br", "email", "arthur@exemplo.com.br"],
    ["  a@b.co  ", "email", "a@b.co"],
    // telefone: sempre "+55" + DDD + número, sem formatação
    ["+5548999998888", "telefone", "+5548999998888"],
    ["+55 (48) 99999-8888", "telefone", "+5548999998888"],
    ["+55 48 99999 8888", "telefone", "+5548999998888"],
    ["+55 48 99999.8888", "telefone", "+5548999998888"],
    ["+55 (48) 3333-4444", "telefone", "+554833334444"], // 10 dígitos
    ["  +55 (11) 91234-5678  ", "telefone", "+5511912345678"],
    // CPF válido (com ou sem pontuação)
    ["529.982.247-25", "cpf", "52998224725"],
    ["52998224725", "cpf", "52998224725"],
    [" 529 982 247 25 ", "cpf", "52998224725"],
    ["123.456.789-09", "cpf", "12345678909"],
    ["111.444.777-35", "cpf", "11144477735"],
    // CNPJ numérico
    ["11.222.333/0001-81", "cnpj", "11222333000181"],
    ["11222333000181", "cnpj", "11222333000181"],
    ["11.444.777/0001-61", "cnpj", "11444777000161"],
    ["00.000.000/0001-91", "cnpj", "00000000000191"],
    // CNPJ alfanumérico (2026) - exemplo oficial da Receita Federal
    ["12.ABC.345/01DE-35", "cnpj", "12ABC34501DE35"],
    ["12ABC34501DE35", "cnpj", "12ABC34501DE35"],
    ["12.abc.345/01de-35", "cnpj", "12ABC34501DE35"],
  ];
  for (const [input, type, value] of valid) {
    it(`${visible(input)} -> ${type} ${visible(value)}`, () => {
      assert.deepEqual(normalizeKey(input), { type, value });
    });
  }

  it("chave vazia -> CHAVE_VAZIA (vazia, só espaços, null, undefined)", () => {
    for (const input of ["", "   ", "\n\t", "\u00a0", null, undefined]) {
      assertPixError(() => normalizeKey(input), "CHAVE_VAZIA", /vazia/);
    }
  });

  const invalid = [
    // [entrada, trecho esperado na mensagem]
    ["529.982.247-26", /CPF.*inválido/],
    ["111.111.111-11", /CPF.*inválido/],
    ["00000000000", /CPF.*inválido/],
    ["11.222.333/0001-82", /CNPJ.*inválido/],
    ["12.ABC.345/01DE-36", /CNPJ.*inválido/],
    ["12.ABC.345/01DE-3A", /CNPJ.*inválido/],
    ["00.000.000/0000-00", /CNPJ.*inválido/],
    ["AAAAAAAAAAAA00", /CNPJ.*inválido/],
    ["a@b", /E-mail inválido/],
    ["arthur@gmail", /E-mail inválido/], // domínio sem ponto
    ["a b@c.com", /E-mail inválido/],
    [".a@b.com", /E-mail inválido/],
    ["a..b@c.com", /E-mail inválido/],
    ["a@-b.com", /E-mail inválido/],
    ["a@b..com", /E-mail inválido/],
    ["á@b.com", /E-mail inválido/],
    ["@gmail.com", /E-mail inválido/],
    ["+1 555 123 4567", /Brasil.*\+55/],
    ["+55 48 9999-88a8", /só números/],
    ["+55 48 99999-88889", /DDD/],
    ["+55 48 9999", /DDD/],
    ["+55 (48) 999-9888", /DDD/], // DDD + só 7 dígitos
    ["+5504899998888", /DDD/], // zero na frente do DDD
    ["+55", /DDD/],
    ["+", /só números/],
    ["lixo", /Chave Pix inválida/],
    ["SUA-CHAVE-PIX-AQUI", /Chave Pix inválida/],
    ["abc123", /Chave Pix inválida/],
    ["12345", /Chave Pix inválida/],
    ["12ABC34501DE3", /Chave Pix inválida/], // 13 caracteres
    ["12ABC34501DE355", /Chave Pix inválida/], // 15 caracteres
    ["???", /Chave Pix inválida/],
  ];
  for (const [input, pattern] of invalid) {
    it(`${visible(input)} -> CHAVE_INVALIDA`, () => {
      assertPixError(() => normalizeKey(input), "CHAVE_INVALIDA", pattern);
    });
  }

  it("CPF inválido -> erro com a dica de telefone (+55DDNÚMERO)", () => {
    assertPixError(() => normalizeKey("529.982.247-26"), "CHAVE_INVALIDA", /Se for telefone, use o formato \+55DDNÚMERO/);
  });

  it("telefone com 11 dígitos sem +55 -> erro com a dica (e não vira CPF por engano)", () => {
    for (const input of ["48999998888", "(48) 99999-8888", "48 99999-8888"]) {
      assertPixError(() => normalizeKey(input), "CHAVE_INVALIDA", /telefone.*\+55DDNÚMERO/);
    }
  });

  it("telefone com DDI mas sem o +: sugere a forma correta", () => {
    assertPixError(() => normalizeKey("5548999998888"), "CHAVE_INVALIDA", /\+5548999998888/);
    assertPixError(() => normalizeKey("55 (48) 3333-4444"), "CHAVE_INVALIDA", /\+554833334444/);
    assertPixError(() => normalizeKey("4899998888"), "CHAVE_INVALIDA", /\+55DDNÚMERO/);
  });

  it("chave aleatória quase certa -> explica o formato", () => {
    assertPixError(() => normalizeKey("123e4567e12b12d1a456426655440000"), "CHAVE_INVALIDA", /36 caracteres/);
    assertPixError(() => normalizeKey("123e4567-e12b-12d1-a456-42665544000"), "CHAVE_INVALIDA", /36 caracteres/);
  });

  it("e-mail: 77 caracteres passam e 78 não", () => {
    const domain = "@exemplo.com";
    const email77 = "x".repeat(77 - domain.length) + domain;
    const email78 = "x".repeat(78 - domain.length) + domain;
    assert.equal(email77.length, 77);
    assert.deepEqual(normalizeKey(email77), { type: "email", value: email77 });
    assertPixError(() => normalizeKey(email78), "CHAVE_INVALIDA", /77 caracteres.*78/);
  });

  it("é idempotente: normalizar o resultado não muda nada", () => {
    for (const [input] of valid) {
      const once = normalizeKey(input);
      assert.deepEqual(normalizeKey(once.value), once, visible(input));
    }
  });

  it("aceita números como entrada (convertidos em texto)", () => {
    assert.deepEqual(normalizeKey(52998224725), { type: "cpf", value: "52998224725" });
  });

  it("chaves geradas ao acaso de cada tipo são aceitas e reconhecidas", () => {
    const random = createRandom(99);
    for (let i = 0; i < 200; i++) {
      const keys = randomKeys(random);
      assert.deepEqual(normalizeKey(keys.aleatoria), { type: "aleatoria", value: keys.aleatoria });
      assert.deepEqual(normalizeKey(keys.email), { type: "email", value: keys.email });
      assert.deepEqual(normalizeKey(keys.telefone), { type: "telefone", value: keys.telefone });
      assert.deepEqual(normalizeKey(keys.cpf), { type: "cpf", value: keys.cpf });
      assert.deepEqual(normalizeKey(keys.cnpj), { type: "cnpj", value: keys.cnpj });
      assert.deepEqual(normalizeKey(keys.cnpjNumerico), { type: "cnpj", value: keys.cnpjNumerico });
    }
  });

  it("trocar um dígito verificador de um CPF/CNPJ válido sempre invalida", () => {
    const random = createRandom(5);
    for (let i = 0; i < 100; i++) {
      const keys = randomKeys(random);
      for (const key of [keys.cpf, keys.cnpj]) {
        const last = key.charAt(key.length - 1);
        const wrong = key.slice(0, -1) + ((Number(last) + 1 + randomInt(random, 0, 8)) % 10);
        assertPixError(() => normalizeKey(wrong), "CHAVE_INVALIDA");
      }
    }
  });
});

// ---------------------------------------------------------------------
// parseAmountCents
// ---------------------------------------------------------------------

describe("parseAmountCents", () => {
  const valid = [
    // números (reais)
    [150, 15000],
    [150.5, 15050],
    [19.99, 1999],
    [1, MIN_CENTS],
    [100000, MAX_CENTS],
    [1234.56, 123456],
    // texto no formato brasileiro
    ["150", 15000],
    ["150,5", 15050],
    ["150,50", 15050],
    ["R$ 150,50", 15050],
    ["R$150", 15000],
    ["r$ 150", 15000],
    ["R$ 150", 15000],
    ["1.500", 150000],
    ["1.500,00", 150000],
    ["R$ 1.500", 150000],
    ["R$ 1.500,50", 150050],
    ["12.345,6", 1234560],
    ["150.50", 15050],
    ["150.5", 15050],
    ["1.50", 150], // ponto com 2 casas = decimal
    ["007", 700],
    // espaços e NBSP (o Intl coloca NBSP depois do "R$")
    ["  150  ", 15000],
    [` R$ 150,50 `, 15050],
    [`R$${NBSP}150,50`, 15050],
    [`${NBSP}150${NBSP}`, 15000],
    [`R$${NBSP}1.500,00`, 150000],
    ["\t150\n", 15000],
    // limites
    ["1,00", MIN_CENTS],
    ["1", MIN_CENTS],
    ["R$ 1,00", MIN_CENTS],
    ["100.000", MAX_CENTS],
    ["100.000,00", MAX_CENTS],
    ["100000", MAX_CENTS],
    ["100000.00", MAX_CENTS],
    ["99.999,99", 9999999],
  ];
  for (const [input, expected] of valid) {
    it(`${visible(input)} -> ${expected}`, () => {
      const cents = parseAmountCents(input);
      assert.equal(cents, expected);
      assert.ok(Number.isInteger(cents));
    });
  }

  const invalid = [
    "",
    "   ",
    "abc",
    "1,2,3",
    "-5",
    "0",
    "0,00",
    "12,345",
    "1,500",
    "1,500.00",
    "1.2.3",
    "1.5000",
    "0.500",
    "0,99", // abaixo do mínimo
    "0,5",
    "0.99",
    "100.000,01", // acima do máximo
    "100000.01",
    "100001",
    "1.000.000",
    "99999999999999999999999",
    "9".repeat(400),
    "R$",
    "R$ ",
    "R$ R$ 150",
    "R $ 150",
    "150 reais",
    "150,00 R$",
    "+150",
    "1e3",
    "0x10",
    "1 500",
    "150,",
    "150.",
    ".5",
    ",5",
    "--5",
    "١٥٠", // dígitos arábicos
    // não-texto e não-número
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    {},
    [],
    ["150"],
    true,
    10n,
    // números fora da regra
    0,
    -0,
    -5,
    0.5,
    0.99,
    100000.01,
    100001,
    1.005, // 3 casas decimais
    0.1 + 0.2,
    1e21,
  ];
  for (const input of invalid) {
    it(`${visible(input).slice(0, 40)} -> NaN`, () => {
      assert.ok(Number.isNaN(parseAmountCents(input)), `devia ser NaN, veio ${parseAmountCents(input)}`);
    });
  }

  it("ida e volta: formatAmountEMV e formatBRL são aceitos de volta por parseAmountCents", () => {
    const random = createRandom(11);
    const samples = [MIN_CENTS, MIN_CENTS + 1, 12345, 15000, 99999, 100000, 100001, 123456, MAX_CENTS - 1, MAX_CENTS];
    for (let i = 0; i < 500; i++) samples.push(randomInt(random, MIN_CENTS, MAX_CENTS));
    for (const cents of samples) {
      assert.equal(parseAmountCents(formatAmountEMV(cents)), cents, formatAmountEMV(cents));
      assert.equal(parseAmountCents(formatBRL(cents)), cents, formatBRL(cents));
      assert.equal(parseAmountCents(formatBRL(cents, { compact: true })), cents, formatBRL(cents, { compact: true }));
      assert.equal(parseAmountCents(cents / 100), cents);
    }
  });
});

// ---------------------------------------------------------------------
// formatAmountEMV e formatBRL
// ---------------------------------------------------------------------

describe("formatAmountEMV", () => {
  const cases = [
    [100, "1.00"],
    [5, "0.05"],
    [0, "0.00"],
    [99, "0.99"],
    [1999, "19.99"],
    [15000, "150.00"],
    [15050, "150.50"],
    [123456, "1234.56"],
    [10000000, "100000.00"],
  ];
  for (const [cents, expected] of cases) {
    it(`${cents} -> ${expected}`, () => {
      assert.equal(formatAmountEMV(cents), expected);
    });
  }

  it("sempre tem 2 casas e confere com toFixed em todo o intervalo permitido", () => {
    for (let cents = 0; cents <= 200000; cents++) {
      assert.equal(formatAmountEMV(cents), (cents / 100).toFixed(2));
    }
    for (let cents = 200001; cents <= MAX_CENTS; cents += 7919) {
      assert.equal(formatAmountEMV(cents), (cents / 100).toFixed(2));
    }
    assert.equal(formatAmountEMV(MAX_CENTS), (MAX_CENTS / 100).toFixed(2));
  });

  it("recusa o que não é inteiro de centavos (VALOR_INVALIDO)", () => {
    for (const cents of [1.5, -1, NaN, Infinity, "100", null, undefined, 2 ** 60]) {
      assertPixError(() => formatAmountEMV(cents), "VALOR_INVALIDO");
    }
  });
});

describe("formatBRL", () => {
  const full = [
    [15000, `R$${NBSP}150,00`],
    [15050, `R$${NBSP}150,50`],
    [100, `R$${NBSP}1,00`],
    [5, `R$${NBSP}0,05`],
    [0, `R$${NBSP}0,00`],
    [150000, `R$${NBSP}1.500,00`],
    [123456, `R$${NBSP}1.234,56`],
    [10000000, `R$${NBSP}100.000,00`],
  ];
  for (const [cents, expected] of full) {
    it(`${cents} -> ${visible(expected)}`, () => {
      assert.equal(formatBRL(cents), expected);
    });
  }

  const compact = [
    [15000, `R$${NBSP}150`],
    [15050, `R$${NBSP}150,50`], // centavos nunca somem
    [100, `R$${NBSP}1`],
    [5, `R$${NBSP}0,05`],
    [150000, `R$${NBSP}1.500`],
    [150050, `R$${NBSP}1.500,50`],
    [10000000, `R$${NBSP}100.000`],
  ];
  for (const [cents, expected] of compact) {
    it(`compact: ${cents} -> ${visible(expected)}`, () => {
      assert.equal(formatBRL(cents, { compact: true }), expected);
    });
  }

  it("usa NBSP (U+00A0) entre o R$ e o número", () => {
    assert.match(formatBRL(15000), /^R\$\u00a0150,00$/);
    assert.doesNotMatch(formatBRL(15000), /R\$ /); // espaço comum não aparece
  });

  it("compact: false e opções vazias dão o formato completo", () => {
    assert.equal(formatBRL(15000, { compact: false }), `R$${NBSP}150,00`);
    assert.equal(formatBRL(15000, {}), `R$${NBSP}150,00`);
    assert.equal(formatBRL(15000, null), `R$${NBSP}150,00`);
    assert.equal(formatBRL(15000, undefined), `R$${NBSP}150,00`);
  });

  it("confere com o Intl.NumberFormat pt-BR em 1000 valores", () => {
    const intl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const random = createRandom(3);
    for (let i = 0; i < 1000; i++) {
      const cents = randomInt(random, 0, MAX_CENTS);
      assert.equal(formatBRL(cents), intl.format(cents / 100));
    }
  });

  it("recusa o que não é inteiro de centavos (VALOR_INVALIDO)", () => {
    for (const cents of [1.5, -1, NaN, "100", null, undefined]) {
      assertPixError(() => formatBRL(cents), "VALOR_INVALIDO");
    }
  });
});

// ---------------------------------------------------------------------
// buildPixPayload
// ---------------------------------------------------------------------

describe("buildPixPayload", () => {
  it("vetor oficial do BCB, byte a byte (sem valor)", () => {
    assert.equal(buildPixPayload({ key: BCB_KEY, name: "Fulano de Tal", city: "BRASILIA" }), BCB_PAYLOAD);
  });

  it("não troca maiúsculas/minúsculas do nome (Fulano de Tal continua assim)", () => {
    const fields = validatePayload(buildPixPayload({ key: BCB_KEY, name: "Fulano de Tal", city: "Brasilia" })).fields;
    assert.equal(fields["59"], "Fulano de Tal");
    assert.equal(fields["60"], "Brasilia");
  });

  it("valores conhecidos (gerados de forma independente pela pix-utils)", () => {
    assert.equal(
      buildPixPayload({ ...SAMPLE, cents: 15000 }),
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865406150.005802BR5915ARTHUR E MARINA6008SAO JOSE62070503***63049C2F"
    );
    assert.equal(
      buildPixPayload({ ...SAMPLE, cents: 15050 }),
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865406150.505802BR5915ARTHUR E MARINA6008SAO JOSE62070503***63045196"
    );
  });

  it("campo 54 ausente quando não há valor (undefined ou null)", () => {
    for (const cents of [undefined, null]) {
      const payload = buildPixPayload({ ...SAMPLE, cents });
      assert.equal("54" in validatePayload(payload).fields, false);
      assert.deepEqual(
        splitTlv(payload).map(([id]) => id),
        ["00", "26", "52", "53", "58", "59", "60", "62", "63"]
      );
    }
    assert.equal("54" in validatePayload(buildPixPayload(SAMPLE)).fields, false);
  });

  it("campo 54 presente com o valor, entre o 53 e o 58", () => {
    const payload = buildPixPayload({ ...SAMPLE, cents: 15000 });
    assert.equal(validatePayload(payload).fields["54"], "150.00");
    assert.ok(payload.includes("53039865406150.005802BR"));
    assert.deepEqual(
      splitTlv(payload).map(([id]) => id),
      ["00", "26", "52", "53", "54", "58", "59", "60", "62", "63"]
    );
  });

  it("estrutura fixa: sem o campo 01, GUI em minúsculas, 52=0000, 53=986, 58=BR, txid ***", () => {
    const parts = splitTlv(buildPixPayload({ ...SAMPLE, cents: 100 }));
    const byId = Object.fromEntries(parts);
    assert.equal(byId["00"], "01");
    assert.ok(!("01" in byId), "o ponto de iniciação (01) não deve ser enviado");
    assert.equal(byId["26"], tlv("00", "br.gov.bcb.pix") + tlv("01", BCB_KEY));
    assert.equal(byId["52"], "0000");
    assert.equal(byId["53"], "986");
    assert.equal(byId["58"], "BR");
    assert.equal(byId["62"], "0503***");
    assert.match(byId["63"], /^[0-9A-F]{4}$/);
    assert.equal(parts[parts.length - 1][0], "63");
  });

  it("só tem ASCII e cabe folgado num QR Code", () => {
    const payload = buildPixPayload({ ...SAMPLE, cents: 15000 });
    assert.match(payload, /^[\x20-\x7e]+$/);
    assert.ok(payload.length < 200, `tamanho ${payload.length}`);
  });

  it("é determinístico", () => {
    assert.equal(buildPixPayload({ ...SAMPLE, cents: 15000 }), buildPixPayload({ ...SAMPLE, cents: 15000 }));
  });

  describe("chave", () => {
    it("normaliza a chave antes de gravar (campo 26.01)", () => {
      const cases = [
        ["123E4567-E12B-12D1-A456-426655440000", BCB_KEY],
        ["Arthur@Example.com", "arthur@example.com"],
        ["+55 (48) 99999-8888", "+5548999998888"],
        ["529.982.247-25", "52998224725"],
        ["11.222.333/0001-81", "11222333000181"],
        ["12.ABC.345/01DE-35", "12ABC34501DE35"],
      ];
      for (const [raw, normalized] of cases) {
        const result = validatePayload(buildPixPayload({ ...SAMPLE, key: raw, cents: 15000 }));
        assert.equal(result.ok, true, result.errors.join(" | "));
        assert.equal(result.fields["26"]["01"], normalized);
      }
    });

    it("chave vazia -> CHAVE_VAZIA", () => {
      for (const key of ["", "  ", undefined, null]) {
        assertPixError(() => buildPixPayload({ ...SAMPLE, key }), "CHAVE_VAZIA");
      }
    });

    it("chave inválida -> CHAVE_INVALIDA", () => {
      for (const key of ["lixo", "529.982.247-26", "48999998888", "a@b"]) {
        assertPixError(() => buildPixPayload({ ...SAMPLE, key }), "CHAVE_INVALIDA");
      }
    });

    it("sem argumentos lança PixError (e não TypeError)", () => {
      assertPixError(() => buildPixPayload(), "CHAVE_VAZIA");
      assertPixError(() => buildPixPayload({}), "CHAVE_VAZIA");
    });

    it("campo 26: e-mail de 77 caracteres cabe (campo com exatamente 99); 78 é recusado", () => {
      const domain = "@exemplo.com";
      const email77 = "x".repeat(77 - domain.length) + domain;
      const payload = buildPixPayload({ ...SAMPLE, key: email77, cents: 15000 });
      const field26 = splitTlv(payload).find(([id]) => id === "26");
      assert.equal(field26[1].length, 99);
      assert.ok(payload.includes("2699" + tlv("00", "br.gov.bcb.pix") + tlv("01", email77)));
      assert.equal(validatePayload(payload).ok, true);
      assert.equal(validatePayload(payload).fields["26"]["01"], email77);

      const email78 = "x".repeat(78 - domain.length) + domain;
      assertPixError(() => buildPixPayload({ ...SAMPLE, key: email78 }), "CHAVE_INVALIDA", /77/);
    });

    it("qualquer campo maior que 99 é barrado pelo tlv (PAYLOAD_INVALIDO)", () => {
      assertPixError(() => tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", "x".repeat(78))), "PAYLOAD_INVALIDO");
    });
  });

  describe("nome e cidade", () => {
    it('"Arthur & Marina" vira "Arthur E Marina"', () => {
      const result = validatePayload(buildPixPayload({ ...SAMPLE, name: "Arthur & Marina", cents: 15000 }));
      assert.equal(result.ok, true);
      assert.equal(result.fields["59"], "Arthur E Marina");
    });

    it("remove acentos e símbolos do nome e da cidade", () => {
      const fields = validatePayload(buildPixPayload({ ...SAMPLE, name: "José Açaí (Jr.)", city: "São José", cents: 15000 })).fields;
      assert.equal(fields["59"], "Jose Acai Jr.");
      assert.equal(fields["60"], "Sao Jose");
    });

    it("corta o nome em 25 e a cidade em 15 caracteres", () => {
      const fields = validatePayload(
        buildPixPayload({ ...SAMPLE, name: "ARTHUR E MARINA DOS SANTOS PEREIRA", city: "SAO JOSE DOS PINHAIS", cents: 15000 })
      ).fields;
      assert.equal(fields["59"], "ARTHUR E MARINA DOS SANTO");
      assert.equal(fields["59"].length, 25);
      assert.equal(fields["60"], "SAO JOSE DOS PI");
      assert.ok(fields["60"].length <= 15);
    });

    it("nome vazio (ou que fica vazio depois de limpar) -> NOME_INVALIDO", () => {
      for (const name of ["", "   ", "@#!", "😀", undefined, null]) {
        assertPixError(() => buildPixPayload({ ...SAMPLE, name }), "NOME_INVALIDO");
      }
    });

    it("cidade vazia (ou que fica vazia depois de limpar) -> CIDADE_INVALIDA", () => {
      for (const city of ["", "   ", "@#!", "😀", undefined, null]) {
        assertPixError(() => buildPixPayload({ ...SAMPLE, city }), "CIDADE_INVALIDA");
      }
    });
  });

  describe("valor", () => {
    it("aceita de MIN_CENTS a MAX_CENTS", () => {
      assert.equal(validatePayload(buildPixPayload({ ...SAMPLE, cents: MIN_CENTS })).fields["54"], "1.00");
      assert.equal(validatePayload(buildPixPayload({ ...SAMPLE, cents: MAX_CENTS })).fields["54"], "100000.00");
      assert.equal(validatePayload(buildPixPayload({ ...SAMPLE, cents: 15050 })).fields["54"], "150.50");
      assert.equal(validatePayload(buildPixPayload({ ...SAMPLE, cents: 123456 })).fields["54"], "1234.56");
    });

    it("recusa fora do intervalo ou que não seja inteiro (VALOR_INVALIDO)", () => {
      const bad = [MIN_CENTS - 1, 0, -100, MAX_CENTS + 1, 150.5, 100.1, NaN, Infinity, "15000", "150,00", true, {}, 0n];
      for (const cents of bad) {
        assertPixError(() => buildPixPayload({ ...SAMPLE, cents }), "VALOR_INVALIDO", /centavos/);
      }
    });

    it("um NaN de parseAmountCents não vira 'sem valor' sem querer", () => {
      assertPixError(() => buildPixPayload({ ...SAMPLE, cents: parseAmountCents("abc") }), "VALOR_INVALIDO");
    });
  });

  describe("txid", () => {
    it('padrão "***"', () => {
      assert.equal(validatePayload(buildPixPayload(SAMPLE)).fields["62"]["05"], "***");
      assert.equal(buildPixPayload({ ...SAMPLE, txid: "***" }), buildPixPayload(SAMPLE));
    });

    it("aceita de 1 a 25 letras e números", () => {
      for (const txid of ["A", "PEDIDO123", "abc123XYZ", "a".repeat(25)]) {
        const result = validatePayload(buildPixPayload({ ...SAMPLE, cents: 15000, txid }));
        assert.equal(result.ok, true, result.errors.join(" | "));
        assert.equal(result.fields["62"]["05"], txid);
      }
      assert.ok(buildPixPayload({ ...SAMPLE, txid: "PEDIDO123" }).includes("62130509PEDIDO123"));
    });

    it("recusa vazio, espaços, símbolos, acento, mais de 25 e não-texto (TXID_INVALIDO)", () => {
      for (const txid of ["", " ", "com espaço", "ab-cd", "a_b", "ção", "a".repeat(26), "**", "****", 123, null, {}]) {
        assertPixError(() => buildPixPayload({ ...SAMPLE, txid }), "TXID_INVALIDO");
      }
    });
  });

  it("propriedade: tudo que é gerado é válido, e todas as combinações de chave/valor passam", () => {
    const random = createRandom(2024);
    const names = ["ARTHUR E MARINA", "Fulano de Tal", "José & Maria", "A", "a".repeat(25), "Ação do Coração"];
    const cities = ["SAO JOSE", "Brasília", "X", "Florianópolis-SC", "a".repeat(15)];
    for (let i = 0; i < 400; i++) {
      const keys = randomKeys(random);
      const key = randomPick(random, Object.values(keys));
      const cents = random() < 0.2 ? undefined : randomInt(random, MIN_CENTS, MAX_CENTS);
      const txid = random() < 0.8 ? undefined : randomString(random, "abcXYZ019", randomInt(random, 1, 25));
      const payload = buildPixPayload({ key, name: randomPick(random, names), city: randomPick(random, cities), cents, txid });
      const result = validatePayload(payload);
      assert.equal(result.ok, true, `${payload} -> ${result.errors.join(" | ")}`);
      assert.equal(result.fields["54"], cents === undefined ? undefined : formatAmountEMV(cents));
      assert.match(payload, /^[\x20-\x7e]+$/);
    }
  });
});

// ---------------------------------------------------------------------
// validatePayload
// ---------------------------------------------------------------------

describe("validatePayload", () => {
  it("aceita o exemplo oficial do BCB e devolve os campos", () => {
    const result = validatePayload(BCB_PAYLOAD);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.fields)), {
      "00": "01",
      "26": { "00": "br.gov.bcb.pix", "01": BCB_KEY },
      "52": "0000",
      "53": "986",
      "58": "BR",
      "59": "Fulano de Tal",
      "60": "BRASILIA",
      "62": { "05": "***" },
      "63": "1D3D",
    });
  });

  it("aceita o payload montado à mão com BASE_PARTS (com valor)", () => {
    const payload = sealed(BASE_PARTS);
    assert.equal(payload, buildPixPayload({ ...SAMPLE, cents: 15000 }));
    const result = validatePayload(payload);
    assert.equal(result.ok, true, result.errors.join(" | "));
    assert.equal(result.fields["54"], "150.00");
    assert.equal(result.fields["59"], "ARTHUR E MARINA");
    assert.equal(result.fields["60"], "SAO JOSE");
  });

  it("aceita o GUI em maiúsculas (comparação sem diferenciar caixa)", () => {
    const account = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", BCB_KEY);
    assert.equal(validatePayload(sealed(replacing("26", account))).ok, true);
  });

  it("aceita o campo 01 (método de iniciação) com 11 ou 12", () => {
    for (const value of ["11", "12"]) {
      const parts = [...BASE_PARTS.slice(0, 1), ["01", value], ...BASE_PARTS.slice(1)];
      assert.equal(validatePayload(sealed(parts)).ok, true, value);
    }
  });

  describe("detecta defeitos", () => {
    const failing = (payload, pattern) => {
      const result = validatePayload(payload);
      assert.equal(result.ok, false, "devia ser inválido: " + payload);
      assert.ok(result.errors.length > 0);
      if (pattern) {
        assert.ok(
          result.errors.some((message) => pattern.test(message)),
          `nenhum erro bate com ${pattern}: ${JSON.stringify(result.errors)}`
        );
      }
      return result;
    };

    it("CRC errado", () => {
      failing(BCB_PAYLOAD.slice(0, -1) + "E", /CRC incorreto.*1D3E.*1D3D/);
      failing(BCB_PAYLOAD.slice(0, -4) + "0000", /CRC incorreto/);
    });

    it("CRC em minúsculas ou fora do formato", () => {
      failing(BCB_PAYLOAD.slice(0, -4) + "1d3d", /4 dígitos hexadecimais maiúsculos/); // o valor certo, em minúsculas
      failing(BCB_PAYLOAD.slice(0, -4) + "ZZZZ", /4 dígitos hexadecimais/);
      failing(BCB_PAYLOAD.slice(0, -8) + "6303ABC", /4 dígitos hexadecimais/);
    });

    it("tamanho do TLV inconsistente", () => {
      // Declarou um caractere a mais: o erro aparece no campo seguinte, que "perdeu" o começo.
      failing(BCB_PAYLOAD.replace("5913Fulano", "5914Fulano"), /texto inesperado.*tamanho/);
      // Declarou um caractere a menos: o campo seguinte começa em lugar errado.
      failing(BCB_PAYLOAD.replace("5913Fulano", "5912Fulano"), /texto inesperado.*tamanho/);
      // Declarou mais do que existe no texto.
      failing(BCB_PAYLOAD.replace("5913Fulano", "5999Fulano"), /tamanho inconsistente no campo 59 \(declara 99 caracteres/);
      failing(BCB_PAYLOAD.slice(0, 40), /tamanho inconsistente no campo 26/);
      // Campo 26 grande demais engole pedaços dos vizinhos: os subcampos deixam de fazer sentido.
      failing(BCB_PAYLOAD.replace("2658", "2699"), /Campo 26: texto inesperado/);
    });

    it("campo obrigatório faltando (com o CRC refeito, para isolar o defeito)", () => {
      for (const [id, name] of [["00", "versão"], ["26", "conta Pix"], ["52", "categoria"], ["53", "moeda"], ["58", "país"], ["59", "nome"], ["60", "cidade"], ["62", "dados adicionais"]]) {
        failing(sealed(without(id)), new RegExp(`obrigatório ausente: ${id} \\(${name}`));
      }
    });

    it("campo 63 (CRC) faltando", () => {
      failing(BCB_PAYLOAD.slice(0, -8), /obrigatório ausente: 63/);
    });

    it("subcampos obrigatórios do 26 e do 62", () => {
      failing(sealed(replacing("26", tlv("00", "br.gov.bcb.pix"))), /26\.01/);
      failing(sealed(replacing("26", tlv("01", BCB_KEY))), /26\.00/);
      failing(sealed(replacing("26", tlv("00", "br.gov.bcb.piz") + tlv("01", BCB_KEY))), /GUI/);
      failing(sealed(replacing("26", tlv("00", "br.gov.bcb.pix") + "0100")), /26\.01/);
      failing(sealed(replacing("62", tlv("06", "abc"))), /62\.05/);
      failing(sealed(replacing("62", tlv("05", "com espaço"))), /txid/);
      failing(sealed(replacing("62", tlv("05", "a".repeat(26)))), /txid/);
    });

    it("valores fixos errados (00, 52, 53, 58)", () => {
      failing(sealed(replacing("00", "02")), /campo 00.*"01"/);
      failing(sealed(replacing("52", "5411")), /campo 52.*"0000"/);
      failing(sealed(replacing("53", "840")), /campo 53.*"986"/);
      failing(sealed(replacing("58", "US")), /campo 58.*"BR"/);
    });

    it("campo 54 (valor) fora do formato 0.00", () => {
      for (const value of ["150", "150.0", "150.000", "1,50", "-1.00", "abc", ".50", "12345678901.00"]) {
        failing(sealed(replacing("54", value)), /campo 54/);
      }
      for (const value of ["150.00", "0.05", "100000.00"]) {
        assert.equal(validatePayload(sealed(replacing("54", value))).ok, true, value);
      }
    });

    it("nome (59) e cidade (60) com tamanho ou caracteres inválidos", () => {
      failing(sealed(replacing("59", "")), /campo 59.*1 a 25/);
      failing(sealed(replacing("59", "A".repeat(26))), /campo 59.*1 a 25.*26/);
      failing(sealed(replacing("59", "José")), /campo 59.*ASCII/);
      failing(sealed(replacing("60", "")), /campo 60.*1 a 15/);
      failing(sealed(replacing("60", "A".repeat(16))), /campo 60.*1 a 15.*16/);
      failing(sealed(replacing("60", "São Paulo")), /campo 60.*ASCII/);
      assert.equal(validatePayload(sealed(replacing("59", "A".repeat(25)))).ok, true);
      assert.equal(validatePayload(sealed(replacing("60", "A".repeat(15)))).ok, true);
    });

    it("campo 01 inválido", () => {
      const parts = [...BASE_PARTS.slice(0, 1), ["01", "99"], ...BASE_PARTS.slice(1)];
      failing(sealed(parts), /campo 01/);
    });

    it("lixo no fim do payload", () => {
      failing(BCB_PAYLOAD + "XYZ", /texto inesperado na posição 137.*lixo no fim/);
      failing(BCB_PAYLOAD + "\n", /texto inesperado na posição 137/);
      failing(BCB_PAYLOAD + " ", /texto inesperado na posição 137/);
      failing(BCB_PAYLOAD + "0000", /campo 00 aparece mais de uma vez|CRC.*último/);
      failing(BCB_PAYLOAD + BCB_PAYLOAD, /mais de uma vez/);
    });

    it("lixo no começo", () => {
      failing("XX" + BCB_PAYLOAD, /texto inesperado na posição 0/);
      failing(" " + BCB_PAYLOAD, /texto inesperado na posição 0/);
    });

    it("CRC fora da última posição", () => {
      const body = BCB_PAYLOAD.slice(0, -8);
      const tail = tlv("80", "abc");
      const withCrcInTheMiddle = body + "6304" + crc16(body + "6304") + tail;
      failing(withCrcInTheMiddle, /CRC.*último/);
    });

    it("campo repetido", () => {
      failing(sealed([...BASE_PARTS, ["58", "BR"]]), /campo 58 aparece mais de uma vez/);
    });

    it("campo 00 que não é o primeiro", () => {
      const [first, ...rest] = BASE_PARTS;
      failing(sealed([...rest, first]), /campo 00.*primeiro/);
    });

    it("vazio e não-texto não lançam exceção", () => {
      for (const input of ["", undefined, null, 123, {}, []]) {
        const result = validatePayload(input);
        assert.equal(result.ok, false);
        assert.ok(result.errors.length > 0);
        assert.deepEqual(result.fields, {});
      }
    });

    it("sempre devolve a mesma forma { ok, errors, fields }", () => {
      for (const input of [BCB_PAYLOAD, "lixo", ""]) {
        const result = validatePayload(input);
        assert.deepEqual(Object.keys(result).sort(), ["errors", "fields", "ok"]);
        assert.equal(typeof result.ok, "boolean");
        assert.ok(Array.isArray(result.errors));
        assert.ok(result.errors.every((message) => typeof message === "string" && message.length > 0));
      }
    });
  });

  it("propriedade: alterar qualquer caractere de um payload válido o invalida", () => {
    const payloads = [BCB_PAYLOAD, buildPixPayload({ ...SAMPLE, cents: 15000 }), buildPixPayload({ ...SAMPLE, key: "+5548999998888", txid: "PEDIDO1" })];
    for (const payload of payloads) {
      assert.equal(validatePayload(payload).ok, true);
      for (let i = 0; i < payload.length; i++) {
        for (const replacement of ["0", "A", "x", " "]) {
          if (payload[i] === replacement) continue;
          const broken = payload.slice(0, i) + replacement + payload.slice(i + 1);
          assert.equal(validatePayload(broken).ok, false, `posição ${i} -> ${JSON.stringify(replacement)}: ${broken}`);
        }
      }
    }
  });

  it("propriedade: textos aleatórios nunca lançam exceção nem são aceitos", () => {
    const random = createRandom(31337);
    for (let i = 0; i < 1000; i++) {
      const text = randomString(random, "0123456789ABCDEF ab*.:-", randomInt(random, 0, 160));
      const result = validatePayload(text);
      assert.equal(result.ok, false, text);
    }
    // Pedaços de payload válido (truncados) também não passam.
    for (let length = 0; length < BCB_PAYLOAD.length; length++) {
      assert.equal(validatePayload(BCB_PAYLOAD.slice(0, length)).ok, false, `cortado em ${length}`);
    }
  });
});

// ---------------------------------------------------------------------
// Conferência cruzada com a biblioteca pix-utils
// ---------------------------------------------------------------------
//
// O que descobrimos comparando com a pix-utils 2.8.2 (versão fixada no
// package.json):
//  - Quando nome e cidade já estão em MAIÚSCULAS, sem acento e dentro dos
//    limites (25 e 15), `createStaticPix(...).toBRCode()` é IDÊNTICO ao nosso
//    payload, byte a byte (mesma ordem, mesmos campos, mesmo CRC).
//  - Diferenças legítimas, por decisão de projeto nossa:
//      1. a pix-utils põe nome e cidade em MAIÚSCULAS; nós mantemos a caixa
//         (o exemplo oficial do BCB usa "Fulano de Tal");
//      2. a pix-utils mantém "&" e símbolos; nós trocamos "&" por "E" e
//         descartamos o que não está em [A-Za-z0-9 $%*+-./:];
//      3. a pix-utils não normaliza nem valida a chave (aceita CPF inválido,
//         não põe e-mail em minúsculas e até aceita chave vazia, gerando um
//         BR Code sem o campo 26.01); nós sim;
//      4. a pix-utils recusa nome > 25 / cidade > 15 sem cortar, aceita nome
//         vazio (e simplesmente omite o campo 59) e descarta em silêncio um
//         valor negativo ou NaN; nós lançamos PixError;
//      5. `parsePix` devolve transactionAmount 0 quando não há valor e NÃO
//         exige todos os campos obrigatórios (aceita um BR Code sem o 58),
//         por isso não basta para validar: usamos também `validatePayload`.
//  - Em CRC e estrutura TLV as duas concordam: ambas recusam CRC errado,
//    tamanho inconsistente e lixo no fim.

describe("conferência cruzada com a pix-utils", () => {
  const { createStaticPix, parsePix, hasError } = pixUtils;

  function parse(payload) {
    const parsed = parsePix(payload);
    assert.equal(hasError(parsed), false, `parsePix recusou: ${JSON.stringify(parsed)}`);
    return parsed;
  }

  it("parsePix lê o exemplo oficial", () => {
    const parsed = parse(BCB_PAYLOAD);
    assert.equal(parsed.type, "STATIC");
    assert.equal(parsed.pixKey, BCB_KEY);
    assert.equal(parsed.merchantName, "Fulano de Tal");
    assert.equal(parsed.merchantCity, "BRASILIA");
    assert.equal(parsed.merchantCategoryCode, "0000");
    assert.equal(parsed.transactionCurrency, "986");
    assert.equal(parsed.countryCode, "BR");
    assert.equal(parsed.txid, "***");
    assert.equal(parsed.transactionAmount, 0); // a pix-utils usa 0 para "sem valor"
  });

  it("parsePix lê o nosso payload: chave, valor, nome e cidade batem", () => {
    const payload = buildPixPayload({ key: "Arthur@Example.com", name: "Arthur & Marina", city: "São José", cents: 15050 });
    const parsed = parse(payload);
    assert.equal(parsed.type, "STATIC");
    assert.equal(parsed.pixKey, "arthur@example.com");
    assert.equal(parsed.transactionAmount, 150.5);
    assert.equal(parsed.merchantName, "Arthur E Marina");
    assert.equal(parsed.merchantCity, "Sao Jose");
    assert.equal(parsed.txid, "***");
    assert.equal(parsed.countryCode, "BR");
    assert.equal(parsed.transactionCurrency, "986");
    assert.equal(parsed.merchantCategoryCode, "0000");
    // Regenerado pela pix-utils (que põe tudo em maiúsculas), é o nosso payload com as mesmas letras.
    assert.equal(
      parsed.toBRCode(),
      buildPixPayload({ key: "arthur@example.com", name: "ARTHUR E MARINA", city: "SAO JOSE", cents: 15050 })
    );
  });

  it("sem valor: parsePix devolve 0 e não existe o campo 54", () => {
    const payload = buildPixPayload(SAMPLE);
    assert.equal(parse(payload).transactionAmount, 0);
    assert.ok(!splitTlv(payload).some(([id]) => id === "54"));
  });

  it("entradas já em MAIÚSCULAS: createStaticPix gera exatamente o mesmo texto", () => {
    const scenarios = [
      { key: BCB_KEY, name: "ARTHUR E MARINA", city: "SAO JOSE", cents: 15000 },
      { key: BCB_KEY, name: "ARTHUR E MARINA", city: "SAO JOSE", cents: 15050 },
      { key: BCB_KEY, name: "ARTHUR E MARINA", city: "SAO JOSE", cents: undefined },
      { key: BCB_KEY, name: "FULANO DE TAL", city: "BRASILIA", cents: undefined },
      { key: "arthur@example.com", name: "A", city: "B", cents: MIN_CENTS },
      { key: "+5548999998888", name: "A".repeat(25), city: "B".repeat(15), cents: MAX_CENTS },
      { key: "52998224725", name: "JOAO 123 $%*+-./:", city: "RIO BRANCO", cents: 199 },
      { key: "11222333000181", name: "EMPRESA LTDA", city: "SAO PAULO", cents: 999999 },
      { key: "12ABC34501DE35", name: "EMPRESA LTDA", city: "SAO PAULO", cents: 100000 },
    ];
    for (const { key, name, city, cents } of scenarios) {
      const reference = createStaticPix({
        merchantName: name,
        merchantCity: city,
        pixKey: key,
        transactionAmount: cents === undefined ? 0 : cents / 100,
      });
      assert.equal(hasError(reference), false);
      assert.equal(buildPixPayload({ key, name, city, cents }), reference.toBRCode(), JSON.stringify({ name, cents }));
    }
  });

  it("txid personalizado: createStaticPix gera exatamente o mesmo texto", () => {
    const reference = createStaticPix({ ...{ merchantName: "ARTHUR E MARINA", merchantCity: "SAO JOSE", pixKey: BCB_KEY }, transactionAmount: 10, txid: "PEDIDO123" });
    assert.equal(buildPixPayload({ ...SAMPLE, cents: 1000, txid: "PEDIDO123" }), reference.toBRCode());
    assert.equal(parse(buildPixPayload({ ...SAMPLE, cents: 1000, txid: "PEDIDO123" })).txid, "PEDIDO123");
  });

  it("2.000 combinações aleatórias: bytes idênticos aos da pix-utils e campos conferem no parsePix", () => {
    const random = createRandom(4242);
    const names = ["ARTHUR E MARINA", "FULANO DE TAL", "A", "MARIA JOSE DA SILVA SANTOS PEREIRA", "JOAO 123 $%*+-./:"];
    const cities = ["SAO JOSE", "BRASILIA", "RIO DE JANEIRO", "SAO BERNARDO DO CAMPO", "X"];
    for (let i = 0; i < 2000; i++) {
      const key = randomPick(random, Object.values(randomKeys(random)));
      const name = randomPick(random, names);
      const city = randomPick(random, cities);
      const cents = random() < 0.2 ? undefined : randomInt(random, MIN_CENTS, MAX_CENTS);
      const ours = buildPixPayload({ key, name, city, cents });

      // A pix-utils recusa texto maior que o limite em vez de cortar: cortamos antes.
      const reference = createStaticPix({
        merchantName: normalizeText(name, 25),
        merchantCity: normalizeText(city, 15),
        pixKey: normalizeKey(key).value,
        transactionAmount: cents === undefined ? 0 : cents / 100,
      });
      assert.equal(hasError(reference), false);
      assert.equal(ours, reference.toBRCode());

      const parsed = parse(ours);
      assert.equal(parsed.pixKey, normalizeKey(key).value);
      assert.equal(parsed.merchantName, normalizeText(name, 25));
      assert.equal(parsed.merchantCity, normalizeText(city, 15));
      assert.equal(parsed.transactionAmount, cents === undefined ? 0 : cents / 100);
    }
  });

  it("valores: a conta em centavos dá o mesmo número que a pix-utils lê de volta", () => {
    const random = createRandom(8);
    const samples = [MIN_CENTS, 101, 999, 1000, 1001, 15000, 15050, 99999, 100000, 123456, 199999, MAX_CENTS - 1, MAX_CENTS];
    for (let i = 0; i < 300; i++) samples.push(randomInt(random, MIN_CENTS, MAX_CENTS));
    for (const cents of samples) {
      const parsed = parse(buildPixPayload({ ...SAMPLE, cents }));
      assert.equal(parsed.transactionAmount, cents / 100, String(cents));
      assert.equal(Math.round(parsed.transactionAmount * 100), cents, String(cents));
    }
  });

  describe("diferenças conhecidas (documentadas)", () => {
    const reference = (overrides) =>
      createStaticPix({ merchantName: "ARTHUR E MARINA", merchantCity: "SAO JOSE", pixKey: "a@b.co", transactionAmount: 10, ...overrides });

    it("1. a pix-utils põe nome e cidade em maiúsculas; nós mantemos a caixa", () => {
      assert.equal(parse(reference({ merchantName: "Arthur e Marina" }).toBRCode()).merchantName, "ARTHUR E MARINA");
      assert.equal(parse(buildPixPayload({ key: "a@b.co", name: "Arthur e Marina", city: "Sao Jose", cents: 1000 })).merchantName, "Arthur e Marina");
    });

    it('2. a pix-utils mantém "&" e símbolos; nós trocamos por "E" e descartamos', () => {
      assert.equal(parse(reference({ merchantName: "Arthur & Marina" }).toBRCode()).merchantName, "ARTHUR & MARINA");
      assert.equal(parse(reference({ merchantName: "A_B,C" }).toBRCode()).merchantName, "A_B,C");
      assert.equal(parse(buildPixPayload({ key: "a@b.co", name: "Arthur & Marina", city: "X", cents: 1000 })).merchantName, "Arthur E Marina");
      assert.equal(parse(buildPixPayload({ key: "a@b.co", name: "A_B,C", city: "X", cents: 1000 })).merchantName, "ABC");
    });

    it("3. a pix-utils não normaliza nem valida a chave; nós sim", () => {
      assert.equal(parse(reference({ pixKey: "ABC@Example.COM" }).toBRCode()).pixKey, "ABC@Example.COM");
      assert.equal(hasError(reference({ pixKey: "12345678900" })), false); // CPF inválido passa
      const emptyKey = reference({ pixKey: "" }).toBRCode(); // BR Code sem 26.01
      assert.equal(validatePayload(emptyKey).ok, false);
      assert.equal(parse(buildPixPayload({ key: "ABC@Example.COM", name: "X", city: "Y", cents: 1000 })).pixKey, "abc@example.com");
      assertPixError(() => buildPixPayload({ key: "12345678900", name: "X", city: "Y" }), "CHAVE_INVALIDA");
      assertPixError(() => buildPixPayload({ key: "", name: "X", city: "Y" }), "CHAVE_VAZIA");
    });

    it("4. limites e valores: a pix-utils recusa ou descarta em silêncio; nós lançamos PixError", () => {
      assert.equal(hasError(reference({ merchantName: "A".repeat(26) })), true); // não corta
      assert.equal(hasError(reference({ merchantCity: "A".repeat(16) })), true);
      assert.equal(validatePayload(reference({ merchantName: "" }).toBRCode()).ok, false); // omite o campo 59
      const hasAmountField = (code) => splitTlv(code).some(([id]) => id === "54");
      assert.equal(hasAmountField(reference({ transactionAmount: -5 }).toBRCode()), false); // sem valor, sem aviso
      assert.equal(hasAmountField(reference({ transactionAmount: NaN }).toBRCode()), false);
      assertPixError(() => buildPixPayload({ ...SAMPLE, name: "" }), "NOME_INVALIDO");
      assertPixError(() => buildPixPayload({ ...SAMPLE, cents: -500 }), "VALOR_INVALIDO");
      assertPixError(() => buildPixPayload({ ...SAMPLE, cents: NaN }), "VALOR_INVALIDO");
      assert.equal(validatePayload(buildPixPayload({ ...SAMPLE, name: "A".repeat(40) })).fields["59"].length, 25);
    });

    it("5. o parsePix aceita um BR Code sem campos obrigatórios; o validatePayload não", () => {
      const withoutCountry = sealed(without("58"));
      const parsed = parsePix(withoutCountry);
      assert.equal(hasError(parsed), false);
      assert.equal(parsed.countryCode, undefined);
      assert.equal(validatePayload(withoutCountry).ok, false);
    });
  });

  describe("recusam os mesmos defeitos de CRC e de estrutura", () => {
    const broken = {
      "CRC errado": BCB_PAYLOAD.slice(0, -1) + "E",
      "tamanho do TLV inconsistente": BCB_PAYLOAD.replace("5913Fulano", "5914Fulano"),
      "lixo no fim": BCB_PAYLOAD + "XYZ",
      "texto cortado": BCB_PAYLOAD.slice(0, 80),
    };
    for (const [name, payload] of Object.entries(broken)) {
      it(name, () => {
        assert.equal(hasError(parsePix(payload)), true, "a pix-utils devia recusar");
        assert.equal(validatePayload(payload).ok, false, "o validatePayload devia recusar");
      });
    }
  });
});

// ---------------------------------------------------------------------
// QR Code: gerar, "fotografar" e ler de volta
// ---------------------------------------------------------------------

describe("presente dentro do Pix (mensagem 26.02 e identificador 62.05)", () => {
  const { describeGift, messageRoom, parsePix, hasError } = { ...PixBR, ...pixUtils };
  const KEY = "2bb06d88-5678-4aef-a0c1-557e7985b3f5";
  const build = (reference, key = KEY) =>
    buildPixPayload({ key, name: "ARTHUR E MARINA", city: "SAO JOSE", cents: 15000, ...reference });

  it("a pix-utils lê a mensagem e o identificador do presente", () => {
    const reference = describeGift({ id: "parrillada", name: "Parrillada na Argentina", quantity: 2, quotas: true }, KEY);
    assert.deepEqual(reference, { message: "Parrillada na Argentina - 2 cotas", txid: "PARRILLADAX2" });
    const parsed = parsePix(build(reference));
    assert.equal(hasError(parsed), false);
    assert.equal(parsed.infoAdicional, reference.message);
    assert.equal(parsed.txid, "PARRILLADAX2");
  });

  it("usa 'Presente:' quando cabe, sem acentos, e corta nomes longos entre palavras", () => {
    assert.equal(describeGift({ id: "valor-livre", name: "Contribuição livre" }, KEY).message, "Presente: Contribuicao livre");
    assert.equal(describeGift({ id: "kh", name: "Kingdom Hearts 4 para o noivo", quantity: 1, quotas: true }, KEY).message,
      "Kingdom Hearts 4 - 1 cota");
    assert.equal(describeGift({ id: "abaporu", name: "1 ingresso para ver o Abaporu na Argentina" }, KEY).message,
      "1 ingresso para ver o Abaporu");
  });

  it("identificador só com letras e números, até 25, com as cotas no fim", () => {
    const { txid } = describeGift({ id: "um-presente-com-um-id-bem-comprido", name: "X", quantity: 10, quotas: true }, KEY);
    assert.match(txid, /^[A-Z0-9]{1,25}$/);
    assert.ok(txid.endsWith("X10"));
    assert.equal(describeGift({ id: "", name: "X" }, KEY).txid, "***");
  });

  it("o campo 26 nunca passa de 99, mesmo com a chave mais longa (mensagem é omitida)", () => {
    assert.equal(messageRoom(KEY), 37);
    for (const size of [40, 55, 60, 65]) {
      const key = "a".repeat(size) + "@example.com";
      const reference = describeGift({ id: "parrillada", name: "Parrillada na Argentina", quantity: 2, quotas: true }, key);
      const payload = build(reference, key);
      assert.equal(validatePayload(payload).ok, true, key);
      assert.equal(hasError(parsePix(payload)), false, key);
    }
  });

  it("cada presente de presentes.js gera um Pix válido com a sua mensagem", () => {
    const context = { window: {} };
    vm.runInNewContext(readFileSync(new URL("../../site/presentes.js", import.meta.url), "utf8"), context);
    for (const gift of context.window.PRESENTES) {
      for (const quantity of gift.cota ? [1, Math.round(gift.valor / gift.cota)] : [1]) {
        const reference = describeGift({ id: gift.id, name: gift.nome, quantity, quotas: Boolean(gift.cota) }, KEY);
        assert.ok(reference.message.length > 0 && reference.message.length <= 37, reference.message);
        const parsed = parsePix(build(reference));
        assert.equal(hasError(parsed), false, gift.id);
        assert.equal(parsed.infoAdicional, reference.message);
      }
    }
  });
});

describe("QR Code (ida e volta com qrcode-generator e jsQR)", () => {
  const QR_DARK = [0x6f, 0x4f, 0x2f]; // #6f4f2f, a cor escura do site

  /** Desenha o QR em RGBA: módulos escuros em #6f4f2f sobre branco, margem de 4 módulos. */
  function render(text, { level = "M", scale = 6, margin = 4 } = {}) {
    const qr = qrcode(0, level); // 0 = escolhe a menor versão que couber
    qr.addData(text);
    qr.make();
    const modules = qr.getModuleCount();
    const size = (modules + margin * 2) * scale;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255); // branco opaco
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (!qr.isDark(row, col)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const offset = (((row + margin) * scale + dy) * size + (col + margin) * scale + dx) * 4;
            rgba[offset] = QR_DARK[0];
            rgba[offset + 1] = QR_DARK[1];
            rgba[offset + 2] = QR_DARK[2];
          }
        }
      }
    }
    return { rgba, size, modules };
  }

  function decode(text, options) {
    const { rgba, size } = render(text, options);
    const result = jsQR(rgba, size, size);
    assert.ok(result, "o jsQR não encontrou o QR Code");
    return result.data;
  }

  const email77 = "x".repeat(77 - "@exemplo.com".length) + "@exemplo.com";
  const payloads = {
    "exemplo oficial do BCB (sem valor)": BCB_PAYLOAD,
    "Arthur & Marina, R$ 150,00": buildPixPayload({ ...SAMPLE, cents: 15000 }),
    "R$ 1.234,56 com chave telefone": buildPixPayload({ ...SAMPLE, key: "+55 (48) 99999-8888", cents: 123456 }),
    "chave CNPJ alfanumérico, R$ 1,00": buildPixPayload({ ...SAMPLE, key: "12.ABC.345/01DE-35", cents: MIN_CENTS }),
    "chave CPF, R$ 100.000,00": buildPixPayload({ ...SAMPLE, key: "529.982.247-25", cents: MAX_CENTS }),
    "o maior payload possível (e-mail de 77, nome 25, cidade 15, txid 25)": buildPixPayload({
      key: email77,
      name: "A".repeat(25),
      city: "B".repeat(15),
      cents: MAX_CENTS,
      txid: "T".repeat(25),
    }),
  };

  for (const [name, payload] of Object.entries(payloads)) {
    it(`${name}: o texto lido é idêntico (nível M)`, () => {
      assert.equal(decode(payload), payload);
    });
  }

  it("funciona nos 4 níveis de correção de erro (L, M, Q, H)", () => {
    const payload = payloads["Arthur & Marina, R$ 150,00"];
    for (const level of ["L", "M", "Q", "H"]) {
      assert.equal(decode(payload, { level }), payload, level);
    }
  });

  it("funciona com módulos pequenos (3 px) e grandes (10 px)", () => {
    const payload = payloads["Arthur & Marina, R$ 150,00"];
    assert.equal(decode(payload, { scale: 3 }), payload);
    assert.equal(decode(payload, { scale: 10 }), payload);
  });

  it("o QR é pequeno o bastante para ficar nítido num celular (>= 4 px por módulo em 280 px)", () => {
    const typical = render(payloads["Arthur & Marina, R$ 150,00"]).modules; // hoje: 49 (versão 8)
    const largest = render(payloads["o maior payload possível (e-mail de 77, nome 25, cidade 15, txid 25)"]).modules; // hoje: 61 (versão 11)
    assert.ok(typical <= 53, `${typical} módulos`);
    assert.ok(largest <= 61, `${largest} módulos`);
    // 280 px divididos por (módulos + 4 de margem de cada lado)
    assert.ok(280 / (largest + 8) >= 4, `${280 / (largest + 8)} px por módulo`);
  });

  it("o QR de textos diferentes é diferente", () => {
    const a = render(payloads["Arthur & Marina, R$ 150,00"]);
    const b = render(buildPixPayload({ ...SAMPLE, cents: 20000 }));
    assert.notDeepEqual(Buffer.from(a.rgba), Buffer.from(b.rgba));
  });
});
