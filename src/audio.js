/**
 * Audio Transcription Core Logic
 * แปลงไฟล์เสียงเป็นข้อความโดยใช้:
 * - faster-whisper (ผ่าน python/whisper_worker.py)
 * - ffprobe สำหรับดึงข้อมูลไฟล์เสียง
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

const SUPPORTED_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.wma', '.aac', '.opus'];

/**
 * ดาวน์โหลดไฟล์จาก URL ไปยัง temp directory
 */
async function downloadAudio(url) {
  if (!existsSync(config.TEMP_DIR)) {
    mkdirSync(config.TEMP_DIR, { recursive: true });
  }

  const fileName = `dl-${Date.now()}${extname(new URL(url).pathname) || '.mp3'}`;
  const filePath = join(config.TEMP_DIR, fileName);

  try {
    const { stderr } = await execFileAsync('curl', [
      '-L', '-f', '-s', '-S',
      '--max-time', '120',
      '--max-filesize', '104857600', // 100MB
      '-o', filePath,
      url,
    ], { timeout: 130000 });

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
 * Resolve audio source จาก file_path หรือ url
 * คืนค่า { localPath, shouldCleanup }
 */
async function resolveAudioSource(filePath, url) {
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
    const localPath = await downloadAudio(url);
    return { localPath, shouldCleanup: true };
  }

  throw new Error('ต้องระบุ file_path หรือ url อย่างใดอย่างหนึ่ง');
}

/**
 * ดึงข้อมูลเสียงด้วย ffprobe
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
 * แปลงไฟล์เสียงเป็นข้อความ (Speech-to-Text)
 * @param {object} args - { file_path, url, lang, model_size }
 */
export async function transcribeAudio(args) {
  const filePath = args?.file_path;
  const url = args?.url;
  const lang = args?.lang || config.DEFAULT_LANG;
  const modelSize = args?.model_size || config.WHISPER_MODEL;

  const { localPath, shouldCleanup } = await resolveAudioSource(filePath, url);

  try {
    // ตรวจสอบ duration ด้วย ffprobe
    const probeData = await runFfprobe(localPath);
    const duration = parseFloat(probeData.format?.duration || '0');

    if (duration > config.MAX_AUDIO_DURATION) {
      throw new Error(
        `ไฟล์เสียงยาว ${Math.round(duration)} วินาที เกินขีดจำกัด ${config.MAX_AUDIO_DURATION} วินาที`
      );
    }

    // เรียก whisper_worker.py
    const { stdout, stderr } = await execFileAsync('python3', [
      PYTHON_WORKER,
      '--action', 'transcribe',
      '--file', localPath,
      '--lang', lang,
      '--model', modelSize,
      '--compute-type', config.WHISPER_COMPUTE_TYPE,
    ], {
      timeout: 300000, // 5 นาที
      env: {
        ...process.env,
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '2',
      },
    });

    const result = JSON.parse(stdout);

    if (result.error) {
      throw new Error(result.error);
    }

    return {
      file: basename(filePath || url),
      lang,
      model: modelSize,
      method: 'faster-whisper',
      ...result,
    };
  } finally {
    if (shouldCleanup) {
      try { unlinkSync(localPath); } catch {}
    }
  }
}

/**
 * ดึงข้อมูลไฟล์เสียง (metadata)
 * @param {object} args - { file_path, url }
 */
export async function getAudioInfo(args) {
  const filePath = args?.file_path;
  const url = args?.url;

  const { localPath, shouldCleanup } = await resolveAudioSource(filePath, url);

  try {
    const probeData = await runFfprobe(localPath);
    const format = probeData.format || {};
    const audioStream = (probeData.streams || []).find(s => s.codec_type === 'audio') || {};

    return {
      file: basename(filePath || url),
      duration: parseFloat(format.duration || '0'),
      format: format.format_name || 'unknown',
      format_long: format.format_long_name || '',
      sample_rate: parseInt(audioStream.sample_rate || '0'),
      channels: audioStream.channels || 0,
      channel_layout: audioStream.channel_layout || '',
      codec: audioStream.codec_name || 'unknown',
      bitrate: parseInt(format.bit_rate || '0'),
      size_bytes: parseInt(format.size || '0'),
    };
  } finally {
    if (shouldCleanup) {
      try { unlinkSync(localPath); } catch {}
    }
  }
}
