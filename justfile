test:
    pnpm vitest run

test-watch:
    pnpm vitest watch

build:
    pnpm run build

cli *args:
    pnpm run build
    node dist/cli/main.js {{args}}

core-build:
    pnpm tsc --noEmit

core-test:
    pnpm vitest run
