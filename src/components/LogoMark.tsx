/** Mark B Column. Locked mark — a column, not a letterform. */
export function LogoMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-7 shrink-0 items-stretch justify-center bg-paper"
    >
      <span className="w-2.5 bg-ink" />
    </span>
  )
}
