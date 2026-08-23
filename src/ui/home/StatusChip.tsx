export function StatusChip({ children }: { children: string }) {
  return (
    <span className="StatusChip" data-status="review" data-queued="true">
      {children}
    </span>
  );
}
