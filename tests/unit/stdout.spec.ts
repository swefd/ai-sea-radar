import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';

import { writeAllSync, type RawWrite } from '../../scripts/verify/stdout.mjs';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const MODULE_URL = pathToFileURL(path.join(ROOT, 'scripts/verify/stdout.mjs')).href;

const SENT_BYTES = 400_000;

/**
 * Дитина, чий stdout — труба (саме так хук і бачить світ), яка пише заданим
 * способом і НЕГАЙНО виходить. Негайний вихід тут не штучність, а суть: рівно
 * так закінчується хук, і рівно тому асинхронний буфер Node не встигає злитись.
 */
function writeAndExit(body: string): number {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', body], {
    encoding: 'buffer',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result.stdout.length;
}

test('writeAllSync доставляє весь текст там, де process.stdout.write губить хвіст', () => {
  const delivered = writeAndExit(
    `import { writeAllSync } from ${JSON.stringify(MODULE_URL)};`
    + `writeAllSync(1, 'x'.repeat(${SENT_BYTES})); process.exit(0);`,
  );
  expect(delivered).toBe(SENT_BYTES);

  // Контроль. Він не «для повноти»: без нього тест був би зеленим і на
  // реалізації, яка нічого не лагодить, — а саме це робить варту порожньою
  // (R-123). Якщо колись Node перестане обривати цей шлях, тест почервоніє —
  // і тоді переміряти треба ПОТРЕБУ в модулі, а не послабити асерцію.
  const truncated = writeAndExit(
    `process.stdout.write('x'.repeat(${SENT_BYTES})); process.exit(0);`,
  );
  expect(truncated).toBeLessThan(SENT_BYTES);
});

test('writeAllSync рахує БАЙТИ, а не символи', () => {
  // Кирилиця — два байти на символ. Функція, що повернула б довжину рядка,
  // звітувала б про вдвічі меншу доставку, ніж сталася, і цикл зупинявся б
  // не там, де треба.
  const delivered = writeAndExit(
    `import { writeAllSync } from ${JSON.stringify(MODULE_URL)};`
    + "const n = writeAllSync(1, 'я'.repeat(10)); process.stdout.write(String(n)); process.exit(0);",
  );
  // 20 байтів кирилиці + два байти числа «20».
  expect(delivered).toBe(22);
});

/** Запис, що приймає не більше `chunk` байтів за раз і збирає віддане. */
function partialWriter(chunk: number): { sink: Buffer[]; write: RawWrite } {
  const sink: Buffer[] = [];
  const write: RawWrite = (_fd, buffer, offset, length) => {
    const take = Math.min(chunk, length);
    sink.push(Buffer.from(buffer.subarray(offset, offset + take)));
    return take;
  };
  return { sink, write };
}

test('частковий запис дописується, а не губиться', () => {
  // `writeSync` має право записати МЕНШЕ, ніж просили. Єдиний виклик без циклу
  // виглядав би успішним і мовчки втрачав хвіст — той самий клас, що обрив труби.
  const { sink, write } = partialWriter(7);
  const text = 'я'.repeat(50); // 100 байтів, не кратно 7
  const written = writeAllSync(1, text, write);

  expect(written).toBe(100);
  expect(Buffer.concat(sink).toString('utf8')).toBe(text);
});

test('EAGAIN — це «спробуй ще», а не кінець запису', () => {
  // Неблокувальна труба, повна просто зараз. Вийти тут означало б утратити
  // хвіст саме на довгому виводі, тобто там, де він найпотрібніший.
  const { sink, write } = partialWriter(1000);
  let refusals = 0;
  const flaky: RawWrite = (fd, buffer, offset, length) => {
    if (refusals < 2) {
      refusals += 1;
      throw Object.assign(new Error('resource temporarily unavailable'), { code: 'EAGAIN' });
    }
    return write(fd, buffer, offset, length);
  };

  expect(writeAllSync(1, 'текст', flaky)).toBe(Buffer.byteLength('текст', 'utf8'));
  expect(refusals).toBe(2);
  expect(Buffer.concat(sink).toString('utf8')).toBe('текст');
});

test('EPIPE не кидається назовні: адресата немає, і це чесна відповідь', () => {
  const gone: RawWrite = () => {
    throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
  };
  // Нуль доставлених байтів — не помилка хука, а факт про читача. Виняток тут
  // перетворив би зниклу сесію на падіння хука.
  expect(writeAllSync(1, 'текст', gone)).toBe(0);
});

test('інші помилки запису НЕ ковтаються', () => {
  const broken: RawWrite = () => {
    throw Object.assign(new Error('bad file descriptor'), { code: 'EBADF' });
  };
  // Проковтнути EBADF означало б повідомити «записано нуль» там, де писати
  // просто нікуди — тиха втрата виводу з виглядом успіху.
  expect(() => writeAllSync(1, 'текст', broken)).toThrow('bad file descriptor');
});
