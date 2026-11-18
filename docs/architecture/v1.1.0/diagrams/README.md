# Diagrams, version 1.1.0

Hand-written SVG diagrams used by [`../README.md`](../README.md) and the root [`README.md`](../../../../README.md).

| File | Shows |
| --- | --- |
| [`system.svg`](./system.svg) | Services, the worker, throwaway containers, the proxy, the outside services and the optional token broker, with trust boundaries |
| [`lifecycle.svg`](./lifecycle.svg) | A ticket from arrival to merge, the two human gates (plan and merge), the automatic breakdown, and the hold state with its self-recovery |

Each file carries its own styles and follows the viewer's light or dark setting, so edit the shapes and text in place. Colors: amber is a person, teal is AI work, red is a container that holds no GitHub or Jira key. When a diagram changes, add a line to the change log in [`../../README.md`](../../README.md#architecture-change-log).
