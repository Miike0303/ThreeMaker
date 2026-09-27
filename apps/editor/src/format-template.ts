/**
 * Substitutes `{name}` placeholders in a translated string. `i18n.ts`'s
 * `t()` has no templating of its own (see apps/desktop/src/i18n.ts, copied
 * verbatim) -- this is a small separate pure helper, not a change to that
 * shared module.
 *
 * One pass with a replacement callback, so values are inserted literally:
 * `$&`/`$$` patterns stay as typed, and a value that itself contains
 * `{other}` is never substituted again. Unknown placeholders are left as-is.
 */
export function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}
