/*!
 * pix.js — "Pix Copia e Cola" (BR Code estático) para o site do casamento.
 *
 * Sem dependências. O mesmo arquivo roda de duas formas:
 *   - no navegador, como script clássico: define `window.PixBR`;
 *   - no Node, como módulo CommonJS: `require("./pix.js")` (usado nos testes).
 *
 * Referências: "Manual de Padrões para Iniciação do Pix" (Banco Central do
 * Brasil) e EMV(R) QRCPS Merchant-Presented Mode.
 *
 * Formato do payload gerado (campos TLV: id de 2 dígitos + tamanho de 2
 * dígitos + valor), nesta ordem:
 *   00 versão "01"
 *   26 conta Pix: 00 "br.gov.bcb.pix" + 01 chave (no máximo 99 caracteres)
 *   52 categoria "0000"   53 moeda "986"   54 valor (opcional)
 *   58 país "BR"   59 nome (até 25)   60 cidade (até 15)
 *   62 dados adicionais: 05 txid ("***" = sem identificador)
 *   63 CRC16 (4 hexadecimais maiúsculos)
 * O campo 01 (método de iniciação) NÃO é enviado, igual ao exemplo oficial.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module !== null && typeof module.exports === "object") {
    module.exports = api;
  } else {
    root.PixBR = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this,
  function () {
    "use strict";

    // ------------------------------------------------------------------
    // Constantes
    // ------------------------------------------------------------------

    /** Menor valor aceito: R$ 1,00 (em centavos). */
    const MIN_CENTS = 100;
    /** Maior valor aceito: R$ 100.000,00 (em centavos). */
    const MAX_CENTS = 10000000;

    const GUI = "br.gov.bcb.pix"; // identificador do arranjo Pix (campo 26.00)
    const MAX_NAME = 25; // campo 59
    const MAX_CITY = 15; // campo 60
    const MAX_TXID = 25; // campo 62.05
    const MAX_FIELD = 99; // um campo TLV não pode passar de 99 caracteres
    // Chave e-mail: 77 caracteres é o limite do Pix. Com o GUI (4 + 14) e o
    // cabeçalho da chave (4), o campo 26 chega a exatamente 99.
    const MAX_EMAIL = 77;

    const PHONE_HINT = "Se for telefone, use o formato +55DDNÚMERO (ex.: +5548999998888).";

    const hasOwn = function (object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    };

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Validação básica (parte local + domínio com ponto), já em minúsculas.
    const EMAIL_RE =
      /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;
    const TXID_RE = /^[A-Za-z0-9]{1,25}$/;

    // Pesos dos dígitos verificadores do CNPJ (numérico e alfanumérico).
    const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    // ------------------------------------------------------------------
    // Erro
    // ------------------------------------------------------------------

    /**
     * Erro lançado por todas as funções deste módulo.
     * `code` ∈ CHAVE_VAZIA | CHAVE_INVALIDA | VALOR_INVALIDO | NOME_INVALIDO |
     *          CIDADE_INVALIDA | TXID_INVALIDO | PAYLOAD_INVALIDO
     * `message` é sempre um texto em português, pronto para mostrar à pessoa.
     */
    class PixError extends Error {
      constructor(code, message) {
        super(message);
        this.name = "PixError";
        this.code = code;
      }
    }

    // ------------------------------------------------------------------
    // Texto, TLV e CRC
    // ------------------------------------------------------------------

    /**
     * Deixa o texto no alfabeto aceito pelo Pix: remove acentos, troca "&" por
     * "E", descarta o que não é `[A-Za-z0-9 $%*+-./:]`, junta espaços repetidos
     * e corta em `maxLength`. NÃO muda maiúsculas/minúsculas.
     * Ex.: normalizeText("Arthur & Marina", 25) -> "Arthur E Marina".
     */
    function normalizeText(value, maxLength) {
      let text = (value === null || value === undefined ? "" : String(value))
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // acentos viram letras simples
        .replace(/&/g, " E ") // espaços em volta evitam "A&B" -> "AEB"
        .replace(/\s+/g, " ") // tab, quebra de linha e NBSP viram espaço
        .replace(/[^A-Za-z0-9 $%*+\-./:]/g, "")
        .replace(/ {2,}/g, " ")
        .trim();
      if (Number.isFinite(maxLength) && maxLength >= 0) {
        text = text.slice(0, maxLength).trim();
      }
      return text;
    }

    /** Monta um campo TLV: id + tamanho (2 dígitos) + valor. Máximo de 99. */
    function tlv(id, value) {
      const fieldId = typeof id === "number" && Number.isInteger(id) && id >= 0 && id <= 99
        ? String(id).padStart(2, "0")
        : id;
      if (typeof fieldId !== "string" || !/^\d{2}$/.test(fieldId)) {
        throw new PixError(
          "PAYLOAD_INVALIDO",
          'Identificador de campo inválido: "' + id + '" (precisa ter 2 dígitos).'
        );
      }
      const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
      if (typeof text !== "string") {
        throw new PixError("PAYLOAD_INVALIDO", "O campo " + fieldId + " precisa de um valor em texto.");
      }
      if (text.length > MAX_FIELD) {
        throw new PixError(
          "PAYLOAD_INVALIDO",
          "O campo " + fieldId + " tem " + text.length + " caracteres, mas o máximo do formato Pix é " + MAX_FIELD + "."
        );
      }
      return fieldId + String(text.length).padStart(2, "0") + text;
    }

    /**
     * CRC16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF), como exige o
     * Pix. Devolve 4 hexadecimais MAIÚSCULOS. Vetor de teste: "123456789" -> "29B1".
     */
    function crc16(text) {
      if (typeof text !== "string") {
        throw new PixError("PAYLOAD_INVALIDO", "O CRC16 só pode ser calculado sobre um texto.");
      }
      // Em UTF-8 (igual a ASCII para qualquer payload Pix válido).
      const bytes = new TextEncoder().encode(text);
      let crc = 0xffff;
      for (let i = 0; i < bytes.length; i++) {
        crc ^= bytes[i] << 8;
        for (let bit = 0; bit < 8; bit++) {
          crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
        }
      }
      return crc.toString(16).toUpperCase().padStart(4, "0");
    }

    // ------------------------------------------------------------------
    // Chave Pix
    // ------------------------------------------------------------------

    /** Dígitos verificadores do CPF (11 dígitos; rejeita 111.111.111-11 etc.). */
    function isValidCpf(digits) {
      if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
      const checkDigit = function (length) {
        let sum = 0;
        for (let i = 0; i < length; i++) sum += Number(digits.charAt(i)) * (length + 1 - i);
        const rest = sum % 11;
        return rest < 2 ? 0 : 11 - rest;
      };
      return checkDigit(9) === Number(digits.charAt(9)) && checkDigit(10) === Number(digits.charAt(10));
    }

    /**
     * Dígitos verificadores do CNPJ, inclusive o alfanumérico (a partir de
     * 2026): 12 caracteres [0-9A-Z] + 2 dígitos; o valor de cada caractere é o
     * código ASCII menos 48 ("0" = 0, "9" = 9, "A" = 17 ... "Z" = 42).
     */
    function isValidCnpj(chars) {
      if (!/^[0-9A-Z]{12}\d{2}$/.test(chars) || /^(.)\1{13}$/.test(chars)) return false;
      const values = Array.from(chars, function (ch) {
        return ch.charCodeAt(0) - 48;
      });
      const checkDigit = function (weights) {
        let sum = 0;
        for (let i = 0; i < weights.length; i++) sum += values[i] * weights[i];
        const rest = sum % 11;
        return rest < 2 ? 0 : 11 - rest;
      };
      return checkDigit(CNPJ_WEIGHTS_1) === values[12] && checkDigit(CNPJ_WEIGHTS_2) === values[13];
    }

    function normalizeEmail(text) {
      const email = text.toLowerCase();
      if (email.length > MAX_EMAIL) {
        throw new PixError(
          "CHAVE_INVALIDA",
          "E-mail grande demais: a chave Pix aceita no máximo " + MAX_EMAIL + " caracteres (este tem " + email.length + ")."
        );
      }
      if (!EMAIL_RE.test(email)) {
        throw new PixError(
          "CHAVE_INVALIDA",
          "E-mail inválido. Confira se não há espaços, acentos ou erro de digitação (ex.: nome@dominio.com)."
        );
      }
      return email;
    }

    function normalizePhone(text) {
      const digits = text.slice(1).replace(/[\s().\-]/g, "");
      if (!/^\d+$/.test(digits)) {
        throw new PixError("CHAVE_INVALIDA", "Telefone inválido: depois do + use só números. " + PHONE_HINT);
      }
      if (digits.slice(0, 2) !== "55") {
        throw new PixError("CHAVE_INVALIDA", "Só são aceitos telefones do Brasil (código +55). " + PHONE_HINT);
      }
      const national = digits.slice(2);
      // DDD (2 dígitos, sem zero) + 8 ou 9 dígitos = 10 ou 11 no total.
      if (!/^[1-9][1-9]\d{8,9}$/.test(national)) {
        throw new PixError(
          "CHAVE_INVALIDA",
          "Telefone inválido: depois do +55 informe o DDD e o número (10 ou 11 dígitos, sem o zero do DDD). " + PHONE_HINT
        );
      }
      return "+55" + national;
    }

    /**
     * Interpreta a chave Pix digitada e a devolve no formato que vai no QR.
     * Devolve `{ type, value }` com type ∈ "aleatoria" | "email" | "telefone" |
     * "cpf" | "cnpj". Lança PixError (CHAVE_VAZIA ou CHAVE_INVALIDA).
     *   - aleatória (UUID): minúsculas;
     *   - e-mail: minúsculas, até 77 caracteres;
     *   - telefone: precisa começar com +55 -> "+55DDNNNNNNNNN";
     *   - CPF / CNPJ: só os caracteres (sem . - /), com dígitos verificadores válidos.
     */
    function normalizeKey(raw) {
      const text = raw === null || raw === undefined ? "" : String(raw).trim();
      if (text === "") {
        throw new PixError("CHAVE_VAZIA", "A chave Pix está vazia.");
      }

      if (UUID_RE.test(text)) {
        return { type: "aleatoria", value: text.toLowerCase() };
      }
      if (text.indexOf("@") !== -1) {
        return { type: "email", value: normalizeEmail(text) };
      }
      if (text.charAt(0) === "+") {
        return { type: "telefone", value: normalizePhone(text) };
      }

      const compact = text.replace(/[\s.\-\/()]/g, "");

      if (/^\d{11}$/.test(compact)) {
        if (isValidCpf(compact)) return { type: "cpf", value: compact };
        throw new PixError(
          "CHAVE_INVALIDA",
          "CPF inválido (os dígitos verificadores não conferem). " + PHONE_HINT
        );
      }

      if (/^[0-9A-Za-z]{14}$/.test(compact)) {
        const cnpj = compact.toUpperCase();
        if (isValidCnpj(cnpj)) return { type: "cnpj", value: cnpj };
        throw new PixError("CHAVE_INVALIDA", "CNPJ inválido (os dígitos verificadores não conferem).");
      }

      if (/^55\d{10,11}$/.test(compact)) {
        throw new PixError(
          "CHAVE_INVALIDA",
          "Telefone sem o sinal de +. Você quis dizer +" + compact + "? O formato é +55DDNÚMERO."
        );
      }
      if (/^\d{10,13}$/.test(compact)) {
        throw new PixError("CHAVE_INVALIDA", "Chave Pix inválida. " + PHONE_HINT);
      }
      if (/^[0-9a-f-]{30,40}$/i.test(text)) {
        throw new PixError(
          "CHAVE_INVALIDA",
          "Chave aleatória inválida: ela tem 36 caracteres no formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (números e letras de a a f)."
        );
      }
      throw new PixError(
        "CHAVE_INVALIDA",
        "Chave Pix inválida. Use e-mail, telefone (+55DDNÚMERO), CPF, CNPJ ou chave aleatória."
      );
    }

    // ------------------------------------------------------------------
    // Valores
    // ------------------------------------------------------------------

    /** Centavos a partir de um número de reais (150, 150.5). NaN se tiver mais de 2 casas. */
    function centsFromNumber(value) {
      if (!Number.isFinite(value)) return NaN;
      const cents = Math.round(value * 100);
      return Math.abs(value * 100 - cents) < 1e-6 ? cents : NaN;
    }

    /** Centavos a partir de um texto em reais (formato brasileiro). NaN se inválido. */
    function centsFromString(value) {
      // \s também cobre NBSP, que o Intl coloca depois do "R$".
      const text = value.replace(/^\s+|\s+$/g, "").replace(/^R\$\s*/i, "");
      const match =
        /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(text) || // 1.500 | 1.500,5 | 1.500,00
        /^(\d+)(?:,(\d{1,2}))?$/.exec(text) || // 150 | 150,5 | 150,50
        /^(\d+)\.(\d{1,2})$/.exec(text); // 150.5 | 150.50 (ponto com 1 ou 2 casas)
      if (!match) return NaN;
      const whole = Number(match[1].replace(/\./g, ""));
      const fraction = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
      return whole * 100 + fraction;
    }

    /**
     * Converte o que a pessoa digitou (ou um número de reais) em centavos
     * inteiros. Devolve NaN se for inválido ou estiver fora de
     * [MIN_CENTS, MAX_CENTS]. Aceita 150, 150.5, "150", "150,5", "R$ 150,50",
     * "1.500", "1.500,00" e "150.50" (ponto decimal só com 1 ou 2 casas).
     */
    function parseAmountCents(input) {
      let cents = NaN;
      if (typeof input === "number") {
        cents = centsFromNumber(input);
      } else if (typeof input === "string") {
        cents = centsFromString(input);
      }
      return cents >= MIN_CENTS && cents <= MAX_CENTS ? cents : NaN;
    }

    function assertWholeCents(cents) {
      if (!Number.isSafeInteger(cents) || cents < 0) {
        throw new PixError("VALOR_INVALIDO", "O valor precisa ser um número inteiro de centavos (0 ou mais).");
      }
    }

    /** Valor no formato do campo 54: 15000 -> "150.00" (só aritmética inteira). */
    function formatAmountEMV(cents) {
      assertWholeCents(cents);
      const rest = cents % 100;
      return (cents - rest) / 100 + "." + String(rest).padStart(2, "0");
    }

    let brlFormatters = null;

    /**
     * Valor em reais para exibir: 15000 -> "R$ 150,00" (o Intl usa NBSP entre
     * "R$" e o número). Com `{ compact: true }`, valores inteiros perdem o ",00":
     * "R$ 150"; valores com centavos continuam completos: "R$ 150,50".
     */
    function formatBRL(cents, options) {
      assertWholeCents(cents);
      if (!brlFormatters) {
        const base = { style: "currency", currency: "BRL" };
        brlFormatters = {
          full: new Intl.NumberFormat("pt-BR", base),
          whole: new Intl.NumberFormat("pt-BR", Object.assign({ minimumFractionDigits: 0, maximumFractionDigits: 0 }, base)),
        };
      }
      const compact = Boolean(options && options.compact);
      const formatter = compact && cents % 100 === 0 ? brlFormatters.whole : brlFormatters.full;
      return formatter.format(cents / 100);
    }

    // ------------------------------------------------------------------
    // Montagem do payload
    // ------------------------------------------------------------------

    /**
     * Monta o BR Code estático ("Pix Copia e Cola").
     *   key   chave Pix (qualquer formato aceito por normalizeKey)
     *   name  nome do recebedor (vira até 25 caracteres sem acento)
     *   city  cidade do recebedor (vira até 15 caracteres sem acento)
     *   cents valor em centavos (inteiro entre MIN_CENTS e MAX_CENTS);
     *         null/undefined = sem valor (a pessoa digita no app do banco)
     *   txid  "***" (padrão) ou 1 a 25 letras/números
     * Lança PixError com o `code` correspondente a cada problema.
     */
    function buildPixPayload(params) {
      const input = params || {};
      const key = normalizeKey(input.key);

      const name = normalizeText(input.name, MAX_NAME);
      if (name === "") {
        throw new PixError(
          "NOME_INVALIDO",
          "O nome do recebedor é obrigatório e precisa ter ao menos uma letra ou número (acentos e símbolos são removidos)."
        );
      }
      const city = normalizeText(input.city, MAX_CITY);
      if (city === "") {
        throw new PixError(
          "CIDADE_INVALIDA",
          "A cidade do recebedor é obrigatória e precisa ter ao menos uma letra ou número (acentos e símbolos são removidos)."
        );
      }

      const hasAmount = input.cents !== null && input.cents !== undefined;
      if (hasAmount && (!Number.isInteger(input.cents) || input.cents < MIN_CENTS || input.cents > MAX_CENTS)) {
        throw new PixError(
          "VALOR_INVALIDO",
          "O valor precisa ser um número inteiro de centavos entre " + MIN_CENTS + " (R$ 1,00) e " + MAX_CENTS + " (R$ 100.000,00)."
        );
      }

      const txid = input.txid === undefined ? "***" : input.txid;
      if (txid !== "***" && !(typeof txid === "string" && TXID_RE.test(txid))) {
        throw new PixError(
          "TXID_INVALIDO",
          'O identificador (txid) precisa ser "***" ou ter de 1 a ' + MAX_TXID + " letras e números, sem espaços ou símbolos."
        );
      }

      const merchantAccount = tlv("00", GUI) + tlv("01", key.value);
      const body =
        tlv("00", "01") +
        tlv("26", merchantAccount) +
        tlv("52", "0000") +
        tlv("53", "986") +
        (hasAmount ? tlv("54", formatAmountEMV(input.cents)) : "") +
        tlv("58", "BR") +
        tlv("59", name) +
        tlv("60", city) +
        tlv("62", tlv("05", txid)) +
        "6304";
      return body + crc16(body);
    }

    // ------------------------------------------------------------------
    // Validação de um payload pronto
    // ------------------------------------------------------------------

    /**
     * Percorre uma sequência TLV. Devolve os campos (id -> valor), a ordem em
     * que apareceram, a posição de cada um e os erros de estrutura encontrados.
     */
    function parseTlv(text, label) {
      const map = {};
      const order = [];
      const offsets = {};
      const errors = [];
      let pos = 0;
      while (pos < text.length) {
        const head = text.slice(pos, pos + 4);
        if (!/^\d{4}$/.test(head)) {
          errors.push(
            label + ": texto inesperado na posição " + pos + ' ("' + text.slice(pos, pos + 12) + (text.length - pos > 12 ? "..." : "") +
              '"): sobrou lixo no fim ou o tamanho de um campo anterior está inconsistente (cada campo começa com 2 dígitos de id e 2 de tamanho).'
          );
          break;
        }
        const id = head.slice(0, 2);
        const size = Number(head.slice(2));
        const value = text.slice(pos + 4, pos + 4 + size);
        if (value.length < size) {
          errors.push(
            label + ": tamanho inconsistente no campo " + id + " (declara " + size + " caracteres, mas restam só " + value.length + ")."
          );
          break;
        }
        if (hasOwn(map, id)) {
          errors.push(label + ": o campo " + id + " aparece mais de uma vez.");
        } else {
          map[id] = value;
          offsets[id] = pos;
        }
        order.push(id);
        pos += 4 + size;
      }
      return { map: map, order: order, offsets: offsets, errors: errors };
    }

    /**
     * Confere a estrutura e as regras de um Pix Copia e Cola estático.
     * Devolve `{ ok, errors, fields }`; `errors` são textos em português e
     * `fields` mapeia id -> valor (os campos 26 e 62 viram objetos com os
     * subcampos). Não lança exceção.
     */
    function validatePayload(payload) {
      const errors = [];
      const fields = {};

      if (typeof payload !== "string" || payload.length === 0) {
        errors.push("O payload está vazio ou não é um texto.");
        return { ok: false, errors: errors, fields: fields };
      }

      const top = parseTlv(payload, "Payload");
      errors.push.apply(errors, top.errors);
      Object.keys(top.map).forEach(function (id) {
        fields[id] = top.map[id];
      });

      // Campos obrigatórios (o 54, valor, é opcional).
      const required = [
        ["00", "versão do formato"],
        ["26", "conta Pix"],
        ["52", "categoria"],
        ["53", "moeda"],
        ["58", "país"],
        ["59", "nome do recebedor"],
        ["60", "cidade do recebedor"],
        ["62", "dados adicionais"],
        ["63", "CRC"],
      ];
      const has = function (id) {
        return hasOwn(top.map, id);
      };
      required.forEach(function (item) {
        if (!has(item[0])) {
          errors.push("Campo obrigatório ausente: " + item[0] + " (" + item[1] + ").");
        }
      });

      // Posição dos campos 00 (primeiro) e 63 (último).
      if (top.order.length > 0 && top.order[0] !== "00" && has("00")) {
        errors.push("O campo 00 (versão do formato) deve ser o primeiro do payload.");
      }
      if (has("63") && top.order[top.order.length - 1] !== "63") {
        errors.push("O campo 63 (CRC) deve ser o último do payload.");
      }

      // Valores fixos.
      const fixed = [
        ["00", "01", "versão do formato"],
        ["52", "0000", "categoria"],
        ["53", "986", "moeda (986 = real)"],
        ["58", "BR", "país"],
      ];
      fixed.forEach(function (item) {
        if (has(item[0]) && top.map[item[0]] !== item[1]) {
          errors.push('O campo ' + item[0] + " (" + item[2] + ') deve ser "' + item[1] + '", mas é "' + top.map[item[0]] + '".');
        }
      });

      if (has("01") && top.map["01"] !== "11" && top.map["01"] !== "12") {
        errors.push('O campo 01 (método de iniciação), quando presente, deve ser "11" ou "12".');
      }

      // 26: conta Pix (GUI + chave).
      if (has("26")) {
        const account = parseTlv(top.map["26"], "Campo 26");
        errors.push.apply(errors, account.errors);
        fields["26"] = account.map;
        if (!hasOwn(account.map, "00")) {
          errors.push("Campo obrigatório ausente: 26.00 (GUI br.gov.bcb.pix).");
        } else if (account.map["00"].toLowerCase() !== GUI) {
          errors.push('O campo 26.00 (GUI) deve ser "' + GUI + '", mas é "' + account.map["00"] + '".');
        }
        if (!hasOwn(account.map, "01") || account.map["01"] === "") {
          errors.push("Campo obrigatório ausente: 26.01 (chave Pix).");
        }
      }

      // 54: valor (opcional).
      if (has("54") && (!/^\d+\.\d{2}$/.test(top.map["54"]) || top.map["54"].length > 13)) {
        errors.push('O campo 54 (valor) deve ter o formato "150.00" (até 13 caracteres), mas é "' + top.map["54"] + '".');
      }

      // 59 e 60: nome e cidade, em ASCII imprimível.
      const text = [
        ["59", MAX_NAME, "nome do recebedor"],
        ["60", MAX_CITY, "cidade do recebedor"],
      ];
      text.forEach(function (item) {
        if (!has(item[0])) return;
        const value = top.map[item[0]];
        if (value.length < 1 || value.length > item[1]) {
          errors.push("O campo " + item[0] + " (" + item[2] + ") deve ter de 1 a " + item[1] + " caracteres, mas tem " + value.length + ".");
        }
        if (!/^[\x20-\x7e]*$/.test(value)) {
          errors.push("O campo " + item[0] + " (" + item[2] + ") só pode ter caracteres ASCII (sem acentos).");
        }
      });

      // 62: dados adicionais (txid em 62.05).
      if (has("62")) {
        const extra = parseTlv(top.map["62"], "Campo 62");
        errors.push.apply(errors, extra.errors);
        fields["62"] = extra.map;
        if (!hasOwn(extra.map, "05") || extra.map["05"] === "") {
          errors.push("Campo obrigatório ausente: 62.05 (txid; use *** se não houver).");
        } else if (extra.map["05"] !== "***" && !TXID_RE.test(extra.map["05"])) {
          errors.push('O campo 62.05 (txid) deve ser "***" ou ter de 1 a ' + MAX_TXID + " letras e números.");
        }
      }

      // 63: CRC16 calculado sobre tudo até "6304" (inclusive).
      if (has("63")) {
        const crcValue = top.map["63"];
        if (!/^[0-9A-F]{4}$/.test(crcValue)) {
          errors.push("O campo 63 (CRC) deve ter exatamente 4 dígitos hexadecimais maiúsculos, mas é \"" + crcValue + '".');
        } else {
          const expected = crc16(payload.slice(0, top.offsets["63"] + 4));
          if (crcValue !== expected) {
            errors.push("CRC incorreto: o payload traz " + crcValue + ", mas o cálculo dá " + expected + ".");
          }
        }
      }

      return { ok: errors.length === 0, errors: errors, fields: fields };
    }

    return Object.freeze({
      PixError: PixError,
      MIN_CENTS: MIN_CENTS,
      MAX_CENTS: MAX_CENTS,
      normalizeText: normalizeText,
      tlv: tlv,
      crc16: crc16,
      normalizeKey: normalizeKey,
      parseAmountCents: parseAmountCents,
      formatAmountEMV: formatAmountEMV,
      formatBRL: formatBRL,
      buildPixPayload: buildPixPayload,
      validatePayload: validatePayload,
    });
  }
);
