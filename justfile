test:
    pnpm vitest run

test-watch:
    pnpm vitest watch

build:
    pnpm tsc

cli *args:
    pnpm tsx src/cli.ts {{args}}

core-build:
    pnpm tsc --noEmit

core-test:
    pnpm vitest run
