#!/usr/bin/env python3
"""
Generate acoustic, non-harsh 44.1 kHz 16-bit mono PCM WAV assets for BeatSave.
Uses only Python standard library modules (wave, math, struct, os, sys).
"""

import math
import os
import struct
import sys
import wave

SAMPLE_RATE = 44100
MAX_INT16 = 32767
MAX_ALLOWED_PEAK = 0.92


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_samples(samples: list[float], target_peak: float) -> list[int]:
    peak = max((abs(s) for s in samples), default=0.0)
    scale = (target_peak / peak) if peak > 0.0 else 1.0
    pcm: list[int] = []
    for s in samples:
        scaled = clamp(s * scale, -MAX_ALLOWED_PEAK, MAX_ALLOWED_PEAK)
        pcm.append(int(round(scaled * MAX_INT16)))
    return pcm


def end_taper(index: int, total: int, taper_samples: int) -> float:
    remaining = total - 1 - index
    if remaining < taper_samples:
        return 0.5 * (1.0 - math.cos(math.pi * remaining / taper_samples))
    return 1.0


def synthesize_wood_tick(duration_ms: float, f_body: float, f_overtone: float, f_thump: float, target_peak: float) -> list[int]:
    total_samples = int(round(SAMPLE_RATE * duration_ms / 1000.0))
    taper_samples = max(32, int(round(SAMPLE_RATE * 0.003)))
    samples: list[float] = []

    for i in range(total_samples):
        t = i / SAMPLE_RATE
        # Smooth ~0.6 ms mallet strike attack so there is no digital click
        attack = 1.0 - math.exp(-t / 0.00045)
        body = 0.65 * math.sin(2.0 * math.pi * f_body * t) * math.exp(-t / 0.0095)
        overtone = 0.32 * math.sin(2.0 * math.pi * f_overtone * t + 0.3) * math.exp(-t / 0.0042)
        thump = 0.25 * math.sin(2.0 * math.pi * f_thump * t) * math.exp(-t / 0.014)
        sample = attack * (body + overtone + thump) * end_taper(i, total_samples, taper_samples)
        samples.append(sample)

    return normalize_samples(samples, target_peak)


def synthesize_breath_chime(duration_ms: float = 420.0, target_peak: float = 0.84) -> list[int]:
    total_samples = int(round(SAMPLE_RATE * duration_ms / 1000.0))
    taper_samples = int(round(SAMPLE_RATE * 0.025))
    samples: list[float] = []

    # Gentle C5 -> G5 harmonic two-note chime
    f1 = 523.25
    f2 = 783.99
    note2_start = 0.135  # seconds

    for i in range(total_samples):
        t = i / SAMPLE_RATE

        # First note
        env1 = (1.0 - math.exp(-t / 0.010)) * math.exp(-t / 0.135)
        note1 = env1 * (
            0.80 * math.sin(2.0 * math.pi * f1 * t)
            + 0.16 * math.sin(2.0 * math.pi * (2.0 * f1) * t)
        )

        # Second note overlapping smoothly
        note2 = 0.0
        if t >= note2_start:
            t2 = t - note2_start
            env2 = (1.0 - math.exp(-t2 / 0.012)) * math.exp(-t2 / 0.145)
            note2 = env2 * (
                0.82 * math.sin(2.0 * math.pi * f2 * t2)
                + 0.14 * math.sin(2.0 * math.pi * (2.0 * f2) * t2)
            )

        sample = (note1 + note2) * end_taper(i, total_samples, taper_samples)
        samples.append(sample)

    return normalize_samples(samples, target_peak)


def write_wav(path: str, pcm_samples: list[int]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        packed = struct.pack(f"<{len(pcm_samples)}h", *pcm_samples)
        wf.writeframes(packed)


def verify_wav(path: str) -> dict:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Missing WAV file: {path}")
    file_size = os.path.getsize(path)
    if file_size <= 44:
        raise ValueError(f"WAV file too small ({file_size} bytes): {path}")

    with open(path, "rb") as f:
        header = f.read(12)
        if header[:4] != b"RIFF" or header[8:12] != b"WAVE":
            raise ValueError(f"Invalid RIFF/WAVE header in {path}")

    with wave.open(path, "rb") as wf:
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        nframes = wf.getnframes()
        if channels != 1 or sampwidth != 2 or framerate != SAMPLE_RATE or nframes == 0:
            raise ValueError(
                f"Invalid WAV format in {path}: ch={channels}, sw={sampwidth}, sr={framerate}, frames={nframes}"
            )
        raw = wf.readframes(nframes)

    unpacked = struct.unpack(f"<{nframes}h", raw)
    peak_int = max(abs(x) for x in unpacked)
    peak_norm = peak_int / float(MAX_INT16)
    if peak_norm > MAX_ALLOWED_PEAK:
        raise ValueError(f"WAV clipping risk in {path}: peak={peak_norm:.4f} > {MAX_ALLOWED_PEAK}")

    return {
        "file": os.path.basename(path),
        "bytes": file_size,
        "frames": nframes,
        "duration_ms": round(nframes * 1000.0 / framerate, 2),
        "sample_rate": framerate,
        "channels": channels,
        "bits": sampwidth * 8,
        "peak_norm": round(peak_norm, 4),
    }


def main() -> int:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    audio_dir = os.path.join(repo_root, "Assets", "Audio")

    assets = {
        "wood_tick.wav": synthesize_wood_tick(
            duration_ms=45.0, f_body=760.0, f_overtone=1420.0, f_thump=255.0, target_peak=0.86
        ),
        "wood_tick_accent.wav": synthesize_wood_tick(
            duration_ms=55.0, f_body=1040.0, f_overtone=1960.0, f_thump=340.0, target_peak=0.90
        ),
        "breath_chime.wav": synthesize_breath_chime(
            duration_ms=420.0, target_peak=0.84
        ),
    }

    for filename, samples in assets.items():
        out_path = os.path.join(audio_dir, filename)
        write_wav(out_path, samples)
        stats = verify_wav(out_path)
        print(
            f"[OK] {stats['file']}: {stats['bytes']} bytes | "
            f"{stats['duration_ms']} ms ({stats['frames']} frames) | "
            f"{stats['sample_rate']} Hz {stats['bits']}-bit mono | "
            f"peak={stats['peak_norm']} (<= {MAX_ALLOWED_PEAK})"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
