/**
 * Subtitle Export Tools
 * แปลง transcript segments เป็น SRT, VTT, ASS, TXT, JSON
 * รองรับ format conversion และ timing adjustment
 */

import type { Segment, ExportSubtitlesArgs, ConvertSubtitleArgs, AdjustTimingArgs, SubtitleExportResult, SubtitleTimingResult } from './types.js';

function formatSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function formatVTT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function wrapText(text: string, maxChars = 42, maxLines = 2): string {
  if (text.length <= maxChars) return text;
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    if (currentLine && (currentLine + ' ' + word).length > maxChars) {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) break;
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    }
  }
  if (currentLine && lines.length < maxLines) lines.push(currentLine);
  return lines.join('\n');
}

function generateSRTContent(segments: Segment[], maxChars: number, maxLines: number): string {
  return segments.map((seg, i) => {
    const start = seg.start || 0;
    const end = seg.end || (start + (seg.duration || 2));
    const text = wrapText(seg.text, maxChars, maxLines);
    return `${i + 1}\n${formatSRT(start)} --> ${formatSRT(end)}\n${text}`;
  }).join('\n\n');
}

function generateVTTContent(segments: Segment[], maxChars: number, maxLines: number): string {
  const cues = segments.map((seg) => {
    const start = seg.start || 0;
    const end = seg.end || (start + (seg.duration || 2));
    const text = wrapText(seg.text, maxChars, maxLines);
    return `${formatVTT(start)} --> ${formatVTT(end)}\n${text}`;
  }).join('\n\n');
  return `WEBVTT\n\n${cues}`;
}

function generateASSContent(segments: Segment[]): string {
  const header = `[Script Info]
Title: Transcript
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  function formatASSTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.round((seconds % 1) * 100);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  }

  const events = segments.map(seg => {
    const start = seg.start || 0;
    const end = seg.end || (start + (seg.duration || 2));
    const text = seg.text.replace(/\n/g, '\\N');
    return `Dialogue: 0,${formatASSTime(start)},${formatASSTime(end)},Default,,0,0,0,,${text}`;
  }).join('\n');

  return `${header}\n${events}`;
}

function parseSRTTime(timeStr: string): number {
  const [h, m, rest] = timeStr.split(':');
  const [s, ms] = rest.split(',');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

function parseVTTTime(timeStr: string): number {
  const [h, m, rest] = timeStr.split(':');
  const [s, ms] = rest.split('.');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

export async function exportSubtitles(args: ExportSubtitlesArgs): Promise<SubtitleExportResult> {
  const { segments, format = 'srt', max_chars_per_line = 42, max_lines = 2 } = args;

  if (!segments?.length) {
    throw new Error('segments array is required (each with start, end/duration, text)');
  }

  const validFormats = ['srt', 'vtt', 'ass', 'txt', 'json'];
  if (!validFormats.includes(format)) {
    throw new Error(`Invalid format. Use one of: ${validFormats.join(', ')}`);
  }

  let content: string;
  switch (format) {
    case 'srt':
      content = generateSRTContent(segments, max_chars_per_line, max_lines);
      break;
    case 'vtt':
      content = generateVTTContent(segments, max_chars_per_line, max_lines);
      break;
    case 'ass':
      content = generateASSContent(segments);
      break;
    case 'txt':
      content = segments.map(s => s.text).join('\n');
      break;
    case 'json':
      content = JSON.stringify(segments, null, 2);
      break;
    default:
      content = '';
  }

  return {
    format,
    segment_count: segments.length,
    content,
  };
}

export async function convertSubtitleFormat(args: ConvertSubtitleArgs): Promise<SubtitleExportResult> {
  const { content, source_format = 'srt', target_format } = args;

  if (!content) throw new Error('content is required (subtitle file content as string)');
  if (!target_format) throw new Error('target_format is required (srt, vtt, ass, txt)');

  const segments: Segment[] = [];

  if (source_format === 'srt') {
    const blocks = content.trim().split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length >= 3) {
        const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
        if (timeMatch) {
          segments.push({
            start: parseSRTTime(timeMatch[1]),
            end: parseSRTTime(timeMatch[2]),
            text: lines.slice(2).join('\n'),
          });
        }
      }
    }
  } else if (source_format === 'vtt') {
    const blocks = content.replace(/^WEBVTT\n*/, '').trim().split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const timeMatch = lines[i].match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timeMatch) {
          segments.push({
            start: parseVTTTime(timeMatch[1]),
            end: parseVTTTime(timeMatch[2]),
            text: lines.slice(i + 1).join('\n'),
          });
          break;
        }
      }
    }
  } else {
    throw new Error(`Unsupported source format: ${source_format}. Supported: srt, vtt`);
  }

  if (segments.length === 0) {
    throw new Error('Could not parse any segments from the provided content');
  }

  return exportSubtitles({ segments, format: target_format });
}

export async function adjustSubtitleTiming(args: AdjustTimingArgs): Promise<SubtitleTimingResult> {
  const { segments, offset_ms } = args;

  if (!segments?.length) {
    throw new Error('segments array is required');
  }
  if (offset_ms === 0 || offset_ms === undefined) {
    throw new Error('offset_ms is required (positive = delay, negative = advance)');
  }

  const offsetSec = offset_ms / 1000;
  const adjusted: Segment[] = segments.map(seg => ({
    ...seg,
    start: Math.max(0, (seg.start || 0) + offsetSec),
    end: seg.end !== undefined ? Math.max(0, seg.end + offsetSec) : undefined as unknown as number,
  }));

  return {
    offset_ms,
    segment_count: adjusted.length,
    segments: adjusted,
  };
}
