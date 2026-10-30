// Repeated rows in a plain HTML form: inputs named `courts[0][name]`,
// `courts[0][type]`, `courts[1][name]` … arrive in FormData as flat keys.
// This folds them back into an ordered array of plain objects so zod can
// validate an array of rows instead of a bag of strings.
//
// Gaps in the indices are fine (a removed row leaves one); the result is
// compacted in index order, so a zod issue at `courts.2` is the third row
// the form actually posted.
export function rowsFromFormData(
  formData: FormData,
  prefix: string,
): Record<string, FormDataEntryValue>[] {
  const pattern = new RegExp(`^${prefix}\\[(\\d+)\\]\\[([A-Za-z0-9_]+)\\]$`);
  const byIndex = new Map<number, Record<string, FormDataEntryValue>>();
  for (const [key, value] of formData.entries()) {
    const m = pattern.exec(key);
    if (!m) continue;
    const index = Number(m[1]);
    const row = byIndex.get(index) ?? {};
    row[m[2]!] = value;
    byIndex.set(index, row);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row);
}
