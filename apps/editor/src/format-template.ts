/**
 * Substitutes `{name}` placeholders in a translated string. `i18n.ts`'s
 * `t()` has no templating of its own (see apps/desktop/src/i18n.ts, copied
 * verbatim) -- this is a small separate pure helper, not a change to that
 * shared module.
 */
export function formatTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
