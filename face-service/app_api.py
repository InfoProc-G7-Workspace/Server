"""
Headless Flask API — pure ML compute only.
Detects faces and extracts feature vectors. No database, no matching.
All data storage and matching is handled by Express.

Primary: PYNQ FPGA for detection + feature extraction.
Fallback: MTCNN + ONNX local inference when PYNQ is unreachable.
"""

import base64
import io
import os
import time

import cv2
import numpy as np
import requests
from PIL import Image
from flask import Flask, jsonify, request


# ── Config ────────────────────────────────────────────────────────────────────

PYNQ_API_URL = os.environ.get("PYNQ_API_URL", "http://192.168.137.62:5001")
INTERNAL_API_KEY = os.environ.get("FACE_API_KEY", "face-internal-secret")
FACE_WIDTH = 96
FACE_HEIGHT = 112

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Path to ONNX model for local fallback
ONNX_MODEL_PATH = os.environ.get(
    "ONNX_MODEL_PATH",
    os.path.join(os.path.dirname(_SCRIPT_DIR), "Face-Verification", "mobilefacenet_pynq_fp32.onnx"),
)

SERVER_HOST = "0.0.0.0"
SERVER_PORT = int(os.environ.get("FACE_API_PORT", "5000"))


# ── PYNQ Remote Detection ────────────────────────────────────────────────────

def call_pynq_detect(image_b64):
    """
    Send base64 image to PYNQ for face detection + feature extraction.

    Returns: (ok, faces_or_msg, timing)
        faces: [{"feature": [...], "box": [x1,y1,x2,y2]}, ...]
    """
    try:
        resp = requests.post(
            f"{PYNQ_API_URL}/api/detect_feature",
            json={"image": image_b64},
            timeout=30,
        )
        data = resp.json()
        if data.get("ok"):
            return True, data["faces"], {
                "detect_ms": data.get("detect_ms", 0),
                "feature_ms": data.get("feature_ms", 0),
                "total_ms": data.get("total_ms", 0),
                "backend": "pynq",
            }
        else:
            return False, data.get("msg", "PYNQ detection failed"), {}
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
        return False, "PYNQ_UNREACHABLE", {}
    except Exception as e:
        return False, f"PYNQ API error: {e}", {}


# ── Local Fallback (MTCNN + ONNX) ────────────────────────────────────────────

_local_mtcnn = None
_local_ort_session = None


def _load_local_models():
    """Lazy-load local models only when PYNQ is unreachable."""
    global _local_mtcnn, _local_ort_session

    if _local_mtcnn is None:
        from facenet_pytorch import MTCNN
        _local_mtcnn = MTCNN(keep_all=True)
        print("[Fallback] MTCNN loaded")

    if _local_ort_session is None:
        import onnxruntime as ort
        if os.path.exists(ONNX_MODEL_PATH):
            _local_ort_session = ort.InferenceSession(ONNX_MODEL_PATH)
            print(f"[Fallback] ONNX model loaded: {ONNX_MODEL_PATH}")
        else:
            raise FileNotFoundError(f"ONNX model not found: {ONNX_MODEL_PATH}")


def _local_detect_and_align(image_rgb):
    """Detect faces using MTCNN and align them."""
    _load_local_models()

    img_pil = Image.fromarray(image_rgb)
    boxes, probs, landmarks = _local_mtcnn.detect(img_pil, landmarks=True)
    if boxes is None:
        return []

    img_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    faces = []
    for box, landmark in zip(boxes, landmarks):
        left_eye = landmark[0]
        right_eye = landmark[1]
        dy = right_eye[1] - left_eye[1]
        dx = right_eye[0] - left_eye[0]
        angle = np.degrees(np.arctan2(dy, dx))
        eye_center = ((left_eye[0] + right_eye[0]) / 2,
                      (left_eye[1] + right_eye[1]) / 2)
        M = cv2.getRotationMatrix2D(eye_center, angle, 1.0)
        rotated = cv2.warpAffine(img_bgr, M, (img_bgr.shape[1], img_bgr.shape[0]))
        x1, y1, x2, y2 = [int(v) for v in box]
        w = x2 - x1
        h = y2 - y1
        y1 = max(0, y1 - int(h * 0.15))
        y2 = min(rotated.shape[0], y2 + int(h * 0.05))
        x1 = max(0, x1 - int(w * 0.05))
        x2 = min(rotated.shape[1], x2 + int(w * 0.05))
        face = rotated[y1:y2, x1:x2]
        if face.size == 0:
            continue
        face = cv2.resize(face, (FACE_WIDTH, FACE_HEIGHT))
        faces.append((face, [int(v) for v in box]))
    return faces


def _local_extract_feature(face_img):
    """Extract feature using ONNX model (normal + flipped)."""
    _load_local_models()
    input_name = _local_ort_session.get_inputs()[0].name

    def preprocess(img):
        img = img.astype(np.float32)
        img = (img - 127.5) / 128.0
        img = img.transpose(2, 0, 1)
        return img[np.newaxis, :, :, :]

    feat = _local_ort_session.run(None, {input_name: preprocess(face_img)})[0]
    feat_flip = _local_ort_session.run(None, {input_name: preprocess(face_img[:, ::-1, :].copy())})[0]
    feat = np.concatenate([feat, feat_flip], axis=1)[0]
    feat = feat / np.linalg.norm(feat)
    return feat


