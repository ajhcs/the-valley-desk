export function StatusChip({
  children,
  kind,
  queued,
  ann,
}: {
  children: string;
  kind?: string;
  queued?: boolean;
  ann?: "ask" | "spill";
}) {
  return (
    <span
      className="StatusChip"
      data-kind={kind}
      data-status={queued ? "review" : undefined}
      data-queued={queued ? "true" : undefined}
      data-ann={ann}
    >
      {children}
    </span>
  );
}
