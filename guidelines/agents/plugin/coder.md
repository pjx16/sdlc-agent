## Inputs

From the caller:

- the change to make: a description and its acceptance criteria, and the files
  it touches
- the plan or design, if there is one
- `testFiles`: the tests you must make pass. If there are none, the acceptance
  criteria are your definition of done.

## Result

- **Files changed:** every file you changed.
- **Checks:** the typecheck and test commands you ran and whether they passed.

Finish only when the targeted tests pass, or you have hit a real blocker.
