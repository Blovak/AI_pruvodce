# Migrace Místopisu z Google Sheets do Firestore

## Cílová architektura

- Firestore je primární úložiště uživatelů, OTP, relací, výkladové cache,
  provozních událostí, chyb a zpětné vazby.
- Worker přistupuje přes servisní účet a OAuth 2.0. Firestore pravidla zakazují
  veškerý přímý klientský přístup.
- Apps Script zůstává autorizovanou e-mailovou bránou a asynchronní kopií
  provozní analytiky v Google Sheets.
- Staré listy se při migraci nemažou.

## 1. Firebase projekt

1. V konzoli Firebase vytvořte projekt nebo připojte existující Google Cloud
   projekt.
2. Založte první databázi Cloud Firestore v režimu Native. Pro české uživatele
   je vhodný region `europe-west3` (Frankfurt). Umístění později nelze změnit.
3. Nasaďte `firestore.rules` a `firestore.indexes.json` pomocí Firebase CLI,
   případně vložte pravidla ručně v konzoli.
4. Vytvořte samostatný servisní účet Workeru s rolí
   `Cloud Datastore User` a vytvořte jeho JSON klíč. Pro migraci jej uložte
   jako `.firebase-service-account.json` do kořene repozitáře. Tento název je
   explicitně ignorovaný Gitem.

Servisní účet je jediný principál aplikace s databázovým oprávněním. Soukromý
klíč nikdy nepatří do Gitu ani do frontendového buildu.

## 2. Apps Script

Nasaďte novou verzi `google-apps-script/Code.js`. Přidává pouze dvě serverově
chráněné operace:

- `sendAuthCodeEmail` odešle Firestorem připravený šestimístný kód,
- `migrationExport` stránkovaně zpřístupní řádky migračnímu nástroji.

Obě operace vyžadují stávající tajný `GOOGLE_LOG_TOKEN`. Veřejný anonymní
požadavek se k datům nedostane.

Z vlastností Apps Script projektu bezpečně zkopírujte současný `AUTH_SECRET`.
Stejná hodnota musí být nastavena Workeru, protože ID relací je HMAC otisk
stávajícího tokenu. Změna hodnoty by odhlásila všechna zařízení.

## 3. Lokální proměnné

Do ignorovaného `.env.local` doplňte hodnoty podle `.env.example`:

- `GOOGLE_LOG_URL`
- `GOOGLE_LOG_TOKEN`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` a `FIREBASE_PRIVATE_KEY`,
  případně lokální `FIREBASE_SERVICE_ACCOUNT_FILE`,
- `AUTH_SECRET`

Nejdříve proveďte pouze čtení a souhrn řádků:

```bash
node scripts/run-firestore-migration.mjs --check
node --env-file=.env.local scripts/run-firestore-migration.mjs
```

Po kontrole počtů spusťte idempotentní zápis:

```bash
node --env-file=.env.local scripts/run-firestore-migration.mjs --apply
```

Nástroj přenáší listy `Použití`, `Chyby`, `Zpětná vazba`, `Místa a MP3`,
`Uživatelé`, `Přihlašovací kódy` a `Přihlašovací relace`. Po dokončení zapíše
manifest `migration/latest` a provede kontrolní čtení cache a relace. Nečitelné
cache JSON řádky vypíše jako přeskočené; zdrojové řádky zůstanou v tabulce.

## 4. Přepnutí Workeru

Nastavte čtyři Firebase/Auth hodnoty jako serverové secrets a ponechte
`GOOGLE_LOG_URL` i `GOOGLE_LOG_TOKEN`. Worker používá Firestore pouze tehdy,
když jsou přítomné všechny Firebase hodnoty a `AUTH_SECRET`; jinak bezpečně
pokračuje přes původní Apps Script.

Po nasazení `/api/health` vrátí:

```json
{ "status": "ok", "storage": "firestore" }
```

Ověřte žádost o OTP, ověření kódu, obnovení staré relace, odhlášení, přesnou
cache, cache do 800 metrů a nový výklad. Současně ověřte, že v listu `Použití`
dál přibývají řádky. Zápis analytiky běží přes `waitUntil`, takže odpověď
uživateli na Google Sheets nečeká.

## Návrat

Odebráním nebo dočasným přejmenováním jedné z Firebase secrets se Worker při
dalším nasazení vrátí k původním operacím Apps Scriptu. Tabulka se během
migrace ani běžného provozu nemaže, takže návrat nevyžaduje obnovu dat.
