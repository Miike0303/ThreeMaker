/** Strips a leading UTF-8 BOM (U+FEFF), which RPG Maker JSON files may carry. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
