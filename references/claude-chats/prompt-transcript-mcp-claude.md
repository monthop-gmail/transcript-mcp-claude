# Prompt: สร้างโปรเจกต์ transcript-mcp-claude

## คำสั่งสำหรับ Claude Code

สร้าง MCP Server ชื่อ **transcript-mcp-claude** เป็น TypeScript project สำหรับถอดเสียง/ข้อความ (transcription) จากหลายแหล่ง ได้แก่ YouTube, ไฟล์ Audio, และไฟล์ Video โดยใช้ร่วมกับ Claude Desktop / Claude Code

---

## โครงสร้างโปรเจกต์

```
transcript-mcp-claude/
├── src/
│   ├── index.ts                      # MCP server entry point
│   ├── config.ts                     # Configuration & environment variables
│   ├── tools/
│   │   ├── index.ts                  # Export all tools
│   │   ├── youtube-transcript.ts     # ดึง transcript จาก YouTube
│   │   ├── audio-transcript.ts       # ถอดเสียงจากไฟล์ audio
│   │   ├── video-transcript.ts       # ถอดเสียงจากไฟล์ video
│   │   ├── translate.ts              # แปลภาษา transcript
│   │   ├── summarize.ts              # สรุปเนื้อหาจาก transcript
│   │   ├── chapters.ts              # สร้าง chapters/timestamps
│   │   ├── subtitle-export.ts        # Export เป็น SRT/VTT/ASS
│   │   └── batch-transcript.ts       # ถอดเสียงหลายไฟล์พร้อมกัน
│   ├── services/
│   │   ├── youtube-service.ts        # YouTube transcript fetcher
│   │   ├── whisper-service.ts        # OpenAI Whisper API / local Whisper
│   │   ├── deepgram-service.ts       # Deepgram API (alternative STT)
│   │   ├── ffmpeg-service.ts         # FFmpeg audio extraction & processing
│   │   ├── translation-service.ts    # Translation provider wrapper
│   │   └── cache-service.ts          # Cache layer for transcripts
│   ├── types/
│   │   ├── transcript.ts             # Transcript data types
│   │   ├── subtitle.ts               # Subtitle format types
│   │   └── tools.ts                  # MCP tool types
│   └── utils/
│       ├── time-format.ts            # Timestamp formatting utilities
│       ├── text-processing.ts        # Text cleanup, punctuation, etc.
│       ├── file-detector.ts          # Detect audio/video file types
│       └── logger.ts                 # Logging utility
├── scripts/
│   └── install-deps.sh              # Install ffmpeg, whisper, etc.
├── temp/                             # Temporary files during processing
│   └── .gitkeep
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5+
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Speech-to-Text**: 
  - `openai` (Whisper API) — primary
  - `@deepgram/sdk` (Deepgram) — alternative, ดีสำหรับ real-time
  - Local Whisper via `whisper.cpp` — offline option
- **YouTube Transcript**: `youtube-transcript` หรือ `youtubei.js`
- **Audio Processing**: `ffmpeg` (via `fluent-ffmpeg`)
- **Cache**: `better-sqlite3`
- **Build**: `tsup` หรือ `tsc`

---

## MCP Tools ที่ต้องสร้าง

### 1. YouTube Transcript (`youtube-transcript.ts`)

```typescript
// Tool: get_youtube_transcript
// - รับ: video_url หรือ video_id, language? (default: auto-detect)
// - ขั้นตอน:
//   1. ดึง transcript จาก YouTube captions (ถ้ามี)
//   2. ถ้าไม่มี captions → download audio → ใช้ Whisper ถอดเสียง
// - ส่งคืน: { text, segments[{start, end, text}], language, source: "captions" | "whisper" }

// Tool: get_youtube_transcript_with_timestamps
// - รับ: video_url หรือ video_id, language?
// - ส่งคืน: formatted text with timestamps (เช่น "[00:00] Hello..." "[00:15] Today we...")

