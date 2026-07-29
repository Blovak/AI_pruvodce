# Místopis

Beta verze osobního AI průvodce, který podle zvoleného bodu představí historii,
příběhy a zajímavosti místa. Výklad lze zdarma poslouchat pomocí systémového
hlasu telefonu nebo počítače.

## Co beta umí

- získat přesnou polohu z prohlížeče nebo vyhledat místo ručně,
- zobrazit okolí na mapě OpenStreetMap,
- vytvořit česky psaný, zdrojovaný výklad pomocí DeepSeek API,
- doporučit doložitelná místa v pěší vzdálenosti,
- odpovědět na doplňující otázku k místu,
- přečíst výklad zdarma systémovým hlasem telefonu nebo počítače,
- kdykoli vyhledat další konkrétní místo i po zobrazení výsledku,
- vybrat přesný bod posunem interaktivní mapy pod pevnou značkou,
- uložit výklad na jeden rok a při návratu na stejné místo jej znovu použít,
- anonymně měřit využití a chyby v soukromé Google tabulce.

## Lokální spuštění

Požadavky: Node.js 22+ a DeepSeek API klíč.

```bash
npm install
cp .env.example .env.local
```

Do `.env.local` vložte svůj klíč:

```dotenv
DEEPSEEK_API_KEY=sk-...
```

Potom spusťte:

```bash
npm run dev
```

Aplikace poběží na [http://localhost:3000](http://localhost:3000).

> Geolokace v produkci vyžaduje HTTPS. Na `localhost` funguje i bez něj.

## Bezpečnost a soukromí

- API klíč zůstává pouze v serverovém prostředí a neposílá se do prohlížeče.
- `.env*` soubory se skutečnými hodnotami jsou ignorované Gitem.
- Souřadnice se používají pro reverzní geokódování a vytvoření výkladu.
- Do analytiky se GPS ukládá pouze po zaokrouhlení na dvě desetinná místa.
- Cache míst používá souřadnice zaokrouhlené na čtyři desetinná místa
  (přibližně 11 metrů), aby poznala návrat na stejné místo.
- Cache obsahuje vygenerovaný výklad. Po jednom roce se záznam přestane používat
  a aplikace vytvoří nový výklad.
- Text doplňujících otázek se neukládá, pouze jejich délka.
- Náhodný identifikátor relace neobsahuje e-mail, IP adresu ani identitu uživatele.
- Hlas je syntetický, vytvořený AI; aplikace to u přehrávače výslovně uvádí.

## Architektura připravená na rozvoj

- `index.html` — přímý vstup veřejné statické aplikace na GitHub Pages,
- `client/index.tsx` — připojení React aplikace k elementu v `index.html`,
- `app/api/*` — endpointy pro lokální vývoj v Next.js,
- `server/index.ts` — produkční Cloudflare Worker se stejnými API cestami,
- `lib/deepseek.ts` — DeepSeek klient, validace JSON výstupu a dohledání
  zdrojových podkladů z české Wikipedie,
- `scripts/build-server.mjs` — vytvoření jednoho serverového balíčku pro hosting,
- `google-apps-script` — verzovaný endpoint pro analytiku a cache v Google
  Sheets; historická MP3 z předchozí verze zůstávají soukromá,
- `components` — oddělené uživatelské rozhraní, mapa a hledání,
- `lib/types.ts` — sdílený kontrakt dat průvodce.

Model DeepSeek lze měnit pomocí proměnné prostředí bez zásahu do kódu. Další
vhodné kroky jsou uživatelské trasy, více jazyků, redakčně spravované zdroje,
ukládání oblíbených míst a Realtime API pro živý rozhovor.

## Použité služby

- [DeepSeek API](https://api-docs.deepseek.com/)
- [MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page)
- [OpenStreetMap](https://www.openstreetmap.org/) a [Nominatim](https://nominatim.org/)

Data OpenStreetMap jsou dostupná pod licencí ODbL.

## Nasazení

Veřejné rozhraní se automaticky publikuje přes GitHub Actions na:

`https://blovak.github.io/AI_pruvodce/`

GitHub Pages je čistě statický hosting. DeepSeek klíč proto zůstává v oddělené
serverové aplikaci a veřejný frontend volá pouze její API. Proměnná
`NEXT_PUBLIC_API_BASE_URL` obsahuje veřejnou adresu backendu, nikdy API klíč.
Veřejná URL načítá přímo kořenový `index.html`; sestavení k němu vytvoří pouze
statické soubory `assets/app.js` a `assets/app.css`.

Produkční backend používá zabezpečený Apps Script endpoint pro anonymizovanou
analytiku i cache. List `Místa a MP3` uchovává souřadnice, odpověď AI a platnost;
sloupce se staršími MP3 zůstávají kvůli historii. Nové uživatelské rozhraní MP3
nenabízí ani negeneruje. Sdílený token je uložen pouze v Script Properties a v
serverových secrets. Pokud Google úložiště selže, průvodce se pokusí požadavek
dokončit přímo přes DeepSeek.
