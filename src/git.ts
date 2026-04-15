/**
 * git 命令封装
 *
 * 设计要点：
 * - 所有命令在 cwd 执行（用户在哪个仓库下调用 aicommit 就操作哪个仓库）
 * - diff 用 --cached（即 staged），不读未暂存的内容
 * - log 优先取「当前用户」的最近提交，回退到全员 log，用作风格参考
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
}

function gitSafe(args: string[]): string {
  try {
    return git(args);
  } catch {
    return '';
  }
}

/** 当前是否在 git 仓库内 */
export function isInsideRepo(): boolean {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** 仓库根目录绝对路径 */
export function repoRoot(): string {
  return git(['rev-parse', '--show-toplevel']);
}

/** 当前分支名（detached HEAD 时返回 'HEAD'） */
export function currentBranch(): string {
  return gitSafe(['symbolic-ref', '--short', 'HEAD']) || 'HEAD';
}

/** 当前 git 用户邮箱，用于过滤个人风格的 log */
export function currentUserEmail(): string {
  return gitSafe(['config', 'user.email']);
}

/** 已暂存改动的完整 diff */
export function stagedDiff(): string {
  return gitSafe(['diff', '--cached']);
}

/** 已暂存改动的文件粒度统计（用于大 diff 摘要） */
export function stagedStat(): string {
  return gitSafe(['diff', '--cached', '--stat']);
}

/** 已暂存改动涉及的文件名列表 */
export function stagedFiles(): string[] {
  const out = gitSafe(['diff', '--cached', '--name-only']);
  return out ? out.split('\n').filter(Boolean) : [];
}

/**
 * 最近 commit subject 列表，用作风格示例
 * 优先取「当前用户」的最近提交；不够则补全员 log
 */
export function recentSubjects(limit = 15): string[] {
  const email = currentUserEmail();
  const mine = email
    ? gitSafe(['log', `--author=${email}`, `-n`, String(limit), '--pretty=%s'])
    : '';
  const lines = mine ? mine.split('\n').filter(Boolean) : [];
  if (lines.length >= 5) return lines.slice(0, limit);

  // 不够就补全员 log（去重）
  const all = gitSafe(['log', `-n`, String(limit * 2), '--pretty=%s']);
  const allLines = all ? all.split('\n').filter(Boolean) : [];
  const seen = new Set(lines);
  for (const l of allLines) {
    if (lines.length >= limit) break;
    if (!seen.has(l)) {
      lines.push(l);
      seen.add(l);
    }
  }
  return lines;
}

/** 执行 git commit -m */
export function commit(message: string): void {
  execFileSync('git', ['commit', '-m', message], { stdio: 'inherit' });
}

/**
 * 把 message 写入 .git/COMMIT_EDITMSG 然后执行 git commit -e
 * 用户可以在编辑器里改完再保存提交
 */
export function commitEditable(message: string): void {
  const root = repoRoot();
  const path = `${root}/.git/COMMIT_EDITMSG`;
  writeFileSync(path, message, 'utf8');
  execFileSync('git', ['commit', '-e', '-F', path], { stdio: 'inherit' });
}
