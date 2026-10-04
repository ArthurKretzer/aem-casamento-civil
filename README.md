# Arthur & Marina — site do casamento

Site do casamento civil de Arthur & Marina: **segunda-feira, 16 de novembro de 2026, às 19h**, no Edifício Vila Salomy (Estreito, Florianópolis).

**No ar em: <https://arthurkretzer.github.io/presentes-casamento/>**

O que tem nele: a data e o local (com links para Google Maps, Waze e agenda), a lista de presentes com **Pix direto para vocês** (QR Code e Pix Copia e Cola já com o valor preenchido, sem plataforma no meio), um campo de valor livre e a confirmação de presença pelo WhatsApp.

O site é estático (só HTML, CSS e JavaScript), não usa banco de dados nem serviços externos e **não aparece no Google** (`noindex`): só chega nele quem recebe o link.

---

## Como editar

Quase tudo o que muda fica em dois arquivos dentro da pasta `site/`:

- `site/config.js`: Pix, WhatsApp e prazo de confirmação;
- `site/presentes.js`: a lista de presentes.

Os textos fixos (data, local, frases) ficam em `site/index.html` e o visual em `site/assets/css/styles.css`.

Dá para editar os arquivos direto no GitHub, pelo navegador, sem instalar nada:

1. Abra o repositório no GitHub, entre em `site/` e clique no arquivo (`config.js` ou `presentes.js`).
2. Clique no lápis (**Edit this file**), no canto direito acima do texto.
3. Faça a alteração. Mantenha as aspas, as vírgulas no fim das linhas e as chaves `{ }` como estão.
4. Clique em **Commit changes...**, deixe marcado **Commit directly to the `main` branch** e confirme.
5. Pronto. O GitHub testa e publica sozinho em poucos minutos (veja [Publicação](#publicação)).

Se alguma coisa estiver errada (uma vírgula esquecida, uma chave Pix inválida, uma foto que não existe), os testes mostram o motivo (o passo "Validar os dados do site" explica em português o que corrigir) e, como a falha acontece **antes da publicação**, o site novo não é publicado: o que já está no ar continua como estava.

### config.js

| Campo | O que colocar |
| --- | --- |
| `pix.chave` | A chave Pix que recebe os presentes. **Vazia (`""`) = o site mostra "Pix em breve"** (veja abaixo). Use uma chave aleatória (veja [Pix: recomendações de segurança](#pix-recomendações-de-segurança)). |
| `pix.recebedor` | O nome do titular **exatamente como o app do banco mostra** na hora de pagar. Os convidados conferem esse nome antes de confirmar. |
| `pix.nomeQr` | Nome gravado dentro do QR Code: sem acentos, até 25 letras (ex.: `"ARTHUR E MARINA"`). |
| `pix.cidadeQr` | Cidade gravada no QR Code: sem acentos, até 15 letras (ex.: `"SAO JOSE"`). |
| `whatsapp` | DDI + DDD + número, só dígitos (ex.: `"5548999998888"`). **Vazio = os botões de WhatsApp somem** e aparece um texto pedindo para confirmar direto com vocês. |
| `rsvpPrazo` | Data limite para confirmar presença, no formato `AAAA-MM-DD` (ex.: `"2026-10-15"`). O site mostra "até 15 de outubro". |
| `siteUrl` | Endereço público do site, terminando em `/`. |

### O modo "Pix em breve"

Enquanto `pix.chave` estiver vazia, o site funciona normalmente, mas os botões de presente ficam desabilitados ("disponível em breve"), o valor livre fica travado e **nenhum QR Code ou chave aparece**. É assim que o site vai ao ar primeiro, antes de a chave existir.

Para ligar o Pix, preencha `chave` **e** `recebedor`. O site só ativa o Pix quando a chave é válida, o recebedor está preenchido e um código de teste passa na validação; se a chave estiver preenchida mas errada, ele continua em "Pix em breve" e o teste do GitHub acusa o erro (então nada errado vai ao ar).

### Adicionar, trocar ou tirar um presente

Em `site/presentes.js` cada presente é um bloco `{ ... }`, e a ordem do arquivo é a ordem no site. Para adicionar, copie um bloco inteiro (com a vírgula no final) e ajuste:

```js
  {
    id: "lua-de-mel",                                  // único: minúsculas, números e "-"
    nome: "Nossa lua de mel",                          // o que aparece no card
    valor: 250,                                        // em reais, com ponto: 150 ou 150.5
    imagem: "assets/img/presentes/lua-de-mel.jpg",     // opcional
    imagemAlt: "Praia ao entardecer",                  // opcional: descrição da foto
    descricao: "Uma noite só para nós dois.",          // opcional: frase curta
  },
```

- **Presente caro em cotas**: acrescente `cota: 300,` (o valor de cada cota). O card mostra "R$ 300 a cota" e "presente completo: R$ 3.000", e no modal o convidado escolhe quantas cotas quer dar (de 1 até o presente completo); o Pix e o QR Code acompanham. As cotas **não são contadas nem esgotam**: é só uma forma de dar parte de um presente. Exemplo: `{ id: "lua-de-mel", nome: "Nossa lua de mel", valor: 3000, cota: 300, imagem: "..." }`.
- **Esgotado**: acrescente `esgotado: true,` e o card passa a mostrar "já presenteado".
- **Tirar um presente**: apague o bloco inteiro.
- O card de "outro valor" (valor livre) já existe e não entra nessa lista.
- Valores aceitos: de R$ 1,00 a R$ 100.000,00.

### Fotos dos presentes

- Formato: **JPEG, 960×720 (proporção 4:3), até uns 150 KB**. Fotos maiores deixam a página pesada no celular.
- Pasta: `site/assets/img/presentes/`. No GitHub: entre na pasta, **Add file → Upload files**, arraste a foto e faça o commit.
- Nome do arquivo em minúsculas, sem acento e sem espaço (`lua-de-mel.jpg`), igual ao que está em `imagem:`. O site publicado diferencia maiúsculas de minúsculas, então `Lua-de-Mel.JPG` não é a mesma coisa que `lua-de-mel.jpg`.
- Bancos de imagens gratuitos: [Unsplash](https://unsplash.com), [Pexels](https://www.pexels.com) e [Wikimedia Commons](https://commons.wikimedia.org). Confira a licença de cada foto e **anote o crédito** na seção [Fotos](#fotos) lá embaixo.
- Para redimensionar e comprimir sem programa nenhum: [squoosh.app](https://squoosh.app) (escolha JPEG, largura 960 e qualidade perto de 75).
- Presente sem foto não tem problema: o card mostra um ornamento dourado no lugar.

---

## Pix: recomendações de segurança

O dinheiro dos presentes cai direto na conta de vocês, então vale cuidar bem do caminho até ela.

1. **Use uma chave ALEATÓRIA.** É um código (algo como `123e4567-e12b-12d1-a456-426655440000`) que o banco gera para vocês: app do banco → Pix → cadastrar chave → chave aleatória. Por quê: o `config.js` fica num repositório público e a chave aparece no site; com a aleatória, ninguém descobre o CPF, o telefone ou o e-mail de vocês, e dá para apagá-la depois do casamento sem mexer nas chaves do dia a dia.
2. **`recebedor` = o nome exato que o banco mostra.** Faça um Pix de teste de outra conta para a chave e copie o nome como aparece na tela de confirmação. É esse nome que o convidado vê no app dele e compara com o que está no site.
3. **Nunca aceitem uma chave que chegue por link ou mensagem.** O site lê a chave só do `config.js` e ignora qualquer coisa que venha no endereço (como `?chave=...`), justamente para ninguém conseguir montar um link que faça os convidados pagarem para outra pessoa. Desconfiem de qualquer pedido para "trocar a chave" por mensagem e só mudem a chave pelo próprio GitHub.
4. **Ative a verificação em duas etapas (2FA) no GitHub** (Settings → Password and authentication). Quem entrar na conta de vocês consegue trocar a chave que o site mostra. Guardem os códigos de recuperação e deixem só vocês dois com acesso de escrita ao repositório (Settings → Collaborators).
5. **Opcional: uma conta separada só para os presentes.** Uma conta (ou subconta) nova, com a chave aleatória dela, facilita ver o que entrou e limita o estrago se algo der errado.

### Checklist antes de divulgar o link

- [ ] Chave aleatória criada; `pix.chave` e `pix.recebedor` preenchidos no `config.js`; commit feito e a aba **Actions** com o ícone verde.
- [ ] Com o site publicado aberto **no computador**, um **Pix real de R$ 1 lendo o QR Code** com o app do banco no celular (use "outro valor" e digite `1`).
- [ ] Com o site aberto **no celular**, outro **Pix real de R$ 1 pelo Pix Copia e Cola**: toque em "copiar código Pix" e cole no app do banco.
- [ ] Os dois testes (QR Code e Copia e Cola) em **2 bancos diferentes**, por exemplo um banco tradicional e uma conta digital.
- [ ] Em cada teste: o nome do recebedor na tela do banco é o esperado, o valor é o certo e o dinheiro apareceu no extrato.
- [ ] Ao abrir um presente, o recebedor mostrado no modal ("O recebedor deve aparecer como...") é o de vocês.
- [ ] `whatsapp` preenchido no `config.js` e o botão **confirmar presença** abre a conversa certa (lembrem que o número fica público no site e no repositório).
- [ ] `rsvpPrazo` com a data certa (hoje: 15 de outubro). Depois do prazo o site continua mostrando a data; se quiserem, esvaziem `whatsapp` para esconder o botão.

### Depois do casamento

- **Apaguem a chave aleatória no app do banco** (ou troquem por outra). O QR Code e o Copia e Cola antigos deixam de funcionar, mesmo que alguém tenha guardado o link ou uma captura de tela.
- No site: esvaziem `pix.chave` (volta para "Pix em breve") ou removam a seção de presentes do `site/index.html`.

---

## Publicação

O site é publicado no **GitHub Pages**, pelo **GitHub Actions**. Cada alteração enviada para a branch `main` dispara o fluxo **Site** (arquivo `.github/workflows/pages.yml`), que testa e publica.

### Primeira configuração (uma vez só)

1. O repositório precisa ser **público** (é o que o GitHub Pages gratuito exige).
2. Vá em **Settings → Pages → Build and deployment → Source** e escolha **GitHub Actions**.
3. Envie um commit para a `main` (ou vá em **Actions → Site → Run workflow**). O endereço aparece no fim da execução. Se a primeira execução falhar no passo "Configurar o Pages", é porque o passo 2 ainda não foi feito: faça e use **Re-run jobs**.

### Como acompanhar

Aba **Actions** do repositório, fluxo **Site**, execução mais recente:

- ícone verde: testado e publicado (leva 1 a 2 minutos para aparecer no site);
- ícone vermelho: nada novo foi ao ar; o site continua como estava. Abra o job que falhou, leia a mensagem, corrija e faça outro commit.

Para conferir qual versão está no ar, abra `https://arthurkretzer.github.io/presentes-casamento/version.txt`: ele mostra o código do último commit publicado.

O GitHub também avisa por e-mail quando uma execução falha. Para desfazer uma alteração que já foi ao ar: abra o arquivo no GitHub, clique em **History**, abra a versão anterior (botão **View file** / `<>`), copie o conteúdo, cole no arquivo atual (lápis **Edit this file**) e faça o commit. Isso publica de novo a versão antiga.

### O que cada job faz

| Job | Quando roda | O que faz |
| --- | --- | --- |
| `testes` | Em **todas** as branches | Instala as dependências, valida `config.js` e `presentes.js` (`npm run validar`), roda os testes unitários do Pix (`npm run test:unit`) e os testes no navegador (`npx playwright test`, em versão desktop e celular). |
| `publicar` | Só na `main`, depois de `testes` passar | Grava a versão (o código do commit) em `site/version.txt` e publica a pasta `site/` no GitHub Pages. |

Se um dia o endereço mudar (por exemplo, um domínio próprio), atualizem a URL em todos estes lugares: `siteUrl` no `config.js`; `og:url`, `og:image` e o link do Google Agenda (parâmetro `details=`) no `site/index.html`; e `UID`, `DESCRIPTION` e `URL` no `site/casamento.ics`.

---

## Desenvolvimento local

Precisa do [Node.js](https://nodejs.org) 22 ou mais novo.

```sh
npm install                       # instala as dependências (uma vez)
npx playwright install chromium   # baixa o navegador dos testes (uma vez)

npm run servir                    # site em http://127.0.0.1:4173/presentes-casamento/
npm test                          # valida config/presentes + testes unitários
npx playwright test               # testes no navegador (sobe o servidor sozinho)
```

O servidor local serve a pasta `site/` sob `/presentes-casamento/`, igual ao GitHub Pages, por isso **todos os caminhos do site são relativos** (sem `/` no começo). Para usar outra porta: `npm run servir -- --port 4180`.

Outras formas de rodar os testes no navegador:

```sh
npx playwright test --project=mobile          # só a versão celular
npx playwright test -g "valor livre"          # só testes com esse nome
npx playwright test --ui                      # modo visual, bom para depurar

# testar o site já publicado (em vez do servidor local)
BASE_URL=https://arthurkretzer.github.io/presentes-casamento/ npx playwright test
```

No Windows (PowerShell), defina a variável antes: `$env:BASE_URL="https://..."; npx playwright test`.

Os testes de navegador (`tests/e2e/site.spec.mjs`) são poucos e rápidos, de propósito: conferem que o site carrega sem erros, os cards, o modo "em breve", o modal (Copia e Cola e QR Code com o mesmo código), o valor livre, o layout em 360px e que a chave só vem do `config.js`. Eles usam uma chave Pix de teste injetada na hora (a do exemplo do Banco Central), então rodam igual com a chave real vazia ou preenchida; quando a chave real está preenchida, um teste também confere o Pix de cada presente com ela.

### Estrutura de pastas

```text
site/                        tudo o que vai ao ar (só esta pasta é publicada)
  index.html                 a página
  config.js                  dados dos noivos: Pix, WhatsApp, prazo     <- vocês editam
  presentes.js               lista de presentes                         <- vocês editam
  casamento.ics              evento para agenda (Apple, Outlook)
  assets/
    css/styles.css           visual do convite
    js/pix.js                Pix: chave, valor, Copia e Cola, CRC
    js/app.js                comportamento da página (cards, modal, QR Code)
    vendor/qrcode.js         gerador de QR Code
    fonts/                   fontes (woff2) servidas pelo próprio site
    img/                     prévia do link, ícones e presentes/ (fotos)
scripts/
  servir.mjs                 servidor local (npm run servir)
  validar-dados.mjs          confere config.js e presentes.js (npm run validar)
  gerar-assets.mjs           gera a prévia do link e os ícones
tests/
  unit/                      testes do Pix e da validação (node --test)
  e2e/site.spec.mjs          testes de fumaça no navegador (Playwright)
.github/workflows/pages.yml  testa e publica
playwright.config.mjs        configuração dos testes de navegador
CLAUDE.md                    instruções para futuras sessões do Claude
```

---

## Créditos

- **Convite e identidade visual:** Marina (protótipo original do site).
- **Fontes:** Cormorant Garamond, Great Vibes e Montserrat, sob a licença [SIL Open Font License 1.1](https://openfontlicense.org), empacotadas pelo [Fontsource](https://fontsource.org) (texto da licença em `site/assets/fonts/LICENCAS-OFL.txt`).
- **QR Code:** [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), de Kazuhiko Arase, licença MIT (`site/assets/vendor/qrcode.js`).
- **Testes (só desenvolvimento):** Playwright, jsQR, pngjs e pix-utils.

### Fotos

<!-- CREDITOS-FOTOS -->
Fotos do [Unsplash](https://unsplash.com), sob a [Unsplash License](https://unsplash.com/license) (uso livre, crédito opcional), recortadas em 960×720 e comprimidas para o site.

| Presente | Arquivo | Foto original |
| --- | --- | --- |
| Um pequeno gesto | `site/assets/img/presentes/pequeno-gesto.jpg` | [Unsplash `photo-1563241527-3004b7be0ffd`](https://images.unsplash.com/photo-1563241527-3004b7be0ffd) |
| Um jantar especial | `site/assets/img/presentes/jantar-especial.jpg` | [Unsplash `photo-1511795409834-ef04bbd61622`](https://images.unsplash.com/photo-1511795409834-ef04bbd61622) |
| Uma experiência a dois | `site/assets/img/presentes/experiencia-a-dois.jpg` | [Unsplash `photo-1707296819777-f96b799efb41`](https://images.unsplash.com/photo-1707296819777-f96b799efb41) |
| Nossa nova casa | `site/assets/img/presentes/nova-casa.jpg` | [Unsplash `photo-1631679706909-1844bbd07221`](https://images.unsplash.com/photo-1631679706909-1844bbd07221) |
