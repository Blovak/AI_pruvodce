# Google Apps Script e-mail a analytická kopie

Tento adresář obsahuje zdroj zabezpečeného pomocného endpointu pro Místopis.
Po přechodu na Firestore odesílá přihlašovací e-maily, asynchronně kopíruje
provozní analytiku do soukromé Google tabulky a stránkovaně poskytuje původní
řádky autorizovanému migračnímu nástroji. Všechny operace vyžadují token ze
Script Properties.

Listy:

- `Přehled` — automatické souhrnné metriky,
- `Použití` — provozní události; načtení průvodce obsahuje e-mail uživatele,
- `Chyby` — požadavky se stavem 400 a vyšším,
- `Zpětná vazba` — připraveno pro další rozvoj aplikace.
- `Uživatelé` — e-mail, datum prvního a posledního přihlášení,
- `Přihlašovací kódy` — krátkodobé HMAC otisky kódů a počty pokusů,
- `Přihlašovací relace` — HMAC otisky dlouhodobých tokenů zařízení.

Cache výkladů:

- při prvním seznámení s místem se použije nejbližší platný záznam do
  800 metrů,
- DeepSeek verze používá pouze cache řádky, jejichž textový model začíná
  `deepseek-`; historické výklady jiných poskytovatelů zůstávají jako archiv,
- pokud v tomto okruhu žádný platný záznam není, server vytvoří nový výklad
  pomocí AI a uloží ho jako další bod,
- Historické sloupce MP3 zůstávají v tabulce kvůli starším datům. Aktuální
  DeepSeek verze aplikace zvukové soubory nevytváří a používá systémový hlas.

Po dokončení migrace jsou cache a autentizační listy archivní zálohou.
Firestore je jejich primárním provozním úložištěm; běžné požadavky už tyto
listy neprohledávají.

Import GPS bodů:

- administrace načítá po dávkách pouze řádky listu `GPS body`, které nemají
  ve sloupci `zpracováno` hodnotu `True`,
- shodný JSON popisu v sousedních řádcích se do Firestore uloží jen jednou,
- každý prošlý řádek se po bezpečném zápisu přesune do listu `Backup`, kde má
  `zpracováno = True`, a z původního listu se odstraní,
- zápis do databáze i archivace jsou opakovatelné; přerušený import lze z
  administrace spustit znovu bez vytvoření duplicit,
- jedno spuštění z administrace skládá bezpečné dílčí dávky a zpracuje alespoň
  3 000 řádků, pokud jich ve zdrojovém listu tolik zbývá.

Soukromí:

- přesná poloha se před zápisem zaokrouhlí na dvě desetinná místa,
- neukládají se IP adresy ani text otázek,
- e-mail se ukládá kvůli přihlášení a k události načtení průvodce,
- šestimístné kódy a tokeny zařízení se ukládají pouze jako HMAC otisky,
- kód platí 10 minut a nejvýše 5 pokusů; relace zařízení platí 180 dní.

Po prvním nasazení autentizace spusťte v editoru Apps Scriptu funkci
`authorizeAuthentication()`. Vytvoří potřebné listy, bezpečný `AUTH_SECRET`
v Script Properties a vyžádá oprávnění k odesílání přihlašovacích e-mailů.

Aktualizace skriptu:

```bash
cd google-apps-script
clasp push
clasp deploy --deploymentId DEPLOYMENT_ID --description "Popis verze"
```

Skutečné tokeny se nesmějí ukládat do tohoto adresáře ani do Gitu.
