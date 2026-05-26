# Hecateq OpenAgent

<p align="center">
  <em>Hecateq-customized OpenCode agent orchestration plugin</em>
</p>

**Hecateq OpenAgent** is a modified fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — a batteries-included OpenCode plugin with multi-model orchestration, parallel background agents, and crafted LSP/AST tools.

---

## Status

**Beta — use at your own risk.**

This is an experimental Hecateq-customized fork. The following gates are verified to pass:
- Package metadata, bundling, and `npm pack --dry-run`
- TypeScript type checking (`bun run typecheck`)
- Production build (`bun run build`)

However, the **inherited full test suite (bun test) is not fully green yet** due to pre-existing upstream/fork test failures that predate this fork. CI runs the test suite as a non-blocking signal, but it is not a release gate.

**Review changes carefully before production use.** Do not claim full test stability for this beta release.

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

Anonymous telemetry stays disabled by default. To enable it explicitly, set both:

```bash
export HECATEQ_SEND_ANONYMOUS_TELEMETRY=1
export HECATEQ_POSTHOG_KEY=your_posthog_project_key
```

If the key is missing, telemetry safely no-ops.

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
