// ОДНОРАЗОВИЙ скрипт: отримати ОДНЕ живе повідомлення StandardClassBPositionReport
// для data/samples/ (SPRINT-02:90 — перетворювач пишеться за зразком). Не частина
// застосунку; видаляється після отримання зразка (специфікація 2026-09-29 §6).
//
// Запускає ЛЮДИНА зі своїм ключем:  node --env-file=.env.local scripts/capture-class-b-sample.mjs
// Ключ читається з оточення й НІКУДИ не друкується; у файл іде лише повідомлення.

import { writeFileSync } from 'node:fs';

const OUT = 'data/samples/standard-class-b-position-report.sample.json';
const BOXES = [
  { name: 'Дуврська протока', box: [[50.75, 0.95], [51.25, 1.95]], ms: 120_000 },
  { name: 'Ла-Манш', box: [[49.0, -6.0], [51.5, 2.5]], ms: 120_000 },
];

const apiKey = (process.env.AISSTREAM_API_KEY ?? '').trim();
if (apiKey === '') {
  console.error('AISSTREAM_API_KEY не задано');
  process.exit(1);
}

function tryBox({ name, box, ms }) {
  return new Promise((resolve) => {
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    socket.binaryType = 'arraybuffer';
    const timer = setTimeout(() => { socket.close(); resolve(null); }, ms);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [box],
        FilterMessageTypes: ['StandardClassBPositionReport'],
      }));
      console.log(`підписано: ${name}; чекаю до ${ms / 1000} с…`);
    });
    socket.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (message.MessageType !== 'StandardClassBPositionReport') return;
      clearTimeout(timer);
      socket.close();
      resolve({ name, box, message, receivedAt: new Date().toISOString() });
    });
    socket.addEventListener('error', () => { clearTimeout(timer); resolve(null); });
  });
}

for (const candidate of BOXES) {
  const got = await tryBox(candidate);
  if (got === null) { console.log(`${candidate.name}: нічого`); continue; }
  const json = JSON.stringify(got.message, null, 2);
  if (json.includes(apiKey)) { console.error('у повідомленні знайдено ключ — не зберігаю'); process.exit(1); }
  writeFileSync(OUT, `${json}\n`);
  console.log(`збережено ${OUT}; район: ${got.name} ${JSON.stringify(got.box)}; отримано: ${got.receivedAt}`);
  process.exit(0);
}
console.log('зразка не отримано в жодному районі');
process.exit(2);
