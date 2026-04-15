/**
 * Prompt 拼装
 *
 * 设计：
 * - 跨次稳定的部分（约定文档、commitlint 规则、风格示例）放 system，便于命中 prompt cache
 * - 本次特定的 diff / 分支 / lint 反馈放 user，避免污染 cache
 * - 大 diff 用「stat + 截断的内容」组合，而不是粗暴砍掉
 */
import type { ProjectContext } from './context.ts';

const FALLBACK_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'revert', 'build'];

export interface BuildPromptInput {
  ctx: ProjectContext;
  branch: string;
  diff: string;
  stat: string;
  recentSubjects: string[];
  language: 'zh' | 'en';
  maxDiffChars: number;
  /** 上一轮 commitlint 校验的反馈，用于重试 */
  lintFeedback?: { previousMessage: string; errors: string[] };
}

export function buildSystemPrompt(input: Omit<BuildPromptInput, 'diff' | 'stat' | 'branch' | 'lintFeedback'>): string {
  const { ctx, recentSubjects, language } = input;
  const types = ctx.allowedTypes.length > 0 ? ctx.allowedTypes : FALLBACK_TYPES;
  const langInstruction = language === 'zh' ? '使用中文撰写 subject 与 body' : 'Write subject and body in English';

  const blocks: string[] = [];

  blocks.push(`你是一个严谨的 commit message 生成器，输出严格遵循 Conventional Commits 规范。

【输出格式】
type(scope): subject

[可选 body，与 subject 之间空一行；解释「为什么」而不是「做了什么」]

[可选 footer，例如 BREAKING CHANGE / Refs: PROJ-123]

【硬性约束】
- 只输出 commit message 本体，不要任何解释、代码块标记、引导语
- type 必须是以下之一：${types.join(', ')}
- subject ≤ ${ctx.headerMaxLength} 字符，祈使句，结尾不加句号
- ${langInstruction}
- 多文件改动若属于同一意图就用一条 message；若明显是多个独立改动，仍只输出最主要的一条 commit，但在 body 中提示用户考虑拆分`);

  if (ctx.scopeEnumEnforced && ctx.allowedScopes.length > 0) {
    blocks.push(`【scope 必须是以下之一】\n${ctx.allowedScopes.join(', ')}`);
  } else {
    blocks.push(`【scope 可选】根据改动涉及的模块/包名推断（如 home, auth, button, ci 等），无明确归属时可省略`);
  }

  if (ctx.rulesSummary) {
    blocks.push(`【commitlint 规则摘要（来自项目实际配置，必须遵守）】\n${ctx.rulesSummary}`);
  }

  if (ctx.conventions) {
    blocks.push(`【项目约定文档（节选）】\n${ctx.conventions}`);
  }

  if (recentSubjects.length > 0) {
    blocks.push(`【本仓库最近的 commit subject（学习风格用，不要照抄）】\n${recentSubjects.map((s) => `- ${s}`).join('\n')}`);
  }

  return blocks.join('\n\n');
}

/** 智能裁剪 diff：超长时保留 stat + 头尾片段 */
function truncateDiff(diff: string, stat: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff;
  const head = diff.slice(0, Math.floor(maxChars * 0.7));
  const tail = diff.slice(-Math.floor(maxChars * 0.2));
  return `[完整 diff 过长 (${diff.length} 字符)，已截断。文件统计如下：]
${stat}

[diff 头部 ${head.length} 字符]
${head}

...[中间省略]...

[diff 尾部 ${tail.length} 字符]
${tail}`;
}

export function buildUserPrompt(input: BuildPromptInput): string {
  const { branch, diff, stat, maxDiffChars, lintFeedback } = input;
  const blocks: string[] = [];

  blocks.push(`【当前分支】${branch}`);

  // 从分支名提取可能的 ticket 编号（PROJ-123 / #123 / TASK-1234）
  const ticketMatch = branch.match(/\b([A-Z]{2,}-\d+|#\d+)\b/);
  if (ticketMatch) {
    blocks.push(`【检测到分支中可能的 ticket】${ticketMatch[1]}（如适用，请加入 footer：Refs: ${ticketMatch[1]}）`);
  }

  blocks.push(`【已暂存改动文件统计】\n${stat || '(无)'}`);
  blocks.push(`【已暂存改动 diff】\n${truncateDiff(diff, stat, maxDiffChars)}`);

  if (lintFeedback) {
    blocks.push(`【上一次生成的 message 未通过 commitlint 校验，请修正后重新生成】
上次输出:
${lintFeedback.previousMessage}

错误:
${lintFeedback.errors.map((e) => `- ${e}`).join('\n')}`);
  }

  blocks.push('请直接输出 commit message，不要任何额外文字。');
  return blocks.join('\n\n');
}
