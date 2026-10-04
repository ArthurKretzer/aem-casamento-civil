// =====================================================================
// LISTA DE PRESENTES
// =====================================================================
// Um bloco { ... } por presente; a ordem aqui é a ordem no site.
//
//   id         identificador único: letras minúsculas, números e "-"
//   nome       nome que aparece no card
//   valor      valor em reais, ex.: 150 ou 150.5 (use ponto, não vírgula)
//   imagem     (opcional) foto em assets/img/presentes/, de preferência
//              JPEG 960×720 com até ~150 KB (veja o README)
//   imagemAlt  (opcional) descrição curta da foto, para leitores de tela
//   descricao  (opcional) uma frase curta abaixo do nome
//   esgotado   (opcional) true para mostrar "já presenteado"
//
// O card de "outro valor" (valor livre) já existe e não precisa estar aqui.

window.PRESENTES = [
  {
    id: "pequeno-gesto",
    nome: "Um pequeno gesto",
    valor: 100,
    imagem: "assets/img/presentes/pequeno-gesto.jpg",
    imagemAlt: "",
  },
  {
    id: "jantar-especial",
    nome: "Um jantar especial",
    valor: 150,
    imagem: "assets/img/presentes/jantar-especial.jpg",
    imagemAlt: "",
  },
  {
    id: "experiencia-a-dois",
    nome: "Uma experiência a dois",
    valor: 200,
    imagem: "assets/img/presentes/experiencia-a-dois.jpg",
    imagemAlt: "",
  },
  {
    id: "nova-casa",
    nome: "Nossa nova casa",
    valor: 300,
    imagem: "assets/img/presentes/nova-casa.jpg",
    imagemAlt: "",
  },
];
