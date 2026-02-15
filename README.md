# transcript-mcp-claude

MCP Server All-in-One สำหรับ Transcription - รวม YouTube, Audio, Video + Translation, Summarization, Chapters, Subtitles, Batch Processing

## Features

**19 MCP Tools** ใน 8 หมวด:

| หมวด | Tools | คำอธิบาย |
|------|-------|----------|
| YouTube (3) | `youtube_to_text`, `youtube_video_info`, `youtube_list_captions` | ดึง transcript และข้อมูลจาก YouTube |
| Audio (2) | `audio_to_text`, `audio_info` | แปลงไฟล์เสียงเป็นข้อความด้วย Whisper |
| Video (2) | `vdo_to_text`, `vdo_info` | แปลงไฟล์วิดีโอเป็นข้อความด้วย ffmpeg + Whisper |
| Translation (2) | `translate_transcript`, `create_multilingual_subtitles` | เตรียมข้อมูลสำหรับแปลภาษา |
| Summarization (3) | `summarize_transcript`, `extract_key_moments`, `generate_blog_post` | สรุปเนื้อหา, ดึง key moments, สร้าง blog post |
| Chapters (2) | `generate_chapters`, `format_chapters_youtube` | สร้าง chapter markers + YouTube format |
| Subtitles (3) | `export_subtitles`, `convert_subtitle_format`, `adjust_subtitle_timing` | Export SRT/VTT/ASS, แปลง format, ปรับ timing |
| Batch (2) | `batch_transcribe`, `transcribe_folder` | ประมวลผลหลายไฟล์พร้อมกัน |

## Tech Stack

- **Runtime**: Node.js 22 + Python 3.12
- **MCP SDK**: @modelcontextprotocol/sdk v1.0.0
- **Transport**: SSE (port 3013) + Stdio
- **STT Engine**: faster-whisper (CTranslate2, CPU, int8)
- **YouTube**: Innertube API + yt-dlp fallback
- **Video/Audio**: ffmpeg + ffprobe

## Quick Start

### Docker (แนะนำ)

```bash
# Build and start
docker compose up -d --build

# ตรวจสอบ
curl http://localhost:3013/health
```

### Local Development

```bash
# Install dependencies
npm install

# Start SSE server
npm start

# Start Stdio server
npm run start:stdio

# Development mode (auto-reload)
npm run dev
```

## Environment Variables

| Variable | Default | คำอธิบาย |
|----------|---------|----------|
| `PORT` | 3013 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `DEFAULT_LANG` | th | ภาษาเริ่มต้น |
| `WHISPER_MODEL` | tiny | Whisper model: tiny, base, small |
| `WHISPER_COMPUTE_TYPE` | int8 | Compute type: int8, float16, float32 |
| `MAX_AUDIO_DURATION` | 600 | Audio max duration (วินาที) |
| `MAX_VDO_DURATION` | 1800 | Video max duration (วินาที) |
| `OMP_NUM_THREADS` | 2 | CPU threads สำหรับ inference |

## MCP Configuration

เพิ่มใน `.mcp.json`:

```json
{
  "mcpServers": {
    "transcript": {
      "url": "http://localhost:3013/sse"
    }
  }
}
```

## Usage Examples

### YouTube Transcript
```
ดึง transcript จาก YouTube video นี้: https://youtube.com/watch?v=xxx
```

### Audio Transcription
```
แปลงไฟล์เสียง /app/data/audio.mp3 เป็นข้อความ
```

### Video Transcription
```
แปลงไฟล์วิดีโอ /app/data/video.mp4 เป็นข้อความ
```

### Export Subtitles
```
สร้างไฟล์ SRT จาก transcript ที่ได้
```

### Generate Chapters
```
สร้าง chapter markers จาก transcript สำหรับใส่ YouTube description
```

### Batch Processing
```
Transcribe ไฟล์ทั้งหมดใน folder /app/data/
```

## Supported Formats

- **Audio**: MP3, WAV, M4A, OGG, FLAC, WebM, WMA, AAC, Opus
- **Video**: MP4, MKV, AVI, MOV, WebM, FLV, WMV, TS, M4V
- **Subtitles**: SRT, VTT, ASS, TXT, JSON

## Architecture

```
Client (Claude) → MCP Protocol → transcript-mcp-claude (port 3013)
                                    ├── YouTube (Innertube API / yt-dlp)
                                    ├── Audio (faster-whisper)
                                    ├── Video (ffmpeg → faster-whisper)
                                    ├── Translation (data structuring)
                                    ├── Summarization (data structuring)
                                    ├── Chapters (timestamp analysis)
                                    ├── Subtitles (SRT/VTT/ASS export)
                                    └── Batch (multi-file orchestration)
```

## Port Convention

| Port | Project |
|------|---------|
| 3010 | youtube-mcp-claude |
| 3011 | audio-mcp-claude |
| 3012 | vdo-mcp-claude |
| **3013** | **transcript-mcp-claude (All-in-One)** |
