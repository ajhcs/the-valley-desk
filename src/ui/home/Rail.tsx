import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { formatDate } from "../../lib/format";
import { chipKind, kindChip, itemHref } from "../../lib/kind";
import { eventRegisterUrl } from "../../lib/register";
import { DateChip } from "./DateChip";
import { GroupChip } from "./GroupChip";
import { MentionText } from "../MentionText";
import { RegisterLink } from "../RegisterLink";
import { ItemJsonLd } from "../ItemJsonLd";

export function Rail({
  label,
  rail,
  items,
  pinId,
}: {
  label: string;
  rail: "news" | "events" | "voices";
  items: ContentItem[];
  pinId?: string;
}) {
  return (
    <section className="Rail" data-rail={rail}>
      <h2>{label}</h2>
      <ul>
        {items.map((item) => {
          const registerHref = rail === "events" ? eventRegisterUrl(item) : undefined;
          const pinned = Boolean(pinId && item.id === pinId);
          return (
            <li
              key={item.id}
              className={registerHref ? "RailRow is-register" : "RailRow"}
            >
              <ItemJsonLd item={item} />
              {rail === "events" ? (
                <>
                  <div className="RailRow-when">
                    {pinned ? <span className="DateChip">PIN</span> : null}
                    <DateChip item={item} />
                  </div>
                  <Link to={itemHref(item)}>
                    <MentionText text={item.title} />
                  </Link>
                  {registerHref ? <RegisterLink item={item} /> : null}
                </>
              ) : (
                <>
                  <div className="RailRow-top">
                    <GroupChip kind={chipKind(item)}>{kindChip(item)}</GroupChip>
                    {item.publishedAt ? (
                      <time className="RailRow-date" dateTime={item.publishedAt}>
                        {formatDate(item.publishedAt)}
                      </time>
                    ) : null}
                  </div>
                  <Link to={itemHref(item)}>
                    <MentionText text={item.title} />
                  </Link>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
