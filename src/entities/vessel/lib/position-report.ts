// Перетворювач повідомлення AISStream `PositionReport` у `Vessel`. Джерело правил:
// docs/tasks/SPRINT-02.md:25 (звідки кожне поле) і :27 (валідація позиції).
// Регістр і набір полів — із живого зразка data/samples/position-report.sample.json,
// а не з документації: там `MetaData.latitude` з малої, а `Message.PositionReport.
// Latitude` з великої, і координати беруться саме з другого, повної точності.
//
// Вхід — `unknown`, бо це розібраний JSON із мережі: жодне поле не гарантоване, і
// тип-твердження на вході сховав би саме ті випадки, заради яких модуль існує.
// Невалідна позиція дає `null`, а не судно з 0,0 — нуль тут був би справжньою
// точкою в Гвінейській затоці, а не "невідомо".
//
// Модуль чистий: ні мережі, ні годинника, ні React. Його імпортують і збирач на
// сервері, і юніт-тести.

import type { Vessel } from '../model/vessel';

/** Максимальна швидкість AIS; 102.3 означає "недоступно" (SPRINT-02:27). */
const MAX_SOG_KNOTS = 102.2;

/**
 * Формат Go `2006-01-02 15:04:05.999999999 -0700 MST`: дріб необов'язковий і до
 * дев'яти цифр, зсув `±HHMM` обов'язковий, абревіатура зони — лише підпис.
 * Якорі з обох боків: хвіст на кшталт `UTC garbage` рядок відкидає.
 */
const AIS_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))? ([+-])(\d{2})(\d{2})(?: [A-Za-z]+)?$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `time_utc` → ISO 8601 з мілісекундами й `Z`, або `null`, якщо рядок не розбирається.
 *
 * Чому не `Date.parse` (виміряно, data/samples/PROVENANCE.md): на Node 24 він
 * ігнорує `+0100`, коли є суфікс `UTC`, і переносить 30 лютого на 2 березня
 * замість відмови. Формат не ISO, тож поведінка — на розсуд рушія. Тут розбір
 * явний, а числовий зсув — авторитетний: `MST`-частина в Go лише абревіатура.
 */
export function parseAisTimeUtc(value: string): string | null {
  const match = AIS_TIME_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, year, month, day, hour, minute, second, fraction = '', sign, offH, offM] = match;
  // Дріб ОБРІЗАЄТЬСЯ до мілісекунд, не округлюється: .999999999 не сміє
  // перескочити в наступну секунду, а то й у наступну добу.
  const millis = Number(fraction.slice(0, 3).padEnd(3, '0'));
  // Хвилини зсуву перевірка перенесення не бачить — вона звіряє лише дату й час,
  // тож `+0199` відкидається тут, окремо.
  if (Number(offM) >= 60) {
    return null;
  }
  const offsetMinutes = Number(offH) * 60 + Number(offM);
  const offsetMs = (sign === '-' ? -1 : 1) * offsetMinutes * 60_000;

  const fields = [year, month, day, hour, minute, second].map(Number) as [
    number, number, number, number, number, number,
  ];
  const [y, mo, d, h, mi, s] = fields;
  const localMs = Date.UTC(y, mo - 1, d, h, mi, s, millis);
  const utcMs = localMs - offsetMs;

  // Перевірка відсутності перенесення: `Date.UTC` мовчки робить з 30 лютого
  // 2 березня, а з 25:00 — наступну добу. Зібрані назад компоненти мусять
  // збігтися з розібраними, інакше дата неіснуюча. Заодно ловить роки 0000…0099,
  // які `Date.UTC` зсуває в 1900-ті.
  const local = new Date(utcMs + offsetMs);
  const rebuilt = [
    local.getUTCFullYear(),
    local.getUTCMonth() + 1,
    local.getUTCDate(),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
  ];
  if (rebuilt.some((component, index) => component !== fields[index])) {
    return null;
  }

  return new Date(utcMs).toISOString();
}

/**
 * MMSI → `id`. Правило SPRINT-02:27 каже лише "непорожній", тож `0` лишається
 * `"0"`: відкидати його — вигадувати правило, якого немає. Число мусить бути
 * цілим невід'ємним — дробовий чи від'ємний номер не є ідентифікатором.
 */
function mmsiToId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

function shipNameToName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Одне повідомлення → судно або `null`. `null` — це "позиції немає" (не той тип,
 * координати поза діапазоном або нечислові, час не розбирається, MMSI порожній).
 * Швидкість і курс поза доменом позицію НЕ відкидають — вони стають `null`, і
 * картка покаже "Немає даних".
 */
export function vesselFromPositionReport(raw: unknown): Vessel | null {
  const message = asObject(raw);
  if (message === null || message.MessageType !== 'PositionReport') {
    return null;
  }

  const meta = asObject(message.MetaData);
  const report = asObject(asObject(message.Message)?.PositionReport);
  if (meta === null || report === null) {
    return null;
  }

  const id = mmsiToId(meta.MMSI);
  if (id === null) {
    return null;
  }

  // 91 і 181 ("недоступно") лежать поза діапазонами, тож окремої гілки не треба.
  const { Latitude: lat, Longitude: lon } = report;
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    return null;
  }
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
    return null;
  }

  const timestamp = typeof meta.time_utc === 'string' ? parseAisTimeUtc(meta.time_utc) : null;
  if (timestamp === null) {
    return null;
  }

  const { Sog: sog, Cog: cog } = report;

  return {
    id,
    name: shipNameToName(meta.ShipName),
    lat,
    lon,
    speedKnots: isFiniteNumber(sog) && sog >= 0 && sog <= MAX_SOG_KNOTS ? sog : null,
    // 360 означає "недоступно"; домен [0, 360) — як у `Vessel.courseDeg`.
    courseDeg: isFiniteNumber(cog) && cog >= 0 && cog < 360 ? cog : null,
    timestamp,
    source: 'aisstream',
  };
}
