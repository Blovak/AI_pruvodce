const SHEETS = {
  overview: "Přehled",
  usage: "Použití",
  errors: "Chyby",
  feedback: "Zpětná vazba",
};

const USAGE_HEADERS = [
  "Čas",
  "Relace",
  "Událost",
  "Stav",
  "Doba (ms)",
  "Místo",
  "Oblast lat",
  "Oblast lon",
  "Délka otázky",
  "Znaky vstupu",
  "Model",
  "Detail",
];

const ERROR_HEADERS = [
  "Čas",
  "Relace",
  "Událost",
  "Stav",
  "Místo",
  "Chyba",
];

const FEEDBACK_HEADERS = [
  "Čas",
  "Relace",
  "Hodnocení",
  "Místo",
  "Poznámka",
];

function setup(logToken, spreadsheetId) {
  const properties = PropertiesService.getScriptProperties();
  const targetId =
    String(spreadsheetId || "").trim() ||
    properties.getProperty("SPREADSHEET_ID");
  if (!targetId) throw new Error("Chybí ID cílové tabulky.");

  const spreadsheet = SpreadsheetApp.openById(targetId);
  const token = String(logToken || "").trim() || createToken_();

  properties.setProperties({
    LOG_TOKEN: token,
    SPREADSHEET_ID: spreadsheet.getId(),
  });

  ensureSheet_(spreadsheet, SHEETS.usage, USAGE_HEADERS, "#e7ede9");
  ensureSheet_(spreadsheet, SHEETS.errors, ERROR_HEADERS, "#f8e8e3");
  ensureSheet_(spreadsheet, SHEETS.feedback, FEEDBACK_HEADERS, "#eee9f5");
  setupOverview_(spreadsheet);

  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    token: token,
  };
}

function doGet() {
  const properties = PropertiesService.getScriptProperties();
  return json_({
    status: "ok",
    configured: Boolean(
      properties.getProperty("LOG_TOKEN") &&
        properties.getProperty("SPREADSHEET_ID"),
    ),
  });
}

function doPost(event) {
  try {
    const payload = JSON.parse(
      (event && event.postData && event.postData.contents) || "{}",
    );
    const properties = PropertiesService.getScriptProperties();

    const expectedToken = properties.getProperty("LOG_TOKEN");

    if (!expectedToken || !safeEqual_(payload.token, expectedToken)) {
      return json_({ ok: false, error: "unauthorized" });
    }

    const item = normalizeEvent_(payload.event || {});
    writeEvent_(item, properties.getProperty("SPREADSHEET_ID"));
    return json_({ ok: true });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: "invalid_request" });
  }
}

function writeEvent_(item, spreadsheetId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    spreadsheet.getSheetByName(SHEETS.usage).appendRow([
      item.timestamp,
      safeCell_(item.session),
      safeCell_(item.action),
      item.status,
      item.durationMs,
      safeCell_(item.place),
      item.latitude,
      item.longitude,
      item.questionLength,
      item.inputChars,
      safeCell_(item.model),
      safeCell_(item.detail),
    ]);

    if (item.status >= 400) {
      spreadsheet.getSheetByName(SHEETS.errors).appendRow([
        item.timestamp,
        safeCell_(item.session),
        safeCell_(item.action),
        item.status,
        safeCell_(item.place),
        safeCell_(item.detail || "Požadavek skončil chybou."),
      ]);
    }
  } finally {
    lock.releaseLock();
  }
}

function normalizeEvent_(raw) {
  const now = new Date();
  const status = boundedNumber_(raw.status, 0, 599, 0);
  return {
    timestamp: now,
    session: cleanText_(raw.session, 80),
    action: cleanText_(raw.action, 40) || "unknown",
    status: status,
    durationMs: boundedNumber_(raw.durationMs, 0, 360000, 0),
    place: cleanText_(raw.place, 240),
    latitude: roundedCoordinate_(raw.latitude, -90, 90),
    longitude: roundedCoordinate_(raw.longitude, -180, 180),
    questionLength: boundedNumber_(raw.questionLength, 0, 500, 0),
    inputChars: boundedNumber_(raw.inputChars, 0, 4096, 0),
    model: cleanText_(raw.model, 80),
    detail: cleanText_(raw.detail, 300),
  };
}

function setupOverview_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SHEETS.overview);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEETS.overview, 0);
  sheet.clear();

  const rows = [
    ["Místopis — provozní přehled", ""],
    ["Aktualizováno", "=NOW()"],
    ["Požadavků celkem", `=MAX(COUNTA('${SHEETS.usage}'!A:A)-1;0)`],
    [
      "Úspěšnost",
      `=IFERROR(COUNTIFS('${SHEETS.usage}'!D:D;">=200";'${SHEETS.usage}'!D:D;"<400")/MAX(COUNTA('${SHEETS.usage}'!D:D)-1;1);0)`,
    ],
    [
      "Vygenerované výklady",
      `=COUNTIF('${SHEETS.usage}'!C:C;"guide")`,
    ],
    [
      "Vytvořené audio",
      `=COUNTIF('${SHEETS.usage}'!C:C;"speech")`,
    ],
    [
      "Chyby",
      `=COUNTIF('${SHEETS.usage}'!D:D;">=400")`,
    ],
    [
      "Průměrná doba výkladu (ms)",
      `=IFERROR(AVERAGEIF('${SHEETS.usage}'!C:C;"guide";'${SHEETS.usage}'!E:E);0)`,
    ],
    ["Ochrana soukromí", "GPS je uložena pouze po zaokrouhlení na 2 desetinná místa. Text otázek se neukládá."],
  ];

  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange("A1:B1").merge();
  sheet
    .getRange("A1")
    .setFontWeight("bold")
    .setFontSize(16)
    .setBackground("#e7ede9");
  sheet.getRange("A2:A8").setFontWeight("bold");
  sheet.getRange("B4").setNumberFormat("0.0%");
  sheet.getRange("B2").setNumberFormat("d. m. yyyy hh:mm");
  sheet.getRange("A9:B9").setWrap(true).setBackground("#f3f4f3");
  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 520);
  sheet.setFrozenRows(1);
}

function ensureSheet_(spreadsheet, name, headers, color) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground(color)
    .setWrap(true);
  sheet.setFrozenRows(1);

  for (let column = 1; column <= headers.length; column += 1) {
    sheet.setColumnWidth(column, column === 6 ? 330 : 130);
  }
  sheet.setColumnWidth(1, 165);

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), headers.length).createFilter();
  }
}

function createToken_() {
  return `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, "");
}

function cleanText_(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function safeCell_(value) {
  const text = cleanText_(value, 300);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function boundedNumber_(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(min, number)));
}

function roundedCoordinate_(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return "";
  return Math.round(number * 100) / 100;
}

function safeEqual_(provided, expected) {
  const left = String(provided || "");
  const right = String(expected || "");
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
