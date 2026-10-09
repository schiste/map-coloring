---
name: repo-onboarding
description: Use when starting work in an unfamiliar repository, when the task asks for repo overview, setup, architecture, entrypoints, test commands, or where to begin. Skip for narrow file-scoped edits once the relevant paths are already known.
---

# Repo Onboarding: map-coloring

## When to Use

- Load this skill first when the repository is unfamiliar or the request is broad.
- Recommended when: first task in repo, repo overview, setup or run instructions, architecture or entrypoints, where should I start, broad debugging or feature-localization request.
- Skip when: known file-scoped edit, follow-up inside already identified area, task already localized to concrete files.
- Use `.codex/skills/aethyme/SKILL.md` or `.claude/skills/aethyme/SKILL.md` for Aethyme's short operating contract after orientation; load its `references/` files only when needed.

## Repo Identity

- Kind: `repository`
- Languages: `javascript`
- Package manager: `npm`
- Key manifests: `package.json`

## Workspaces

- `.` (primary; npm; manifest `package.json`; high confidence)

## Start Here

- `install`: `npm install`
- `dev`: `npm run start`
- `fast_test`: `npm run test`

## Supporting Commands

- `npm install` (install; high confidence from `package.json`)
- `npm run start` (dev; high confidence from `package.json:scripts.start`)
- `npm run test` (fast_test; high confidence from `package.json:scripts.test`)
- `npm start` (primary-script; medium confidence from `package.json:scripts.start`)

## Entrypoints

- `app`: `package.json:scripts.start` (package start script; medium confidence)
- `test`: `test` (conventional test root; medium confidence)

## Additional Entrypoints

- `package.json:scripts.start` (script; role=app; package start script; medium confidence)
- `package.json:scripts.test` (script; role=test; package test script; medium confidence)
- `test` (directory; role=test; conventional test root; medium confidence)

## Repo Map

- `.github` (automation; automation and CI configuration; high confidence)
- `assets` (assets; public assets or static files; high confidence)
- `scripts` (tooling; developer tooling or scripts; high confidence)
- `test` (tests; conventional test directory; high confidence)

## Aethyme Recipes

- `aethyme explore --repo "$PWD" --request "<task>" --format answer-json`
  Purpose: Broad repository orientation for a user request
- `aethyme repo inspect "$PWD" --mode brief --json-output`
  Purpose: Quick deterministic repo summary
- `aethyme graph callers "$PWD" "<symbol-or-file>" --json-output`
  Purpose: Trace likely impact before editing

## Generated and Dangerous Paths

- Generated/vendor `.aethyme/generated`: tracked generated or vendored surface; verify ownership before editing
- Sensitive `.aethyme/gates.toml`: repository validation policy; changes affect every broker submission
- Sensitive `.github/workflows`: repository automation; changes can affect publication or shared CI

## Freshness

- Source digest: `f1fcc51fe0a30faddb4c5ed315d23b02f502895159eeeb7a9076faa5330dbb51`
- Tracked source files: `53`
- Overrides applied: `False`
- Sections generated: `repo, workspaces, primary_workspace, commands, areas, entrypoints, caution_zones, generated_paths, dangerous_paths, navigation_recipes, summon, freshness`
