export function GroupChip({
  children,
  kind,
}: {
  children: string;
  kind: string;
}) {
  return (
    <span className="GroupChip" data-kind={kind}>
      {children}
    </span>
  );
}
