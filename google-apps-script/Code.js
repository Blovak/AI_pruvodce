const SHEETS = {
  overview: "Přehled",
  usage: "Použití",
  errors: "Chyby",
  feedback: "Zpětná vazba",
  cache: "Místa a MP3",
};

const CACHE_TTL_YEARS = 1;
const DEFAULT_CACHE_RADIUS_METERS = 800;
const MAX_CACHE_RADIUS_METERS = 5000;
const EARTH_RADIUS_METERS = 6371008.8;

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

const CACHE_HEADERS = [
  "Vytvořeno",
  "Platné do",
  "Cache klíč",
  "Latitude",
  "Longitude",
  "Místo",
  "Odpověď AI (JSON)",
  "MP3 odkaz",
  "Drive file ID",
  "Textový model",
  "Hlasový model",
  "Poslední použití",
  "Počet použití",
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
  ensureCacheSheet_(spreadsheet);
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

    const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
    switch (String(payload.operation || "log")) {
      case "cacheGet":
        return json_(cacheGet_(spreadsheetId, payload));
      case "cacheSaveGuide":
        return json_(cacheSaveGuide_(spreadsheetId, payload));
      case "cacheGetAudio":
        return json_(cacheGetAudio_(spreadsheetId, payload.cacheKey));
      case "cacheSaveAudio":
        return json_(cacheSaveAudio_(spreadsheetId, payload));
      default: {
        const item = normalizeEvent_(payload.event || {});
        writeEvent_(item, spreadsheetId);
        return json_({ ok: true });
      }
    }
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: "invalid_request" });
  }
}

function authorizeCacheStorage() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Nejprve spusťte setup.");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  ensureCacheSheet_(spreadsheet);
  const folder = ensureAudioFolder_();
  return {
    ok: true,
    sheetUrl: spreadsheet.getUrl(),
    folderUrl: folder.getUrl(),
  };
}

function cacheGet_(spreadsheetId, rawRequest) {
  const request =
    rawRequest && typeof rawRequest === "object"
      ? rawRequest
      : { cacheKey: rawRequest };
  const key = validCacheKey_(request.cacheKey);
  const latitude = coordinateNumber_(request.latitude, -90, 90);
  const longitude = coordinateNumber_(request.longitude, -180, 180);
  const hasCoordinates = latitude !== null && longitude !== null;
  if (!hasCoordinates && !key) {
    return { ok: false, error: "invalid_cache_location" };
  }

  const requestedRadius = Number(request.maxDistanceMeters);
  const maxDistanceMeters = Math.min(
    Math.max(
      Number.isFinite(requestedRadius)
        ? requestedRadius
        : DEFAULT_CACHE_RADIUS_METERS,
      0,
    ),
    MAX_CACHE_RADIUS_METERS,
  );

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = cacheSheet_(spreadsheetId);
    const match = hasCoordinates
      ? findNearestValidCacheRow_(
          sheet,
          latitude,
          longitude,
          maxDistanceMeters,
          false,
        )
      : findValidCacheRow_(sheet, key, false);
    if (!match) return { ok: true, hit: false };

    const guide =
      match.guide || parseGuideJson_(String(match.values[6] || ""));
    if (!guide) return { ok: true, hit: false };

    const hits = Number(match.values[12]) || 0;
    sheet.getRange(match.row, 12, 1, 2).setValues([[new Date(), hits + 1]]);
    return {
      ok: true,
      hit: true,
      guide: guide,
      cacheKey: String(match.values[2] || ""),
      distanceMeters: Math.round(Number(match.distanceMeters) || 0),
      audioAvailable: Boolean(match.values[8]),
      mp3Url: String(match.values[7] || ""),
      validUntil: dateIso_(match.values[1]),
    };
  } finally {
    lock.releaseLock();
  }
}

function cacheSaveGuide_(spreadsheetId, payload) {
  const key = validCacheKey_(payload.cacheKey);
  if (!key) return { ok: false, error: "invalid_cache_key" };

  const guideJson = JSON.stringify(payload.guide || {});
  if (!guideJson || guideJson.length > 45000) {
    return { ok: false, error: "guide_too_large" };
  }

  const now = new Date();
  const validUntil = new Date(now.getTime());
  validUntil.setFullYear(validUntil.getFullYear() + CACHE_TTL_YEARS);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = cacheSheet_(spreadsheetId);
    sheet.appendRow([
      now,
      validUntil,
      key,
      cacheCoordinate_(payload.latitude, -90, 90),
      cacheCoordinate_(payload.longitude, -180, 180),
      safeCell_(payload.place),
      guideJson,
      "",
      "",
      safeCell_(payload.textModel),
      "",
      now,
      0,
    ]);
    return {
      ok: true,
      cacheKey: key,
      validUntil: validUntil.toISOString(),
    };
  } finally {
    lock.releaseLock();
  }
}

function cacheGetAudio_(spreadsheetId, rawKey) {
  const key = validCacheKey_(rawKey);
  if (!key) return { ok: false, error: "invalid_cache_key" };

  const sheet = cacheSheet_(spreadsheetId);
  const match = findValidCacheRow_(sheet, key, true);
  if (!match) return { ok: true, hit: false };

  try {
    const file = DriveApp.getFileById(String(match.values[8]));
    if (file.isTrashed()) return { ok: true, hit: false };
    const blob = file.getBlob();
    sheet.getRange(match.row, 12).setValue(new Date());
    return {
      ok: true,
      hit: true,
      audioBase64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType() || "audio/mpeg",
      mp3Url: file.getUrl(),
    };
  } catch (error) {
    console.error(error);
    return { ok: true, hit: false };
  }
}

