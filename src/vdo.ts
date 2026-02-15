/**
 * Video Transcription Core Logic
 * แปลงไฟล์วิดีโอเป็นข้อความโดย:
 * 1. ffmpeg extract audio จาก video → WAV
 * 2. faster-whisper transcribe audio → text
 * 3. ffprobe สำหรับดึงข้อมูลวิดีโอ
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { promisify } from 'util';
import { dirname, join, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import type { VdoTranscribeArgs, VdoInfoArgs, VdoTranscriptResult, VdoFileInfo, ProbeData, WhisperResult } from './types.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PYTHON_WORKER = join(PROJECT_ROOT, 'python', 'whisper_worker.py');

const SUPPORTED_FORMATS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.ts', '.m4v'];

async function downloadVdo(url: string): Promise<string> {
  if (!existsSync(config.TEMP_DIR)) {
    mkdirSync(config.TEMP_DIR, { recursive: true });
  }

  const fileName = `dl-${Date.now()}${extname(new URL(url).pathname) || '.mp4'}`;
  const filePath = join(config.TEMP_DIR, fileName);

  try {
    await execFileAsync('curl', [
      '-L', '-f', '-s', '-S',
      '--max-time', '300',
      '--max-filesize', '524288000',
      '-o', filePath,
      url,
    ], { timeout: 310000 });

    if (!existsSync(filePath)) {
      throw new Error('ดาวน์โหลดไม่สำเร็จ: ไม่พบไฟล์');
    }

    return filePath;
  } catch (e) {
    try { unlinkSync(filePath); } catch {}
    throw new Error(`ดาวน์โหลดไม่สำเร็จ: ${(e as Error).message}`);
  }
}

interface ResolvedSource {
  localPath: string;
  shouldCleanup: boolean;
}

async function resolveVdoSource(filePath?: string, url?: string): Promise<ResolvedSource> {
  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`ไม่พบไฟล์: ${filePath}`);
    }
    const ext = extname(filePath).toLowerCase();
    if (ext && !SUPPORTED_FORMATS.includes(ext)) {
      throw new Error(`ไม่รองรับ format: ${ext} (รองรับ: ${SUPPORTED_FORMATS.join(', ')})`);
    }
    return { localPath: filePath, shouldCleanup: false };
  }

  if (url) {
    const localPath = await downloadVdo(url);
    return { localPath, shouldCleanup: true };
  }

  throw new Error('ต้องระบุ file_path หรือ url อย่างใดอย่างหนึ่ง');
}

async function runFfprobe(filePath: string): Promise<ProbeData> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], { timeout: 15000 });

  return JSON.parse(stdout) as ProbeData;
}

async function extractAudio(videoPath: string): Promise<string> {
  if (!existsSync(config.TEMP_DIR)) {
    mkdirSync(config.TEMP_DIR, { recursive: true });
  }

  const audioPath = join(config.TEMP_DIR, `audio-${Date.now()}.wav`);

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    '-y',
    audioPath,
  ], { timeout: 300000 });

  if (!existsSync(audioPath)) {
    throw new Error('ไม่สามารถ extract audio จากวิดีโอได้');
  }

  return audioPath;
}

export async function transcribeVdo(args: VdoTranscribeArgs): Promise<VdoTranscriptResult> {
  const { file_path, url, lang = config.DEFAULT_LANG, model_size = config.WHISPER_MODEL } = args;
  const { localPath, shouldCleanup } = await resolveVdoSource(file_path, url);
  let audioPath: string | null = null;

  try {
    const probeData = await runFfprobe(localPath);
    const duration = parseFloat(probeData.format?.duration || '0');

    if (duration > config.MAX_VDO_DURATION) {
      throw new Error(
        `วิดีโอยาว ${Math.round(duration)} วินาที เกินขีดจำกัด ${config.MAX_VDO_DURATION} วินาที (${Math.round(config.MAX_VDO_DURATION / 60)} นาที)`
      );
    }

    const audioStream = probeData.streams?.find(s => s.codec_type === 'audio');
    if (!audioStream) {
      throw new Error('วิดีโอไม่มี audio track');
    }

    audioPath = await extractAudio(localPath);

    const { stdout } = await execFileAsync('python3', [
      PYTHON_WORKER,
      '--action', 'transcribe',
      '--file', audioPath,
      '--lang', lang,
      '--model', model_size,
      '--compute-type', config.WHISPER_COMPUTE_TYPE,
    ], {
      timeout: 600000,
      env: {
        ...process.env,
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '2',
      },
    });

    const result = JSON.parse(stdout) as WhisperResult;

    if (result.error) {
      throw new Error(result.error);
    }

    const videoStream = probeData.streams?.find(s => s.codec_type === 'video');

    return {
      file: basename(file_path || url || ''),
      lang,
      model: model_size,
      method: 'ffmpeg+faster-whisper',
      duration: parseFloat(probeData.format?.duration || '0'),
      resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
      detected_language: result.detected_language,
      language_probability: result.language_probability,
      text: result.text,
      segmentCount: result.segmentCount,
      segments: result.segments,
    };
  } finally {
    if (audioPath) {
      try { unlinkSync(audioPath); } catch {}
    }
    if (shouldCleanup) {
      try { unlinkSync(localPath); } catch {}
    }
  }
}

export async function getVdoInfo(args: VdoInfoArgs): Promise<VdoFileInfo> {
  const { file_path, url } = args;
  const { localPath, shouldCleanup } = await resolveVdoSource(file_path, url);

  try {
    const probeData = await runFfprobe(localPath);
    const format = probeData.format || {};
    const videoStream = probeData.streams?.find(s => s.codec_type === 'video');
    const audioStream = probeData.streams?.find(s => s.codec_type === 'audio');

    let fps: number | null = null;
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/');
      if (num && den && parseInt(den) > 0) {
        fps = Math.round((parseInt(num) / parseInt(den)) * 100) / 100;
      }
    }

    return {
      file: basename(file_path || url || ''),
      duration: parseFloat(format.duration || '0'),
      format: format.format_name || 'unknown',
      format_long: format.format_long_name || '',
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      resolution: videoStream?.width ? `${videoStream.width}x${videoStream.height}` : null,
      fps,
      video_codec: videoStream?.codec_name || null,
      audio_codec: audioStream?.codec_name || null,
      sample_rate: parseInt(audioStream?.sample_rate || '0'),
      channels: audioStream?.channels || 0,
      bitrate: parseInt(format.bit_rate || '0'),
      size_bytes: parseInt(format.size || '0'),
    };
  } finally {
    if (shouldCleanup) {
      try { unlinkSync(localPath); } catch {}
    }
  }
}
