# Místopis

Osobní AI průvodce, který podle zvoleného bodu představí historii,
příběhy a zajímavosti místa. Výklad lze zdarma poslouchat pomocí systémového
hlasu telefonu nebo počítače.

## Co aplikace umí

- získat přesnou polohu z prohlížeče nebo vyhledat místo ručně,
- přihlásit uživatele šestimístným kódem poslaným na e-mail a zapamatovat
  zařízení po dobu 180 dní,
- zobrazit okolí na mapě OpenStreetMap,
- vytvořit česky psaný, zdrojovaný výklad pomocí DeepSeek API,
- doporučit doložitelná místa v pěší vzdálenosti,
- ukázat směr k doporučeným místům šipkami, které se otáčejí podle kompasu
  telefonu,
- odpovědět na doplňující otázku k místu,
- přečíst výklad zdarma systémovým hlasem telefonu nebo počítače,
- kdykoli vyhledat další konkrétní místo i po zobrazení výsledku,
- vybrat přesný bod posunem interaktivní mapy pod pevnou značkou,
- uložit výklad na jeden rok a při návratu na stejné místo jej znovu použít,
- pro ručně vybraný bod, výsledek hledání nebo cíl v okolí použít pouze
  výklad se stejným přesným cache klíčem, nikoli jiný blízký bod,
- měřit využití a chyby ve Firestore a asynchronně je kopírovat do soukromé
  Google tabulky; načtení průvodce se eviduje pod přihlášeným e-mailem,
- nabídnout účtu správce chráněný přehled uživatelů, posledních přihlášení a
  počtu dohledaných pozic.

## Lokální spuštění

Požadavky: Node.js 22+, DeepSeek API klíč, Cloud Firestore a nakonfigurovaný
Apps Script endpoint pro e-mailové OTP a kopii analytiky. Bez Firebase
proměnných aplikace dočasně používá původní Apps Script úložiště.

```bash
npm install
cp .env.example .env.local
```

Do `.env.local` vložte svůj klíč:

```dotenv
DEEPSEEK_API_KEY=sk-...
GOOGLE_LOG_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
GOOGLE_LOG_TOKEN=...
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
AUTH_SECRET=...
```

Potom spusťte:

```bash
npm run dev
```

Aplikace poběží na [http://localhost:3000](http://localhost:3000).

> Geolokace v produkci vyžaduje HTTPS. Na `localhost` funguje i bez něj.
> iPhone vyžaduje pro kompas jednorázové potvrzení tlačítkem v sekci
> „Objevte v okolí“.

## Bezpečnost a soukromí

- API klíč zůstává pouze v serverovém prostředí a neposílá se do prohlížeče.
- `.env*` soubory se skutečnými hodnotami jsou ignorované Gitem.
- Souřadnice se používají pro reverzní geokódování a vytvoření výkladu.
- Orientace telefonu se zpracovává pouze lokálně v prohlížeči a nikam se
  neodesílá.
- Do analytiky se GPS ukládá pouze po zaokrouhlení na dvě desetinná místa.
- Cache míst používá souřadnice zaokrouhlené na čtyři desetinná místa
  (přibližně 11 metrů), aby poznala návrat na stejné místo.
- Cache obsahuje vygenerovaný výklad. Po jednom roce se záznam přestane používat
  a aplikace vytvoří nový výklad.
- Text doplňujících otázek se neukládá, pouze jejich délka.
- E-mail se ukládá kvůli přihlášení a u událostí načtení průvodce pro interní
  provozní přehled. Jednorázové kódy a dlouhodobé tokeny zařízení jsou v
  úložišti pouze jako HMAC otisky.
- Šestimístný kód platí 10 minut a dovolí nejvýše 5 pokusů. Odeslání je
  omezené proti zneužití a token konkrétního zařízení platí 180 dní.
- Provozní identifikátor relace neobsahuje IP adresu; událost načtení průvodce
  obsahuje samostatně e-mail přihlášeného uživatele.
- Hlas vytváří bezplatné systémové Web Speech API přímo v zařízení.

## Architektura připravená na rozvoj

- `index.html` — přímý vstup veřejné statické aplikace na GitHub Pages,
- `client/index.tsx` — připojení React aplikace k elementu v `index.html`,
- `app/api/*` — endpointy pro lokální vývoj v Next.js,
- `server/index.ts` — produkční Cloudflare Worker se stejnými API cestami,
- `lib/deepseek.ts` — DeepSeek klient, validace JSON výstupu a dohledání
  zdrojových podkladů z české Wikipedie,
- `lib/firestore-rest.ts` a `lib/firestore-storage.ts` — serverový přístup do
  Firestore, autentizace, geohash cache a provozní data,
- `scripts/build-server.mjs` — vytvoření jednoho serverového balíčku pro hosting,
- `scripts/firestore-migration.ts` — idempotentní přenos existujících listů,
- `google-apps-script` — e-mailová brána a asynchronní kopie analytiky v Google
  Sheets; historická MP3 z předchozí verze zůstávají soukromá,
- `components` — oddělené uživatelské rozhraní, mapa a hledání,
- `lib/types.ts` — sdílený kontrakt dat průvodce.

Model DeepSeek lze měnit pomocí proměnné prostředí bez zásahu do kódu. Další
vhodné kroky jsou uživatelské trasy, více jazyků, redakčně spravované zdroje,
ukládání oblíbených míst a Realtime API pro živý rozhovor.

## Použité služby

- [DeepSeek API](https://api-docs.deepseek.com/)
- [Cloud Firestore](https://firebase.google.com/docs/firestore)
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

Produkční backend používá Firestore jako primární úložiště autentizace, cache a
provozních dat. Apps Script pouze odesílá OTP e-maily a na pozadí kopíruje
provozní analytiku do původní Google tabulky. List `Místa a MP3` zůstává
jako historie a migrační záloha. Nové uživatelské rozhraní MP3 nenabízí ani
negeneruje. Firestore servisní účet, `AUTH_SECRET` i Apps Script token jsou
pouze v serverových secrets. Podrobný postup je v
[`FIRESTORE_MIGRATION.md`](FIRESTORE_MIGRATION.md).
