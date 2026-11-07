// Lengths are stored internally in centimetres. These helpers convert to/from what the user types and sees.

export type Units = 'cm' | 'm' | 'ftin';

export const UNIT_LABELS: Record<Units, string> = {
  cm: 'Centimetres (cm)',
  m: 'Metres (m)',
  ftin: "Feet & inches (ft' in\")",
};

const trim = (n: number, digits: number) => String(parseFloat(n.toFixed(digits)));

export function formatLength(cm: number, units: Units, withUnit = true): string {
  if (!Number.isFinite(cm)) return '';
  if (units === 'cm') return trim(cm, 1) + (withUnit ? ' cm' : '');
  if (units === 'm') return (cm / 100).toFixed(2) + (withUnit ? ' m' : '');
  const totalIn = Math.round((Math.abs(cm) / 2.54) * 4) / 4; // nearest 1/4"
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  const s = ft > 0 ? `${ft}' ${trim(inch, 2)}"` : `${trim(inch, 2)}"`;
  return (cm < 0 ? '-' : '') + s;
}

export function formatDims(w: number, d: number, units: Units): string {
  if (units === 'ftin') return `${formatLength(w, units)} x ${formatLength(d, units)}`;
  return `${formatLength(w, units, false)} x ${formatLength(d, units)}`;
}

const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const FEET = "(?:'|ft|feet|foot)";
const INCH = '(?:"|\'\'|in|inch|inches)';

/**
 * Parse a length typed by the user. Accepts "1.5 m", "150cm", "1500 mm", "150" (in the current
 * unit; bare numbers are inches when using feet & inches), "5'6\"", "5 ft 6 in", "66in".
 * Returns centimetres, or null if it can't be understood.
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');
  if (!s) return null;

  const ftIn = s.match(new RegExp(`^${NUM}\\s*${FEET}\\s*(?:${NUM}\\s*${INCH}?)?$`));
  if (ftIn) return (parseFloat(ftIn[1]) * 12 + parseFloat(ftIn[2] ?? '0')) * 2.54;

  const inOnly = s.match(new RegExp(`^${NUM}\\s*${INCH}$`));
  if (inOnly) return parseFloat(inOnly[1]) * 2.54;

  const metric = s.match(new RegExp(`^${NUM}\\s*(mm|cm|m)?$`));
  if (!metric) return null;
  const v = parseFloat(metric[1]);
  const unit = metric[2] ?? (units === 'ftin' ? 'in' : units);
  switch (unit) {
    case 'mm':
      return v / 10;
    case 'cm':
      return v;
    case 'm':
      return v * 100;
    case 'in':
      return v * 2.54;
  }
  return null;
}

export function unitHint(units: Units): string {
  return units === 'ftin' ? `e.g. 5' 6" or 66in` : units === 'm' ? 'e.g. 1.5 m or 150 cm' : 'e.g. 150 or 1.5 m';
}
