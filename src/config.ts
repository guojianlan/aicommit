/**
 * 配置读写：~/.aicommitrc.json
 *
 * 数据结构：
 * {
 *   provider: 'openai' | 'anthropic',   // 注：openai 兼容协议覆盖 deepseek/qwen/moonshot/groq 等
 *   baseUrl?: string,                    // openai provider 必填（如 https://api.deepseek.com/v1）
 *   apiKey: string,
 *   model: string,                       // 例：gpt-4o-mini / claude-3-5-sonnet-latest / deepseek-chat
 *   language?: 'zh' | 'en',              // commit message 语言，默认 zh
 *   maxDiffChars?: number                // diff 截断阈值，默认 12000
 * }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export type Provider = 'openai' | 'anthropic';

export interface Config {
  provider: Provider;
  baseUrl?: string;
  apiKey: string;
  model: string;
  language?: 'zh' | 'en';
  maxDiffChars?: number;
}

const CONFIG_PATH = join(homedir(), '.aicommitrc.json');

const ALLOWED_KEYS = new Set([
  'provider',
  'baseUrl',
  'apiKey',
  'model',
  'language',
  'maxDiffChars',
]);

/** 读取配置；不存在时返回 null，由调用方决定是否报错 */
export function readConfig(): Partial<Config> | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`配置文件解析失败 (${CONFIG_PATH}): ${(e as Error).message}`);
  }
}

/** 写入完整配置并设为 0600，避免 apiKey 泄漏 */
export function writeConfig(cfg: Partial<Config>): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Windows 下 chmod 无效，忽略
  }
}

/** 设置单个键 */
export function setConfigKey(key: string, value: string): void {
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error(`未知配置项: ${key}\n允许: ${[...ALLOWED_KEYS].join(', ')}`);
  }
  const cfg = (readConfig() ?? {}) as Record<string, unknown>;
  if (key === 'maxDiffChars') {
    cfg[key] = Number(value);
  } else {
    cfg[key] = value;
  }
  writeConfig(cfg as Partial<Config>);
}

/** 获取已校验的运行时配置，缺字段抛错 */
export function loadResolvedConfig(overrides: Partial<Config> = {}): Config {
  const file = readConfig() ?? {};
  const merged: Partial<Config> = { ...file, ...overrides };

  // 默认值
  merged.provider = (merged.provider ?? 'openai') as Provider;
  merged.language = merged.language ?? 'zh';
  merged.maxDiffChars = merged.maxDiffChars ?? 12000;

  // 必填校验
  if (!merged.apiKey) throw new Error('缺少 apiKey，请运行：aicommit config set apiKey <key>');
  if (!merged.model) throw new Error('缺少 model，请运行：aicommit config set model <name>');
  if (merged.provider === 'openai' && !merged.baseUrl) {
    throw new Error('openai provider 缺少 baseUrl，请运行：aicommit config set baseUrl <url>');
  }

  return merged as Config;
}

/** 用于 config show，遮蔽 apiKey */
export function redactConfig(cfg: Partial<Config>): Partial<Config> {
  const out = { ...cfg };
  if (out.apiKey) {
    const key = out.apiKey;
    out.apiKey = key.length <= 8 ? '****' : `${key.slice(0, 4)}...${key.slice(-4)}`;
  }
  return out;
}

export const CONFIG_FILE_PATH = CONFIG_PATH;