function cacheSaveAudio_(spreadsheetId, payload) {
  const key = validCacheKey_(payload.cacheKey);
  if (!key) return { ok: false, error: "invalid_cache_key" };
  const encoded = String(payload.audioBase64 || "");
  if (!encoded || encoded.length > 30000000) {
    return { ok: false, error: "invalid_audio" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = cacheSheet_(spreadsheetId);
    const match = findValidCacheRow_(sheet, key, false);
    if (!match) return { ok: false, error: "cache_row_not_found" };

    const existingFileId = String(match.values[8] || "");
    if (existingFileId) {
      try {
        const existingFile = DriveApp.getFileById(existingFileId);
        if (!existingFile.isTrashed()) {
          return {
            ok: true,
            cacheKey: key,
            mp3Url: existingFile.getUrl(),
            reused: true,
          };
        }
      } catch (error) {
        console.error(error);
      }
    }

    const bytes = Utilities.base64Decode(encoded);
    const mimeType = cleanText_(payload.mimeType, 80) || "audio/mpeg";
    const placeName = fileNamePart_(payload.placeName) || "mistopis";
    const timestamp = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd_HH-mm-ss",
    );
    const blob = Utilities.newBlob(
      bytes,
      mimeType,
      `${placeName}_${timestamp}.mp3`,
    );
    const file = ensureAudioFolder_().createFile(blob);
    file.setDescription(`Místopis cache ${key}`);

    sheet.getRange(match.row, 8, 1, 5).setValues([
      [
        file.getUrl(),
        file.getId(),
        match.values[9],
        safeCell_(payload.ttsModel),
        new Date(),
      ],
    ]);
    return {
      ok: true,
      cacheKey: key,
      mp3Url: file.getUrl(),
      fileId: file.getId(),
      reused: false,
    };
  } finally {
    lock.releaseLock();
  }
}

function cacheSheet_(spreadsheetId) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  return ensureCacheSheet_(spreadsheet);
}

function ensureCacheSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SHEETS.cache);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEETS.cache);
  sheet.getRange(1, 1, 1, CACHE_HEADERS.length).setValues([CACHE_HEADERS]);
  sheet
    .getRange(1, 1, 1, CACHE_HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#e7ede9")
    .setWrap(true);
  sheet.setFrozenRows(1);
  if (!sheet.getFilter()) {
    sheet
      .getRange(1, 1, Math.max(sheet.getMaxRows(), 2), CACHE_HEADERS.length)
      .createFilter();
  }
  return sheet;
}

function ensureAudioFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = properties.getProperty("AUDIO_FOLDER_ID");
  if (folderId) {
    try {
      const folder = DriveApp.getFolderById(folderId);
      if (!folder.isTrashed()) return folder;
    } catch (error) {
      console.error(error);
    }
  }

  const folder = DriveApp.createFolder("Místopis – uložené MP3");
  folder.setDescription(
    "Soukromá audio cache aplikace Místopis. Soubory obsluhuje Google Apps Script.",
  );
  properties.setProperty("AUDIO_FOLDER_ID", folder.getId());
  return folder;
}

function findValidCacheRow_(sheet, key, requireAudio) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const rows = sheet.getRange(2, 1, lastRow - 1, CACHE_HEADERS.length).getValues();
  const now = Date.now();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const values = rows[index];
    const validUntil = values[1] instanceof Date ? values[1].getTime() : 0;
    if (
      String(values[2]) === key &&
      validUntil > now &&
      (!requireAudio || values[8])
    ) {
      return { row: index + 2, values: values };
    }
  }
  return null;
}

function findNearestValidCacheRow_(
  sheet,
  latitude,
  longitude,
  maxDistanceMeters,
  requireAudio,
) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const rows = sheet
    .getRange(2, 1, lastRow - 1, CACHE_HEADERS.length)
    .getValues();
  const now = Date.now();
  let nearest = null;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const values = rows[index];
    const validUntil = values[1] instanceof Date ? values[1].getTime() : 0;
    if (validUntil <= now || (requireAudio && !values[8])) continue;

    const rowLatitude = coordinateNumber_(values[3], -90, 90);
    const rowLongitude = coordinateNumber_(values[4], -180, 180);
    if (rowLatitude === null || rowLongitude === null) continue;

    const distanceMeters = haversineMeters_(
      latitude,
      longitude,
      rowLatitude,
      rowLongitude,
    );
    if (
      distanceMeters > maxDistanceMeters + 0.01 ||
      (nearest && distanceMeters >= nearest.distanceMeters)
    ) {
      continue;
    }

    const guide = parseGuideJson_(String(values[6] || ""));
    if (!guide) continue;
    nearest = {
      row: index + 2,
      values: values,
      guide: guide,
      distanceMeters: distanceMeters,
    };
  }

  return nearest;
}

function haversineMeters_(latitudeA, longitudeA, latitudeB, longitudeB) {
  const toRadians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * toRadians;
  const longitudeDelta = (longitudeB - longitudeA) * toRadians;
  const latitudeARadians = latitudeA * toRadians;
  const latitudeBRadians = latitudeB * toRadians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function parseGuideJson_(value) {
  try {
    const guide = JSON.parse(value);
    return guide && typeof guide === "object" && !Array.isArray(guide)
      ? guide
      : null;
  } catch (error) {
    return null;
  }
}

function coordinateNumber_(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

function validCacheKey_(value) {
  const key = String(value || "").trim();
  return /^-?\d{1,2}\.\d{4},-?\d{1,3}\.\d{4}$/.test(key) ? key : "";
}

function cacheCoordinate_(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return "";
  return Math.round(number * 10000) / 10000;
}

function fileNamePart_(value) {
  return cleanText_(value, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function dateIso_(value) {
  return value instanceof Date ? value.toISOString() : "";
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
