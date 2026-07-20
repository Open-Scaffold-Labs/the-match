# Third-Party Notices

## MoveNet (pose estimation model)

- **Model:** MoveNet SinglePose Lightning v4 (int8), converted TFLite → ONNX via tf2onnx (opset 13)
- **File:** `client/public/models/movenet-lightning-192.onnx` (2.9 MB)
- **Source:** https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/int8/4
- **Author:** Google
- **License:** Apache License 2.0 — http://www.apache.org/licenses/LICENSE-2.0
- **Use:** on-device golf-swing pose estimation (Swing Intelligence V1.5).
  Runs locally via onnxruntime-web; no imagery leaves the device.

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License. Unless required by
applicable law or agreed to in writing, software distributed under the
License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS
OF ANY KIND, either express or implied.

## MediaPipe Pose Landmarker (archive importer, dev CLI)

- **Component**: MediaPipe Pose Landmarker (`pose_landmarker_lite.task`) + `mediapipe` Python package
- **Source**: Google — https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- **License**: Apache-2.0
- **Use**: server-side keypoint extraction in `scripts/pose-extract.py` for the
  swing archive importer (`--pose`). The model file is downloaded on first run
  to `~/.cache/the-match/` and is NOT bundled or redistributed with the app.
- **Privacy**: runs locally on the developer's machine; no video leaves the box.
