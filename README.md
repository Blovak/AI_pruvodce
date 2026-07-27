# Místopis

Beta verze osobního AI průvodce, který podle aktuální polohy představí historii, příběhy a zajímavosti místa. Výklad lze poslouchat česky pomocí OpenAI Text-to-Speech.

## Co beta umí

- získat přesnou polohu z prohlížeče nebo vyhledat místo ručně,
- zobrazit okolí na mapě OpenStreetMap,
- vytvořit česky psaný, zdrojovaný výklad pomocí Responses API,
- doporučit doložitelná místa v pěší vzdálenosti,
- odpovědět na doplňující otázku k místu,
- převést celý výklad na přirozený AI hlas.
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
- Text doplňujících otázek se neukládá, pouze jejich délka.
- Náhodný identifikátor relace neobsahuje e-mail, IP adresu ani identitu uživatele.
- Hlas je syntetický, vytvořený AI; aplikace to u přehrávače výslovně uvádí.

## Architektura připravená na rozvoj

- `app/api/*` — endpointy pro lokální vývoj v Next.js,
- `server/index.ts` — produkční Cloudflare Worker se stejnými API cestami,
- `scripts/build-server.mjs` — vytvoření jednoho serverového balíčku pro hosting,
- `google-apps-script` — verzovaný zdroj logovacího endpointu pro Google Sheets,
- `components` — oddělené uživatelské rozhraní, mapa a hledání,
- `lib/types.ts` — sdílený kontrakt dat průvodce.

Modely a hlas lze měnit pomocí proměnných prostředí bez zásahu do kódu. Další vhodné kroky jsou cache výkladů podle geohashe, uživatelské trasy, více jazyků, redakčně spravované zdroje, ukládání oblíbených míst a Realtime API pro živý rozhovor.

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

Produkční backend předává anonymizované provozní události zabezpečenému Apps
Script endpointu. Sdílený logovací token je uložen pouze v Script Properties a
v serverových secrets. Pokud logování selže, hlavní funkce průvodce pokračují
bez přerušení.
