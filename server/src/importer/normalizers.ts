// Pure normalizer functions — no DB or I/O dependencies. Used by both staff and shift parsers.

type Profession = "doctor" | "nurse" | "receptionist";

// Maps all known aliases/variations to canonical profession names.
// Every entry must be lowercase (inputs are lowercased before lookup).
const PROFESSION_MAP: Record<string, Profession> = {
  doctor: "doctor",
  physician: "doctor",
  md: "doctor",
  nurse: "nurse",
  rn: "nurse",
  "registered nurse": "nurse",
  receptionist: "receptionist",
  reception: "receptionist",
  "recep.": "receptionist",
};

/**
 * Normalizes free-form profession strings to one of three canonical values.
 * Returns null if the profession is not recognized — callers must reject those rows.
 */
export function normalizeProfession(raw: string): Profession | null {
  const cleaned = raw.trim().toLowerCase();
  return PROFESSION_MAP[cleaned] ?? null;
}

// Basic email validation — intentionally simple (RFC-compliant regex is overkill here).
// Catches obvious issues like "(at)" substitutions and missing @ signs.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Detects placeholder/junk names that should not be imported.
 * Catches patterns like "J. Placeholder", "Test User", "TBD", etc.
 */
const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /^test\s/i,
  /^tbd$/i,
  /^n\/?a$/i,
  /^unknown$/i,
];

export function isPlaceholderName(name: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(name.trim()));
}

/**
 * Normalizes a full name: trims whitespace, collapses internal spaces,
 * and applies title case. Does not reject names — callers handle that.
 */
export function normalizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parses date strings in three supported formats, applying separator-based disambiguation:
 *   - YYYY-MM-DD (ISO): unambiguous, parsed directly
 *   - DD/MM/YYYY (slash separator → European convention)
 *   - MM-DD-YYYY (dash separator, non-ISO → US convention)
 *
 * Returns ISO date string (YYYY-MM-DD) or null if the date is invalid or unparseable.
 */
export function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let year: number, month: number, day: number;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // ISO format: YYYY-MM-DD
    const parts = trimmed.split("-").map(Number);
    [year, month, day] = parts as [number, number, number];
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    // Slash format → DD/MM/YYYY (European convention)
    const parts = trimmed.split("/").map(Number);
    [day, month, year] = parts as [number, number, number];
  } else if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    // Dash non-ISO → MM-DD-YYYY (US convention)
    const parts = trimmed.split("-").map(Number);
    [month, day, year] = parts as [number, number, number];
  } else {
    return null;
  }

  // Validate the parsed date actually exists on the Gregorian calendar.
  // Using Date constructor and checking if it round-trips correctly.
  const dateObj = new Date(year, month - 1, day);
  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== month - 1 ||
    dateObj.getDate() !== day
  ) {
    return null;
  }

  // Return ISO string
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Parses time strings in HH:MM format. Returns null for malformed values.
 * Explicitly rejects non-standard formats like "10:00+1".
 */
export function parseTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return null;
  }

  const [hours, minutes] = trimmed.split(":").map(Number) as [number, number];
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Determines if a shift is overnight based on start/end times.
 * An overnight shift is one where end_time <= start_time (crosses midnight).
 * Equal times are NOT treated as overnight — they're treated as invalid (zero-duration).
 */
export function isOvernightShift(startTime: string, endTime: string): boolean {
  return endTime < startTime;
}

/**
 * Parses the shift requirements field. Supports two formats:
 * 1. Structured: "nurses=2;doctors=1;receptionists=0"
 * 2. Free text best-effort: "two nurses and a doctor"
 *
 * Returns null if the field cannot be parsed at all.
 * Missing roles default to 0.
 */
export function parseRequirements(
  raw: string
): { doctors: number; nurses: number; receptionists: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try structured format first: key=value pairs separated by semicolons
  if (/\w+=\d+/.test(trimmed)) {
    return parseStructuredRequirements(trimmed);
  }

  // Fall back to free-text parsing
  return parseFreeTextRequirements(trimmed);
}

function parseStructuredRequirements(
  raw: string
): { doctors: number; nurses: number; receptionists: number } {
  const result = { doctors: 0, nurses: 0, receptionists: 0 };
  const pairs = raw.split(";").map((s) => s.trim()).filter(Boolean);

  for (const pair of pairs) {
    const [key, value] = pair.split("=").map((s) => s.trim());
    const num = parseInt(value ?? "", 10);
    if (isNaN(num) || num < 0) continue;

    const normalizedKey = key?.toLowerCase();
    if (normalizedKey === "doctors") result.doctors = num;
    else if (normalizedKey === "nurses") result.nurses = num;
    else if (normalizedKey === "receptionists") result.receptionists = num;
  }

  return result;
}

// Maps English number words to digits for free-text requirements parsing.
const WORD_TO_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * Best-effort parser for free-text requirements like "two nurses and a doctor".
 * Scans for number-word + profession-word patterns.
 */
function parseFreeTextRequirements(
  raw: string
): { doctors: number; nurses: number; receptionists: number } | null {
  const lower = raw.toLowerCase();
  const result = { doctors: 0, nurses: 0, receptionists: 0 };
  let matched = false;

  // Pattern: (number_word|digit) followed by (profession_word)
  const regex =
    /(\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b)\s+(doctors?|nurses?|receptionists?|physicians?|rn|md)/gi;

  let match;
  while ((match = regex.exec(lower)) !== null) {
    const numStr = match[1]!.toLowerCase();
    const profStr = match[2]!.toLowerCase();

    const num = WORD_TO_NUM[numStr] ?? parseInt(numStr, 10);
    if (isNaN(num)) continue;

    if (/^doctor|^physician|^md/.test(profStr)) {
      result.doctors = num;
      matched = true;
    } else if (/^nurse|^rn/.test(profStr)) {
      result.nurses = num;
      matched = true;
    } else if (/^receptionist/.test(profStr)) {
      result.receptionists = num;
      matched = true;
    }
  }

  return matched ? result : null;
}
