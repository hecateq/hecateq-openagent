# Contributing to Hecateq OpenAgent

Thank you for your interest in contributing! This is a modified fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), customized for the Hecateq ecosystem.

## How to Contribute

1. **Fork** the repository.
2. **Create a branch** from `main` with a descriptive name.
3. **Make your changes** following the project conventions (Bun, TypeScript strict mode, kebab-case files).
4. **Run checks:**
   ```bash
   bun run typecheck
   bun run build
   bun test
   ```
5. **Commit** with clear, descriptive messages (present tense).
6. **Open a Pull Request** against the `main` branch.

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build better tools.

## Development Setup

- **Bun** (latest) — the only supported package manager
- **TypeScript** — strict mode
- Run `bun install` then `bun run build` to get started

## Licensing

By contributing, you agree that your contributions will be licensed under the same **SUL-1.0** license as this project. See [LICENSE.md](./LICENSE.md).
