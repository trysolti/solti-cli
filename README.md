# Solti CLI

Command-line interface for the [Solti Platform](https://solti.run) — schedule and run asynchronous workloads without managing infrastructure.

## Installation

```bash
brew install trysolti/tap/solti
```

npm distribution (`pnpm add -g @solti/cli`) is coming soon — the package is not
published yet.

## Quickstart

```bash
solti account login        # opens your browser — sign in once
solti organization list
solti project list
solti profile set default --project-id <your-project-id>
solti job run --image alpine:latest -- echo "Hello from Solti!"
```

Headless / CI usage (no login required):

```bash
export SOLTI_API_KEY=<your-api-key>
export SOLTI_PROJECT_ID=<your-project-id>
solti job list
```

## Configuration

State is stored under `~/.solti/`:

```
~/.solti/
├── active.json                      # active account + active profile
└── accounts/
    └── <email>/
        ├── auth.json                # OAuth tokens (0600)
        └── profiles/
            └── <profile>/config.json
```

## Development

```bash
pnpm install
pnpm build
node dist/index.js --help
```

Spec: `../solti-specs/constitution/tools/cli.md` (implementation tracked under Change 004).
