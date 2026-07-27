# Google Apps Script analytika

Tento adresář obsahuje zdroj zabezpečeného logovacího endpointu pro Místopis.
Apps Script je navázaný na soukromou Google tabulku a přijímá pouze požadavky
s tokenem uloženým v Script Properties.

Listy:

- `Přehled` — automatické souhrnné metriky,
- `Použití` — anonymizované provozní události,
- `Chyby` — požadavky se stavem 400 a vyšším,
- `Zpětná vazba` — připraveno pro další beta verzi.

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
