// =============================
// CONFIGURAÇÃO DO CASAMENTO
// =============================
// Troque somente estes dados antes de publicar.
const CONFIG = {
  pixKey: "SUA-CHAVE-PIX-AQUI",
  merchantName: "ARTHUR E MARINA",
  merchantCity: "SAO JOSE",
  whatsapp: "55SEUNUMEROAQUI"
};

// Atualiza os elementos configuráveis
document.getElementById("pixKeyDisplay").textContent = CONFIG.pixKey;
document.querySelector(".rsvp-button").href = `https://wa.me/${CONFIG.whatsapp}`;

// ---------- Pix BR Code ----------
function normalizeText(value, maxLength) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, "")
    .slice(0, maxLength);
}

function tlv(id, value) {
  const size = String(value.length).padStart(2, "0");
  return `${id}${size}${value}`;
}

function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildPixPayload(amount) {
  const merchantName = normalizeText(CONFIG.merchantName, 25);
  const merchantCity = normalizeText(CONFIG.merchantCity, 15);
  const key = CONFIG.pixKey.trim();

  const merchantAccount =
    tlv("00", "BR.GOV.BCB.PIX") +
    tlv("01", key);

  const additionalData = tlv("05", "***");

  let payload =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", Number(amount).toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", merchantName) +
    tlv("60", merchantCity) +
    tlv("62", additionalData) +
    "6304";

  return payload + crc16(payload);
}

const dialog = document.getElementById("pixDialog");
const closeDialog = document.getElementById("closeDialog");
const qrContainer = document.getElementById("qrcode");
const dialogTitle = document.getElementById("dialogTitle");
const dialogGiftName = document.getElementById("dialogGiftName");
const copyPayloadButton = document.getElementById("copyPayload");
const copyFeedback = document.getElementById("copyFeedback");

let currentPayload = "";

function openPix(amount, giftName = "Seu presente") {
  if (CONFIG.pixKey === "SUA-CHAVE-PIX-AQUI") {
    alert("Antes de publicar, coloque a chave Pix no arquivo script.js.");
    return;
  }

  currentPayload = buildPixPayload(amount);
  dialogTitle.textContent = Number(amount).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
  dialogGiftName.textContent = giftName;
  qrContainer.innerHTML = "";

  new QRCode(qrContainer, {
    text: currentPayload,
    width: 206,
    height: 206,
    colorDark: "#6f4f2f",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  copyFeedback.textContent = "";
  dialog.showModal();
}

document.querySelectorAll(".gift").forEach((button) => {
  button.addEventListener("click", () => {
    openPix(button.dataset.amount, button.querySelector(".gift__name").textContent);
  });
});

document.getElementById("customButton").addEventListener("click", () => {
  const amount = Number(document.getElementById("customAmount").value);
  if (!amount || amount <= 0) {
    document.getElementById("customAmount").focus();
    return;
  }
  openPix(amount, "Contribuição livre");
});

closeDialog.addEventListener("click", () => dialog.close());

dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) dialog.close();
});

copyPayloadButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentPayload);
    copyFeedback.textContent = "Pix Copia e Cola copiado.";
  } catch {
    copyFeedback.textContent = "Não foi possível copiar automaticamente.";
  }
});

document.getElementById("copyPix").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(CONFIG.pixKey);
    document.getElementById("copyPix").textContent = "copiado!";
    setTimeout(() => {
      document.getElementById("copyPix").textContent = "copiar chave";
    }, 1800);
  } catch {
    alert(`Chave Pix: ${CONFIG.pixKey}`);
  }
});
