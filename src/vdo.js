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

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PYTHON_WORKER = join(PROJECT_ROOT, 'python', 'whisper_worker.py');

const SUPPORTED_FORMATS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.ts', '.m4v'];

/**
 * ดาวน์โหลดวิดีโอจาก URL ไปยัง temp directory
 */
async function downloadVdo(url) {
  if (!existsSync(config.TEMP_DIR)) {
    mkdirSync(config.TEMP_DIR, { recursive: true });
  }

  const fileName = `dl-${Date.now()}${extname(new URL(url).pathname) || '.mp4'}`;
  const filePath = join(config.TEMP_DIR, fileName);

  try {
    const { stderr } = await execFileAsync('curl', [
      '-L', '-f', '-s', '-S',
      '--max-time', '300',
      '--max-filesize', '524288000', // 500MB
      '-o', filePath,
      url,
    ], { timeout: 310000 });

    if (!existsSync(filePath)) {
      throw new Error(`ดาวน์โหลดไม่สำเร็จ: ${stderr || 'ไม่พบไฟล์'}`);
    }

    return filePath;
  } catch (e) {
    try { unlinkSync(filePath); } catch {}
    throw new Error(`ดาวน์โหลดไม่สำเร็จ: ${e.message}`);
  }
}

/**
 * Resolve video source จาก file_path หรือ url
 * คืนค่า { localPath, shouldCleanup }
 */
async function resolveVdoSource(filePath, url) {
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

/**
 * ดึงข้อมูลวิดีโอด้วย ffprobe
 */
async function runFfprobe(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], { timeout: 15000 });

  return JSON.parse(stdout);
}

/**
 * Extract audio จาก video → WAV file
 * ใช้ mono 16kHz สำหรับ Whisper
 */
async function extractAudio(videoPath) {
  if (!existsSync(config.TEMP_DIR)) {
    mkdirSync(config.TEMP_DIR, { recursive: true });
  }

  const audioPath = join(config.TEMP_DIR, `audio-${Date.now()}.wav`);

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vn',                    // ไม่เอา video
    '-acodec', 'pcm_s16le',  // WAV format
    '-ar', '16000',           // 16kHz สำหรับ Whisper
    '-ac', '1',               // mono
    '-y',                     // overwrite
    audioPath,
  ], { timeout: 300000 }); // 5 นาที

  if (!existsSync(audioPath)) {
    throw new Error('ไม่สามารถ extract audio จากวิดีโอได้');
  }

  return audioPath;
}

/**
 * แปลงไฟล์วิดีโอเป็นข้อความ (Video-to-Text)
 * @param {object} args - { file_path, url, lang, model_size }
 */
export async function transcribeVdo(args) {
  const filePath = args?.file_path;
  const url = args?.url;
  const lang = args?.lang || config.DEFAULT_LANG;
  const modelSize = args?.model_size || config.WHISPER_MODEL;

  const { localPath, shouldCleanup } = await resolveVdoSource(filePath, url);
  let audioPath = null;

  try {
    // ตรวจสอบ duration ด้วย ffprobe
    const probeData = await runFfprobe(localPath);
    const duration = parseFloat(probeData.format?.duration || '0');

    if (duration > config.MAX_VDO_DURATION) {
      throw new Error(
        `วิดีโอยาว ${Math.round(duration)} วินาที เกินขีดจำกัด ${config.MAX_VDO_DURATION} วินาที (${Math.round(config.MAX_VDO_DURATION / 60)} นาที)`
      );
    }

    // ตรวจสอบว่ามี audio stream
    const audioStream = (probeData.streams || []).find(s => s.codec_type === 'audio');
    if (!audioStream) {
      throw new Error('วิดีโอไม่มี audio track');
    }

    // Extract audio จาก video
    audioPath = await extractAudio(localPath);

    // เรียก whisper_worker.py
    const { stdout } = await execFileAsync('python3', [
      PYTHON_WORKER,
      '--action', 'transcribe',
      '--file', audioPath,
      '--lang', lang,
      '--model', modelSize,
      '--compute-type', config.WHISPER_COMPUTE_TYPE,
    ], {
      timeout: 600000, // 10 นาที (video อาจยาว)
      env: {
        ...process.env,
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '2',
      },
    });

    const result = JSON.parse(stdout);

    if (result.error) {
      throw new Error(result.error);
    }

    // เพิ่มข้อมูล video metadata
    const videoStream = (probeData.streams || []).find(s => s.codec_type === 'video');

    return {
      file: basename(filePath || url),
      lang,
      model: modelSize,
      method: 'ffmpeg+faster-whisper',
      duration: parseFloat(probeData.format?.duration || '0'),
      resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
      ...result,
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

/**
 * ดึงข้อมูลไฟล์วิดีโอ (metadata)
 * @param {object} args - { file_path, url }
 */
export async function getVdoInfo(args) {
  const filePath = args?.file_path;
  const url = args?.url;

  const { localPath, shouldCleanup } = await resolveVdoSource(filePath, url);

  try {
    const probeData = await runFfprobe(localPath);
    const format = probeData.format || {};
    const videoStream = (probeData.streams || []).find(s => s.codec_type === 'video') || {};
    const audioStream = (probeData.streams || []).find(s => s.codec_type === 'audio') || {};

    // คำนวณ fps
    let fps = null;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/');
      if (num && den && parseInt(den) > 0) {
        fps = Math.round((parseInt(num) / parseInt(den)) * 100) / 100;
      }
    }

    return {
      file: basename(filePath || url),
      duration: parseFloat(format.duration || '0'),
      format: format.format_name || 'unknown',
      format_long: format.format_long_name || '',
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      resolution: videoStream.width ? `${videoStream.width}x${videoStream.height}` : null,
      fps,
      video_codec: videoStream.codec_name || null,
      audio_codec: audioStream.codec_name || null,
      sample_rate: parseInt(audioStream.sample_rate || '0'),
      channels: audioStream.channels || 0,
      bitrate: parseInt(format.bit_rate || '0'),
      size_bytes: parseInt(format.size || '0'),
    };
  } finally {
    if (shouldCleanup) {
      try { unlinkSync(localPath); } catch {}
    }
  }
}