// Tool: list_available_captions
// - รับ: video_url หรือ video_id
// - ส่งคืน: available caption languages & types (auto-generated vs manual)
```

### 2. Audio Transcript (`audio-transcript.ts`)

```typescript
// Tool: transcribe_audio
// - รับ: file_path, language? (auto-detect if not specified), 
//         provider? ("whisper" | "deepgram", default: "whisper"),
//         model? ("tiny" | "base" | "small" | "medium" | "large", default: "base")
// - รองรับ: mp3, wav, m4a, flac, ogg, aac, wma
// - ขั้นตอน:
//   1. ตรวจสอบ format → แปลงเป็น wav/mp3 ถ้าจำเป็น (via ffmpeg)
//   2. ถ้าไฟล์ใหญ่เกิน 25MB → แบ่งเป็น chunks
//   3. ส่งให้ Whisper/Deepgram ถอดเสียง
//   4. รวม chunks กลับเป็น transcript เดียว
// - ส่งคืน: { text, segments[{start, end, text}], language, duration, confidence }

// Tool: transcribe_audio_realtime
// - รับ: file_path (สำหรับ streaming transcription)
// - ใช้ Deepgram streaming API
// - ส่งคืน: progressive transcript updates
```

### 3. Video Transcript (`video-transcript.ts`)

```typescript
// Tool: transcribe_video
// - รับ: file_path, language?, provider?, model?
// - รองรับ: mp4, mkv, mov, webm, avi, flv, wmv
// - ขั้นตอน:
//   1. Extract audio track จาก video ด้วย ffmpeg
//   2. ส่งต่อให้ transcribe_audio
// - ส่งคืน: { text, segments[{start, end, text}], language, duration, confidence }

// Tool: extract_audio
// - รับ: video_path, output_format? ("mp3" | "wav", default: "mp3"), quality? ("low" | "medium" | "high")
// - ส่งคืน: { audio_path, duration, format, file_size }
```

### 4. Translation (`translate.ts`)

```typescript
// Tool: translate_transcript
// - รับ: transcript_text หรือ video_url/file_path, 
//         target_language (เช่น "th", "en", "ja", "zh", "ko"),
//         source_language? (auto-detect)
// - ส่งคืน: { original_text, translated_text, segments_translated[], source_lang, target_lang }

// Tool: create_multilingual_subtitles
// - รับ: transcript_text หรือ video_url/file_path,
//         target_languages[] (เช่น ["th", "en", "ja"])
// - ส่งคืน: { subtitles: { language, srt_content, vtt_content }[] }
```

### 5. Summarize (`summarize.ts`)

```typescript
// Tool: summarize_transcript
// - รับ: transcript_text หรือ video_url/file_path,
//         style? ("bullet_points" | "paragraph" | "key_takeaways" | "detailed"),
//         max_length? (จำนวนคำ)
// - ส่งคืน: { summary, key_points[], duration_of_content }

// Tool: extract_key_moments
// - รับ: transcript_text หรือ video_url/file_path
// - ส่งคืน: { moments[{timestamp, topic, importance_score}] }

// Tool: generate_blog_post
// - รับ: transcript_text หรือ video_url/file_path, title?, tone? ("formal" | "casual" | "technical")
// - ส่งคืน: { title, blog_content, meta_description, tags[] }
```

### 6. Chapters (`chapters.ts`)

```typescript
// Tool: generate_chapters
// - รับ: transcript_text หรือ video_url/file_path,
//         max_chapters? (default: 10), min_chapter_duration? (default: 60 seconds)
// - ส่งคืน: { chapters[{start_time, end_time, title, summary}] }
// - format: YouTube-compatible (เช่น "00:00 Introduction\n02:15 Main Topic\n...")

// Tool: format_chapters_youtube
// - รับ: chapters[]
// - ส่งคืน: YouTube description-ready text
```

### 7. Subtitle Export (`subtitle-export.ts`)

```typescript
// Tool: export_subtitles
// - รับ: transcript (text + segments), 
//         format ("srt" | "vtt" | "ass" | "txt" | "json"),
//         max_chars_per_line? (default: 42),
//         max_lines? (default: 2)
// - ส่งคืน: { file_path, content, format }

// Tool: convert_subtitle_format
// - รับ: file_path, target_format ("srt" | "vtt" | "ass" | "txt")
// - ส่งคืน: { file_path, content }

