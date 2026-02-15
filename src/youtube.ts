/**
 * YouTube Transcript Extraction
 * ดึง transcript/subtitle จาก YouTube โดยใช้:
 * 1. Innertube Android API (ไม่ต้อง auth)
 * 2. yt-dlp fallback (รองรับ cookies สำหรับ bot-detected servers)
 */

import { execFile } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { promisify } from 'util';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Segment, TranscriptResult, VideoInfo, CaptionInfo, CaptionTrack, LanguageInfo } from './types.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
const USER_AGENT = 'com.google.android.youtube/19.09.37 (Linux; U; Android 14) gzip';

const COOKIE_PATHS = [
  join(PROJECT_ROOT, 'cookies.txt'),
  join(PROJECT_ROOT, 'data', 'cookies.txt'),
  '/app/cookies.txt',
  '/app/data/cookies.txt',
];

// Innertube API response types
interface InnertubeCaption {
  languageCode: string;
  name?: { simpleText?: string };
  kind?: string;
  baseUrl: string;
}

interface InnertubeResponse {
  playabilityStatus?: { status: string };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
    viewCount?: string;
    shortDescription?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: InnertubeCaption[];
    };
  };
}

interface OembedResponse {
  title?: string;
  author_name?: string;
}

function findCookiesFile(): string | null {
  for (const p of COOKIE_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function extractVideoID(input: string): string {
  if (!input) throw new Error('URL หรือ Video ID จำเป็นต้องระบุ');

  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  const patterns = [
    /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`ไม่สามารถแยก Video ID จาก URL: ${input}`);
}

async function fetchPlayerData(videoID: string): Promise<InnertubeResponse> {
  const resp = await fetch(INNERTUBE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '19.09.37',
          androidSdkVersion: 34,
          hl: 'en',
          gl: 'US',
        }
      },
      videoId: videoID,
      contentCheckOk: true,
      racyCheckOk: true,
    })
  });

  if (!resp.ok) {
    throw new Error(`YouTube API error: ${resp.status}`);
  }

  return await resp.json() as InnertubeResponse;
}

function parseSubtitleXML(xml: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /<p t="(\d+)" d="(\d+)"[^>]*>(.*?)<\/p>/gs;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXMLEntities(match[3]).trim();
    if (text) {
      const start = parseInt(match[1]) / 1000;
      const duration = parseInt(match[2]) / 1000;
      segments.push({
        start,
        end: start + duration,
        duration,
        text,
      });
    }
  }

  return segments;
}

function parseSubtitleXMLText(xml: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /<text start="([^"]+)" dur="([^"]+)"[^>]*>(.*?)<\/text>/gs;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXMLEntities(match[3]).trim();
    if (text) {
      const start = parseFloat(match[1]);
      const duration = parseFloat(match[2]);
      segments.push({
        start,
        end: start + duration,
        duration,
        text,
      });
    }
  }

  return segments;
}

function parseVTT(vtt: string): Segment[] {
  const segments: Segment[] = [];
  const lines = vtt.split('\n');
  let currentText = '';

  for (const line of lines) {
    const timeMatch = line.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->/);
    if (timeMatch) {
      if (currentText) segments.push({ start: 0, end: 0, text: currentText.trim() });
      currentText = '';
      continue;
    }
    if (line.trim() && !line.startsWith('WEBVTT') && !line.match(/^\d+$/) && !line.includes('-->')) {
      const clean = line.replace(/<[^>]+>/g, '').trim();
      if (clean && !segments.some(s => s.text === clean)) {
        currentText = clean;
      }
    }
  }
  if (currentText) segments.push({ start: 0, end: 0, text: currentText.trim() });

  return segments;
}

function decodeXMLEntities(str: string): string {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '');
}

async function getTranscriptViaYtDlpFile(videoID: string, lang = 'th'): Promise<TranscriptResult> {
  const cookiesFile = findCookiesFile();
  const tmpDir = '/tmp';
  const outTemplate = `${tmpDir}/ytsub-${videoID}`;

  const args = [
    '--write-auto-subs',
    '--write-subs',
    '--sub-langs', `${lang},-live_chat`,
    '--skip-download',
    '--sub-format', 'vtt/srv1/xml',
    '-o', outTemplate,
    '--print', '%(title)s\t%(uploader)s\t%(duration)s',
    '--no-warnings',
  ];

  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  }

  args.push('https://www.youtube.com/watch?v=' + videoID);

  const { stdout } = await execFileAsync('yt-dlp', args, {
    timeout: 30000,
    env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin:/home/admin/.deno/bin' },
  });

  const [title] = stdout.trim().split('\t');

  const possibleExts = [`.${lang}.vtt`, `.${lang}.srv1`, `.${lang}.xml`, `.${lang}.srt`];
  let subContent = '';

  for (const ext of possibleExts) {
    const filePath = outTemplate + ext;
    if (existsSync(filePath)) {
      subContent = readFileSync(filePath, 'utf-8');
      try { unlinkSync(filePath); } catch {}
      break;
    }
  }

  if (!subContent) {
    throw new Error(`yt-dlp: ไม่พบไฟล์ subtitle ภาษา "${lang}"`);
  }

  let segments: Segment[];
  if (subContent.includes('WEBVTT')) {
    segments = parseVTT(subContent);
  } else if (subContent.includes('<text')) {
    segments = parseSubtitleXMLText(subContent);
  } else {
    segments = parseSubtitleXML(subContent);
  }

  if (segments.length === 0) {
    throw new Error('ไม่พบข้อความใน subtitle');
  }

  return {
    videoID,
    title: title || '',
    lang,
    segmentCount: segments.length,
    text: segments.map(s => s.text).join(' '),
    segments,
    method: 'yt-dlp',
  };
}

