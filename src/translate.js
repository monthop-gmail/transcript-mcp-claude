/**
 * Translation Tools
 * จัดโครงสร้าง transcript data สำหรับให้ Claude แปลภาษา
 * (ไม่ต้อง external API - Claude ทำ translation เอง)
 */

/**
 * เตรียม transcript สำหรับการแปลภาษา
 * @param {object} args - { text, segments, target_language, source_language }
 */
export async function translateTranscript(args) {
  const text = args?.text;
  const segments = args?.segments || [];
  const targetLang = args?.target_language;
  const sourceLang = args?.source_language || 'auto';

  if (!text) {
    throw new Error('text is required - provide transcript text to translate');
  }
  if (!targetLang) {
    throw new Error('target_language is required (e.g., "en", "th", "ja", "zh", "ko")');
  }

  return {
    source_language: sourceLang,
    target_language: targetLang,
    original_text: text,
    original_segment_count: segments.length,
    segments,
    instruction: `Please translate the following text from ${sourceLang} to ${targetLang}`,
  };
}

/**
 * เตรียม transcript สำหรับสร้าง multilingual subtitles
 * @param {object} args - { text, segments, target_languages }
 */
export async function createMultilingualSubtitles(args) {
  const text = args?.text;
  const segments = args?.segments || [];
  const targetLangs = args?.target_languages || [];

  if (!text) {
    throw new Error('text is required');
  }
  if (!targetLangs.length) {
    throw new Error('target_languages is required (array of language codes, e.g., ["en", "th", "ja"])');
  }

  return {
    original_text: text,
    original_segment_count: segments.length,
    segments,
    requested_languages: targetLangs,
    instruction: `Please translate each segment into the following languages: ${targetLangs.join(', ')}`,
  };
}
