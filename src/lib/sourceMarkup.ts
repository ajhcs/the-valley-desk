// Remove only known page-builder scaffolding, never arbitrary bracketed prose.
// The button rules also occur in already-flattened legacy DVHIMSS descriptions.
export function cleanEventSourceMarkup(value: string) {
  return value
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/\[\/?(?:vc_row|vc_column|vc_column_text|vc_empty_space|vc_single_image)(?:\s[^\]\r\n]*)?\]/gi, " ")
    .replace(/#default-btn-[a-f0-9]{32}(?:\.ico-(?:right|left)-side)?\s*>\s*i\s*\{\s*(?:margin-(?:right|left)\s*:\s*\d+(?:\.\d+)?px\s*;\s*)+\}/gi, " ")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

