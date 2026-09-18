// Гілка значка — курс чи нейтральний — і кут його повороту.
// Проєктне рішення B-03/B-04, §3.1 ("Наслідок для значка, який легко пропустити").
//
// Чому це окремий модуль у чистому ядрі, а не рядок усередині ui/vessel-icon.ts:
// той модуль імпортує CSS, а юніт-раннер Playwright не має трансформу для `.css`
// (ERR_UNKNOWN_FILE_EXTENSION). Лишись рішення там — гілку `data-icon` не
// перевіряло б ніщо взагалі.

import { normalizeCourseDeg } from './vessel-format';

export type VesselIconState = {
  readonly kind: 'course' | 'neutral';
  /** Для 'neutral' завжди 0: коло не має переду, обертати його нема сенсу. */
  readonly rotationDeg: number;
};

export function vesselIconState(courseDeg: number | null): VesselIconState {
  if (courseDeg === null) {
    return { kind: 'neutral', rotationDeg: 0 };
  }

  // Той самий кут, що друкує `formatCourse`. Спільна нормалізація — єдине, що не
  // дає значку дивитися в 360°, поки картка пише "0°".
  return { kind: 'course', rotationDeg: normalizeCourseDeg(courseDeg) };
}
