# Contributing to crosscheck-ai

Thank you for helping improve Crosscheck.

## Development setup

Requirements:

- Node.js 20 or newer
- Git

Clone the repository and install its dependencies:

```bash
git clone https://github.com/saivarun1410/crosscheck-ai.git
cd crosscheck-ai
npm install
```

Run the complete validation suite:

```bash
npm run check
```

This runs type-checking, automated tests, and the production build. Please add or update tests for behavior changes.

## Pull request workflow

The default branch is protected. Contributors should:

1. Create a focused branch or fork.
2. Make one coherent change and include relevant tests or documentation.
3. Run `npm run check` locally.
4. Open a pull request describing the change, motivation, impact, and validation performed.
5. Address review feedback and wait for the required owner approval before merging.

Force pushes and deletion of the default branch are blocked. Stale approvals are dismissed when reviewed code changes, and review conversations must be resolved before merge.

## Reporting security issues

Do not include secrets, access tokens, or exploit details for an unpatched vulnerability in a public issue. Use GitHub's private vulnerability reporting flow when it is available for the repository, or contact the maintainer privately through their GitHub profile.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
