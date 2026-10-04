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
    chave: "2bb06d88-5678-4aef-a0c1-557e7985b3f5",

    // Nome do titular da chave EXATAMENTE como o app do banco mostra na
    // hora de pagar. Os convidados conferem esse nome antes de confirmar.
    recebedor: "Arthur Raulino Kretzer",

    // Nome e cidade gravados dentro do QR Code (sem acentos;
    // até 25 e 15 caracteres, respectivamente).
    nomeQr: "ARTHUR E MARINA",
    cidadeQr: "SAO JOSE",
  },

  // WhatsApp para o botão "avisar os noivos" depois do Pix: DDI + DDD +
  // número, só dígitos. Exemplo: "5548999998888". Vazio = botão oculto.
  whatsapp: "5548999263500",

  // Link do Google Forms de confirmação de presença (https://forms.gle/...).
  // Vazio = o botão "confirmar presença" some e o site pede para falar com vocês.
  formularioPresenca: "https://forms.gle/MrdA3pDX5QVpg98x8",

  // Endereço público do site, terminando em "/".
  siteUrl: "https://arthurkretzer.github.io/aem-casamento-civil/",
};
