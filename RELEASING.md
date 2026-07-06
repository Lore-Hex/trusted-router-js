# Releasing `@lore-hex/trusted-router` (npm)

## How a release happens

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit to `main` and let CI (`.github/workflows/ci.yml`) go green.
3. Push a tag `vX.Y.Z` (matching `package.json`). The
   `.github/workflows/release.yml` workflow triggers on `v*` tags, re-runs
   `npm run check` + `npm test`, then publishes with
   `npm publish --provenance`.

```bash
git tag v0.4.0
git push origin v0.4.0
```

## One-time npm setup (REQUIRED — the publish fails without it)

The publish job uses **npm OIDC trusted publishing** (`permissions:
id-token: write`, `environment: npm`, `npm publish --provenance`) with **no
NPM token**. This only works if a **trusted publisher is registered on
npmjs.com** for the package. Version 0.3.0 was published *manually* from a
logged-in account, so the automation was never configured — until it is, every
tagged release fails.

**To enable automated releases (do this once):**

On npmjs.com → `@lore-hex/trusted-router` → **Settings → Trusted Publisher →
Add GitHub Actions publisher**:
- Organization / repository: `Lore-Hex/trusted-router-js`
- Workflow filename: `release.yml`
- Environment: `npm`

No token is needed after this. Re-run the failed release workflow (or
re-push the tag) and it will publish.

**Alternative (token auth instead of OIDC):** create an npm granular/automation
token with publish rights to `@lore-hex/trusted-router`, add it as the repo
secret `NPM_TOKEN`, and add to the `npm publish --provenance` step in
`release.yml`:

```yaml
      - run: npm publish --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Gotcha: E404 on publish = OIDC short-circuited by setup-node's placeholder token

`npm publish` returns **404 Not Found** (not 403) when the runner cannot
authenticate — npm masks publish auth failures as 404. The ROOT CAUSE of the
repeated failures here (v0.3.1–v0.5.0 all failed): **`actions/setup-node@v4/v5`
unconditionally writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`
into `.npmrc`**, and npm then tries token auth with that empty placeholder and
404s **before** ever attempting OIDC. Upgrading npm alone does not help — the
poisoned `.npmrc` short-circuits OIDC regardless of npm version.

**Fix (mirrors the working `Lore-Hex/workweave-router` setup):**
- `actions/setup-node@v6` (first release with npm OIDC support; does not write
  the placeholder authToken).
- `node-version: "24"` (ships npm ≥ 11.5, the OIDC minimum).
- `npm publish --provenance --access public`.
- Pin third-party actions to commit SHAs (this job has `id-token: write`).

If you still see E404 after that, the npm-side trusted publisher does not match
this workflow — verify repo `Lore-Hex/trusted-router-js`, workflow
`release.yml`, environment `npm`. Do not bump the version chasing a phantom
"package not found".

## Sibling SDKs (same pattern)

- `trusted-router-py` → PyPI OIDC trusted publishing (working).
- `trusted-router-swift` → SwiftPM, released by git tag only (bare `X.Y.Z`,
  no `v` prefix — match the existing tag convention).
- `trusted-router-go` → Go module, released by `vX.Y.Z` git tag only (the
  module proxy serves it; no registry publish).
