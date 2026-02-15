#!/usr/bin/env node

/**
 * MCP Server for All-in-One Transcription - Stdio Transport
 * รวม YouTube, Audio, Video transcript + Translation, Summarization, Chapters, Subtitles, Batch
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { config } from './config.js';
import { extractVideoID, getTranscript, getVideoInfo, listAvailableCaptions } from './youtube.js';
import { transcribeAudio, getAudioInfo } from './audio.js';
import { transcribeVdo, getVdoInfo } from './vdo.js';
import { translateTranscript, createMultilingualSubtitles } from './translate.js';
import { summarizeTranscript, extractKeyMoments, generateBlogPost } from './summarize.js';
import { generateChapters, formatChaptersYoutube } from './chapters.js';
import { exportSubtitles, convertSubtitleFormat, adjustSubtitleTiming } from './subtitle.js';
import { batchTranscribe, transcribeFolder } from './batch.js';

// Create server instance
const server = new Server(
  {
    name: 'transcript-mcp-claude',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define all 19 tools
const TOOLS = [
  // --- YouTube (3) ---
  {
    name: 'youtube_to_text',
    description: 'ดึง transcript/subtitle จาก YouTube video / Get transcript from YouTube video',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'YouTube URL หรือ Video ID เช่น https://youtube.com/watch?v=xxx หรือ xxx',
        },
        lang: {
          type: 'string',
          description: 'ภาษา subtitle เช่น "th", "en" (default: "th")',
          default: 'th',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'youtube_video_info',
    description: 'ดึงข้อมูลวิดีโอ YouTube เช่น ชื่อ, ความยาว, subtitle ที่มี / Get YouTube video metadata',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'YouTube URL หรือ Video ID',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'youtube_list_captions',
    description: 'แสดงรายการ caption/subtitle ที่มีอยู่ใน YouTube video / List available captions',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'YouTube URL หรือ Video ID',
        },
      },
      required: ['url'],
    },
  },
  // --- Audio (2) ---
  {
    name: 'audio_to_text',
    description: 'แปลงไฟล์เสียงเป็นข้อความด้วย Whisper / Transcribe audio file to text',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'เส้นทางไฟล์เสียง เช่น /app/data/audio.mp3',
        },
        url: {
          type: 'string',
          description: 'URL ของไฟล์เสียง',
        },
        lang: {
          type: 'string',
          description: 'ภาษา: "th", "en", "auto" (default: "th")',
          default: 'th',
        },
        model_size: {
          type: 'string',
          description: 'Whisper model: "tiny", "base", "small" (default: "tiny")',
          default: 'tiny',
        },
      },
    },
  },
  {
    name: 'audio_info',
    description: 'ดึงข้อมูลไฟล์เสียง เช่น ความยาว, format, sample rate / Get audio file metadata',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'เส้นทางไฟล์เสียง',
        },
        url: {
          type: 'string',
          description: 'URL ของไฟล์เสียง',
        },
      },
    },
  },
  // --- Video (2) ---
  {
    name: 'vdo_to_text',
    description: 'แปลงไฟล์วิดีโอเป็นข้อความด้วย ffmpeg + Whisper / Transcribe video to text',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'เส้นทางไฟล์วิดีโอ เช่น /app/data/video.mp4',
        },
        url: {
          type: 'string',
          description: 'URL ของไฟล์วิดีโอ',
        },
        lang: {
          type: 'string',
          description: 'ภาษา: "th", "en", "auto" (default: "th")',
          default: 'th',
        },
        model_size: {
          type: 'string',
          description: 'Whisper model: "tiny", "base", "small" (default: "tiny")',
          default: 'tiny',
        },
      },
    },
  },
  {
    name: 'vdo_info',
    description: 'ดึงข้อมูลไฟล์วิดีโอ เช่น ความยาว, resolution, fps, codec / Get video file metadata',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'เส้นทางไฟล์วิดีโอ',
        },
        url: {
          type: 'string',
          description: 'URL ของไฟล์วิดีโอ',
        },
      },
    },
  },
  // --- Translation (2) ---
  {
    name: 'translate_transcript',
    description: 'เตรียม transcript สำหรับแปลภาษา / Prepare transcript for translation',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'ข้อความ transcript ที่ต้องการแปล',
        },
        segments: {
          type: 'array',
          description: 'Transcript segments พร้อม timestamps',
          items: { type: 'object' },
        },
        target_language: {
          type: 'string',
          description: 'ภาษาเป้าหมาย เช่น "en", "th", "ja", "zh", "ko"',
        },
        source_language: {
          type: 'string',
          description: 'ภาษาต้นฉบับ (default: "auto")',
          default: 'auto',
        },
      },
      required: ['text', 'target_language'],
    },
  },
  {
    name: 'create_multilingual_subtitles',
    description: 'เตรียม transcript สำหรับสร้าง subtitle หลายภาษา / Prepare multilingual subtitles',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'ข้อความ transcript',
        },
        segments: {
          type: 'array',
          description: 'Transcript segments',
          items: { type: 'object' },
        },
        target_languages: {
          type: 'array',
          description: 'รายการภาษาเป้าหมาย เช่น ["en", "th", "ja"]',
          items: { type: 'string' },
        },
      },
      required: ['text', 'target_languages'],
    },
  },
  // --- Summarization (3) ---
  {
    name: 'summarize_transcript',
    description: 'เตรียม transcript สำหรับสรุปเนื้อหา / Prepare transcript for summarization',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'ข้อความ transcript ที่ต้องการสรุป',
        },
        style: {
          type: 'string',
          description: 'รูปแบบการสรุป: "bullet_points", "paragraph", "key_takeaways", "detailed"',
          default: 'bullet_points',
        },
        max_length: {
          type: 'number',
          description: 'จำนวนคำสูงสุดของบทสรุป (default: 500)',
          default: 500,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_key_moments',
    description: 'ดึง key moments จาก transcript พร้อม timestamps / Extract key moments',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'ข้อความ transcript',
        },
        segments: {
          type: 'array',
          description: 'Transcript segments พร้อม timestamps',
          items: { type: 'object' },
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'generate_blog_post',
    description: 'เตรียม transcript สำหรับสร้าง blog post / Prepare transcript for blog post',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'ข้อความ transcript',
        },
        title: {
          type: 'string',
          description: 'ชื่อ blog post ที่ต้องการ (ถ้ามี)',
        },
        tone: {
          type: 'string',
          description: 'โทนการเขียน: "formal", "casual", "technical"',
          default: 'casual',
        },
      },
      required: ['text'],
    },
  },
  // --- Chapters (2) ---
  {
    name: 'generate_chapters',
    description: 'สร้าง chapter markers จาก transcript segments / Generate chapter markers',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'ข้อความ transcript',
        },
        segments: {
          type: 'array',
          description: 'Transcript segments พร้อม start/end timestamps',
          items: { type: 'object' },
        },
        max_chapters: {
          type: 'number',
          description: 'จำนวน chapters สูงสุด (default: 10)',
          default: 10,
        },
        min_chapter_duration: {
          type: 'number',
          description: 'ความยาวขั้นต่ำของแต่ละ chapter (วินาที, default: 60)',
          default: 60,
        },
      },
    },
  },
  {
    name: 'format_chapters_youtube',
    description: 'แปลง chapters เป็น YouTube description format (00:00 Title)',
    inputSchema: {
      type: 'object',
      properties: {
        chapters: {
          type: 'array',
          description: 'Chapters array พร้อม start_time/start_formatted และ title',
          items: { type: 'object' },
        },
      },
      required: ['chapters'],
    },
  },
  // --- Subtitle Export (3) ---
  {
    name: 'export_subtitles',
    description: 'แปลง transcript segments เป็น SRT, VTT, ASS, TXT หรือ JSON / Export subtitles',
    inputSchema: {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          description: 'Segments array [{start, end, text}, ...]',
          items: { type: 'object' },
        },
        format: {
          type: 'string',
          description: 'รูปแบบ output: "srt", "vtt", "ass", "txt", "json" (default: "srt")',
          default: 'srt',
        },
        max_chars_per_line: {
          type: 'number',
          description: 'จำนวนตัวอักษรสูงสุดต่อบรรทัด (default: 42)',
          default: 42,
        },
        max_lines: {
          type: 'number',
          description: 'จำนวนบรรทัดสูงสุดต่อ subtitle (default: 2)',
          default: 2,
        },
      },
      required: ['segments'],
    },
  },
  {
    name: 'convert_subtitle_format',
    description: 'แปลง subtitle ระหว่าง format (SRT <-> VTT <-> ASS <-> TXT)',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'เนื้อหาไฟล์ subtitle เป็น string',
        },
        source_format: {
          type: 'string',
          description: 'Format ต้นทาง: "srt" หรือ "vtt" (default: "srt")',
          default: 'srt',
        },
        target_format: {
          type: 'string',
          description: 'Format ปลายทาง: "srt", "vtt", "ass", "txt"',
        },
      },
      required: ['content', 'target_format'],
    },
  },
  {
    name: 'adjust_subtitle_timing',
    description: 'ปรับ timing ของ subtitle (positive=delay, negative=advance) / Adjust subtitle timing',
    inputSchema: {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          description: 'Segments array [{start, end, text}, ...]',
          items: { type: 'object' },
        },
        offset_ms: {
          type: 'number',
          description: 'Offset ในหน่วย millisecond (บวก=delay, ลบ=advance)',
        },
      },
      required: ['segments', 'offset_ms'],
    },
  },
  // --- Batch Processing (2) ---
  {
    name: 'batch_transcribe',
    description: 'Transcribe หลายไฟล์ audio/video พร้อมกัน / Batch transcribe multiple files',
    inputSchema: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          description: 'รายการ file paths หรือ URLs',
          items: { type: 'string' },
        },
        lang: {
          type: 'string',
          description: 'ภาษา (default: "th")',
          default: 'th',
        },
        model_size: {
          type: 'string',
          description: 'Whisper model size (default: "tiny")',
          default: 'tiny',
        },
      },
      required: ['sources'],
    },
  },
  {
    name: 'transcribe_folder',
    description: 'Transcribe ไฟล์ audio/video ทั้งหมดใน folder / Transcribe all files in folder',
    inputSchema: {
      type: 'object',
      properties: {
        folder_path: {
          type: 'string',
          description: 'เส้นทาง folder ที่มีไฟล์ media',
        },
        extensions: {
          type: 'array',
          description: 'นามสกุลไฟล์ที่ต้องการ (default: ["mp3", "mp4", "wav", "m4a"])',
          items: { type: 'string' },
        },
        lang: {
          type: 'string',
          description: 'ภาษา (default: "th")',
          default: 'th',
        },
        model_size: {
          type: 'string',
          description: 'Whisper model size (default: "tiny")',
          default: 'tiny',
        },
        recursive: {
          type: 'boolean',
          description: 'สแกน subdirectories ด้วย (default: false)',
          default: false,
        },
      },
      required: ['folder_path'],
    },
  },
];

// Helper: Format response
function formatResponse(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

// Helper: Format error response
function formatError(message) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: true, message }),
      },
    ],
    isError: true,
  };
}

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // YouTube
      case 'youtube_to_text': {
        if (!args?.url) return formatError('URL หรือ Video ID จำเป็นต้องระบุ');
        const videoID = extractVideoID(args.url);
        const lang = args?.lang || config.DEFAULT_LANG;
        return formatResponse(await getTranscript(videoID, lang));
      }
      case 'youtube_video_info': {
        if (!args?.url) return formatError('URL หรือ Video ID จำเป็นต้องระบุ');
        const videoID = extractVideoID(args.url);
        return formatResponse(await getVideoInfo(videoID));
      }
      case 'youtube_list_captions': {
        if (!args?.url) return formatError('URL หรือ Video ID จำเป็นต้องระบุ');
        const videoID = extractVideoID(args.url);
        return formatResponse(await listAvailableCaptions(videoID));
      }

      // Audio
      case 'audio_to_text':
        return formatResponse(await transcribeAudio(args));
      case 'audio_info':
        return formatResponse(await getAudioInfo(args));

      // Video
      case 'vdo_to_text':
        return formatResponse(await transcribeVdo(args));
      case 'vdo_info':
        return formatResponse(await getVdoInfo(args));

      // Translation
      case 'translate_transcript':
        return formatResponse(await translateTranscript(args));
      case 'create_multilingual_subtitles':
        return formatResponse(await createMultilingualSubtitles(args));

      // Summarization
      case 'summarize_transcript':
        return formatResponse(await summarizeTranscript(args));
      case 'extract_key_moments':
        return formatResponse(await extractKeyMoments(args));
      case 'generate_blog_post':
        return formatResponse(await generateBlogPost(args));

      // Chapters
      case 'generate_chapters':
        return formatResponse(await generateChapters(args));
      case 'format_chapters_youtube':
        return formatResponse(await formatChaptersYoutube(args));

      // Subtitle Export
      case 'export_subtitles':
        return formatResponse(await exportSubtitles(args));
      case 'convert_subtitle_format':
        return formatResponse(await convertSubtitleFormat(args));
      case 'adjust_subtitle_timing':
        return formatResponse(await adjustSubtitleTiming(args));

      // Batch Processing
      case 'batch_transcribe':
        return formatResponse(await batchTranscribe(args));
      case 'transcribe_folder':
        return formatResponse(await transcribeFolder(args));

      default:
        return formatError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error in ${name}:`, error);
    return formatError(error.message);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Transcript MCP Server v1.0 running on stdio');
  console.error(`Tools: ${TOOLS.length}`);
}

process.on('SIGINT', () => {
  console.error('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down...');
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
