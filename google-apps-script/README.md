# Google Apps Script analytika

Tento adresář obsahuje zdroj zabezpečeného logovacího endpointu pro Místopis.
Apps Script je navázaný na soukromou Google tabulku a přijímá pouze požadavky
s tokenem uloženým v Script Properties.

Listy:

- `Přehled` — automatické souhrnné metriky,
- `Použití` — anonymizované provozní události,
- `Chyby` — požadavky se stavem 400 a vyšším,
- `Zpětná vazba` — připraveno pro další beta verzi.

Cache výkladů:

- při prvním seznámení s místem se použije nejbližší platný záznam do
  800 metrů,
- DeepSeek verze používá pouze cache řádky, jejichž textový model začíná
  `deepseek-`; historické výklady jiných poskytovatelů zůstávají jako archiv,
- pokud v tomto okruhu žádný platný záznam není, server vytvoří nový výklad
  pomocí AI a uloží ho jako další bod,
- Historické sloupce MP3 zůstávají v tabulce kvůli starším datům. Aktuální
  DeepSeek verze aplikace zvukové soubory nevytváří a používá systémový hlas.

Soukromí:

- přesná poloha se před zápisem zaokrouhlí na dvě desetinná místa,
- neukládají se IP adresy, e-maily ani text otázek,
- identifikátor relace je náhodný údaj uložený pouze v prohlížeči uživatele.

Aktualizace skriptu:

```bash
cd google-apps-script
clasp push
clasp deploy --deploymentId DEPLOYMENT_ID --description "Popis verze"
```

Skutečné tokeny se nesmějí ukládat do tohoto adresáře ani do Gitu.
