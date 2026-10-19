/**
 * PII scrubbing for the DeepSeek clinical decision support pipeline (plan
 * decision D11, Phase 10.1).
 *
 * Only clinical variables may leave the server. Before any symptom text is
 * forwarded to the model, identifiers are replaced with bracketed placeholders
 * so the audit log and the upstream request carry no patient identity.
 */

/** Bracketed markers substituted for stripped values. */
export const PII_PLACEHOLDERS = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  id: "[ID]",
  address: "[ADDRESS]",
  name: "[NAME]",
} as const;

/**
 * Clinical and common sentence-leading words that must survive scrubbing.
 *
 * Masking a capitalised word that merely starts a sentence ("Malaria is…") would
 * strip real diagnostic signal, so these are never treated as names.
 */
const NON_NAME_WORDS = new Set(
  [
    // sentence starters and conjunctions
    "the", "a", "an", "and", "or", "but", "if", "when", "while", "after", "before",
    "because", "however", "also", "not", "no", "yes", "this", "that", "these",
    "those", "he", "she", "they", "we", "it", "his", "her", "their", "its", "i",
    // clinical headings and roles
    "patient", "patients", "doctor", "doctor's", "nurse", "history", "complaint",
    "complaints", "symptom", "symptoms", "diagnosis", "diagnostic", "reports",
    "report", "presents", "presenting", "clinical", "examination", "findings",
    "treatment", "medications", "medication", "allergies", "allergy", "vitals",
    "chief", "present", "illness", "notes", "note", "review", "assessed", "ward",
    // regionally common conditions that capitalise in prose
    "malaria", "typhoid", "cholera", "diabetes", "hypertension", "pneumonia",
    "anaemia", "anemia", "tuberculosis", "hepatitis", "meningitis", "covid",
    "fever", "headache", "vomiting", "diarrhoea", "diarrhea", "nausea", "cough",
    "fatigue", "dizziness", "seizure", "seizures", "stroke", "pregnancy",
    "sickle", "hiv", "aids", "asthma", "ulcer", "typhoid", "yellow", "west",
    "nile", "lassa", "ebola", "measles", "polio", "tetanus",
  ].map((word) => word.toLowerCase()),
);

/** Titles that reliably introduce a personal name. */
const NAME_TITLES =
  /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Alhaji|Alhaja|Chief|Engr|Barr|Sir)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;

/** Capitalised two-to-three word runs, the shape full names take. */
const CAPITALISED_RUN = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2})\b/g;

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** 11-19 digit runs: NIN, bank accounts, BVN. */
const LONG_DIGITS = /\b\d{11,19}\b/g;

/** Phone numbers in international or local grouped formats. */
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

/** Postal-style address lines. */
const ADDRESS =
  /\b\d{1,4}\s+[A-Za-z]{2,}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Close|Crescent|Boulevard|Way|Drive|Court)\b/gi;

function looksLikeName(candidate: string): boolean {
  const words = candidate.split(/\s+/);
  // Any clinical or sentence-leading word means this is prose, not a person.
  return !words.some((word) => NON_NAME_WORDS.has(word.toLowerCase()));
}

/**
 * Mask only the name-like words inside a capitalised run.

 * A leading clinical word must not shield the person's name that follows it:
 * "Patient Ada Obi" becomes "Patient [NAME]", while "West Nile" is left intact.
 */
function maskCapitalisedRun(run: string): string {
  const words = run.split(/\s+/);
  const out: string[] = [];
  let nameBuffer: string[] = [];

  const flush = () => {
    // A lone capitalised word is too ambiguous to mask (it is usually a
    // sentence opener or a drug name), so only runs of two or more become a name.
    if (nameBuffer.length >= 2) {
      out.push(PII_PLACEHOLDERS.name);
    } else {
      out.push(...nameBuffer);
    }
    nameBuffer = [];
  };

  for (const word of words) {
    if (NON_NAME_WORDS.has(word.toLowerCase())) {
      flush();
      out.push(word);
    } else {
      nameBuffer.push(word);
    }
  }
  flush();

  return out.join(" ");
}

/**
 * Remove direct identifiers from free text.
 *
 * Handles email addresses, phone numbers, national/bank identification numbers,
 * postal addresses and person names. Heuristic by nature: it reliably removes
 * the identifier shapes above, but it cannot infer intent, so output must still
 * be treated as confidential.
 */
export function scrubPII(input: string): string {
  if (!input) {
    return input;
  }

  let result = input;

  result = result.replace(EMAIL, PII_PLACEHOLDERS.email);
  result = result.replace(LONG_DIGITS, PII_PLACEHOLDERS.id);
  result = result.replace(PHONE, PII_PLACEHOLDERS.phone);
  result = result.replace(ADDRESS, PII_PLACEHOLDERS.address);
  result = result.replace(NAME_TITLES, (match, name: string) =>
    looksLikeName(name) ? PII_PLACEHOLDERS.name : match,
  );
  result = result.replace(CAPITALISED_RUN, (run) => maskCapitalisedRun(run));

  return result;
}

/** Scrub every string field in a payload, leaving structure intact. */
export function scrubPIIDeep<T>(value: T): T {
  if (typeof value === "string") {
    return scrubPII(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubPIIDeep(entry)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubPIIDeep(entry);
    }
    return out as unknown as T;
  }
  return value;
}
