## Inputs

All of it is in the facts below; you have no tools and no repository.

- the Jira project's issue types, which one is the sub-task type, and the statuses of each type with their category
- the labels already in use on recent issues
- the Confluence spaces the person can write to (or why there are none)

## Output `data`

```json
{ "statusMap": { "KB": "In Progress", "DONE": "Done" },
  "approvalStatuses": { "plan": "Plan Approved", "breakdown": null },
  "issueTypeRouting": { "Story": "feature", "Bug": "bug", "Epic": "ignore", "Sub-task": "ignore" },
  "intakeLabel": "sdlc-agent", "confluenceSpaceKey": "ENG" }
```

If you cannot continue without an answer, return `needs_input` with a `question`.
