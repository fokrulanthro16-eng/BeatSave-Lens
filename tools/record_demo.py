#!/usr/bin/env python3
"""
One-click desktop 60 fps Preview recorder for BeatSave (Lens Studio 5.23.2).
Launches BeatSave-Lens.esproj, finds the Preview viewport, captures 60 fps video
via gdigrab while driving Space / M / R interactions, muxes with
tools/beatsave_master_audio.wav, updates thumbnail_1200x675.png, and runs ffprobe.
"""

import ctypes
from ctypes import wintypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ESPROJ_PATH = os.path.join(REPO_ROOT, "BeatSave-Lens.esproj")
MASTER_AUDIO = os.path.join(REPO_ROOT, "tools", "beatsave_master_audio.wav")
OUT_VIDEO = os.path.join(REPO_ROOT, "devpost", "media", "beatsave_demo.mp4")
OUT_THUMB = os.path.join(REPO_ROOT, "devpost", "media", "thumbnail_1200x675.png")

LENS_STUDIO_EXE = r"C:\Program Files\Snap Inc\Lens Studio\Lens Studio.exe"
GRAB_FFMPEG = r"C:\Program Files\BlueStacks_msi5\ffmpeg.exe"
FULL_FFMPEG = r"C:\Users\WALTON\.gemini\antigravity\bin\ffmpeg.exe"
FFPROBE_EXE = shutil.which("ffprobe") or "ffprobe"

VK_SPACE = 0x20
VK_M = 0x4D
VK_R = 0x52
VK_ESCAPE = 0x1B

user32 = ctypes.windll.user32


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


def get_audio_duration(wav_path: str) -> float:
    with wave.open(wav_path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def find_lens_studio_hwnd() -> int:
    """Find the primary visible Lens Studio top-level window handle."""
    found = []
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value
        if "Lens Studio" in title or "BeatSave" in title:
            rect = RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w = rect.right - rect.left
            h = rect.bottom - rect.top
            if w >= 640 and h >= 480:
                found.append((hwnd, w * h, title))
        return True

    user32.EnumWindows(EnumWindowsProc(callback), 0)
    if not found:
        return 0
    found.sort(key=lambda item: item[1], reverse=True)
    return int(found[0][0])


def dismiss_update_popups(main_hwnd: int) -> None:
    """Dismiss any 5.25 update dialog or modal popup without updating."""
    try:
        import uiautomation as auto
    except Exception:
        return

    try:
        win = auto.ControlFromHandle(main_hwnd)
        for child in win.GetChildren():
            if child.ControlTypeName == "WindowControl":
                name = (child.Name or "").lower()
                if "update" in name or "5.25" in name or "what's new" in name:
                    for btn_label in ("Skip", "Later", "Not Now", "Dismiss", "Close", "Cancel"):
                        btn = child.ButtonControl(Name=btn_label)
                        if btn.Exists(0.3):
                            btn.Click()
                            return
                    child.SendKeys("{Esc}")
    except Exception:
        pass


def focus_window(hwnd: int) -> None:
    if not hwnd:
        return
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.25)


