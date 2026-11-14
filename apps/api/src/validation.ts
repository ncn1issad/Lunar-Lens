import type { HorizonQuery } from '@lunar-lense/contracts';

export class InvalidInputError extends Error {}

export function parseHorizonQuery(params: URLSearchParams): HorizonQuery {
  const keys = ['date', 'longitude', 'latitude'];
  if ([...params.keys()].some((key) => !keys.includes(key))
    || keys.some((key) => params.getAll(key).length !== 1)) {
    throw new InvalidInputError('Provide date, longitude and latitude exactly once, with no extra parameters.');
  }

  const date = params.get('date')!;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')
    || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new InvalidInputError('Use a valid Gregorian date in YYYY-MM-DD format.');
  }

  function coordinate(key: string, min: number, max: number) {
    const raw = params.get(key)!.trim();
    const value = Number(raw);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
      || !Number.isFinite(value) || value < min || value > max) {
      throw new InvalidInputError(`${key} must be a finite number between ${min} and ${max} degrees.`);
    }
    return value;
  }

  return { date, longitude: coordinate('longitude', -180, 360), latitude: coordinate('latitude', -90, 90) };
}
