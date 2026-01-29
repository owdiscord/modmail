export function convertDelayStringToMS(str: string): number | null {
  const units = {
    w: 7 * 24 * 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
    s: 1000,
  } as const;

  type Unit = keyof typeof units;

  const matches = str.trim().matchAll(/(\d+)([wdhms])?/gi);
  let totalMs = 0;
  let hasMatch = false;

  for (const match of matches) {
    const valueStr = match[1];
    const unitStr = match[2];

    if (!valueStr) continue;

    const value = parseInt(valueStr, 10);
    const unit = (unitStr?.toLowerCase() || "m") as Unit;

    totalMs += value * units[unit];
    hasMatch = true;
  }

  return hasMatch && totalMs > 0 ? totalMs : null;
}

export async function getDelayFromArgs(
  opts: Array<string>,
): Promise<number | null> {
  const delayStringRegex = /^(?:\d+[wdhms]?)+$/i;
  const delayStringArg = opts.find((arg) => delayStringRegex.test(arg));

  if (!delayStringArg) return null;

  const delay = convertDelayStringToMS(delayStringArg);
  if (delay === 0 || delay === null) {
    throw "Invalid delay specififed. Format should match a single-number (minutes), or {x}d{x}h{x}m{h}s, with each being optional.";
  }

  return delay;
}
