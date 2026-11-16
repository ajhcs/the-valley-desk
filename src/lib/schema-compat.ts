import { z } from "zod";

// Genuine Zod 4 validation with the existing contract's UTC minute precision.
// Validators return Booleans so no accepted source string is rewritten.
const SecondsUtc = z.string().datetime();
const MinutesUtc = z.string().datetime({ precision: -1 });
export const acceptsLegacyUtcDatetime = (value: string) => SecondsUtc.safeParse(value).success || MinutesUtc.safeParse(value).success;
export function legacyUtcDatetime() {
  return z.string().refine(acceptsLegacyUtcDatetime, "Invalid datetime");
}
export const acceptsLegacyUrl = (value: string) => {
  try { new URL(value); return true; } catch { return false; }
};
export function legacyUrl() {
  return z.string().refine(acceptsLegacyUrl, "Invalid url");
}
// Existing offset-enabled contracts accept compact offsets as well as HH:MM.
// Preserve that syntax and raw bytes; this does not assert a real time-zone offset.
export const acceptsLegacyOffsetDatetime = (value: string) => {
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return false;
  return acceptsLegacyUtcDatetime(value.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "Z"));
};
export function legacyOffsetDatetime() {
  return z.string().refine(acceptsLegacyOffsetDatetime, "Invalid datetime");
}
