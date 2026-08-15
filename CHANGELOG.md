# Changelog

All notable changes to this project are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-15

Initial public npm release.

### Added

- Provider-neutral author and reviewer orchestration for Codex and Claude Code.
- Bounded review and correction rounds.
- Deterministic verification commands that remain authoritative over agent output.
- Structured reviewer findings with severity, confidence, and changed-file validation.
- `run`, `review`, `doctor`, and `init` CLI commands.
- JSON reporting and configurable output files for automation and CI usage.
- Role reversal through CLI flags without changing the configuration file.
- Read-only reviewer permission modes and clean-working-tree safeguards.

[0.1.0]: https://www.npmjs.com/package/crosscheck-ai/v/0.1.0
