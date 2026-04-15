#!/usr/bin/env node
// 用 tsx 直接执行 src/cli.ts，避免维护编译产物
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.ts');
const tsx = resolve(here, '../node_modules/.bin/tsx');

const child = spawn(tsx, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