// Tool: adjust_subtitle_timing
// - รับ: file_path, offset_ms (positive = delay, negative = advance)
// - ส่งคืน: { file_path, content }
```

### 8. Batch Transcript (`batch-transcript.ts`)

```typescript
// Tool: batch_transcribe
// - รับ: file_paths[] หรือ youtube_urls[], language?, provider?
// - ส่งคืน: { results[{source, text, segments, status, error?}] }

// Tool: transcribe_folder
// - รับ: folder_path, extensions? (default: ["mp3", "mp4", "wav", "m4a"]),
//         language?, provider?, recursive? (default: false)
// - ส่งคืน: { results[], total_files, successful, failed }
```

---

## Services Detail

### FFmpeg Service (`ffmpeg-service.ts`)

```typescript
class FFmpegService {
  // Extract audio from video
  extractAudio(videoPath: string, outputFormat: string): Promise<string>
  
  // Convert audio format
  convertAudio(inputPath: string, outputFormat: string, options?: ConvertOptions): Promise<string>
  
  // Split audio into chunks (for large files > 25MB)
  splitAudio(audioPath: string, chunkDurationSec: number): Promise<string[]>
  
  // Get media info (duration, format, bitrate, etc.)
  getMediaInfo(filePath: string): Promise<MediaInfo>
  
  // Merge audio chunks
  mergeAudio(chunkPaths: string[], outputPath: string): Promise<string>
}
```

### Whisper Service (`whisper-service.ts`)

```typescript
class WhisperService {
  // Transcribe via OpenAI Whisper API
  transcribeAPI(audioPath: string, options?: WhisperOptions): Promise<TranscriptResult>
  
  // Transcribe via local whisper.cpp (offline)
  transcribeLocal(audioPath: string, model: string): Promise<TranscriptResult>
  
  // Auto-detect language
  detectLanguage(audioPath: string): Promise<string>
}
```

### YouTube Service (`youtube-service.ts`)

```typescript
class YouTubeService {
  // Get captions/transcript from YouTube
  getTranscript(videoId: string, language?: string): Promise<TranscriptResult>
  
  // List available caption tracks
  listCaptions(videoId: string): Promise<CaptionTrack[]>
  
  // Download audio from YouTube video (via yt-dlp)
  downloadAudio(videoUrl: string, outputPath: string): Promise<string>
  
  // Get video metadata
  getVideoInfo(videoId: string): Promise<VideoInfo>
  
  // Parse video ID from various URL formats
  parseVideoId(input: string): string
}
```

---

## Supported Formats

### Audio Input
| Format | Extension | Notes |
|--------|-----------|-------|
| MP3 | .mp3 | Most common |
| WAV | .wav | Uncompressed, best quality |
| M4A | .m4a | Apple format |
| FLAC | .flac | Lossless |
| OGG | .ogg | Open format |
| AAC | .aac | Advanced audio |
| WMA | .wma | Windows format |

### Video Input
| Format | Extension | Notes |
|--------|-----------|-------|
| MP4 | .mp4 | Most common |
| MKV | .mkv | Matroska |
| MOV | .mov | Apple QuickTime |
| WebM | .webm | Web format |
| AVI | .avi | Legacy format |
| FLV | .flv | Flash video |
| WMV | .wmv | Windows format |

### Subtitle Output
| Format | Extension | Use Case |
|--------|-----------|----------|
| SRT | .srt | Most universal |
| VTT | .vtt | Web/HTML5 video |
| ASS | .ass | Styled subtitles |
| TXT | .txt | Plain text |
| JSON | .json | Programmatic use |

---

## .env.example

```env
# Speech-to-Text Providers (ใช้อย่างน้อย 1 ตัว)
OPENAI_API_KEY=your_openai_api_key              # สำหรับ Whisper API
DEEPGRAM_API_KEY=your_deepgram_api_key          # สำหรับ Deepgram (optional)

# Whisper Settings
WHISPER_MODEL=base                              # tiny/base/small/medium/large
WHISPER_MODE=api                                # api/local

