import type { GuideContent } from "@/lib/types";

export const welcomeGuide: GuideContent = {
  placeName: "Vaše okolí čeká",
  subtitle: "Příběhy jsou blíž, než se zdá",
  era: "PRŮVODCE MÍSTEM",
  overview:
    "Povolte přístup k poloze a Místopis vám představí historii i drobné zajímavosti místa, kde právě stojíte.",
  story:
    "Každá ulice má několik vrstev. Pod dnešními fasádami se skrývají staré cesty, zapomenutá řemesla i osudy lidí, kteří tudy procházeli dávno před námi. Stačí určit místo a můžeme je společně odkrýt.",
  facts: [
    {
      title: "Příběh na míru",
      text: "Výklad vzniká podle přesné polohy a lze se průvodce dál ptát.",
    },
    {
      title: "Poslech za chůze",
      text: "Celý příběh si můžete nechat přečíst přirozeným AI hlasem.",
    },
    {
      title: "Místo pod kontrolou",
      text: "Polohu použijeme pouze pro vytvoření aktuálního průvodce.",
    },
  ],
  nearby: [],
  question: "Co vás na tomto místě zajímá nejvíc?",
  sourceUrls: [],
};
