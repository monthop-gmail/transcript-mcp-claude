/**
 * Summarization Tools
 * จัดโครงสร้าง transcript data สำหรับให้ Claude สรุป
 * รองรับหลาย style: bullet_points, paragraph, key_takeaways, detailed
 */

import type { SummarizeArgs, KeyMomentsArgs, BlogPostArgs, SummarizationPrep, KeyMomentsPrep, BlogPostPrep } from './types.js';

const VALID_STYLES = ['bullet_points', 'paragraph', 'key_takeaways', 'detailed'] as const;
const VALID_TONES = ['formal', 'casual', 'technical'] as const;

export async function summarizeTranscript(args: SummarizeArgs): Promise<SummarizationPrep> {
  const { text, style = 'bullet_points', max_length = 500 } = args;

  if (!text) {
    throw new Error('text is required - provide transcript text to summarize');
  }

  if (!(VALID_STYLES as readonly string[]).includes(style)) {
    throw new Error(`Invalid style. Use one of: ${VALID_STYLES.join(', ')}`);
  }

  const wordCount = text.split(/\s+/).length;

  return {
    original_text: text,
    word_count: wordCount,
    style,
    max_length,
    instruction: `Please summarize the following transcript in "${style}" style, maximum ${max_length} words.`,
  };
}

export async function extractKeyMoments(args: KeyMomentsArgs): Promise<KeyMomentsPrep> {
  const { text, segments = [] } = args;

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

export async function generateBlogPost(args: BlogPostArgs): Promise<BlogPostPrep> {
  const { text, title = '', tone = 'casual' } = args;

  if (!text) {
    throw new Error('text is required');
  }

  if (!(VALID_TONES as readonly string[]).includes(tone)) {
    throw new Error(`Invalid tone. Use one of: ${VALID_TONES.join(', ')}`);
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
