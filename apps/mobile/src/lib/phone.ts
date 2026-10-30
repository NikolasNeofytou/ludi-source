// Cyprus-only phone helpers. MVP launches in Larnaca with a fixed +357
// prefix in the UI, so we don't need a full international picker — when
// expansion to Athens / non-CY users opens up, swap this for a proper
// libphonenumber-based picker.

const CY_PREFIX = '+357';

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

export function isValidCyMobile(digits: string): boolean {
  // CY mobile numbers are 8 digits and conventionally start with 9. We
  // accept any 8-digit string here — the source of truth for "this is a
  // reachable phone" is the SMS provider, not us.
  return /^\d{8}$/.test(digits);
}

export function toE164Cy(digits: string): string {
  return `${CY_PREFIX}${digitsOnly(digits)}`;
}

export function formatCyForDisplay(digits: string): string {
  const d = digitsOnly(digits);
  if (d.length !== 8) return `${CY_PREFIX} ${d}`;
  // 9X XXX XXX
  return `${CY_PREFIX} ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}

export function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}
