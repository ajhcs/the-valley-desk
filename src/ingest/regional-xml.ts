import { XMLParser } from "fast-xml-parser";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
export type RegionalXmlElement = {
  name: string; namespace: string; attributes: { name: string; namespace: string; value: string }[];
  children: RegionalXmlElement[]; text: string;
};
/** Preserve expanded XML names; prefixes alone carry no vocabulary authority. */
export function regionalXmlDocument(body: string) {
  const ordered: unknown = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_",
    removeNSPrefix: false, parseTagValue: false, parseAttributeValue: false, processEntities: true, trimValues: false }).parse(body);
  let nodes = 0;
  const decode = (rows: unknown, inherited: ReadonlyMap<string, string>, depth: number): RegionalXmlElement[] => {
    if (!Array.isArray(rows) || depth > 128) throw new Error("regional-xml-tree-too-complex");
    const result: RegionalXmlElement[] = [];
    for (const raw of rows) {
      if (++nodes > 50000 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("regional-xml-tree-too-complex");
      const row = raw as Record<string, unknown>;
      const names = Object.keys(row).filter(name => name !== ":@" && name !== "#text" && !name.startsWith("?"));
      if (!names.length) continue;
      if (names.length !== 1) throw new Error("regional-xml-ambiguous-element");
      const attributes = (row[":@"] ?? {}) as Record<string, unknown>, scope = new Map(inherited);
      for (const [key, value] of Object.entries(attributes)) {
        const qualified = key.slice(2);
        if (qualified === "xmlns" || qualified.startsWith("xmlns:")) {
          const prefix = qualified === "xmlns" ? "" : qualified.slice(6), uri = String(value);
          if (prefix === "xmlns" || uri === XMLNS_NAMESPACE || (prefix === "xml") !== (uri === XML_NAMESPACE) || (prefix && !uri))
            throw new Error("regional-xml-invalid-namespace");
          scope.set(prefix, uri);
        }
      }
      const expanded = (qualified: string, attribute = false) => {
        const parts = qualified.split(":"); if (parts.length > 2 || parts.some(part => !part)) throw new Error("regional-xml-invalid-name");
        const [prefix, name] = parts.length === 2 ? parts : ["", parts[0]];
        const namespace = prefix ? scope.get(prefix) : attribute ? "" : scope.get("") ?? "";
        if (namespace === undefined || prefix === "xmlns") throw new Error("regional-xml-unbound-prefix");
        return { name, namespace };
      };
      const childRows = row[names[0]];
      if (!Array.isArray(childRows)) throw new Error("regional-xml-invalid-element");
      const resolvedAttributes = Object.entries(attributes).filter(([key]) => key !== "@_xmlns" && !key.startsWith("@_xmlns:")).map(([key, value]) => ({ ...expanded(key.slice(2), true), value: String(value) }));
      const unique = new Set(resolvedAttributes.map(value => value.namespace + "\u0000" + value.name));
      if (unique.size !== resolvedAttributes.length) throw new Error("regional-xml-duplicate-expanded-attribute");
      const element = { ...expanded(names[0]), attributes: resolvedAttributes, children: decode(childRows, scope, depth + 1),
        text: childRows.map(child => child && typeof child === "object" && "#text" in child ? String(child["#text"]) : "").join("") };
      result.push(element);
    }
    return result;
  };
  return decode(ordered, new Map([["xml", XML_NAMESPACE]]), 0);
}
export const xmlAttribute = (element: RegionalXmlElement, name: string, namespace = "") =>
  element.attributes.find(attribute => attribute.name === name && attribute.namespace === namespace)?.value;
