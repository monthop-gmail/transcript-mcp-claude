/**
 * Chapter Generation Tools
 * สร้าง chapter markers จาก transcript segments
 * รองรับ YouTube chapter format
 */

/**
 * Format seconds เป็น HH:MM:SS หรือ MM:SS
 */
function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * สร้าง chapters จาก transcript segments
 * @param {object} args - { text, segments, max_chapters, min_chapter_duration }
 */
export async function generateChapters(args) {
  const text = args?.text;
  const segments = args?.segments || [];
  const maxChapters = args?.max_chapters || 10;
  const minDuration = args?.min_chapter_duration || 60; // seconds

  if (!text && segments.length === 0) {
    throw new Error('text or segments required');
  }

  // ถ้ามี segments พร้อม timestamps ให้สร้าง chapter markers
  if (segments.length > 0) {
    const lastSeg = segments[segments.length - 1];
    const totalDuration = lastSeg.end || (lastSeg.start + (lastSeg.duration || 0));

    // คำนวณจำนวน chapter ที่เหมาะสม
    const idealChapters = Math.min(maxChapters, Math.floor(totalDuration / minDuration));
    const chapterCount = Math.max(1, idealChapters);
    const chapterDuration = totalDuration / chapterCount;

    const chapters = [];
    for (let i = 0; i < chapterCount; i++) {
      const targetTime = i * chapterDuration;
      // หา segment ที่ใกล้ timestamp นี้ที่สุด
      const nearestSeg = segments.reduce((prev, curr) => {
        const prevStart = prev.start || 0;
        const currStart = curr.start || 0;
        return Math.abs(currStart - targetTime) < Math.abs(prevStart - targetTime) ? curr : prev;
      });

      chapters.push({
        index: i + 1,
        start_time: nearestSeg.start || targetTime,
        start_formatted: formatTimestamp(nearestSeg.start || targetTime),
        preview_text: nearestSeg.text || '',
      });
    }

    // สร้าง YouTube-compatible format
    const youtubeFormat = chapters
      .map(ch => `${ch.start_formatted} ${ch.preview_text.substring(0, 60)}`)
      .join('\n');

    return {
      total_duration: totalDuration,
      chapter_count: chapters.length,
      chapters,
      youtube_format: youtubeFormat,
      segments,
      instruction: 'The chapters above are auto-generated based on even time distribution. Please refine the chapter titles based on the actual content at each timestamp.',
    };
  }

  // Text-only: ส่งข้อมูลให้ Claude สร้าง chapters
  return {
    text,
    max_chapters: maxChapters,
    instruction: `Please divide this transcript into up to ${maxChapters} logical chapters. For each chapter, provide: start_time (if identifiable), title, and a brief summary.`,
  };
}

/**
 * Format chapters สำหรับ YouTube description
 * @param {object} args - { chapters }
 */
export async function formatChaptersYoutube(args) {
  const chapters = args?.chapters || [];

  if (!chapters.length) {
    throw new Error('chapters array is required');
  }

  const formatted = chapters.map(ch => {
    const time = ch.start_formatted || formatTimestamp(ch.start_time || 0);
    const title = ch.title || ch.preview_text || 'Untitled';
    return `${time} ${title}`;
  }).join('\n');

  return {
    youtube_description: formatted,
    chapter_count: chapters.length,
  };
}
