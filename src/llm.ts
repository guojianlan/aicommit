/**
 * LLM 调用层（AI SDK）
 *
 * 用 Vercel AI SDK 的 generateText 统一接口，少一层适配。
 * - openai provider：通过 createOpenAI({ baseURL }) 兼容大多数主流服务
 *   （DeepSeek、Qwen、Moonshot、Groq、Azure OpenAI、本地 ollama 等）
 * - anthropic provider：原生 Claude API
 *
 * 切换 provider 只需改配置，不需要写适配代码。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { Config } from './config.ts';

export interface GenerateInput {
  system: string;
  user: string;
  config: Config;
}

export async function generateMessage(input: GenerateInput): Promise<string> {
  const { config, system, user } = input;

  const model = (() => {
    if (config.provider === 'anthropic') {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider(config.model);
    }
    // 默认 openai 兼容
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl!,
      compatibility: 'compatible',
    });
    return provider(config.model);
  })();

  const result = await generateText({
    model,
    system,
    prompt: user,
    temperature: 0.2,
    maxTokens: 600,
  });

  return cleanupOutput(result.text);
}

/**
 * 清理常见的模型啰嗦输出：
 * - 包裹的 ``` 代码块
 * - 开头的「commit message:」「以下是」之类引导语
 * - 首尾多余空白
 */
function cleanupOutput(text: string): string {
  let s = text.trim();

  // 去掉 ```...``` 包裹
  const fence = s.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1].trim();

  // 去掉常见前缀
  s = s.replace(/^(commit message[:：]|以下是[^\n]*[:：]?|here'?s[^\n]*[:：]?)\s*/i, '').trim();

  return s;
}
