## Inputs

- the facts code collected (default branch, languages)
- the repository, read-only, at `/workspace`

## Output `data`

```json
{ "stack": "nestjs", "installCmd": "npm ci", "typecheckCmd": "npx tsc --noEmit",
  "testCmdTemplate": "npx jest {files}", "kbDir": "docs/kb",
  "testFilePattern": "**/*.spec.ts", "exampleTestFile": "src/users/users.service.spec.ts" }
```

If you cannot continue without an answer, return `needs_input` with a `question`.
