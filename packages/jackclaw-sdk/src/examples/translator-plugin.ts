/**
 * translator-plugin — Example JackClaw Plugin
 *
 * Commands:
 *   /translate [lang] <text>  → 翻译文本
 *   /en <text>                → 翻译成英文
 *   /zh <text>                → 翻译成中文
 *
 * Uses the Node's LLM Gateway for translation.
 */
import { definePlugin } from '../index.js'

const LANG_MAP: Record<string, string> = {
  en: 'English',
  zh: '中文',
  ja: '日语',
  ko: '韩语',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  ar: 'Arabic',
}

export default definePlugin({
  name: 'translator',
  version: '1.0.0',
  description: '多语言翻译 (via LLM Gateway)',

  commands: {
    translate: async (ctx) => {
      // /translate en 你好世界
      // /translate zh Hello world
      const [langCode, ...words] = ctx.args
      const text = words.join(' ')

      if (!langCode || !text) {
        return { text: '用法: /translate [lang] <text>\n支持: ' + Object.keys(LANG_MAP).join(', ') }
      }

      const targetLang = LANG_MAP[langCode] ?? langCode
      const prompt = `Translate the following text to ${targetLang}. Return ONLY the translation, no explanation:\n\n${text}`

      // Store translation in plugin memory
      ctx.store.set('lastTranslation', { from: text, to: targetLang, ts: Date.now() })

      return {
        text: `[Note: Translation requires LLM Gateway. Prompt: "${prompt.slice(0, 80)}..."]`,
        data: { prompt, targetLang, sourceText: text },
      }
    },

    en: async (ctx) => {
      const text = ctx.args.join(' ')
      if (!text) return { text: '用法: /en <中文文本>' }
      return {
        text: `[Translate to English]: ${text}`,
        data: { prompt: `Translate to English: ${text}`, targetLang: 'English' },
      }
    },

    zh: async (ctx) => {
      const text = ctx.args.join(' ')
      if (!text) return { text: 'Usage: /zh <English text>' }
      return {
        text: `[翻译成中文]: ${text}`,
        data: { prompt: `翻译成中文: ${text}`, targetLang: '中文' },
      }
    },
  },

  hooks: {
    onLoad: async (ctx) => {
      ctx.log.info('Translator plugin loaded')
      ctx.store.set('translationCount', 0)
    },
  },
})
