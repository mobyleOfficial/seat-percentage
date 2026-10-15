# Ingresso Seat Percentage

Extensão para **Chrome** e **Firefox** que mostra, acima de cada horário de sessão nas páginas de filme do [ingresso.com](https://www.ingresso.com), a **porcentagem de ocupação da sala**.

Fork do [Ingresso Cinema Map](https://github.com/mobyleOfficial/ingresso-cinema-map) contendo **somente** a feature de ocupação — sem mapa, geolocalização ou modo grupo.

## Como funciona

- Cada horário habilitado recebe um badge com a porcentagem de lugares ocupados e uma barra de progresso
- Cores: azul abaixo de 50%, âmbar de 50% a 79%, vermelho a partir de 80%
- Passe o mouse sobre o horário para ver o detalhe (ex.: _Sala 55% ocupada (11 de 20 lugares)_)
- Os mapas de assentos só são buscados para horários visíveis na tela (no máximo 3 requisições simultâneas, cache de 3 minutos)
- Assentos bloqueados por distanciamento (`PhysicalDistance`) não entram na capacidade
- Sessões sem marcação de assento ou com erro na API mostram `–` (_Ocupação da sala indisponível_)
- Troca de dia na página é detectada e os badges são refeitos

Os dados vêm da API pública de sessões do ingresso.com (`api.ingresso.com/v1/sessions`), chamada pela própria página, sem cookies (`credentials: 'omit'`). A extensão não coleta nem envia dados do usuário.

## Para desenvolvedores

1. **Chrome:** abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique em **Carregar sem compactação** — selecione a pasta do projeto.
2. **Firefox (140+):** abra `about:debugging#/runtime/this-firefox`, clique em **Carregar extensão temporária…** e selecione o `manifest.json`. Para instalação persistente, use o `.xpi` gerado por `npm run package`.

A extensão roda em qualquer página `https://www.ingresso.com/filme/*`.

### Estrutura

| Arquivo | Papel |
|---------|-------|
| `lib/seat-percentage.js` | Funções puras: extrai `sessionId`, soma os mapas de assentos, calcula % e nível |
| `inpage.js` | Content script (world `MAIN`): encontra os horários, busca os mapas e desenha os badges |
| `inpage.css` | Estilo dos badges |

### Testes

```bash
npm install
npx playwright install chromium firefox
npm test                 # unitários + Chrome + Firefox
npm run test:unit        # só funções puras (Node)
npm run test:chrome      # Chromium + Playwright
npm run test:firefox     # Firefox + geckodriver + servidor HTTP local
```

Os testes de integração usam o snapshot em `fixtures/ingresso/movie-page.html` e respostas sintéticas da API de sessões (ver `fixtures/ingresso/README.md`).

> **Nota:** use o Chromium do Playwright, não o Google Chrome — extensões MV3 não carregam corretamente com `channel: 'chrome'`.

## CI / lojas

- **Test** — roda em todo PR para `main` (Chrome e Firefox, com fixture local)
- **Release** — manual: cria tag, GitHub Release e, opcionalmente, publica na Chrome Web Store e no Firefox Add-ons
- **Chrome Web Store Publish** / **Firefox Add-ons Publish** — manuais, para republicar só em uma loja

Os workflows de publicação exigem os secrets `CHROME_*` e `FIREFOX_JWT_*` do **novo** item nas lojas (o ID da extensão é diferente do Ingresso Cinema Map).

## Feedback

- [Relatar um bug](../../issues/new?template=bug_report.yml)
- [Sugerir funcionalidade](../../issues/new?template=feature_request.yml)

## Licença

[MIT](LICENSE) — Edson Yudi Toma
