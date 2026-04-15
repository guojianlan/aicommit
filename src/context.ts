/**
 * 项目上下文收集
 *
 * 从仓库根读：
 * - CLAUDE.md / AGENTS.md / .cursor/rules/* 等团队约定（截取关键片段，避免 prompt 过长）
 * - commitlint 配置（通过 @commitlint/load 拿到运行时规则，比硬编码 type 列表更准）
 *
 * 这些信息会拼进 system prompt，让模型生成的 message 更贴近项目规范。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './git.ts';

export interface ProjectContext {
  /** 团队约定文档（CLAUDE.md / AGENTS.md 等）合并文本，已截断 */
  conventions: string;
  /** commitlint 允许的 type 列表（来自实际 config，没配置时为空数组） */
  allowedTypes: string[];
  /** commitlint 允许的 scope 列表（如有） */
  allowedScopes: string[];
  /** commitlint header 长度上限 */
  headerMaxLength: number;
  /** commitlint 是否启用 scope-enum 强制 */
  scopeEnumEnforced: boolean;
  /** 原始规则 JSON 摘要，给模型看（最权威的依据） */
  rulesSummary: string;
}

const CONVENTION_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
];

/** 读约定文档；每个文件最多取前 N 字符，避免单个文件吃掉所有 token */
function readConventions(root: string, perFileLimit = 4000): string {
  const parts: string[] = [];
  for (const rel of CONVENTION_FILES) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    try {
      const txt = readFileSync(abs, 'utf8').trim();
      if (!txt) continue;
      const truncated = txt.length > perFileLimit ? `${txt.slice(0, perFileLimit)}\n...[truncated]` : txt;
      parts.push(`### ${rel}\n${truncated}`);
    } catch {
      // 忽略读失败
    }
  }
  return parts.join('\n\n');
}

/** 加载 commitlint 配置；找不到或解析失败时返回 null */
async function loadCommitlint(root: string): Promise<{
  rules: Record<string, unknown>;
} | null> {
  // 几个常见配置文件名
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
  if (!candidates.some((f) => existsSync(join(root, f)))) return null;

  try {
    // 动态导入避免无 commitlint 项目也强制安装
    const mod = (await import('@commitlint/load')) as { default: (opts?: unknown, ctx?: unknown) => Promise<{ rules: Record<string, unknown> }> };
    const load = mod.default;
    const result = await load({}, { cwd: root });
    return { rules: result.rules ?? {} };
  } catch {
    return null;
  }
}

/**
 * commitlint 规则形如：'type-enum': [2, 'always', ['feat', 'fix', ...]]
 * 数组第 0 位 = severity (0=disable, 1=warning, 2=error)
 */
function extractEnumRule(rules: Record<string, unknown>, key: string): { enforced: boolean; values: string[] } {
  const r = rules[key];
  if (!Array.isArray(r) || r.length < 3) return { enforced: false, values: [] };
  const [severity, , values] = r as [number, string, unknown];
  if (severity < 2) return { enforced: false, values: [] };
  return { enforced: true, values: Array.isArray(values) ? (values as string[]) : [] };
}

function extractNumberRule(rules: Record<string, unknown>, key: string, fallback: number): number {
  const r = rules[key];
  if (!Array.isArray(r) || r.length < 3) return fallback;
  const [severity, , value] = r as [number, string, unknown];
  if (severity < 2) return fallback;
  return typeof value === 'number' ? value : fallback;
}

export async function collectContext(): Promise<ProjectContext> {
  const root = repoRoot();
  const conventions = readConventions(root);
  const commitlint = await loadCommitlint(root);

  if (!commitlint) {
    return {
      conventions,
      allowedTypes: [],
      allowedScopes: [],
      headerMaxLength: 100,
      scopeEnumEnforced: false,
      rulesSummary: '',
    };
  }

  const typeEnum = extractEnumRule(commitlint.rules, 'type-enum');
  const scopeEnum = extractEnumRule(commitlint.rules, 'scope-enum');
  const headerMaxLength = extractNumberRule(commitlint.rules, 'header-max-length', 100);

  // 给模型看的规则摘要：精简版，避免把整个 rules 对象塞进去
  const summary: Record<string, unknown> = {
    'header-max-length': headerMaxLength,
  };
  if (typeEnum.enforced) summary['type-enum'] = typeEnum.values;
  if (scopeEnum.enforced) summary['scope-enum'] = scopeEnum.values;

  return {
    conventions,
    allowedTypes: typeEnum.values,
    allowedScopes: scopeEnum.values,
    headerMaxLength,
    scopeEnumEnforced: scopeEnum.enforced,
    rulesSummary: JSON.stringify(summary, null, 2),
  };
}
