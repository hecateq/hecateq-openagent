# Release Process

## Overview

Hecateq OpenAgent is published to npm as `@hecateq/openagent`. This document describes the release process.

## First Beta Release

To publish the first beta release:

```bash
# Ensure you are logged in to npm
npm login

# Verify the package is ready
npm pack --dry-run

# Publish with beta dist-tag
npm publish --access public --tag beta
```

## Subsequent Releases

### Manual publish (for initial setup)

```bash
npm version 0.1.0-hecateq.<n>  # bump prerelease number
npm publish --access public --tag beta
```

### Trusted Publishing (recommended for CI)

After initial publish, configure npm Trusted Publishing for the `@hecateq/openagent` package:

1. Go to https://www.npmjs.com/settings/hecateq/packages
2. Select `@hecateq/openagent` → "Access" → "Trusted Publishing"
3. Configure:
   - **Registry**: npm
   - **Repository**: `hecateq/hecateq-openagent`
   - **Environment**: (leave blank for any environment)
   - **Workflow**: `publish.yml`

Once configured, the GitHub Actions workflow (`.github/workflows/publish.yml`) can publish automatically.

## Versioning

We follow Semantic Versioning with a `-hecateq.<n>` prerelease suffix for beta releases:

- `0.1.0-hecateq.1` — initial beta
- `0.1.0-hecateq.2` — second beta
- `0.1.0` — first stable release
- `0.2.0` — minor release with new features

## Pre-release Checklist

Before publishing:

- [ ] All tests pass (`bun test`)
- [ ] Type checks pass (`bun run typecheck`)
- [ ] Build succeeds (`bun run build`)
- [ ] `npm pack --dry-run` shows expected files
- [ ] CHANGELOG.md is updated
- [ ] Version is bumped in package.json
- [ ] No secrets or local files in the package