async function fetchOembedData(videoID: string): Promise<OembedResponse> {
  const resp = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoID}&format=json`);
  if (!resp.ok) throw new Error(`oEmbed error: ${resp.status}`);
  return await resp.json() as OembedResponse;
}

export async function getTranscript(videoID: string, lang = 'th'): Promise<TranscriptResult> {
  // Method 1: Innertube Android API
  try {
    const data = await fetchPlayerData(videoID);

    if (data.playabilityStatus?.status === 'OK') {
      const captionTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (captionTracks && captionTracks.length > 0) {
        let track = captionTracks.find(t => t.languageCode === lang && t.kind !== 'asr')
          || captionTracks.find(t => t.languageCode === lang)
          || captionTracks.find(t => t.languageCode.startsWith(lang) && t.kind !== 'asr')
          || captionTracks.find(t => t.languageCode.startsWith(lang));

        if (!track) {
          const available = captionTracks.map(t => t.languageCode).join(', ');
          throw new Error(`ไม่พบ subtitle ภาษา "${lang}" (มี: ${available})`);
        }

        const subResp = await fetch(track.baseUrl, {
          headers: { 'User-Agent': USER_AGENT }
        });
        const xml = await subResp.text();

        if (xml && xml.length > 0) {
          const segments = parseSubtitleXML(xml);
          if (segments.length > 0) {
            return {
              videoID,
              title: data.videoDetails?.title || '',
              lang: track.languageCode,
              segmentCount: segments.length,
              text: segments.map(s => s.text).join(' '),
              segments,
              method: 'innertube',
            };
          }
        }
      }
    }
  } catch (e) {
    console.error('Innertube failed:', (e as Error).message);
  }

  // Method 2: yt-dlp with cookies
  try {
    return await getTranscriptViaYtDlpFile(videoID, lang);
  } catch (e) {
    console.error('yt-dlp file method failed:', (e as Error).message);
  }

  throw new Error(
    `ไม่สามารถดึง transcript ได้ - YouTube อาจตรวจจับ bot\n` +
    `แก้ไข: วาง cookies.txt จาก browser ที่ login YouTube ไว้ที่ ${COOKIE_PATHS[0]}`
  );
}

export async function getVideoInfo(videoID: string): Promise<VideoInfo> {
  // ลอง Innertube ก่อน
  try {
    const data = await fetchPlayerData(videoID);

    if (data.playabilityStatus?.status === 'OK') {
      const details = data.videoDetails || {};
      const captionTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

      return {
        videoID,
        title: details.title || '',
        author: details.author || '',
        lengthSeconds: parseInt(details.lengthSeconds || '0'),
        viewCount: parseInt(details.viewCount || '0'),
        description: details.shortDescription || '',
        availableLanguages: captionTracks.map((t): LanguageInfo => ({
          code: t.languageCode,
          name: t.name?.simpleText || t.languageCode,
          kind: t.kind || 'manual',
        })),
        method: 'innertube',
      };
    }
  } catch (e) {
    console.error('Innertube failed for info:', (e as Error).message);
  }

  // Fallback: oEmbed + yt-dlp
  try {
    const oembed = await fetchOembedData(videoID);

    let extraInfo: { lengthSeconds?: number; viewCount?: number; description?: string } = {};
    const cookiesFile = findCookiesFile();
    try {
      const args = [
        '--skip-download',
        '--print', '%(duration)s\t%(view_count)s\t%(description)s',
        '--no-warnings',
      ];
      if (cookiesFile) args.push('--cookies', cookiesFile);
      args.push('https://www.youtube.com/watch?v=' + videoID);

      const { stdout } = await execFileAsync('yt-dlp', args, {
        timeout: 15000,
        env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin:/home/admin/.deno/bin' },
      });
      const [duration, viewCount, description] = stdout.trim().split('\t');
      extraInfo = {
        lengthSeconds: parseInt(duration || '0'),
        viewCount: parseInt(viewCount || '0'),
        description: description || '',
      };
    } catch {}

    return {
      videoID,
      title: oembed.title || '',
      author: oembed.author_name || '',
      lengthSeconds: extraInfo.lengthSeconds || 0,
      viewCount: extraInfo.viewCount || 0,
      description: extraInfo.description || '',
      availableLanguages: [],
      method: 'oembed',
    };
  } catch (e) {
    throw new Error(`ไม่สามารถดึงข้อมูลวิดีโอได้: ${(e as Error).message}`);
  }
}

export async function listAvailableCaptions(videoID: string): Promise<CaptionInfo> {
  try {
    const data = await fetchPlayerData(videoID);
    const captionTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    return {
      videoID,
      title: data.videoDetails?.title || '',
      captions: captionTracks.map((t): CaptionTrack => ({
        languageCode: t.languageCode,
        name: t.name?.simpleText || t.languageCode,
        kind: t.kind || 'manual',
        isAutoGenerated: t.kind === 'asr',
      })),
    };
  } catch (e) {
    throw new Error(`ไม่สามารถดึงรายการ caption ได้: ${(e as Error).message}`);
  }
}
