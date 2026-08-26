import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { catalog } from "../../lib/catalog";
import { entities } from "../../lib/entities";
import { formatDate } from "../../lib/format";
import { itemHref } from "../../lib/kind";
import { MentionText } from "../MentionText";
import { LabFilterGroup } from "./LabFilters";
import { LabShell } from "./LabShell";
import {
  filterSystems,
  systemCards,
  systemFilterOptions,
  topicLabel,
  type SystemFilter,
} from "./lab";

export function LabSystemsPage() {
  const [filter, setFilter] = useState<SystemFilter>("all");
  const [openId, setOpenId] = useState<string | undefined>();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cards = useMemo(() => filterSystems(systemCards(catalog, entities), filter), [filter]);
  const moved = cards
    .filter((card) => card.latest)
    .sort((a, b) => (b.latest?.publishedAt ?? b.latest?.updatedAt ?? "").localeCompare(a.latest?.publishedAt ?? a.latest?.updatedAt ?? ""))
    .slice(0, 3);

  function onGridKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!cards.length) return;
    const cols = window.matchMedia("(min-width: 1100px)").matches ? 3 : window.matchMedia("(min-width: 720px)").matches ? 2 : 1;
    let next = index;
    if (event.key === "ArrowRight") next = Math.min(cards.length - 1, index + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowDown") next = Math.min(cards.length - 1, index + cols);
    else if (event.key === "ArrowUp") next = Math.max(0, index - cols);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = cards.length - 1;
    else return;
    event.preventDefault();
    buttonRefs.current[next]?.focus();
  }

  return (
    <LabShell title="Health-system command grid" kicker="What moved">
      <p className="LabLead">
        One card per live seed system. Items attach through org ids and parents. No /org pages.
      </p>
      <LabFilterGroup
        label="System filters"
        value={filter}
        options={systemFilterOptions()}
        onChange={(id) => {
          setFilter(id);
          setOpenId(undefined);
        }}
      />
      {moved.length ? (
        <ol className="LabMoved" aria-label="Most recent system movement">
          {moved.map((card, index) => (
            <li key={card.entity.id} style={{ ["--i" as string]: index }}>
              <p>
                {index + 1}. {card.entity.name}
              </p>
              {card.latest ? (
                <Link to={itemHref(card.latest)}>
                  <MentionText text={card.latest.title} />
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div
        className="LabGrid"
        aria-label="Health systems"
      >
        {cards.length === 0 ? (
          <p className="LabEmpty">No systems in this filter.</p>
        ) : (
          cards.map((card, index) => {
            const open = openId === card.entity.id;
            return (
              <article
                key={card.entity.id}
                className={open ? "LabSystem is-open" : "LabSystem"}
                style={{ ["--i" as string]: index }}
              >
                <button
                  type="button"
                  className="LabSystem-hit"
                  aria-expanded={open}
                  aria-controls={`lab-system-panel-${card.entity.id}`}
                  ref={(node) => {
                    buttonRefs.current[index] = node;
                  }}
                  onKeyDown={(event) => onGridKey(event, index)}
                  onClick={() => setOpenId(open ? undefined : card.entity.id)}
                >
                  <span className="LabSystem-name">{card.entity.name}</span>
                  <span className="LabSystem-meta">
                    {card.region} · {card.hospitals} hospitals in box
                    {card.items.length ? ` · ${card.items.length} published` : " · no published movement"}
                  </span>
                </button>
                {card.facts[0] ? (
                  <p className="LabFact">
                    {card.facts[0].painted}
                    {" · "}
                    <a href={card.facts[0].citation.url} target="_blank" rel="noopener noreferrer">
                      {card.facts[0].citation.name}
                    </a>
                  </p>
                ) : null}
                {card.latest ? (
                  <p className="LabSystem-latest">
                    <span className="LabTag">{topicLabel(card.latest)}</span>
                    <Link to={itemHref(card.latest)}>
                      <MentionText text={card.latest.title} />
                    </Link>
                    <time dateTime={card.latest.publishedAt}>{formatDate(card.latest.publishedAt)}</time>
                  </p>
                ) : (
                  <p className="LabEmpty">No published movement.</p>
                )}
                <ul id={`lab-system-panel-${card.entity.id}`} className="LabMini" hidden={!open}>
                    {card.items.filter((item) => item.id !== card.latest?.id).slice(0, 7).map((item) => (
                      <li key={item.id}>
                        <Link to={itemHref(item)}>
                          <MentionText text={item.title} />
                        </Link>
                        <span>{formatDate(item.publishedAt)}</span>
                      </li>
                    ))}
                  </ul>
              </article>
            );
          })
        )}
      </div>
    </LabShell>
  );
}
