// Forked from HumanizeDuration.js - https://git.io/j0HgmQ
// Made to be a lot less adaptive (we only need english, for example) and vendored.

type UnitName = "y" | "mo" | "w" | "d" | "h" | "m" | "s" | "ms";

type UnitWord = (count: number) => string;

interface Language {
  year: UnitWord;
  month: UnitWord;
  week: UnitWord;
  day: UnitWord;
  hour: UnitWord;
  minute: UnitWord;
  second: UnitWord;
  millisecond: UnitWord;
}

type UnitMeasures = Record<UnitName, number>;

interface Options {
  delimiter?: string;
  spacer?: string;
  round?: boolean;
  largest?: number;
  units?: UnitName[];
  conjunction?: string;
  maxDecimalPoints?: number;
  unitMeasures?: UnitMeasures;
  serialComma?: boolean;
}

type NormalizedOptions = Required<
  Pick<
    Options,
    | "spacer"
    | "conjunction"
    | "serialComma"
    | "units"
    | "round"
    | "unitMeasures"
  >
> &
  Options;

type Humanizer = ((ms: number, humanizerOptions?: Options) => string) &
  NormalizedOptions;

const UNIT_KEY: Record<UnitName, keyof Language> = {
  y: "year",
  mo: "month",
  w: "week",
  d: "day",
  h: "hour",
  m: "minute",
  s: "second",
  ms: "millisecond",
};

function pluralise(singular: string, plural: string): UnitWord {
  return (count) => (count === 1 ? singular : plural);
}

const LANGUAGE: Language = {
  year: pluralise("year", "years"),
  month: pluralise("month", "months"),
  week: pluralise("week", "weeks"),
  day: pluralise("day", "days"),
  hour: pluralise("hour", "hours"),
  minute: pluralise("minute", "minutes"),
  second: pluralise("second", "seconds"),
  millisecond: pluralise("millisecond", "milliseconds"),
};

interface Piece {
  unitName: UnitName;
  unitCount: number;
}

function renderPiece(
  piece: Piece,
  spacer: string,
  maxDecimalPoints?: number,
): string {
  const normalizedCount =
    maxDecimalPoints === undefined
      ? piece.unitCount
      : Math.floor(piece.unitCount * 10 ** maxDecimalPoints) /
        10 ** maxDecimalPoints;

  const word = LANGUAGE[UNIT_KEY[piece.unitName]](normalizedCount);
  return `${normalizedCount}${spacer}${word}`;
}

