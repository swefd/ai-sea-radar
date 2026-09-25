// Збирач B-12: контракт. Джерело: docs/tasks/SPRINT-02.md:28, :92; план
// docs/superpowers/plans/2026-09-25-b11-b13-parallel.md, 0.5.
//
// У цьому коміті — ЛИШЕ типи. Тіло `collect` пише смуга B-12; до того модуль
// нічого не виконує, і жоден код його не викликає.

import type { Connect, ReadErrorCode, TimerId } from './transport';

/** Мінімум, який збирачу треба знати про елемент: ключ і час для «найновіша на id». */
export type Collectable = { readonly id: string; readonly timestamp: string };

export type CollectOptions<T extends Collectable> = {
  connect: Connect;
  apiKey: string;
  windowMs: number;
  limit: number;
  /**
   * Перетворювач — ПАРАМЕТР: shared/ не імпортує entities/. `null` — «не валідна
   * позиція», включно з SubscriptionConfirmation; збирач такі мовчки пропускає.
   */
  toItem: (raw: unknown) => T | null;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => TimerId;
  clearTimer: (id: TimerId) => void;
  signal?: AbortSignal;
};

export type CollectResult<T> =
  | { kind: 'done'; items: T[]; reason: 'window_elapsed' | 'limit_reached'; finishedAt: number }
  | { kind: 'error'; code: ReadErrorCode; finishedAt: number };
