export interface Fps {
  num: number;
  den: number;
  value: number;
  str: string;
}

export function parseRate(str: string): { num: number; den?: number } | null {
  const [num, den] = str.split('/').map(Number);
  return Number.isFinite(num) ? { num, den } : null;
}

export function parseFpsRate(str?: string): Fps | null {
  const rate = str ? parseRate(str) : null;
  if (!rate || !Number.isFinite(rate.den) || rate.den === 0 || rate.num === 0) {
    return null;
  }
  const { num } = rate;
  const den = rate.den as number;
  return {
    num,
    den,
    value: num / den,
    str: den === 1 ? String(num) : `${num}/${den}`,
  };
}

export function formatFps(rate: string): string {
  const ratio = /^(\d+)\/(\d+)$/.exec(rate);
  const num = ratio ? Number(ratio[1]) : Number(rate);
  const den = ratio ? Number(ratio[2]) : 1;
  if (!(num > 0) || !(den > 0)) return rate;
  return `${Math.round((num / den) * 100) / 100} fps`;
}

export function timeAt(frame: number, fps: number): number {
  return fps > 0 ? frame / fps : 0;
}

export function framesForSeconds(fps: number, seconds: number): number {
  return Math.round(fps * seconds);
}
