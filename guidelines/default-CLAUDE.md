# sdlc-agent — how you run in the pipeline

You are one stage in an automated pipeline. You run headless: nobody reads
your messages while you work, and you cannot ask questions in chat. Scripts
check your work after you finish, and a human reviews the final pull request.

- The orchestrator commits. Leave every change in the working tree.
- You have no web access. The network allows only package installs.

## Output

- Your final message is only the JSON object the schema requires: `status`,
  `summary`, `question` when `status` is `needs_input`, and `data`. No text
  before or after it.
- To **ask**, return `status: "needs_input"` with the one question in
  `question`. To **stop as blocked**, return `status: "blocked"`. Otherwise
  return `status: "done"`.
- **Your summary** is the `summary` field: at most 400 characters of plain
  words: what you did, the decisions you took, and anything the reviewer must
  know.
