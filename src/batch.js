/**
 * Batch Processing Tools
 * ประมวลผลหลายไฟล์พร้อมกัน
 * รองรับ batch transcribe และ folder scan
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { transcribeAudio } from './audio.js';
import { transcribeVdo } from './vdo.js';

const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.wma', '.aac', '.opus'];
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.ts', '.m4v'];

/**
 * ตรวจสอบว่าไฟล์เป็น audio หรือ video
 */
function getFileType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  return null;
}

/**
 * Batch transcribe หลายไฟล์
 * @param {object} args - { sources, lang, model_size }
 */
export async function batchTranscribe(args) {
  const sources = args?.sources || [];
  const lang = args?.lang || 'th';
  const modelSize = args?.model_size || 'tiny';

  if (!sources.length) {
    throw new Error('sources array is required (file paths or URLs)');
  }

  const results = [];
  let successful = 0;
  let failed = 0;

  for (const source of sources) {
    try {
      // YouTube URLs ให้ใช้ youtube_to_text tool แทน
      if (source.includes('youtube.com') || source.includes('youtu.be')) {
        results.push({
          source,
          type: 'youtube',
          status: 'skipped',
          note: 'Use youtube_to_text tool for YouTube URLs',
        });
        continue;
      }

      const fileType = getFileType(source);
      let result;

      if (fileType === 'audio') {
        result = await transcribeAudio({ file_path: source, lang, model_size: modelSize });
      } else if (fileType === 'video') {
        result = await transcribeVdo({ file_path: source, lang, model_size: modelSize });
      } else if (source.startsWith('http://') || source.startsWith('https://')) {
        // URL - ลอง audio ก่อน
        result = await transcribeAudio({ url: source, lang, model_size: modelSize });
      } else {
        throw new Error(`Unsupported file type: ${extname(source)}`);
      }

      results.push({ source, type: fileType || 'url', status: 'success', ...result });
      successful++;
    } catch (error) {
      results.push({ source, status: 'error', error: error.message });
      failed++;
    }
  }

  return {
    total: sources.length,
    successful,
    failed,
    results,
  };
}

/**
 * Transcribe ไฟล์ทั้งหมดใน folder
 * @param {object} args - { folder_path, extensions, lang, model_size, recursive }
 */
export async function transcribeFolder(args) {
  const folderPath = args?.folder_path;
  const extensions = args?.extensions || ['mp3', 'mp4', 'wav', 'm4a'];
  const lang = args?.lang || 'th';
  const modelSize = args?.model_size || 'tiny';
  const recursive = args?.recursive || false;

  if (!folderPath) {
    throw new Error('folder_path is required');
  }

  if (!existsSync(folderPath)) {
    throw new Error(`Folder not found: ${folderPath}`);
  }

  // รวบรวมไฟล์ที่ตรง extension
  const extSet = new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`));
  const files = [];

  function scanDir(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory() && recursive) {
        scanDir(fullPath);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (extSet.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  scanDir(folderPath);

  if (files.length === 0) {
    return {
      folder: folderPath,
      extensions: [...extSet],
      total_files: 0,
      message: 'No matching files found',
    };
  }

  return batchTranscribe({ sources: files, lang, model_size: modelSize });
}
