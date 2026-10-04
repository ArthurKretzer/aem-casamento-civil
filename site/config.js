// =====================================================================
// CONFIGURAÇÃO DO SITE
// =====================================================================
// Dados gerais do casamento. Depois de editar, faça o commit na branch
// "main": o site é testado e publicado sozinho em poucos minutos.
// Veja o README para o passo a passo e as recomendações de segurança.

window.SITE_CONFIG = {
  pix: {
    // Chave Pix que recebe os presentes.
    // Vazia ("") = o site mostra "Pix em breve" e esconde QR Code e chave.
    // Recomendado: chave ALEATÓRIA (não exponha CPF, telefone ou e-mail).
    chave: "",

    // Nome do titular da chave EXATAMENTE como o app do banco mostra na
    // hora de pagar. Os convidados conferem esse nome antes de confirmar.
    recebedor: "",

    // Nome e cidade gravados dentro do QR Code (sem acentos;
    // até 25 e 15 caracteres, respectivamente).
    nomeQr: "ARTHUR E MARINA",
    cidadeQr: "SAO JOSE",
  },

  // WhatsApp para confirmação de presença e recados: DDI + DDD + número,
  // só dígitos. Exemplo: "5548999998888". Vazio = botões ocultos.
  whatsapp: "",

  // Data limite para confirmar presença (AAAA-MM-DD).
  rsvpPrazo: "2026-10-15",

  // Endereço público do site, terminando em "/".
  siteUrl: "https://arthurkretzer.github.io/presentes-casamento/",
};
