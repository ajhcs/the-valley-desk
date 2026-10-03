import { parse, ErrorCodes } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

/** Bounded HTML5 document parsing. No execution, resource loading or template-content traversal. */
export type RegionalHtmlElement = { name: string; attributes: Record<string, string>; start: number; end: number; ancestors: string[] };
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export function regionalHtmlElements(body: string, selected: readonly string[] = ["a", "link"]) {
  if (new TextEncoder().encode(body).length > 524288) throw new Error("regional-html-too-large");
  const duplicates: number[] = [];
  const document = parse(body, { sourceCodeLocationInfo: true, scriptingEnabled: true,
    onParseError: error => { if (error.code === ErrorCodes.duplicateAttribute) duplicates.push(error.startOffset); } });
  duplicates.sort((a, b) => a - b);
  const duplicateIn = (start: number, end: number) => {
    let low = 0, high = duplicates.length;
    while (low < high) { const middle = (low + high) >>> 1; if (duplicates[middle] < start) low = middle + 1; else high = middle; }
    return low < duplicates.length && duplicates[low] <= end;
  };
  const result: RegionalHtmlElement[] = [];
  const pending: { node: DefaultTreeAdapterTypes.Node; ancestors: string[]; depth: number }[] = [{ node: document, ancestors: [], depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { node, ancestors, depth } = pending.pop()!;
    if (++visited > 50000 || depth > 256) throw new Error("regional-html-tree-too-complex");
    let parents = ancestors;
    if ("tagName" in node) {
      // Foreign SVG/MathML subtrees are outside the supported evidence vocabulary.
      if (node.namespaceURI !== HTML_NAMESPACE) continue;
      const attributes: Record<string, string> = Object.create(null);
      for (const attribute of node.attrs) if (!attribute.namespace && !attribute.prefix) attributes[attribute.name] = attribute.value;
      // Template content is a separate document fragment. HTML5 parsing handles self-closing
      // non-void tags, raw text, plaintext, namespace transitions and tree reconstruction.
      if (node.tagName === "template" || node.tagName === "noscript" || "hidden" in attributes || "inert" in attributes ||
          attributes["aria-hidden"]?.trim().toLowerCase() === "true" || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style ?? "")) continue;
      const location = node.sourceCodeLocation?.startTag;
      if (location && selected.includes(node.tagName) && !duplicateIn(location.startOffset, location.endOffset))
        result.push({ name: node.tagName, attributes, start: location.startOffset, end: location.endOffset, ancestors });
      parents = [...ancestors, node.tagName];
    }
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--)
      pending.push({ node: node.childNodes[i], ancestors: parents, depth: depth + 1 });
  }
  return result.sort((a, b) => a.start - b.start);
}
export function regionalQuoteContainsElement(body: string, quote: string, element: RegionalHtmlElement) {
  let position = body.indexOf(quote);
  while (position >= 0) { if (element.start >= position && element.end <= position + quote.length) return true;
    position = body.indexOf(quote, position + 1); }
  return false;
}
