/**
 * Batch Processing Tools
 * ประมวลผลหลายไฟล์พร้อมกัน
 * รองรับ batch transcribe และ folder scan
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { transcribeAudio } from './audio.js';
import { transcribeVdo } from './vdo.js';
import type { BatchTranscribeArgs, TranscribeFolderArgs, BatchResult, BatchItemResult, FolderScanEmpty } from './types.js';

const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.wma', '.aac', '.opus'];
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.ts', '.m4v'];

function getFileType(filePath: string): 'audio' | 'video' | null {
  const ext = extname(filePath).toLowerCase();
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  return null;
}

export async function batchTranscribe(args: BatchTranscribeArgs): Promise<BatchResult> {
  const { sources, lang = 'th', model_size = 'tiny' } = args;

  if (!sources?.length) {
    throw new Error('sources array is required (file paths or URLs)');
  }

  const results: BatchItemResult[] = [];
  let successful = 0;
  let failed = 0;

  for (const source of sources) {
    try {
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
      let result: Record<string, unknown>;

      if (fileType === 'audio') {
        result = await transcribeAudio({ file_path: source, lang, model_size }) as unknown as Record<string, unknown>;
      } else if (fileType === 'video') {
        result = await transcribeVdo({ file_path: source, lang, model_size }) as unknown as Record<string, unknown>;
      } else if (source.startsWith('http://') || source.startsWith('https://')) {
        result = await transcribeAudio({ url: source, lang, model_size }) as unknown as Record<string, unknown>;
      } else {
        throw new Error(`Unsupported file type: ${extname(source)}`);
      }

      results.push({ source, type: fileType || 'url', status: 'success', ...result });
      successful++;
    } catch (error) {
      results.push({ source, type: 'unknown', status: 'error', error: (error as Error).message });
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

export async function transcribeFolder(args: TranscribeFolderArgs): Promise<BatchResult | FolderScanEmpty> {
  const { folder_path, extensions = ['mp3', 'mp4', 'wav', 'm4a'], lang = 'th', model_size = 'tiny', recursive = false } = args;

  if (!folder_path) {
    throw new Error('folder_path is required');
  }

  if (!existsSync(folder_path)) {
    throw new Error(`Folder not found: ${folder_path}`);
  }

  const extSet = new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`));
  const files: string[] = [];

  function scanDir(dir: string): void {
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

  scanDir(folder_path);

  if (files.length === 0) {
    return {
      folder: folder_path,
      extensions: [...extSet],
      total_files: 0,
      message: 'No matching files found',
    };
  }

  return batchTranscribe({ sources: files, lang, model_size });
}