def get_preview_rect(main_hwnd: int) -> tuple[int, int, int, int]:
    """Locate the Preview viewport via UIAutomation, or fall back cleanly."""
    try:
        import uiautomation as auto
        root = auto.ControlFromHandle(main_hwnd)
        for ctrl, _depth in auto.WalkControl(root, maxDepth=10):
            name = (ctrl.Name or "").strip()
            if name in ("Preview 1", "Preview") and ctrl.ControlTypeName in ("PaneControl", "CustomControl", "GroupControl"):
                r = ctrl.BoundingRectangle
                w = r.right - r.left
                h = r.bottom - r.top
                if w >= 280 and h >= 280:
                    # Trim 36 px top dock tab / bottom toolbar chrome for clean viewport framing
                    top_pad = 36 if h > 420 else 0
                    bot_pad = 40 if h > 460 else 0
                    return (
                        r.left,
                        r.top + top_pad,
                        (w // 2) * 2,
                        ((h - top_pad - bot_pad) // 2) * 2,
                    )
    except Exception:
        pass

    if main_hwnd:
        rect = RECT()
        user32.GetWindowRect(main_hwnd, ctypes.byref(rect))
        win_w = rect.right - rect.left
        win_h = rect.bottom - rect.top
        # Standard Lens Studio right-hand Preview dock region fallback
        px = rect.left + int(win_w * 0.66)
        py = rect.top + int(win_h * 0.08)
        pw = ((int(win_w * 0.33)) // 2) * 2
        ph = ((int(win_h * 0.80)) // 2) * 2
        if pw >= 320 and ph >= 320:
            return (px, py, pw, ph)

    sw = user32.GetSystemMetrics(0)
    sh = user32.GetSystemMetrics(1)
    return (0, 0, (sw // 2) * 2, (sh // 2) * 2)


def click_point(x: int, y: int) -> None:
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.05)
    user32.mouse_event(0x0002, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTDOWN
    time.sleep(0.04)
    user32.mouse_event(0x0004, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTUP


def press_vk(vk_code: int) -> None:
    user32.keybd_event(vk_code, 0, 0, 0)
    time.sleep(0.05)
    user32.keybd_event(vk_code, 0, 0x0002, 0)  # KEYEVENTF_KEYUP


def regenerate_thumbnail(video_path: str, thumb_path: str, ffmpeg_bin: str) -> None:
    """Extract a crisp 16:9 locked-ring frame from the recorded demo video and add clean plain text."""
    tmp_frame = os.path.join(tempfile.gettempdir(), "beatsave_thumb_raw.png")
    subprocess.run(
        [ffmpeg_bin, "-y", "-ss", "14.5", "-i", video_path, "-frames:v", "1", tmp_frame],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    im = Image.open(tmp_frame).convert("RGB").resize((1200, 675), Image.Resampling.LANCZOS)
    overlay = Image.new("RGBA", (1200, 675), (0, 0, 0, 0))
    draw_ov = ImageDraw.Draw(overlay)
    for y in range(215):
        alpha = int(190 * (1.0 - y / 215.0))
        draw_ov.line([(0, y), (1200, y)], fill=(20, 20, 19, alpha))

    comp = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(comp)

    def load_font(size: int, bold: bool = False):
        candidates = [
            r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
            r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        ]
        for c in candidates:
            if os.path.exists(c):
                return ImageFont.truetype(c, size)
        return ImageFont.load_default()

    f_title = load_font(58, bold=True)
    f_sub = load_font(26, bold=False)
    draw.rectangle([(48, 42), (56, 134)], fill="#E63946")
    draw.text((74, 34), "BeatSave", font=f_title, fill="#F4F3EE")
    draw.text((76, 102), "Hands-free 110 BPM floor CPR pacing ring for Snap SPECS", font=f_sub, fill="#F4F3EE")
    comp.save(thumb_path, "PNG", optimize=True)
    if os.path.exists(tmp_frame):
        os.remove(tmp_frame)


def main() -> int:
    for required in (ESPROJ_PATH, MASTER_AUDIO, LENS_STUDIO_EXE, GRAB_FFMPEG):
        if not os.path.exists(required):
            print(f"[ERROR] Missing required file: {required}", file=sys.stderr)
            return 1

    mux_ffmpeg = FULL_FFMPEG if os.path.exists(FULL_FFMPEG) else (shutil.which("ffmpeg") or GRAB_FFMPEG)
    duration_sec = get_audio_duration(MASTER_AUDIO)
    print(f"[1/6] Master audio verified: {duration_sec:.2f} s ({MASTER_AUDIO})")

    print("[2/6] Launching Lens Studio 5.23.2 with BeatSave-Lens.esproj...")
    ls_proc = subprocess.Popen([LENS_STUDIO_EXE, ESPROJ_PATH])

    hwnd = 0
    for _ in range(60):
        time.sleep(1.0)
        hwnd = find_lens_studio_hwnd()
        if hwnd:
            dismiss_update_popups(hwnd)
            break

    if not hwnd:
        print("[ERROR] Could not detect visible Lens Studio window after 60 s.", file=sys.stderr)
        return 1

    # Give Preview time to compile TypeScript & load SIK 0.18.0 + Simulator
    print("[3/6] Waiting 14 s for Lens Studio Preview initialization...")
    for _ in range(14):
        time.sleep(1.0)
        dismiss_update_popups(hwnd)

    focus_window(hwnd)
    x, y, w, h = get_preview_rect(hwnd)
    cx = x + w // 2
    cy = y + h // 2
    print(f"[4/6] Capturing Preview viewport ({w}x{h} at {x},{y}) for {duration_sec:.2f} s at 60 fps...")

    raw_avi = os.path.join(tempfile.gettempdir(), "beatsave_raw_60fps.avi")
    if os.path.exists(raw_avi):
        os.remove(raw_avi)

    grab_cmd = [
        GRAB_FFMPEG, "-y",
        "-f", "gdigrab",
        "-framerate", "60",
        "-offset_x", str(x),
        "-offset_y", str(y),
        "-video_size", f"{w}x{h}",
        "-t", f"{duration_sec + 0.5:.2f}",
        "-i", "desktop",
        "-c:v", "utvideo",
        raw_avi,
    ]
    rec_proc = subprocess.Popen(grab_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    t0 = time.monotonic()

    # Focus Preview center right as recording begins (click only once at 0:05 to lock, or focus dock first)
    events = [
        (5.0,  "Lock ring -> Start Cycle 1 (Space)", lambda: (focus_window(hwnd), click_point(cx, cy))),
        (24.0, "Toggle MODE: HANDS-ONLY (M)",        lambda: (focus_window(hwnd), press_vk(VK_M))),
        (29.0, "Pause mid-cycle (Space)",            lambda: (focus_window(hwnd), press_vk(VK_SPACE))),
        (31.0, "Resume pacing (Space)",              lambda: (focus_window(hwnd), press_vk(VK_SPACE))),
        (33.0, "Reset to PLACING (R)",               lambda: (focus_window(hwnd), press_vk(VK_R))),
        (34.0, "Lock final active pacing (Space)",   lambda: (focus_window(hwnd), press_vk(VK_SPACE))),
    ]

    for target_t, label, action in events:
        while True:
            rem = (t0 + target_t) - time.monotonic()
            if rem <= 0:
                break
            time.sleep(min(0.05, rem))
        print(f"  -> t={time.monotonic() - t0:5.2f}s : {label}")
        action()

    _out, err = rec_proc.communicate(timeout=int(duration_sec) + 20)
    if rec_proc.returncode != 0 or not os.path.exists(raw_avi):
        print("[ERROR] gdigrab recording failed:", err.decode(errors="replace"), file=sys.stderr)
        return 1

    print("[5/6] Muxing 1080p 60 fps H.264 + AAC 44.1 kHz master audio...")
    os.makedirs(os.path.dirname(OUT_VIDEO), exist_ok=True)
    # Pad/scale cleanly inside 1920x1080 16:9 while preserving exact Preview aspect ratio
    vf = "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#141413,setsar=1"
    mux_cmd = [
        mux_ffmpeg, "-y",
        "-i", raw_avi,
        "-i", MASTER_AUDIO,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", "60",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        "-shortest",
        OUT_VIDEO,
    ]
    subprocess.run(mux_cmd, check=True)
    os.remove(raw_avi)

    regenerate_thumbnail(OUT_VIDEO, OUT_THUMB, mux_ffmpeg)

    print("[6/6] Closing Lens Studio and verifying output via ffprobe...")
    try:
        ls_proc.terminate()
    except Exception:
        pass

    probe = subprocess.run(
        [
            FFPROBE_EXE, "-v", "error",
            "-show_entries", "format=duration,size",
            "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
            "-of", "json",
            OUT_VIDEO,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    print("=== FFPROBE VERIFICATION ===")
    print(probe.stdout)
    info = json.loads(probe.stdout)
    v_streams = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
    if not v_streams or v_streams[0].get("r_frame_rate") != "60/1":
        print("[WARN] Unexpected video frame rate in ffprobe output.", file=sys.stderr)
        return 1
    print(f"[SUCCESS] Saved 60 fps demo video: {OUT_VIDEO}")
    print(f"[SUCCESS] Updated thumbnail:      {OUT_THUMB}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
