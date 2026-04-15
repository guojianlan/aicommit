/**
 * commitlint 自检：把生成的 message 送进 @commitlint/lint，
 * 用项目实际 rules 校验。校验失败可把错误回喂给模型重试。
 *
 * 没装 commitlint 的项目走 noop（始终通过）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './git.ts';

export interface LintResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const HAS_LOCAL_CONFIG = (() => {
  try {
    const root = repoRoot();
    const candidates = [
      'commitlint.config.js',
      'commitlint.config.cjs',
      'commitlint.config.mjs',
      'commitlint.config.ts',
      '.commitlintrc.js',
      '.commitlintrc.cjs',
      '.commitlintrc.json',
      '.commitlintrc',
    ];
    return candidates.some((f) => existsSync(join(root, f)));
  } catch {
    return false;
  }
})();

export async function lintMessage(message: string): Promise<LintResult> {
  if (!HAS_LOCAL_CONFIG) {
    return { valid: true, errors: [], warnings: [] };
  }
  try {
    const loadMod = (await import('@commitlint/load')) as { default: (opts?: unknown, ctx?: unknown) => Promise<{ rules: Record<string, unknown> }> };
    const lintMod = (await import('@commitlint/lint')) as { default: (msg: string, rules: Record<string, unknown>) => Promise<{ valid: boolean; errors: { message: string }[]; warnings: { message: string }[] }> };

    const { rules } = await loadMod.default({}, { cwd: repoRoot() });
    const result = await lintMod.default(message, rules);

    return {
      valid: result.valid,
      errors: result.errors.map((e) => e.message),
      warnings: result.warnings.map((w) => w.message),
    };
  } catch (e) {
    // commitlint 加载失败时不阻断生成
    return { valid: true, errors: [], warnings: [`commitlint 校验跳过：${(e as Error).message}`] };
  }
}
