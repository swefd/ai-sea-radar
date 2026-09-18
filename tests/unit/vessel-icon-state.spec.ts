import { test, expect } from '@playwright/test';

import { formatCourse, vesselIconState } from '@/entities/vessel';

// Гілка значка — "курс" чи "нейтральний" — і кут його повороту.
//
// ЧОМУ ЦЕ ВЗАГАЛІ ТЕСТОВНО. Рішення §3.1 винесло цей вибір із ui/vessel-icon.ts у
// чисте ядро саме заради цього файлу: модуль значка імпортує CSS, а юніт-раннер
// Playwright не має трансформу для .css (ERR_UNKNOWN_FILE_EXTENSION ".css"). Лишись
// рішення в ui/, гілку data-icon не перевіряло б НІЩО — ні тут, ні в реєстрі
// перевірок, ні очима (нейтральний значок видно тільки при тимчасовій правці даних).
//
// Тому тут імпортується лише чистий вхід '@/entities/vessel'.

test('null дає нейтральний значок, а не курс у нуль градусів', () => {
  // Друга половина вимоги "нуль і null - різні речі", застосована до значка:
  // невідомий курс — це коло без переду, а не стрілка на північ.
  expect(vesselIconState(null)).toEqual({ kind: 'neutral', rotationDeg: 0 });
});

test('0 дає ЗНАЧОК КУРСУ — пряма варта проти перевірки на хибність', () => {
  // Найдорожчий дефект цієї функції й найневидиміший у рев'ю: `if (!courseDeg)`
  // або `courseDeg || ...` замість `=== null` повертає нейтральне коло для судна,
  // що йде рівно на північ. Обидва об'єкти мають rotationDeg 0, тож розрізняє їх
  // ТІЛЬКИ поле kind — і тільки цей рядок.
  expect(vesselIconState(0)).toEqual({ kind: 'course', rotationDeg: 0 });

  // Те саме твердження нарізно, щоб причина падіння читалася з назви поля.
  expect(vesselIconState(0).kind).toBe('course');
  expect(vesselIconState(null).kind).toBe('neutral');
});

test('курс переноситься в кут, нормалізований так само, як у картці', () => {
  expect(vesselIconState(135)).toEqual({ kind: 'course', rotationDeg: 135 });
  expect(vesselIconState(135.4).rotationDeg).toBe(135);
  expect(vesselIconState(135.5).rotationDeg).toBe(136);
});

test('кут значка нормалізується округленням ПЕРЕД модулем', () => {
  // Та сама неоднозначність §3.5, що й у formatCourse, але тут вона коштує
  // дорожче: CSS-поворот на 360° візуально не відрізнити від 0°, тож невірне
  // читання пройшло б і повз очі теж. Ловиться лише тут.
  expect(vesselIconState(359.7).rotationDeg).toBe(0); // невірне читання -> 360
  expect(vesselIconState(359.5).rotationDeg).toBe(0); // невірне читання -> 360
  // Нижній край вікна розходження: доводить, що вікно — [359.5, 360), а не
  // "все велике перетворюється на нуль".
  expect(vesselIconState(359.4).rotationDeg).toBe(359);
  // Модуль справді живий: без нього було б 360 і 720.
  expect(vesselIconState(360).rotationDeg).toBe(0);
  expect(vesselIconState(719.7).rotationDeg).toBe(0);
});

test('значок і картка ніколи не розходяться в куті', () => {
  // Несуча перевірка цього файлу. Судно, що показує в картці "0°", а на карті
  // дивиться в 360° — це не косметика: картка й значок читають одне поле, і
  // розбіжність означала б дві різні відповіді на те саме питання. Два модулі
  // сьогодні ділять одну нормалізацію; тест закріплює НАСЛІДОК, а не спосіб,
  // тож переживе будь-яке переписування всередині.
  //
  // Перелік навмисно містить обидві сторони вікна розходження: під невірним
  // читанням в одному з модулів рядок 359.7 дав би "0°" проти 360.
  for (const courseDeg of [0, 45, 135, 135.5, 359.4, 359.5, 359.7, 360, 719.7, -45]) {
    const { rotationDeg } = vesselIconState(courseDeg);
    expect(`${rotationDeg}°`, `курс ${courseDeg}`).toBe(formatCourse(courseDeg));
  }
});

test('нейтральний кут — саме число 0, а не NaN і не undefined', () => {
  // `transform: rotate(NaNdeg)` браузер мовчки ігнорує, тож на екрані це
  // виглядало б як правильний нейтральний значок, а на реальному курсі — як
  // значок, що не обертається. Тип number цього не ловить: NaN має тип number.
  for (const courseDeg of [null, 0, 135, 359.7, -45]) {
    const { rotationDeg } = vesselIconState(courseDeg);
    expect(Number.isFinite(rotationDeg), `курс ${courseDeg}`).toBe(true);
  }
});

test('kind набуває рівно двох значень і жодного іншого', () => {
  const kinds = new Set(
    [null, 0, 45, 135, 359.7, 360, -45, 1e6].map((courseDeg) => vesselIconState(courseDeg).kind),
  );
  // Атрибут data-icon у ТЗ має рівно два значення, і тести B-07 шукатимуть судна
  // за ним. Третє значення зробило б їх мовчки порожніми.
  expect([...kinds].sort()).toEqual(['course', 'neutral']);
});
