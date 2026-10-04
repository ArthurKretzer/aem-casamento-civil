// =====================================================================
// LISTA DE PRESENTES
// =====================================================================
// Um bloco { ... } por presente; a ordem aqui é a ordem no site.
//
//   id         identificador único: letras minúsculas, números e "-"
//   nome       nome que aparece no card
//   valor      valor em reais, ex.: 150 ou 150.5 (use ponto, não vírgula)
//   cota       (opcional) valor de cada cota, para presentes caros: o card
//              mostra "R$ 300 a cota" e o convidado escolhe quantas cotas dar
//              (até o presente completo). Nada é contado nem esgota.
//   imagem     (opcional) foto em assets/img/presentes/, de preferência
//              JPEG 960×720 com até ~150 KB (veja o README)
//   imagemAlt  (opcional) descrição curta da foto, para leitores de tela
//   descricao  (opcional) uma frase curta abaixo do nome
//   esgotado   (opcional) true para mostrar "já presenteado"
//
// O card de "outro valor" (valor livre) já existe e não precisa estar aqui.

window.PRESENTES = [
  {
    id: "kingdom-hearts-4",
    nome: "Kingdom Hearts 4 para o noivo",
    valor: 400,
    cota: 100,
  },
  {
    id: "playstation-5",
    nome: "PlayStation 5 para o casal",
    valor: 3500,
    cota: 350,
  },
  {
    id: "noite-de-tango",
    nome: "Noite de tango na Argentina",
    valor: 500,
    cota: 100,
  },
  {
    id: "claude-pro",
    nome: "1 mês de Claude Pro",
    valor: 120,
  },
  {
    id: "mangas-inuyasha",
    nome: "Mangás de Inuyasha para a noiva",
    valor: 200,
    cota: 50,
  },
  {
    id: "empanadas-argentinas",
    nome: "Empanadas argentinas para o casal",
    valor: 50,
    imagem: "assets/img/presentes/empanadas-argentinas.jpg",
    imagemAlt: "Empanadas assadas sobre uma tábua de madeira com chimichurri e duas taças de vinho tinto numa mesa posta para dois",
  },
  {
    id: "noite-de-teatro",
    nome: "1 noite de teatro na Argentina",
    valor: 200,
    cota: 100,
    imagem: "assets/img/presentes/noite-de-teatro.jpg",
    imagemAlt: "Interior dourado de um teatro de ópera com camarotes, lustre aceso e cortina de veludo vermelho, visto de um camarote",
  },
  {
    id: "ingresso-abaporu",
    nome: "1 ingresso para ver o Abaporu na Argentina",
    valor: 100,
    imagem: "assets/img/presentes/ingresso-abaporu.jpg",
    imagemAlt: "Casal de mãos dadas, de costas, observando uma pintura modernista em uma galeria de museu clara",
  },
  {
    id: "parrillada",
    nome: "Parrillada na Argentina",
    valor: 300,
    cota: 75,
    imagem: "assets/img/presentes/parrillada.jpg",
    imagemAlt: "Parrilla argentina ao entardecer com carnes, linguiças e legumes nas brasas, ao lado de uma mesa com vinho Malbec",
  },
  {
    id: "aulas-de-espanhol",
    nome: "Aulas de espanhol para o casal",
    valor: 360,
    cota: 60,
    imagem: "assets/img/presentes/aulas-de-espanhol.jpg",
    imagemAlt: "Mesa de café antigo com cadernos de anotações, um dicionário de espanhol, dois cafés com leite e alfajores",
  },
];
