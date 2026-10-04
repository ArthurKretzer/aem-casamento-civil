// =============================
// COMPORTAMENTO DA PÁGINA
// =============================
// Lê config.js e presentes.js, monta os cards de presentes e cuida do
// modal Pix (Pix Copia e Cola, QR Code, cópia da chave). Não edite aqui
// para trocar dados: use config.js e presentes.js.
(function () {
  "use strict";

  const CONFIG = window.SITE_CONFIG || {};
  const PIX_CONFIG = CONFIG.pix || {};
  const GIFTS = Array.isArray(window.PRESENTES) ? window.PRESENTES : [];
  const Pix = window.PixBR;

  const QR_COLOR = "#6f4f2f";       // marrom do convite (o dourado lê mal)
  const QR_MODULE_PX = 8;           // resolução do PNG; exibido a 280px
  const QR_QUIET_ZONE = 4;          // margem obrigatória, em módulos
  const CUSTOM_GIFT_NAME = "Contribuição livre";

  const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

  // ---------- Pix: configuração ----------
  // O modo "ativo" só liga com chave válida, recebedor preenchido e um
  // payload de teste que passa na validação. Na dúvida, fica "em breve".
  function resolvePix() {
    const rawKey = String(PIX_CONFIG.chave || "").trim();
    if (!rawKey) return null;
    if (!Pix) {
      console.error("[Pix] pix.js não carregou; o Pix fica desativado.");
      return null;
    }
    try {
      const key = Pix.normalizeKey(rawKey);
      const receiver = String(PIX_CONFIG.recebedor || "").trim();
      if (!receiver) {
        throw new Error("preencha 'recebedor' com o nome que o banco mostra ao pagar.");
      }
      const settings = {
        key: key.value,
        receiver,
        name: PIX_CONFIG.nomeQr,
        city: PIX_CONFIG.cidadeQr,
      };
      const probe = Pix.buildPixPayload({ key: settings.key, name: settings.name, city: settings.city, cents: Pix.MIN_CENTS });
      const check = Pix.validatePayload(probe);
      if (!check.ok) throw new Error(check.errors.join("; "));
      return settings;
    } catch (error) {
      console.error(`[Pix] Configuração inválida em config.js: ${error.message}`);
      return null;
    }
  }

  const pix = resolvePix();
  document.documentElement.dataset.pix = pix ? "ativo" : "em-breve";

  // ---------- WhatsApp ----------
  const whatsapp = String(CONFIG.whatsapp || "").replace(/\D/g, "");
  const hasWhatsapp = /^55\d{10,11}$/.test(whatsapp);

  function whatsappLink(text) {
    return `https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`;
  }

  // ---------- Presentes ----------
  function giftCents(gift) {
    if (Pix) return Pix.parseAmountCents(gift.valor);
    const cents = Math.round(Number(gift.valor) * 100);
    return cents > 0 ? cents : NaN;
  }

  function formatMoney(cents, compact) {
    return Pix ? Pix.formatBRL(cents, { compact }) : `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
  }

  function createPlaceholder() {
    const placeholder = document.createElement("div");
    placeholder.className = "gift__placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "✦";
    return placeholder;
  }

  function createGiftCard(gift, cents) {
    const card = document.createElement("article");
    card.className = "gift";
    card.dataset.testid = "presente-card";
    card.dataset.id = gift.id;
    card.dataset.centavos = String(cents);
    if (gift.esgotado) card.dataset.esgotado = "true";

    const media = document.createElement("div");
    media.className = "gift__media";
    if (gift.imagem) {
      const img = document.createElement("img");
      img.className = "gift__img";
      img.alt = gift.imagemAlt || "";
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 960;
      img.height = 720;
      img.addEventListener("error", () => img.replaceWith(createPlaceholder()), { once: true });
      img.src = gift.imagem;
      media.append(img);
    } else {
      media.append(createPlaceholder());
    }

    const body = document.createElement("div");
    body.className = "gift__body";

    const name = document.createElement("h3");
    name.className = "gift__name";
    name.dataset.testid = "presente-nome";
    name.textContent = gift.nome;
    body.append(name);

    if (gift.descricao) {
      const description = document.createElement("p");
      description.className = "gift__desc";
      description.textContent = gift.descricao;
      body.append(description);
    }

    const price = document.createElement("p");
    price.className = "gift__price";
    price.dataset.testid = "presente-valor";
    price.textContent = formatMoney(cents, true);
    body.append(price);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gift__action";
    button.dataset.testid = "presente-card-botao";
    if (gift.esgotado) {
      button.disabled = true;
      button.textContent = "já presenteado";
    } else if (!pix) {
      button.disabled = true;
      button.textContent = "Pix em breve";
    } else {
      button.textContent = "presentear →";
      button.setAttribute("aria-label", `Presentear: ${gift.nome} (${formatMoney(cents, true)})`);
      button.addEventListener("click", () => openPix(cents, gift.nome));
    }
    body.append(button);

    card.append(media, body);
    return card;
  }

  function renderGifts() {
    const grid = byTestId("presentes-grid");
    const cards = [];
    for (const gift of GIFTS) {
      const cents = giftCents(gift);
      if (!gift || !gift.id || !gift.nome || !Number.isInteger(cents)) {
        console.error("[Presentes] Item inválido em presentes.js (confira id, nome e valor):", gift);
        continue;
      }
      cards.push(createGiftCard(gift, cents));
    }
    grid.replaceChildren(...cards);
  }

  // ---------- Valor livre ----------
  const customForm = document.getElementById("customForm");
  const customInput = byTestId("valor-livre-input");
  const customButton = byTestId("valor-livre-botao");
  const customError = byTestId("valor-livre-erro");

  function setupCustomGift() {
    if (!pix) {
      customInput.disabled = true;
      customButton.disabled = true;
      customButton.textContent = "Pix em breve";
      return;
    }
    customInput.addEventListener("input", clearCustomError);
    customForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const cents = Pix.parseAmountCents(customInput.value);
      if (!Number.isInteger(cents)) {
        customError.textContent = `Digite um valor entre ${formatMoney(Pix.MIN_CENTS, true)} e ${formatMoney(Pix.MAX_CENTS, true)}, por exemplo 150 ou 150,50.`;
        customError.hidden = false;
        customInput.setAttribute("aria-invalid", "true");
        customInput.focus();
        return;
      }
      clearCustomError();
      openPix(cents, CUSTOM_GIFT_NAME);
    });
  }

  function clearCustomError() {
    customError.hidden = true;
    customError.textContent = "";
    customInput.removeAttribute("aria-invalid");
  }

  // ---------- Seção Pix ----------
  function setupPixSection() {
    if (!pix) return;
    byTestId("pix-chave").textContent = pix.key;
    byTestId("pix-recebedor").textContent = pix.receiver;
    byTestId("pix-recebedor-modal").textContent = pix.receiver;

    const copyKeyButton = byTestId("pix-copiar-chave");
    copyKeyButton.addEventListener("click", async () => {
      const copied = await copyText(pix.key);
      copyKeyButton.textContent = copied ? "copiado!" : "copie a chave ao lado";
      setTimeout(() => { copyKeyButton.textContent = "copiar chave"; }, 2200);
    });
  }

  // ---------- Área de transferência ----------
  async function copyText(text, fallbackField) {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error("clipboard indisponível");
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Navegadores dentro de apps (WhatsApp, Instagram...) às vezes bloqueiam a API.
      if (fallbackField) {
        fallbackField.focus();
        fallbackField.select();
        fallbackField.setSelectionRange(0, fallbackField.value.length);
        try {
          return document.execCommand("copy");
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  // ---------- QR Code ----------
  function renderQrCanvas(payload) {
    const qr = window.qrcode(0, "M");
    qr.addData(payload);
    qr.make();
    const modules = qr.getModuleCount();
    const size = (modules + QR_QUIET_ZONE * 2) * QR_MODULE_PX;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = QR_COLOR;
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) {
          context.fillRect((col + QR_QUIET_ZONE) * QR_MODULE_PX, (row + QR_QUIET_ZONE) * QR_MODULE_PX, QR_MODULE_PX, QR_MODULE_PX);
        }
      }
    }
    return canvas;
  }

  // ---------- Modal ----------
  const dialog = byTestId("pix-dialog");
  const dialogTitle = byTestId("pix-valor");
  const dialogGiftName = byTestId("pix-presente");
  const payloadField = byTestId("pix-payload");
  const qrImage = byTestId("pix-qr");
  const saveQrLink = byTestId("pix-salvar");
  const copyPayloadButton = byTestId("pix-copiar");
  const copyFeedback = byTestId("pix-feedback");
  const notifyLink = byTestId("pix-avisar");

  let currentPayload = "";

  function openPix(cents, giftName) {
    if (!pix) return;
    let payload;
    try {
      payload = Pix.buildPixPayload({ key: pix.key, name: pix.name, city: pix.city, cents });
      const check = Pix.validatePayload(payload);
      if (!check.ok) throw new Error(check.errors.join("; "));
    } catch (error) {
      console.error(`[Pix] Não foi possível gerar o código: ${error.message}`);
      return;
    }
    currentPayload = payload;
    const amount = formatMoney(cents, false);

    dialogTitle.textContent = amount;
    dialogGiftName.textContent = giftName;
    payloadField.value = payload;
    copyFeedback.textContent = "";

    const dataUrl = renderQrCanvas(payload).toDataURL("image/png");
    qrImage.src = dataUrl;
    qrImage.alt = `QR Code Pix de ${amount} para Arthur & Marina`;
    qrImage.dataset.ready = "true";
    saveQrLink.href = dataUrl;
    saveQrLink.download = `pix-arthur-e-marina-${(cents / 100).toFixed(2).replace(".", "-").replace(/-00$/, "")}.png`;

    if (hasWhatsapp) {
      notifyLink.href = whatsappLink(`Oi, Arthur e Marina! Acabei de enviar um presente pelo Pix: ${giftName} (${amount}). Com carinho,`);
      notifyLink.hidden = false;
    } else {
      notifyLink.hidden = true;
    }

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.classList.add("is-fallback");
      dialog.setAttribute("open", "");
    }
    // Ajusta a altura do campo ao código inteiro (só dá para medir com o modal aberto).
    payloadField.style.height = "auto";
    payloadField.style.height = `${payloadField.scrollHeight + 2}px`;
    copyPayloadButton.focus();
  }

  function closePix() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function setupDialog() {
    byTestId("pix-fechar").addEventListener("click", closePix);

    // Clique no fundo escurecido (fora da caixa) fecha o modal.
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (outside) closePix();
    });

    dialog.addEventListener("close", () => { copyFeedback.textContent = ""; });

    copyPayloadButton.addEventListener("click", async () => {
      const copied = await copyText(currentPayload, payloadField);
      copyFeedback.textContent = copied
        ? "Código copiado! Agora é só colar em Pix Copia e Cola no app do seu banco."
        : "Não foi possível copiar automaticamente. O código está selecionado acima: toque e segure para copiar.";
    });

    byTestId("pix-copiar-chave-modal").addEventListener("click", async () => {
      const copied = await copyText(pix ? pix.key : "");
      copyFeedback.textContent = copied
        ? "Chave Pix copiada! No app do banco, escolha Pix com chave e digite o valor."
        : `Não foi possível copiar automaticamente. A chave é: ${pix ? pix.key : ""}`;
    });
  }

  // ---------- Confirmação de presença ----------
  function formatDeadline(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
  }

  function setupRsvp() {
    const deadline = formatDeadline(CONFIG.rsvpPrazo);
    if (deadline) byTestId("rsvp-prazo").textContent = `até ${deadline}`;

    const rsvpButton = byTestId("rsvp-botao");
    const rsvpAlt = byTestId("rsvp-sem-whatsapp");
    if (hasWhatsapp) {
      rsvpButton.href = whatsappLink("Olá, Arthur e Marina! Quero confirmar minha presença no jantar do casamento, dia 16/11. Nome(s): ");
      rsvpButton.hidden = false;
      rsvpAlt.hidden = true;
    } else {
      rsvpButton.hidden = true;
      rsvpAlt.hidden = false;
    }
  }

  renderGifts();
  setupCustomGift();
  setupPixSection();
  setupDialog();
  setupRsvp();
})();
