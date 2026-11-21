## Inputs

From the caller:

- the change the tests are for: a description and its acceptance criteria, and
  the files it touches
- the plan or design, if there is one
- an existing test file to copy the style from; if none was named, pick one
  next to the code under test

## Result

- **Test files** (`testFiles`): every test file you created or changed.
- **Criteria covered:** each acceptance criterion and the name of the test that
  covers it. Every criterion appears exactly once.
- **Stubs:** the files where you added stubs, if any.