# YouTube (optional - สำหรับ download audio จาก age-restricted videos)
YOUTUBE_COOKIES_PATH=                           # path to cookies.txt

# Processing
TEMP_DIR=./temp
MAX_FILE_SIZE_MB=500
CHUNK_DURATION_SEC=600                          # 10 minutes per chunk
CACHE_TTL_SECONDS=3600                          # cache transcript for 1 hour

# Translation (optional)
TRANSLATION_PROVIDER=google                     # google/deepl
DEEPL_API_KEY=                                  # สำหรับ DeepL (optional)
```

---

## System Dependencies

สร้าง `scripts/install-deps.sh`:

```bash
#!/bin/bash
# Install system dependencies

# FFmpeg (required)
# macOS
brew install ffmpeg

# Ubuntu/Debian
# sudo apt-get install ffmpeg

# yt-dlp (required for YouTube audio download)
pip install yt-dlp

# whisper.cpp (optional - for local transcription)
# brew install whisper-cpp
# หรือ build from source: https://github.com/ggerganov/whisper.cpp
```

---

## MCP Server Configuration (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "transcript-mcp-claude": {
      "command": "node",
      "args": ["path/to/transcript-mcp-claude/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "xxx",
        "WHISPER_MODEL": "base",
        "WHISPER_MODE": "api"
      }
    }
  }
}
```

---

## ข้อกำหนดเพิ่มเติม

1. **Error Handling**: จัดการกรณี file ไม่รองรับ, API error, file size เกิน limit
2. **Progress Tracking**: แสดง progress สำหรับไฟล์ใหญ่ (เช่น "Processing chunk 3/10...")
3. **Temp File Cleanup**: ลบไฟล์ชั่วคราวหลัง process เสร็จ
4. **Caching**: cache transcript ที่เคยทำแล้ว (key = file hash + language)
5. **Input Validation**: validate file paths, URLs, language codes ด้วย zod
6. **Graceful Fallback**: 
   - YouTube: ลอง captions ก่อน → ถ้าไม่มีค่อย download + whisper
   - Whisper API fail → fallback to Deepgram (ถ้ามี key)
7. **Large File Handling**: 
   - แบ่ง chunk อัตโนมัติถ้า > 25MB
   - Overlap 2 วินาทีระหว่าง chunks เพื่อไม่ให้ตัดกลางประโยค
8. **README.md**: คู่มือติดตั้ง, setup API keys, ตัวอย่างการใช้ทุก tool
9. **TypeScript Strict Mode**: เปิด strict
10. **Unit Tests**: test time formatting, text processing, file detection

---

## ลำดับการ Build

1. ตั้งค่า project (package.json, tsconfig, dependencies)
2. สร้าง FFmpeg service (audio extraction & conversion)
3. สร้าง YouTube service (transcript fetching + audio download)
4. สร้าง Whisper service (API + local)
5. สร้าง MCP server skeleton (index.ts)
6. สร้าง tools: youtube-transcript → audio-transcript → video-transcript
7. เพิ่ม subtitle export tools
8. เพิ่ม translate & summarize tools
9. เพิ่ม chapters & batch tools
10. เพิ่ม caching layer
11. เขียน README
12. ทดสอบทุก tool

---

## ตัวอย่างการใช้งานผ่าน Claude

```
User: "ถอดเสียงวิดีโอ YouTube นี้ให้หน่อย https://youtube.com/watch?v=xxx"
→ Claude เรียก get_youtube_transcript

User: "แปลเป็นภาษาไทยด้วย"
→ Claude เรียก translate_transcript

User: "สร้าง chapters ให้หน่อย"
→ Claude เรียก generate_chapters

User: "Export เป็นไฟล์ SRT"
→ Claude เรียก export_subtitles

User: "ถอดเสียงไฟล์ recording.mp3 ในเครื่อง"
→ Claude เรียก transcribe_audio

User: "ถอดเสียงไฟล์ video ทั้งหมดในโฟลเดอร์ ~/recordings/"
→ Claude เรียก transcribe_folder

User: "สรุปเนื้อหาวิดีโอนี้เป็น blog post"
→ Claude เรียก get_youtube_transcript → generate_blog_post
```
