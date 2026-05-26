# Hecateq OpenAgent

<p align="center">
  <em>Hecateq-customized OpenCode agent orchestration plugin</em>
</p>

**Hecateq OpenAgent** is a modified fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — a batteries-included OpenCode plugin with multi-model orchestration, parallel background agents, and crafted LSP/AST tools.

---

## Status

**Experimental modified fork.** This is a beta-quality Hecateq-customized build of oh-my-openagent. It is not yet stable for production use. Use at your own risk.

---

## Origin

This project is based on the excellent work of [YeonGyu Kim's oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent). We have forked and customized it for the Hecateq ecosystem.

> **No affiliation:** This project is not affiliated with, endorsed by, or sponsored by YeonGyu Kim, the original oh-my-openagent project, or any of its associated entities.

See [NOTICE.md](./NOTICE.md) for full attribution and license information.

---

## Goals

- Provide a Hecateq-customized OpenCode agent orchestration plugin
- Maintain compatibility with the upstream oh-my-openagent ecosystem
- Add Hecateq-specific workflows, configuration, and tooling
- Offer a beta distribution channel for early adopters
- Preserve the full agent orchestration, multi-model, and LSP/AST capabilities of the original

---

## Installation

### npm (global install)

```bash
npm install -g @hecateq/openagent@beta
```

### bun (global install)

```bash
bun install -g @hecateq/openagent@beta
```

After installation, configure your OpenCode to use the plugin by adding `"@hecateq/openagent"` to the `plugin` array in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@hecateq/openagent"]
}
```

---

## Development

```bash
# Clone the repository
git clone https://github.com/hecateq/hecateq-openagent.git
cd hecateq-openagent

# Install dependencies (bun only)
bun install

# Type check
bun run typecheck

# Build
bun run build

# Test
bun test

# Dry-run packaging check
npm pack --dry-run
```

---

## Release

This package is published to npm under the `@hecateq` scope on the `beta` dist-tag.

First manual beta publish:

```bash
npm publish --access public --tag beta
```

After initial publish, configure Trusted Publishing for the `@hecateq/openagent` package on npm for the `hecateq/hecateq-openagent` repository, with the publish workflow as the trusted action.

---

## License

This project is licensed under the **Sustainable Use License v1.0 (SUL-1.0)**. See [LICENSE.md](./LICENSE.md) for details.

---

## Attribution

This project is a modified fork of **oh-my-openagent** by YeonGyu Kim. See [NOTICE.md](./NOTICE.md) for attribution and license information.
