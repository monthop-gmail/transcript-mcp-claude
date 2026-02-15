/**
 * Translation Tools
 * จัดโครงสร้าง transcript data สำหรับให้ Claude แปลภาษา
 * (ไม่ต้อง external API - Claude ทำ translation เอง)
 */

import type { Segment, TranslateArgs, MultilingualArgs, TranslationPrep, MultilingualSubtitlesPrep } from './types.js';

export async function translateTranscript(args: TranslateArgs): Promise<TranslationPrep> {
  const { text, segments = [], target_language, source_language = 'auto' } = args;

  if (!text) {
    throw new Error('text is required - provide transcript text to translate');
  }
  if (!target_language) {
    throw new Error('target_language is required (e.g., "en", "th", "ja", "zh", "ko")');
  }

  return {
    source_language,
    target_language,
    original_text: text,
    original_segment_count: segments.length,
    segments,
    instruction: `Please translate the following text from ${source_language} to ${target_language}`,
  };
}

export async function createMultilingualSubtitles(args: MultilingualArgs): Promise<MultilingualSubtitlesPrep> {
  const { text, segments = [], target_languages } = args;

  if (!text) {
    throw new Error('text is required');
  }
  if (!target_languages?.length) {
    throw new Error('target_languages is required (array of language codes, e.g., ["en", "th", "ja"])');
  }

  return {
    original_text: text,
    original_segment_count: segments.length,
    segments,
    requested_languages: target_languages,
    instruction: `Please translate each segment into the following languages: ${target_languages.join(', ')}`,
  };
}
