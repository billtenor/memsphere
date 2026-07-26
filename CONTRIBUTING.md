# Contributing

Thank you for contributing to this project.

## Development

Install dependencies and run the project checks:

```bash
npm install
npm run build
npm test
```

Keep changes focused, include tests for behavior changes, and update documentation
when user-facing behavior changes.

## Local Security Check

Install [Gitleaks](https://github.com/gitleaks/gitleaks), then run:

```bash
git config --local user.name "Your Name"
git config --local user.email "you@example.com"
npm run security:setup
npm run security:check
```

Setup records the repository-local identity and enables `user.useConfigOnly`.
Husky then runs the staged version of the same check before each commit. Set
`GITLEAKS_BIN` when the executable is not available as `gitleaks` on `PATH`.

## License

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this project is provided under the Apache License, Version 2.0,
without additional terms or conditions.
