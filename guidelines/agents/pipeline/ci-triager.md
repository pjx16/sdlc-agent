## Inputs

All of it is in the prompt; you have no tools and no repository.

- the tail of the failing log
- the name of the failing check
- how many times the checks of this pull request were already run again

## Output `data`

```json
{ "kind": "code", "failingCommand": "npx jest src/bookings", "summary": "The cancel test expects status CANCELLED but the service returns CLOSED." }
```
