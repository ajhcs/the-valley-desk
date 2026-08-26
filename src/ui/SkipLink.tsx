import type { MouseEvent } from "react";

function focusSkipTarget(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: false });
}

/** Moves real focus to the skip target. href remains for no-JS. */
export function SkipLink({
  href,
  className,
  children,
}: {
  href: `#${string}`;
  className: string;
  children: string;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const id = href.slice(1);
    if (!document.getElementById(id)) return;
    event.preventDefault();
    focusSkipTarget(id);
  }
  return (
    <a className={className} href={href} onClick={onClick}>
      {children}
    </a>
  );
}
