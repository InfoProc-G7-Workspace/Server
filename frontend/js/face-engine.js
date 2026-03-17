// ─── FaceEngine: client-side face detection + feature extraction ─────────────
// MediaPipe FaceDetector  → bounding boxes + eye keypoints
// ONNX Runtime Web        → MobileFaceNet embedding (64-d × 2 = 128-d, L2-normalized)
//
// Public API:
//   FaceEngine.init()                          → Promise<void>
//   FaceEngine.detectAndExtract(imageEl)       → Promise<[{feature,box,confidence}]>
//   FaceEngine.detectAndExtractFromDataUrl(u)  → Promise<[{feature,box,confidence}]>
//   FaceEngine.drawAnnotations(canvas, faces, labels)
//   FaceEngine.isReady()                       → boolean

var FaceEngine = (function () {
  // ── State ──────────────────────────────────────────────────────────────
  var _detector = null;
  var _session  = null;
  var _ready    = false;
  var _loading  = null;   // shared init promise

  // ── Config ─────────────────────────────────────────────────────────────
  var MODEL_URL = '/models/mobilefacenet_micro.onnx';
  var FACE_W    = 96;
  var FACE_H    = 112;
  var MP_CDN    = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
  var MP_WASM   = MP_CDN + '/wasm';
  var MP_MODEL  = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

  // ── Init (idempotent) ──────────────────────────────────────────────────
  function init() {
    if (_ready) return Promise.resolve();
    if (_loading) return _loading;

    _loading = _doInit();
    return _loading;
  }

  async function _doInit() {
    try {
      // MediaPipe FaceDetector
      var vision = await import(MP_CDN + '/vision_bundle.mjs');
      var fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
      _detector = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      });

      // ONNX Runtime (ort is loaded globally via <script> in index.html)
      _session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
      });

      _ready = true;
      console.log('[FaceEngine] Ready  (detector + onnx)');
    } catch (e) {
      _loading = null;
      console.error('[FaceEngine] Init failed:', e);
      throw e;
    }
  }

  // ── Detect faces ───────────────────────────────────────────────────────
  // Returns: [{box:{x,y,w,h}, keypoints:{leftEye,rightEye,...}, confidence}]
  function detect(imageEl) {
    var result = _detector.detect(imageEl);
    return result.detections.map(function (d) {
      var bb = d.boundingBox;
      var kp = {};
      (d.keypoints || []).forEach(function (k) {
        // keypoints are normalised 0-1
        kp[k.name || k.label] = { x: k.x, y: k.y };
      });
      return {
        box: { x: bb.originX, y: bb.originY, w: bb.width, h: bb.height },
        keypoints: kp,
        confidence: d.categories ? d.categories[0].score : 0,
      };
    });
  }

  // ── Crop + align a single face ─────────────────────────────────────────
  function cropAlignedFace(imageEl, det) {
    var imgW = imageEl.videoWidth  || imageEl.naturalWidth  || imageEl.width;
    var imgH = imageEl.videoHeight || imageEl.naturalHeight || imageEl.height;

    var kp = det.keypoints;
    var le = kp.leftEye, re = kp.rightEye;

    // Rotation angle from eyes (keypoints are normalised 0-1)
    var angle = 0;
    if (le && re) {
      angle = Math.atan2((re.y - le.y) * imgH, (re.x - le.x) * imgW);
    }

    // Bounding box (pixels)
    var bx = det.box.x, by = det.box.y, bw = det.box.w, bh = det.box.h;

    // Padding (same ratios as server-side MTCNN pipeline)
    var padTop   = bh * 0.15;
    var padBot   = bh * 0.05;
    var padSide  = bw * 0.05;
    var cx = Math.max(0, bx - padSide);
    var cy = Math.max(0, by - padTop);
    var cw = Math.min(imgW - cx, bw + padSide * 2);
    var ch = Math.min(imgH - cy, bh + padTop + padBot);

    var out = document.createElement('canvas');
    out.width  = FACE_W;
    out.height = FACE_H;
    var ctx = out.getContext('2d');

    if (Math.abs(angle) > 0.01 && le && re) {
      // Rotate around eye centre, then crop
      var ecx = ((le.x + re.x) / 2) * imgW;
      var ecy = ((le.y + re.y) / 2) * imgH;
      var tmp = document.createElement('canvas');
      tmp.width = imgW; tmp.height = imgH;
      var tc = tmp.getContext('2d');
      tc.translate(ecx, ecy);
      tc.rotate(-angle);
      tc.translate(-ecx, -ecy);
      tc.drawImage(imageEl, 0, 0);
      ctx.drawImage(tmp, cx, cy, cw, ch, 0, 0, FACE_W, FACE_H);
    } else {
      ctx.drawImage(imageEl, cx, cy, cw, ch, 0, 0, FACE_W, FACE_H);
    }
    return out;
  }

  // ── Pixel buffer → NCHW Float32 (BGR, normalised) ─────────────────────
  function _toTensor(imageData, flip) {
    var d = imageData.data;  // RGBA
    var t = new Float32Array(3 * FACE_H * FACE_W);
    for (var y = 0; y < FACE_H; y++) {
      for (var x = 0; x < FACE_W; x++) {
        var sx = flip ? (FACE_W - 1 - x) : x;
        var i = (y * FACE_W + sx) * 4;
        // BGR order to match cv2-based training pipeline
        t[0 * FACE_H * FACE_W + y * FACE_W + x] = (d[i + 2] - 127.5) / 128.0; // B
        t[1 * FACE_H * FACE_W + y * FACE_W + x] = (d[i + 1] - 127.5) / 128.0; // G
        t[2 * FACE_H * FACE_W + y * FACE_W + x] = (d[i]     - 127.5) / 128.0; // R
      }
    }
    return t;
  }

  // ── Run model (normal + flipped → concat → L2 norm) ───────────────────
  async function extractFeature(faceCanvas) {
    var ctx  = faceCanvas.getContext('2d');
    var data = ctx.getImageData(0, 0, FACE_W, FACE_H);
    var name = _session.inputNames[0];

    var runOne = function (buf) {
      var tensor = new ort.Tensor('float32', buf, [1, 3, FACE_H, FACE_W]);
      var feeds  = {}; feeds[name] = tensor;
      return _session.run(feeds);
    };

    var rNorm = await runOne(_toTensor(data, false));
    var rFlip = await runOne(_toTensor(data, true));

    var fNorm = rNorm[_session.outputNames[0]].data;
    var fFlip = rFlip[_session.outputNames[0]].data;

    // Concatenate → 128-d
    var feat = new Float32Array(fNorm.length + fFlip.length);
    feat.set(fNorm, 0);
    feat.set(fFlip, fNorm.length);

    // L2 normalise
    var norm = 0;
    for (var i = 0; i < feat.length; i++) norm += feat[i] * feat[i];
    norm = Math.sqrt(norm) || 1;
    for (var i = 0; i < feat.length; i++) feat[i] /= norm;

    return Array.from(feat);
  }

  // ── High-level: detect all faces + extract features ────────────────────
  async function detectAndExtract(imageEl) {
    await init();
    var dets = detect(imageEl);
    if (!dets.length) return [];

    var results = [];
    for (var i = 0; i < dets.length; i++) {
      var face    = cropAlignedFace(imageEl, dets[i]);
      var feature = await extractFeature(face);
      results.push({
        box:        dets[i].box,
        keypoints:  dets[i].keypoints,
        confidence: dets[i].confidence,
        feature:    feature,
      });
    }
    return results;
  }

  // ── Convenience: from data-URL string ──────────────────────────────────
  function detectAndExtractFromDataUrl(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload  = function () { detectAndExtract(img).then(resolve, reject); };
      img.onerror = function () { reject(new Error('Image load failed')); };
      img.src = dataUrl;
    });
  }

  // ── Draw annotations on a canvas ───────────────────────────────────────
  // labels: [{name, similarity}] aligned with faces array
  function drawAnnotations(canvas, faces, labels) {
    var ctx = canvas.getContext('2d');
    for (var i = 0; i < faces.length; i++) {
      var b = faces[i].box;
      var l = (labels && labels[i]) || {};
      var matched = !!l.name;
      ctx.strokeStyle = matched ? '#00ff00' : '#ff0000';
      ctx.lineWidth   = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);

      var text = matched ? l.name + ' ' + (l.similarity || 0).toFixed(2) : 'Unknown';
      ctx.font      = '14px sans-serif';
      ctx.fillStyle = matched ? '#00ff00' : '#ff0000';
      ctx.fillText(text, b.x, b.y - 4);
    }
  }

  // ── Public ─────────────────────────────────────────────────────────────
  return {
    init:                        init,
    detect:                      detect,
    extractFeature:              extractFeature,
    detectAndExtract:            detectAndExtract,
    detectAndExtractFromDataUrl: detectAndExtractFromDataUrl,
    drawAnnotations:             drawAnnotations,
    isReady:                     function () { return _ready; },
  };
})();