function getPieces(
  ms: number,
  options: Pick<
    NormalizedOptions,
    "units" | "unitMeasures" | "largest" | "round"
  >,
): Piece[] {
  const { units, unitMeasures } = options;
  const largest =
    typeof options.largest === "number" ? options.largest : Infinity;

  if (!units.length) return [];

  // Get the counts for each unit. Doesn't round or truncate anything.
  // e.g. `{ y: 7, mo: 6, w: 0, d: 5, h: 23.99 }`.
  const unitCounts: Partial<Record<UnitName, number>> = {};
  let msRemaining = ms;

  for (let i = 0; i < units.length; i++) {
    const unitName = units[i];
    if (!unitName) throw "no unit name found";

    const unitMs = unitMeasures[unitName];
    const isLast = i === units.length - 1;
    const unitCount = isLast
      ? msRemaining / unitMs
      : Math.floor(msRemaining / unitMs);
    unitCounts[unitName] = unitCount;
    msRemaining -= unitCount * unitMs;
  }

  if (options.round) {
    // Collapse everything past the `largest`-th non-zero unit into that unit.
    let unitsRemainingBeforeRound = largest;
    for (let i = 0; i < units.length; i++) {
      const unitName = units[i];
      if (!unitName) throw "no unit name found";

      const unitCount = unitCounts[unitName];
      if (unitCount === 0) continue;

      unitsRemainingBeforeRound--;
      if (unitsRemainingBeforeRound === 0) {
        for (let j = i + 1; j < units.length; j++) {
          const smallerUnitName = units[j];
          if (!smallerUnitName) throw "no smaller unit name found";
          const smallerUnitCount = unitCounts[smallerUnitName] ?? 0;
          unitCounts[unitName] =
            (unitCounts[unitName] ?? 0) +
            (smallerUnitCount * unitMeasures[smallerUnitName]) /
              unitMeasures[unitName];
          unitCounts[smallerUnitName] = 0;
        }
        break;
      }
    }

    // Round the last non-zero piece, carrying into larger units as needed.
    // e.g. "3 days, 23.99 hours" -> "4 days"; "6 days, 23.99 hours" -> "1 week".
    for (let i = units.length - 1; i >= 0; i--) {
      const unitName = units[i];
      if (!unitName) throw "no unit name found";
      const unitCount = unitCounts[unitName] ?? 0;
      if (unitCount === 0) continue;

      const rounded = Math.round(unitCount);
      unitCounts[unitName] = rounded;
      if (i === 0) break;

      const previousUnitName = units[i - 1];
      if (!previousUnitName) throw "no previous unit name found";
      const previousUnitMs = unitMeasures[previousUnitName];

      const carry = Math.floor(
        (rounded * unitMeasures[unitName]) / previousUnitMs,
      );
      if (carry) {
        unitCounts[previousUnitName] =
          (unitCounts[previousUnitName] ?? 0) + carry;
        unitCounts[unitName] = 0;
      } else {
        break;
      }
    }
  }

  const result: Piece[] = [];
  for (let i = 0; i < units.length && result.length < largest; i++) {
    const unitName = units[i];
    if (!unitName) throw "no unit name found";
    const unitCount = unitCounts[unitName] ?? 0;
    if (unitCount) result.push({ unitName, unitCount });
  }
  return result;
}

function formatPieces(
  pieces: Piece[],
  options: Pick<
    NormalizedOptions,
    | "units"
    | "delimiter"
    | "spacer"
    | "conjunction"
    | "maxDecimalPoints"
    | "serialComma"
  >,
): string {
  const { units, spacer, conjunction, serialComma, maxDecimalPoints } = options;
  const delimiter = options.delimiter ?? ", ";

  if (!pieces.length) {
    const smallestUnitName = units[units.length - 1];
    if (!smallestUnitName) throw "no smallest unit name found";
    return renderPiece(
      { unitName: smallestUnitName, unitCount: 0 },
      spacer,
      maxDecimalPoints,
    );
  }

  const rendered = pieces.map((p) => renderPiece(p, spacer, maxDecimalPoints));

  if (!conjunction || pieces.length === 1) {
    return rendered.join(delimiter);
  }
  if (pieces.length === 2) {
    return rendered.join(conjunction);
  }
  return (
    rendered.slice(0, -1).join(delimiter) +
    (serialComma ? "," : "") +
    conjunction +
    rendered.slice(-1)
  );
}

/**
 * Create a humanizer, which lets you change the default options.
 */
function humanizer(passedOptions: Options = {}): Humanizer {
  const result = ((ms: number, humanizerOptions?: Options): string => {
    // Make sure we have a positive number.
    ms = Math.abs(ms);

    const options: NormalizedOptions = { ...result, ...humanizerOptions };
    const pieces = getPieces(ms, options);
    return formatPieces(pieces, options);
  }) as Humanizer;

  return Object.assign(
    result,
    {
      spacer: " ",
      conjunction: "",
      serialComma: true,
      units: ["y", "mo", "w", "d", "h", "m", "s"] as UnitName[],
      round: false,
      unitMeasures: {
        y: 31557600000,
        mo: 2629800000,
        w: 604800000,
        d: 86400000,
        h: 3600000,
        m: 60000,
        s: 1000,
        ms: 1,
      },
    },
    passedOptions,
  );
}

const humanizeDuration = Object.assign(humanizer({}), { humanizer });
export default humanizeDuration;
