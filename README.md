# Místopis

Beta verze osobního AI průvodce, který podle aktuální polohy představí historii, příběhy a zajímavosti místa. Výklad lze poslouchat česky pomocí OpenAI Text-to-Speech.

## Co beta umí

- získat přesnou polohu z prohlížeče nebo vyhledat místo ručně,
- zobrazit okolí na mapě OpenStreetMap,
- vytvořit česky psaný, zdrojovaný výklad pomocí Responses API,
- doporučit doložitelná místa v pěší vzdálenosti,
- odpovědět na doplňující otázku k místu,
- přečíst výklad zdarma systémovým hlasem telefonu nebo počítače,
- vytvořit či načíst výklad jako MP3 s přirozeným AI hlasem,
- uložit výklad a MP3 na jeden rok a při návratu na stejné místo je znovu použít,
- anonymně měřit využití a chyby v soukromé Google tabulce.

## Lokální spuštění

Požadavky: Node.js 22+ a OpenAI API klíč.

```bash
npm install
cp .env.example .env.local
```

Do `.env.local` vložte svůj klíč:

```dotenv
OPENAI_API_KEY=sk-proj-...
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
- Cache obsahuje vygenerovaný výklad a soukromý odkaz na MP3. Po jednom roce
  se záznam přestane používat a aplikace vytvoří nový výklad i zvuk.
- Text doplňujících otázek se neukládá, pouze jejich délka.
- Náhodný identifikátor relace neobsahuje e-mail, IP adresu ani identitu uživatele.
- Hlas je syntetický, vytvořený AI; aplikace to u přehrávače výslovně uvádí.

## Architektura připravená na rozvoj

- `app/api/*` — endpointy pro lokální vývoj v Next.js,
- `server/index.ts` — produkční Cloudflare Worker se stejnými API cestami,
- `scripts/build-server.mjs` — vytvoření jednoho serverového balíčku pro hosting,
- `google-apps-script` — verzovaný endpoint pro analytiku, cache v Google
  Sheets a soukromá MP3 na Google Disku,
- `components` — oddělené uživatelské rozhraní, mapa a hledání,
- `lib/types.ts` — sdílený kontrakt dat průvodce.

Modely a hlas lze měnit pomocí proměnných prostředí bez zásahu do kódu. Další
vhodné kroky jsou uživatelské trasy, více jazyků, redakčně spravované zdroje,
ukládání oblíbených míst a Realtime API pro živý rozhovor.

## Použité služby

- [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text)
- [OpenAI Text-to-Speech](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenStreetMap](https://www.openstreetmap.org/) a [Nominatim](https://nominatim.org/)

Data OpenStreetMap jsou dostupná pod licencí ODbL.

## Nasazení

Veřejné rozhraní se automaticky publikuje přes GitHub Actions na:

`https://blovak.github.io/AI_pruvodce/`

GitHub Pages je čistě statický hosting. OpenAI klíč proto zůstává v oddělené
serverové aplikaci a veřejný frontend volá pouze její API. Proměnná
`NEXT_PUBLIC_API_BASE_URL` obsahuje veřejnou adresu backendu, nikdy API klíč.

Produkční backend používá zabezpečený Apps Script endpoint pro anonymizovanou
analytiku i cache. List `Místa a MP3` uchovává souřadnice, odpověď AI, platnost
a odkaz na soukromé MP3 v adresáři `Místopis – uložené MP3`. Sdílený token je
uložen pouze v Script Properties a v serverových secrets. Pokud Google úložiště
selže, průvodce se pokusí požadavek dokončit přímo přes OpenAI.
