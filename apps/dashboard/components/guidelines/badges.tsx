/** The model an agent uses unless the project says otherwise. */
export function ModelBadge({ model }: { model: string }) {
  return <span className="rounded border border-border px-1.5 py-0.5 text-xs font-normal text-muted">{model}</span>;
}

/** The text differs from the one that shipped. */
export function CustomisedBadge() {
  return <span className="rounded border border-accent px-1.5 py-0.5 text-xs font-normal text-accent">Customised</span>;
}
