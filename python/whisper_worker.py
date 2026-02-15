#!/usr/bin/env python3
"""
Whisper Worker - CLI tool for audio transcription using faster-whisper.
Called by Node.js audio.js/vdo.js via child_process.execFile.
Outputs JSON to stdout. Errors go to stderr.
"""

import argparse
import json
import sys
import os


def transcribe(file_path, lang, model_size, compute_type):
    """Transcribe audio file and return results as dict."""
    from faster_whisper import WhisperModel

    model = WhisperModel(
        model_size,
        device="cpu",
        compute_type=compute_type,
        cpu_threads=int(os.environ.get("OMP_NUM_THREADS", "2")),
    )

    language = None if lang == "auto" else lang

    segments_gen, info = model.transcribe(
        file_path,
        beam_size=1,
        language=language,
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500,
        ),
    )

    segments = []
    full_text_parts = []
    for seg in segments_gen:
        segments.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })
        full_text_parts.append(seg.text.strip())

    return {
        "detected_language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 2),
        "text": " ".join(full_text_parts),
        "segmentCount": len(segments),
        "segments": segments,
    }


def main():
    parser = argparse.ArgumentParser(description="Whisper Worker")
    parser.add_argument("--action", required=True, choices=["transcribe"])
    parser.add_argument("--file", required=True)
    parser.add_argument("--lang", default="th")
    parser.add_argument("--model", default="tiny")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    try:
        if args.action == "transcribe":
            result = transcribe(args.file, args.lang, args.model, args.compute_type)
        json.dump(result, sys.stdout, ensure_ascii=False)
    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)


if __name__ == "__main__":
    main()
