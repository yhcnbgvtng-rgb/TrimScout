import type { DealStructureMethod, PaymentMethod } from "./types";

export const DEAL_STRUCTURE_METHODS: readonly DealStructureMethod[] = ["cash", "finance", "lease"];

export const DEAL_STRUCTURE_LABELS: Record<DealStructureMethod, string> = {
  cash: "Cash",
  finance: "Finance",
  lease: "Lease",
};

/** Stable Cash → Finance → Lease order, joined as "Cash + Finance". */
export function formatDealStructures(methods: readonly DealStructureMethod[]): string {
  return DEAL_STRUCTURE_METHODS.filter((method) => methods.includes(method))
    .map((method) => DEAL_STRUCTURE_LABELS[method])
    .join(" + ");
}

export function toggleDealStructure(
  current: readonly DealStructureMethod[],
  id: DealStructureMethod
): DealStructureMethod[] {
  const selected = new Set(current);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return DEAL_STRUCTURE_METHODS.filter((method) => selected.has(method));
}

/** Legacy single-value column; the checked set lives on requestedStructures. */
export function paymentMethodFromStructures(
  methods: readonly DealStructureMethod[]
): PaymentMethod {
  return methods[0] ?? "cash";
}
