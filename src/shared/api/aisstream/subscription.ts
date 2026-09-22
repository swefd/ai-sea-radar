// Тіло підписки AISStream. Джерело: docs/tasks/SPRINT-02.md:23; звірено з живою
// документацією aisstream.io. Проєктне рішення §4.2.

import { DOVER_STRAIT_REGION } from '@/shared/config';

/**
 * Будує JSON-рядок підписки.
 *
 * ПОЛЕ КЛЮЧА — `APIKey`. Три джерела в репозиторії розходяться, і перемагає не
 * більшість, а дріт:
 *   - reference/aisstream-typescript-example/client.ts:11  → `Apikey`
 *   - reference/ais-message-models/models/SubscriptionMessage.ts:17 → `'aPIKey'`
 *   - той самий файл :27 → `"baseName": "APIKey"` — ім'я, яке реально летить
 * `aPIKey` — властивість згенерованого класу, не поле JSON; довідка того пакета
 * прямо наказує читати колонку baseName. Жива документація друкує `APIKey`.
 *
 * Помилка тут МОВЧАЗНА: джерело не відповідає «невірне поле», воно просто
 * закриває з'єднання, і симптом прочитається як збій мережі.
 *
 * Повертає РЯДОК, а не об'єкт: рішення про формат живе тут, а connect.ts лише
 * передає готове в сокет.
 */
export function buildSubscription(apiKey: string): string {
  const { south, west, north, east } = DOVER_STRAIT_REGION;

  return JSON.stringify({
    APIKey: apiKey,
    // Масив КОРОБОК; кожна — два кути; кожен кут — пара [lat, lon].
    // Порядок пари саме такий за документацією та SPRINT-02:23; переставлені
    // місцями числа дали б коробку біля Гани й порожній збір при справному сокеті.
    BoundingBoxes: [[[south, west], [north, east]]],
    FilterMessageTypes: ['PositionReport'],
  });
}
