/**
 * Summarization Tools
 * จัดโครงสร้าง transcript data สำหรับให้ Claude สรุป
 * รองรับหลาย style: bullet_points, paragraph, key_takeaways, detailed
 */

/**
 * เตรียม transcript สำหรับการสรุป
 * @param {object} args - { text, style, max_length }
 */
export async function summarizeTranscript(args) {
  const text = args?.text;
  const style = args?.style || 'bullet_points';
  const maxLength = args?.max_length || 500;

  if (!text) {
    throw new Error('text is required - provide transcript text to summarize');
  }

  const validStyles = ['bullet_points', 'paragraph', 'key_takeaways', 'detailed'];
  if (!validStyles.includes(style)) {
    throw new Error(`Invalid style. Use one of: ${validStyles.join(', ')}`);
  }

  const wordCount = text.split(/\s+/).length;

  return {
    original_text: text,
    word_count: wordCount,
    style,
    max_length: maxLength,
    instruction: `Please summarize the following transcript in "${style}" style, maximum ${maxLength} words.`,
  };
}

/**
 * ดึง key moments จาก transcript segments
 * @param {object} args - { text, segments }
 */
export async function extractKeyMoments(args) {
  const text = args?.text;
  const segments = args?.segments || [];

  if (!text) {
    throw new Error('text is required');
  }

  return {
    original_text: text,
    segment_count: segments.length,
    segments,
    instruction: 'Please identify key moments from the transcript segments. For each moment, provide: timestamp, topic, and importance_score (1-10).',
  };
}

/**
 * เตรียม transcript สำหรับสร้าง blog post
 * @param {object} args - { text, title, tone }
 */
export async function generateBlogPost(args) {
  const text = args?.text;
  const title = args?.title || '';
  const tone = args?.tone || 'casual';

  if (!text) {
    throw new Error('text is required');
  }

  const validTones = ['formal', 'casual', 'technical'];
  if (!validTones.includes(tone)) {
    throw new Error(`Invalid tone. Use one of: ${validTones.join(', ')}`);
  }

  const wordCount = text.split(/\s+/).length;

  return {
    original_text: text,
    word_count: wordCount,
    suggested_title: title,
    tone,
    instruction: `Please create a blog post from the following transcript. Tone: ${tone}. ${title ? `Suggested title: "${title}".` : 'Please generate a title.'} Include: title, blog_content, meta_description, and tags.`,
  };
}
