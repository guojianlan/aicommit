/**
 * aicommit CLI 入口
 *
 * 命令：
 *   aicommit                            生成并打印（不提交），让用户决定
 *   aicommit --yes / -y                 生成后直接 git commit
 *   aicommit -e                         生成后用 git commit -e 进入编辑器
 *   aicommit --no-lint                  关闭 commitlint 自检 + 重试
 *   aicommit --provider <p>             临时覆盖 provider
 *   aicommit --base-url <url>           临时覆盖 baseUrl
 *   aicommit --model <m>                临时覆盖 model
 *
 *   aicommit config set <key> <value>   写配置
 *   aicommit config show                显示配置（apiKey 已遮蔽）
 *   aicommit config path                打印配置文件路径
 */
import { Command } from 'commander';
import {
  loadResolvedConfig,
  setConfigKey,
  readConfig,
  redactConfig,
  CONFIG_FILE_PATH,
  type Config,
  type Provider,
} from './config.ts';
import {
  isInsideRepo,
  stagedDiff,
  stagedStat,
  recentSubjects,
  currentBranch,
  commit as gitCommit,
  commitEditable,
} from './git.ts';
import { collectContext } from './context.ts';
import { buildSystemPrompt, buildUserPrompt } from './prompt.ts';
import { generateMessage } from './llm.ts';
import { lintMessage } from './lint.ts';

const program = new Command();

program
  .name('aicommit')
  .description('AI-powered commit message generator (project-aware: CLAUDE.md / AGENTS.md / commitlint)')
  .version('0.1.0');

// ---------- config 子命令 ----------
const configCmd = program.command('config').description('管理配置');

configCmd
  .command('set <key> <value>')
  .description('设置配置项 (provider/baseUrl/apiKey/model/language/maxDiffChars)')
  .action((key: string, value: string) => {
    setConfigKey(key, value);
    console.log(`✓ 已设置 ${key}`);
  });

configCmd
  .command('show')
  .description('显示当前配置（apiKey 已遮蔽）')
  .action(() => {
    const cfg = readConfig();
    if (!cfg) {
      console.log(`(尚未配置) 配置文件路径：${CONFIG_FILE_PATH}`);
      return;
    }
    console.log(JSON.stringify(redactConfig(cfg), null, 2));
  });

configCmd
  .command('path')
  .description('打印配置文件路径')
  .action(() => {
    console.log(CONFIG_FILE_PATH);
  });

// ---------- 默认命令：生成 commit ----------
program
  .option('-y, --yes', '生成后直接提交，不打印确认')
  .option('-e, --edit', '生成后用 git commit -e 进入编辑器')
  .option('--no-lint', '关闭 commitlint 自检与重试')
  .option('--provider <p>', '临时覆盖 provider (openai|anthropic)')
  .option('--base-url <url>', '临时覆盖 baseUrl')
  .option('--model <m>', '临时覆盖 model')
  .option('--max-retries <n>', 'commitlint 失败时的最大重试次数', '2')
  .action(async (opts) => {
    if (!isInsideRepo()) {
      console.error('✗ 不在 git 仓库内');
      process.exit(1);
    }

    const diff = stagedDiff();
    if (!diff) {
      console.error('✗ 没有已暂存的改动，先 git add');
      process.exit(1);
    }

    // 解析配置
    const overrides: Partial<Config> = {};
    if (opts.provider) overrides.provider = opts.provider as Provider;
    if (opts.baseUrl) overrides.baseUrl = opts.baseUrl;
    if (opts.model) overrides.model = opts.model;

    let cfg: Config;
    try {
      cfg = loadResolvedConfig(overrides);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    }

    // 收集项目上下文
    const ctx = await collectContext();
    const branch = currentBranch();
    const stat = stagedStat();
    const subjects = recentSubjects(15);

    const system = buildSystemPrompt({
      ctx,
      recentSubjects: subjects,
      language: cfg.language ?? 'zh',
      maxDiffChars: cfg.maxDiffChars ?? 12000,
    });

    // 生成 + 自检 + 重试
    const maxRetries = Math.max(0, parseInt(String(opts.maxRetries), 10) || 0);
    const lintEnabled = opts.lint !== false;

    let attempt = 0;
    let message = '';
    let lintFeedback: { previousMessage: string; errors: string[] } | undefined;

    while (true) {
      attempt += 1;
      const user = buildUserPrompt({
        ctx,
        branch,
        diff,
        stat,
        recentSubjects: subjects,
        language: cfg.language ?? 'zh',
        maxDiffChars: cfg.maxDiffChars ?? 12000,
        lintFeedback,
      });

      process.stderr.write(attempt === 1 ? '⠋ 正在生成 commit message...\n' : `⠋ 第 ${attempt} 次重试（commitlint 校验失败）...\n`);

      try {
        message = await generateMessage({ system, user, config: cfg });
      } catch (e) {
        console.error(`✗ LLM 调用失败：${(e as Error).message}`);
        process.exit(1);
      }

      if (!lintEnabled) break;

      const result = await lintMessage(message);
      if (result.valid) break;

      if (attempt > maxRetries) {
        console.error('⚠ commitlint 校验仍失败，已用尽重试次数。错误：');
        for (const err of result.errors) console.error(`  - ${err}`);
        console.error('（可加 --no-lint 跳过校验）');
        break;
      }
      lintFeedback = { previousMessage: message, errors: result.errors };
    }

    // 输出与提交
    if (opts.edit) {
      commitEditable(message);
      return;
    }
    if (opts.yes) {
      gitCommit(message);
      return;
    }

    // 默认：打印让用户决定
    console.log('\n--- 生成的 commit message ---');
    console.log(message);
    console.log('--- end ---\n');
    console.log('确认提交，运行：');
    console.log(`  git commit -m ${JSON.stringify(message)}`);
    console.log('或重跑加 --yes 自动提交，加 -e 进编辑器再改。');
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
