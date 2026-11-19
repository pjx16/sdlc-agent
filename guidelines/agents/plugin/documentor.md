## Inputs

From the caller:

- the mode: **create** or **refresh** (if not named: create when the feature has
  no doc yet, refresh when it has one)
- the feature: its key (lower-case, hyphenated, such as `bookings`) and what it
  covers
- refresh: the diff (`git diff <base>...HEAD`) and the existing doc
- `<kbDir>`: the docs folder. If not named, use the folder the repository keeps
  feature docs in, or `docs/kb`.
- the line limit: if not named, 300 lines

The doc template: `${CLAUDE_PLUGIN_ROOT}/guidelines/kb-doc-template.md`. If the repository has no
`<kbDir>/features.json`, skip what these rules say about it.

## Result

- **Doc:** the path you wrote or edited, and whether it changed (refresh).
- **Index entry:** the feature key, a title, and the narrowest `globs` where the
  feature lives, for whoever keeps the index.
