# Independent conformance tests (spec 410)
Run: `bun test --isolate tests`. Test names start with the rule id. Failing tests mark rules the product breaks or has no code for.

| rule | file |
|---|---|
| E1, E2 | e1_e2_manifest.test.ts |
| E3, E4, E5, E6, E7, E8, E9 | e3_e9_core.test.ts |
| E10, E11, E12 | e10_e12.test.ts |
