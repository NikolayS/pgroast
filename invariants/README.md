# Subsystem invariants

Rules that senior reviewers apply and that a model does not reliably infer by itself. Each file covers one subsystem. The roasters receive the files whose `paths:` patterns match the files a patch touches.

Every entry must link to the thread, commit or review that taught it. Do not add an invariant from memory or from a model's suggestion without such a source.

Entry format:

```
## <short rule name>
- Rule: <the invariant, one or two sentences>
- Failure when broken: <what goes wrong, concretely>
- How a test hides it: <optional: the test shape that masks the problem>
- Source: <link> (<who>, <date>)
```
