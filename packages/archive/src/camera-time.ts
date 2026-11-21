const ISO_ZONED_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;

function validCalendarDay(day: string): boolean {
  const epoch = Date.parse(day);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === day;
}

export function zonedTimeMs(time: string): number {
  const day = ISO_ZONED_TIME.exec(time)?.[1];
  return day && validCalendarDay(day) ? Date.parse(time) : NaN;
}

export function parseDateBound(time: string): number {
  const epoch = ISO_DAY.test(time) && validCalendarDay(time) ? Date.parse(time) : zonedTimeMs(time);
  if (!Number.isFinite(epoch)) throw new Error('expected an ISO date or timestamp with a time zone');
  return epoch;
}
