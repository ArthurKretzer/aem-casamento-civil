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

  // Presente em cotas: valor de cada cota e quantas cotas fecham o presente.
  // As cotas não são contadas nem esgotam: é só para dar parte de um presente.
  function giftQuota(gift, cents) {
    if (gift.cota === undefined || gift.cota === null || gift.cota === "") return null;
    const quotaCents = Pix ? Pix.parseAmountCents(gift.cota) : Math.round(Number(gift.cota) * 100);
    if (!Number.isInteger(quotaCents) || quotaCents <= 0 || quotaCents > cents) {
      console.error(`[Presentes] Cota inválida em "${gift.nome}" (confira o valor da cota):`, gift.cota);
      return null;
    }
    return { cents: quotaCents, max: Math.max(1, Math.floor(cents / quotaCents)) };
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
    const quota = giftQuota(gift, cents);

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
    price.textContent = formatMoney(quota ? quota.cents : cents, true);
    if (quota) {
      const unit = document.createElement("span");
      unit.className = "gift__unit";
      unit.textContent = "a cota";
      price.append(" ", unit);
    }
    body.append(price);

    if (quota) {
      card.dataset.cota = String(quota.cents);
      const full = document.createElement("p");
      full.className = "gift__full";
      full.dataset.testid = "presente-cota";
      full.textContent = `presente completo: ${formatMoney(cents, true)}`;
      body.append(full);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gift__action";
    button.dataset.testid = "presente-card-botao";
    if (gift.esgotado) {
      button.disabled = true;
      button.textContent = "já presenteado";
    } else if (!pix) {
      button.disabled = true;
      button.textContent = "disponível em breve";
    } else {
      button.textContent = "presentear →";
      const label = quota ? `cotas de ${formatMoney(quota.cents, true)}` : formatMoney(cents, true);
      button.setAttribute("aria-label", `Presentear: ${gift.nome} (${label})`);
      button.addEventListener("click", () => (quota ? openPix(quota.cents, gift.nome, quota.max, gift.id) : openPix(cents, gift.nome, 1, gift.id)));
    }
    body.append(button);

    card.append(media, body);
    return card;
  }

  function renderGifts() {
    const grid = byTestId("presentes-grid");
    const cards = [];
    for (const gift of GIFTS) {
      const cents = gift ? giftCents(gift) : NaN;
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
      customButton.textContent = "em breve";
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
      openPix(cents, CUSTOM_GIFT_NAME, 1, "valor-livre");
    });
  }

  function clearCustomError() {
    customError.hidden = true;
    customError.textContent = "";
    customInput.removeAttribute("aria-invalid");
  }

  // ---------- Recebedor (conferido pelo convidado no app do banco) ----------
  function setupReceiver() {
    if (pix) byTestId("pix-recebedor-modal").textContent = pix.receiver;
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
  const amountText = byTestId("pix-valor");
  const giftNameText = byTestId("pix-presente");
  const quotaPicker = byTestId("pix-cotas");
  const quotaCount = byTestId("pix-cotas-quantidade");
  const quotaLess = byTestId("pix-cotas-menos");
  const quotaMore = byTestId("pix-cotas-mais");
  const quotaInfo = byTestId("pix-cotas-info");
  const payloadField = byTestId("pix-payload");
  const qrImage = byTestId("pix-qr");
  const saveQrLink = byTestId("pix-salvar");
  const copyPayloadButton = byTestId("pix-copiar");
  const copyFeedback = byTestId("pix-feedback");
  const notifyLink = byTestId("pix-avisar");

  let currentPayload = "";

  // Presente aberto no modal. "quantity" só muda em presentes com cotas.
  let current = null;

  function openPix(unitCents, giftName, maxQuantity = 1, giftId = "") {
    if (!pix) return;
    current = { id: giftId, name: giftName, unitCents, quantity: 1, maxQuantity };
    if (!updatePix()) return;
    copyFeedback.textContent = "";

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.classList.add("is-fallback");
      dialog.setAttribute("open", "");
    }
    // Ajusta a altura do campo ao código inteiro (só dá para medir com o modal aberto).
    fitPayloadField();
    copyPayloadButton.focus();
  }

  // Monta o código Pix, o QR Code e os textos para o valor atual.
  function updatePix() {
    const cents = current.unitCents * current.quantity;
    let payload;
    try {
      // O presente vai na mensagem e no identificador do Pix, para os noivos saberem o que foi dado.
      const reference = Pix.describeGift(
        { id: current.id, name: current.name, quantity: current.quantity, quotas: current.maxQuantity > 1 }, pix.key);
      payload = Pix.buildPixPayload({ key: pix.key, name: pix.name, city: pix.city, cents, ...reference });
      const check = Pix.validatePayload(payload);
      if (!check.ok) throw new Error(check.errors.join("; "));
    } catch (error) {
      console.error(`[Pix] Não foi possível gerar o código: ${error.message}`);
      return false;
    }
    currentPayload = payload;
    const amount = formatMoney(cents, false);

    amountText.textContent = amount;
    giftNameText.textContent = current.name;
    payloadField.value = payload;

    const hasQuotas = current.maxQuantity > 1;
    quotaPicker.hidden = !hasQuotas;
    if (hasQuotas) {
      quotaCount.textContent = String(current.quantity);
      quotaInfo.textContent = `${current.quantity === 1 ? "cota" : "cotas"} de ${formatMoney(current.unitCents, true)} · o presente completo são ${current.maxQuantity} cotas`;
      quotaLess.disabled = current.quantity <= 1;
      quotaMore.disabled = current.quantity >= current.maxQuantity;
    }

    let dataUrl = "";
    try {
      dataUrl = renderQrCanvas(payload).toDataURL("image/png");
    } catch (error) {
      console.error(`[Pix] Não foi possível gerar o QR Code: ${error.message}`);
    }
    // Sem QR Code o Copia e Cola continua funcionando; só o bloco do QR some.
    document.querySelector(".dialog-qr").hidden = !dataUrl;
    if (dataUrl) {
      qrImage.src = dataUrl;
      qrImage.alt = `QR Code Pix de ${amount} para Arthur & Marina`;
      qrImage.dataset.ready = "true";
      saveQrLink.href = dataUrl;
    } else {
      qrImage.removeAttribute("src");
      delete qrImage.dataset.ready;
    }
    saveQrLink.download = `pix-arthur-e-marina-${(cents / 100).toFixed(2).replace(".", "-").replace(/-00$/, "")}.png`;

    if (hasWhatsapp) {
      const what = hasQuotas
        ? `${current.quantity} ${current.quantity === 1 ? "cota" : "cotas"} de ${current.name}`
        : current.name;
      notifyLink.href = whatsappLink(`Oi, Arthur e Marina! Acabei de enviar um presente pelo Pix: ${what} (${amount}). Com carinho,`);
      notifyLink.hidden = false;
    } else {
      notifyLink.hidden = true;
    }
    return true;
  }

  function changeQuantity(step) {
    if (!current) return;
    const quantity = Math.min(current.maxQuantity, Math.max(1, current.quantity + step));
    if (quantity === current.quantity) return;
    current.quantity = quantity;
    updatePix();
    copyFeedback.textContent = "";
    fitPayloadField();
  }

  function fitPayloadField() {
    payloadField.style.height = "auto";
    payloadField.style.height = `${payloadField.scrollHeight + 2}px`;
  }
  window.addEventListener("resize", () => { if (dialog.open) fitPayloadField(); });

  function closePix() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function setupDialog() {
    byTestId("pix-fechar").addEventListener("click", closePix);
    quotaLess.addEventListener("click", () => changeQuantity(-1));
    quotaMore.addEventListener("click", () => changeQuantity(1));

    // Clique no fundo escurecido (fora da caixa) fecha o modal, desde que o
    // botão também tenha sido pressionado no fundo (arrastar uma seleção de
    // dentro da caixa para fora não pode fechar).
    const isOutside = (event) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    let pressedOnBackdrop = false;
    dialog.addEventListener("pointerdown", (event) => {
      pressedOnBackdrop = event.target === dialog && isOutside(event);
    });
    dialog.addEventListener("click", (event) => {
      const startedOnBackdrop = pressedOnBackdrop;
      pressedOnBackdrop = false;
      if (event.target !== dialog || !startedOnBackdrop) return;
      if (isOutside(event)) closePix();
    });

    dialog.addEventListener("close", () => { copyFeedback.textContent = ""; });

    copyPayloadButton.addEventListener("click", async () => {
      const copied = await copyText(currentPayload, payloadField);
      copyFeedback.textContent = copied
        ? "Código copiado! Agora é só colar em Pix Copia e Cola no app do seu banco."
        : "Não foi possível copiar automaticamente. O código está selecionado abaixo: toque e segure para copiar.";
    });

    byTestId("pix-copiar-chave-modal").addEventListener("click", async () => {
      const copied = await copyText(pix ? pix.key : "");
      copyFeedback.textContent = copied
        ? "Chave Pix copiada! No app do banco, escolha Pix com chave e digite o valor."
        : `Não foi possível copiar automaticamente. A chave é: ${pix ? pix.key : ""}`;
    });
  }

  // ---------- Confirmação de presença (Google Forms) ----------
  function setupRsvp() {
    const url = String(CONFIG.formularioPresenca || "").trim();
    if (!/^https:\/\/(forms\.gle\/|docs\.google\.com\/forms\/)/.test(url)) return;
    const button = byTestId("rsvp-botao");
    button.href = url;
    button.hidden = false;
    byTestId("rsvp-texto").textContent = "Se preferir, fale diretamente com a gente, o Arthur ou a Marina.";
  }

  // ---------- Menu: destaca a seção visível ----------
  function setupNav() {
    const links = [...document.querySelectorAll(".site-nav__links a")];
    const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
    if (!("IntersectionObserver" in window) || !sections.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links) {
          if (link.getAttribute("href") === `#${entry.target.id}`) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        }
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((section) => observer.observe(section));
  }

  renderGifts();
  setupCustomGift();
  setupReceiver();
  setupDialog();
  setupRsvp();
  setupNav();
})();
