# Arthur & Marina — site de casamento

Site estático pronto para publicar na Vercel.

## 1. Configurar o Pix

Abra `script.js` e altere:

```js
const CONFIG = {
  pixKey: "SUA-CHAVE-PIX-AQUI",
  merchantName: "ARTHUR E MARINA",
  merchantCity: "SAO JOSE",
  whatsapp: "55SEUNUMEROAQUI"
};
```

A chave pode ser e-mail, telefone, CPF/CNPJ ou chave aleatória.

O site gera um Pix BR Code com o valor preenchido para cada opção de presente.

## 2. Publicar na Vercel

1. Crie um repositório no GitHub.
2. Envie `index.html`, `styles.css` e `script.js`.
3. Entre na Vercel.
4. Add New → Project.
5. Selecione o repositório.
6. Deploy.

Não é necessário build command nem banco de dados.

## 3. Personalização

Os principais textos e valores estão em `index.html`.

Para trocar a aparência, use `styles.css`.

O site usa fontes do Google Fonts e QRCode.js via CDN.
