#!/usr/bin/env python3
"""Swing Intelligence — pose keypoint extraction for the archive importer.

Runs MediaPipe Pose Landmarker (Apache-2.0, Google) on a video clip and
writes per-frame 33-keypoint series to stdout as JSON:

  { "fps": 59.94, "width": 1080, "height": 1920,
    "frames": [ [[y,x,visibility], ... 33] | null, ... ] }   # pixels, y-down

Used by scripts/swing-import.mjs --pose. Coordinates are in RAW frame space
(no rotation applied) — iPhone .mov files store portrait frames that players
rotate at display time; raw processing avoids the bogus rotation matrices
seen in the wild (2026-07-20 pilot: files tagged rotation=-90 whose content
is upright).

Model: pose_landmarker_lite.task, auto-downloaded once to
~/.cache/the-match/ (Apache-2.0; see THIRD_PARTY_NOTICES.md).

Usage: python3 scripts/pose-extract.py <video> [--model path]
Requires: pip install mediapipe opencv-python-headless
"""
import json, os, sys, urllib.request

MODEL_URL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
             'pose_landmarker_lite/float16/latest/pose_landmarker_lite.task')
CACHE = os.path.expanduser('~/.cache/the-match')


def ensure_model(path=None):
    if path:
        return path
    os.makedirs(CACHE, exist_ok=True)
    dst = os.path.join(CACHE, 'pose_landmarker_lite.task')
    if not os.path.exists(dst):
        print(f'[pose-extract] downloading pose model -> {dst}', file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, dst)
    return dst


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    video = args[0]
    model = ensure_model(args[args.index('--model') + 1] if '--model' in args else None)

    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    opts = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model),
        running_mode=mp_vision.RunningMode.VIDEO, num_poses=1)
    lm = mp_vision.PoseLandmarker.create_from_options(opts)

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames, i, prev = [], 0, -1
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
        ts = max(prev + 1, int(round(i * 1000 / fps)))
        prev = ts
        res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)
        if res.pose_landmarks:
            L = res.pose_landmarks[0]
            frames.append([[round(l.y * H, 1), round(l.x * W, 1), round(l.visibility, 3)] for l in L])
        else:
            frames.append(None)
        i += 1
    cap.release()
    lm.close()
    json.dump({'fps': fps, 'width': W, 'height': H, 'frames': frames}, sys.stdout)


if __name__ == '__main__':
    main()
