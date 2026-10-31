/**
 * Spoken text for the one fixed voice. Same calm pacing as Corporate Tambola: "Next number is <letter>, <digits>, <words>. <letter>, <words>."
 *   52 (G) -> "Next number is Gee, five two, fifty-two. Gee, fifty-two."
 *    7 (B) -> "Next number is Bee, seven. Bee, seven."   (single digits are not spelled out digit by digit)
 * The browser's own speech voice is used (no audio files ship with the app).
 */
import { MAX_NUMBER, columnOf } from "./bingo-card";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** The letters as a speech voice reads them best. */
export const LETTER_WORDS = ["Bee", "Eye", "En", "Gee", "Oh"] as const;

export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) throw new RangeError(`number must be 1..${MAX_NUMBER}`);
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10), o = n % 10;
  return o === 0 ? TENS[t]! : `${TENS[t]}-${ONES[o]}`;
}

export const numberDigits = (n: number): string => String(n).split("").map((d) => ONES[Number(d)]).join(" ");

export function spokenPhrase(n: number): string {
  const w = numberWords(n), l = LETTER_WORDS[columnOf(n)]!;
  if (n < 10) return `Next number is ${l}, ${w}. ${l}, ${w}.`;
  return `Next number is ${l}, ${numberDigits(n)}, ${w}. ${l}, ${w}.`;
}

/** Version of the voice wording; bump when it changes so devices that cached a voice line refresh it. */
export const AUDIO_PACK_VERSION = "v2-en-in-speech";
