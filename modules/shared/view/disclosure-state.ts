/** A reading choice, independent of the DOM that happens to display it. */
export interface DisclosureBinding {
  readonly key: string;
  read(): boolean;
  write(expanded: boolean): void;
}

/** Module-local state. Capture synchronously before replacing the old content. */
export class DisclosureState {
  readonly #snapshots = new Map<string, Map<string, boolean>>();
  #current: { scope: string; bindings: readonly DisclosureBinding[] } | undefined;

  capture(): void {
    if (!this.#current) return;
    const { scope, bindings } = this.#current;
    this.#snapshots.set(scope, new Map(uniqueBindings(bindings).map(binding => [binding.key, binding.read()])));
    this.#current = undefined;
  }

  restore(scope: string, bindings: readonly DisclosureBinding[]): void {
    const snapshot = this.#snapshots.get(scope);
    for (const binding of uniqueBindings(bindings)) {
      const expanded = snapshot?.get(binding.key);
      if (expanded !== undefined) binding.write(expanded);
    }
    this.#current = { scope, bindings };
  }
}

function uniqueBindings(bindings: readonly DisclosureBinding[]): DisclosureBinding[] {
  const counts = new Map<string, number>();
  for (const { key } of bindings) counts.set(key, (counts.get(key) ?? 0) + 1);
  // Ambiguous nodes retain their defaults instead of borrowing another node's choice.
  return bindings.filter(binding => counts.get(binding.key) === 1);
}

export function nativeDisclosure(node: HTMLDetailsElement, key: string): DisclosureBinding {
  return { key, read: () => node.open, write: expanded => { node.open = expanded; } };
}

export function classDisclosure(node: HTMLElement, key: string, className = "open"): DisclosureBinding {
  return {
    key,
    read: () => node.classList.contains(className),
    write: expanded => { node.classList.toggle(className, expanded); }
  };
}
