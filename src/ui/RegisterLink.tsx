import type { ContentItem } from "../content/schema";
import { eventRegisterUrl } from "../lib/register";

export function RegisterLink({ item }: { item: ContentItem }) {
  const href = eventRegisterUrl(item);
  if (!href) return null;
  return (
    <a className="Register" href={href} target="_blank" rel="noopener noreferrer">
      Register
    </a>
  );
}
