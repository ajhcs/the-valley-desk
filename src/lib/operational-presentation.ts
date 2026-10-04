/** An open incident needs another independent healthy observation to resolve. */
export function operationalConditionLabel(condition: string | null | undefined, state = "open") {
  return condition === "healthy" && state === "open" ? "recovery pending" : condition ?? state;
}