def local_detect(image_b64):
    """Local fallback: MTCNN detection + ONNX feature extraction."""
    try:
        image = decode_image_data(image_b64)
        t0 = time.time()
        faces = _local_detect_and_align(image)
        t1 = time.time()

        if len(faces) == 0:
            return False, "No face detected", {}

        face_results = []
        for face_img, box in faces:
            feat = _local_extract_feature(face_img)
            face_results.append({
                "feature": feat.tolist(),
                "box": box,
            })
        t2 = time.time()

        return True, face_results, {
            "detect_ms": round((t1 - t0) * 1000),
            "feature_ms": round((t2 - t1) * 1000),
            "total_ms": round((t2 - t0) * 1000),
            "backend": "local",
        }
    except FileNotFoundError as e:
        return False, str(e), {}
    except Exception as e:
        return False, f"Local fallback error: {e}", {}


# ── Unified Detection (PYNQ → local fallback) ────────────────────────────────

def detect_faces(image_b64):
    """Try PYNQ first, fall back to local if unreachable."""
    ok, result, timing = call_pynq_detect(image_b64)
    if not ok and result == "PYNQ_UNREACHABLE":
        print("[Fallback] PYNQ unreachable, using local inference")
        return local_detect(image_b64)
    return ok, result, timing


# ── Utility ───────────────────────────────────────────────────────────────────

def decode_image_data(data_url):
    if "," in data_url:
        _, encoded = data_url.split(",", 1)
    else:
        encoded = data_url
    img_bytes = base64.b64decode(encoded)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    return np.array(img)


def annotate_image(image_b64, faces, names_and_sims):
    """Draw bounding boxes and labels on image, return base64 JPEG."""
    image = decode_image_data(image_b64)
    annotated = image.copy()
    for face_data, (name, sim) in zip(faces, names_and_sims):
        x1, y1, x2, y2 = face_data["box"]
        if name:
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(annotated, f"{name} {sim:.2f}", (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        else:
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 0, 0), 2)
            cv2.putText(annotated, "Unknown", (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
    buf = io.BytesIO()
    Image.fromarray(annotated).save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ── Auth Middleware ────────────────────────────────────────────────────────────

def require_internal_key():
    key = request.headers.get("X-Internal-Key", "")
    if key != INTERNAL_API_KEY:
        return jsonify({"ok": False, "msg": "Unauthorized"}), 403
    return None


# ── Flask App ─────────────────────────────────────────────────────────────────

app = Flask(__name__)


@app.before_request
def check_auth():
    if request.path == "/api/health":
        return None
    return require_internal_key()


@app.route("/api/health", methods=["GET"])
def api_health():
    """Health check including PYNQ connectivity."""
    pynq_ok = False
    try:
        resp = requests.get(f"{PYNQ_API_URL}/api/health", timeout=5)
        pynq_ok = resp.json().get("ok", False)
    except Exception:
        pass
    return jsonify({"ok": True, "pynq": pynq_ok})


@app.route("/api/detect", methods=["POST"])
def api_detect():
    """
    Detect faces and extract feature vectors from an image.
    Returns raw features — no matching, no database.

    Request:  { "image": "data:image/jpeg;base64,..." }
    Response: { "ok": true, "faces": [{"feature": [...], "box": [x1,y1,x2,y2]}], "timing": {...} }
    """
    data = request.get_json()
    image_data = data.get("image")
    if not image_data:
        return jsonify({"ok": False, "msg": "Missing image"})

    ok, result, timing = detect_faces(image_data)
    if not ok:
        return jsonify({"ok": False, "msg": result, "timing": timing})

    return jsonify({"ok": True, "faces": result, "timing": timing})


@app.route("/api/annotate", methods=["POST"])
def api_annotate():
    """
    Draw bounding boxes and labels on an image.

    Request:  { "image": "base64...", "faces": [...], "labels": [{"name":"...", "sim":0.9}, ...] }
    Response: { "ok": true, "annotated": "data:image/jpeg;base64,..." }
    """
    data = request.get_json()
    image_data = data.get("image")
    faces = data.get("faces", [])
    labels = data.get("labels", [])
    if not image_data:
        return jsonify({"ok": False, "msg": "Missing image"})

    names_and_sims = [(l.get("name"), l.get("sim", 0)) for l in labels]
    annotated_b64 = annotate_image(image_data, faces, names_and_sims)
    return jsonify({"ok": True, "annotated": annotated_b64})


if __name__ == "__main__":
    print(f"\n{'='*50}")
    print(f"  Face API (ML only):  http://localhost:{SERVER_PORT}")
    print(f"  PYNQ:                {PYNQ_API_URL}")
    print(f"{'='*50}\n")
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=False)
