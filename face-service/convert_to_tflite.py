#!/usr/bin/env python3
"""
MobileFaceNet micro (epoch 40) → ONNX → TFLite 转换 + 余弦相似度验证

使用方法:
    conda activate face-local
    cd /home/han/Code/Server/face-service
    python convert_to_tflite.py
输出:
    models/mobilefacenet_micro.onnx
    models/mobilefacenet_micro.tflite
"""

import sys, os, shutil
import numpy as np

# ── 0. 路径配置 ──────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR   = os.path.join(SCRIPT_DIR, "models")
CKPT_PATH   = os.path.join(MODEL_DIR, "mobilefacenet_micro_ep040.ckpt")
ONNX_PATH   = os.path.join(MODEL_DIR, "mobilefacenet_micro.onnx")
TFLITE_PATH = os.path.join(MODEL_DIR, "mobilefacenet_micro.tflite")

# MobileFaceNet 源码路径
MFNET_ROOT  = "/home/han/Code/MobileFaceNet_Pytorch"
sys.path.insert(0, MFNET_ROOT)

# ── 1. 加载 PyTorch 模型 ─────────────────────────────────────────────────────
print("=" * 60)
print("[1/4] Loading PyTorch model (micro, epoch 40) ...")
import torch
from core.model_lh import MobileFacenet, Mobilefacenet_micro_setting

net = MobileFacenet(
    Mobilefacenet_micro_setting,
    inplanes=32, mid_channels=96, embedding_size=64, use_se=True,
)
ckpt = torch.load(CKPT_PATH, map_location="cpu")
net.load_state_dict(ckpt["net_state_dict"])
net.eval()
total_params = sum(p.numel() for p in net.parameters())
print(f"  ✓ Loaded. Parameters: {total_params:,}")

# 生成固定随机输入 (NCHW: 1×3×112×96)
np.random.seed(42)
random_input_np = np.random.randn(1, 3, 112, 96).astype(np.float32)

# PyTorch 推理
with torch.no_grad():
    pt_input = torch.from_numpy(random_input_np)
    pt_output = net(pt_input).numpy().flatten()
print(f"  PyTorch output shape: {pt_output.shape}, norm: {np.linalg.norm(pt_output):.6f}")

# ── 2. 导出 ONNX ────────────────────────────────────────────────────────────
print()
print("=" * 60)
print("[2/4] Exporting to ONNX ...")
dummy = torch.randn(1, 3, 112, 96)
torch.onnx.export(
    net, dummy, ONNX_PATH,
    input_names=["input"],
    output_names=["embedding"],
    dynamic_axes={
        "input":     {0: "batch_size"},
        "embedding": {0: "batch_size"},
    },
    opset_version=13,
)
onnx_size = os.path.getsize(ONNX_PATH) / 1024
print(f"  ✓ Saved: {ONNX_PATH}  ({onnx_size:.1f} KB)")

# ONNX Runtime 验证
import onnxruntime as ort
sess = ort.InferenceSession(ONNX_PATH)
onnx_output = sess.run(None, {"input": random_input_np})[0].flatten()

cos_pt_onnx = np.dot(pt_output, onnx_output) / (
    np.linalg.norm(pt_output) * np.linalg.norm(onnx_output) + 1e-8
)
print(f"  ONNX output shape: {onnx_output.shape}, norm: {np.linalg.norm(onnx_output):.6f}")
print(f"  Cosine similarity (PyTorch vs ONNX): {cos_pt_onnx:.8f}")

# ── 3. ONNX → TFLite ────────────────────────────────────────────────────────
print()
print("=" * 60)
print("[3/4] Converting ONNX → TFLite ...")

converted = False

# --- 方法 A: onnx2tf (最佳质量) ---
if not converted:
    try:
        print("  Trying onnx2tf ...")
        import onnx2tf
        TMP_SAVED = os.path.join(MODEL_DIR, "_tf_saved_model")
        onnx2tf.convert(
            input_onnx_file_path=ONNX_PATH,
            output_folder_path=TMP_SAVED,
            non_verbose=True,
        )
        # 在输出目录中寻找 tflite 文件
        for f in os.listdir(TMP_SAVED):
            if f.endswith(".tflite"):
                shutil.move(os.path.join(TMP_SAVED, f), TFLITE_PATH)
                converted = True
                break
        if not converted:
            # 没有自动生成 tflite, 手动从 SavedModel 转换
            import tensorflow as tf
            converter = tf.lite.TFLiteConverter.from_saved_model(TMP_SAVED)
            converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
            tflite_model = converter.convert()
            with open(TFLITE_PATH, "wb") as f:
                f.write(tflite_model)
            converted = True
        shutil.rmtree(TMP_SAVED, ignore_errors=True)
        print(f"  ✓ onnx2tf succeeded")
    except Exception as e:
        print(f"  ✗ onnx2tf failed: {e}")
        shutil.rmtree(os.path.join(MODEL_DIR, "_tf_saved_model"), ignore_errors=True)

# --- 方法 B: onnx → tf SavedModel (onnx-tf) → tflite ---
if not converted:
    try:
        print("  Trying onnx-tf ...")
        import onnx
        from onnx_tf.backend import prepare
        onnx_model = onnx.load(ONNX_PATH)
        tf_rep = prepare(onnx_model)
        TMP_SAVED = os.path.join(MODEL_DIR, "_tf_saved_model")
        tf_rep.export_graph(TMP_SAVED)
        import tensorflow as tf
        converter = tf.lite.TFLiteConverter.from_saved_model(TMP_SAVED)
        converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
        tflite_model = converter.convert()
        with open(TFLITE_PATH, "wb") as f:
            f.write(tflite_model)
        converted = True
        shutil.rmtree(TMP_SAVED, ignore_errors=True)
        print(f"  ✓ onnx-tf succeeded")
    except Exception as e:
        print(f"  ✗ onnx-tf failed: {e}")
        shutil.rmtree(os.path.join(MODEL_DIR, "_tf_saved_model"), ignore_errors=True)

# --- 方法 C: 手动用 TF ops 重建网络 (最可靠的 fallback) ---
if not converted:
    try:
        print("  Trying manual TF reconstruction ...")
        import tensorflow as tf

        # 读取 ONNX 权重, 通过 onnxruntime 拿中间值来验证
        # 这里直接用 tf.function 包装 onnxruntime 来生成 tflite
        # 最简方案: 用 concrete function 包一层 onnxruntime

        # 更实用的方案: 直接把 ONNX 当成 inference engine,
        # 生成一个 "wrapper" tflite, 实际用 onnxruntime 推理.
        # 但这不是真正的 tflite. 所以这里我们用 numpy weights 手动转.

        # 读 ONNX 的所有权重
        import onnx
        from onnx import numpy_helper
        onnx_model = onnx.load(ONNX_PATH)
        weights = {}
        for init in onnx_model.graph.initializer:
            weights[init.name] = numpy_helper.to_array(init)

        print(f"  Found {len(weights)} weight tensors in ONNX model")
        print("  Weight names (first 10):")
        for i, name in enumerate(list(weights.keys())[:10]):
            print(f"    {name}: {weights[name].shape}")

        # 由于手动重建网络太复杂, 我们用另一个方式:
        # 将 ONNX 通过 onnxruntime 的 TensorRT / OpenVINO EP 转换
        # 或者直接创建一个 tf.Module 包装 numpy 推理

        # 最终 fallback: 用 tf.Module + numpy weights 逐层重建
        # 这里我们选择最简单的: 生成一个空壳 tflite 并用 onnxruntime
        raise RuntimeError(
            "Manual reconstruction skipped — too complex for auto-conversion.\n"
            "请手动安装兼容版本:\n"
            "  pip install 'onnx==1.16.2' 'onnx_graphsurgeon==0.5.2' 'onnx2tf==1.26.3'\n"
            "然后重新运行此脚本。"
        )
    except Exception as e:
        print(f"  ✗ Manual reconstruction failed: {e}")

if not converted:
    print()
    print("=" * 60)
    print("ERROR: 所有转换方法均失败。请尝试手动修复依赖:")
    print("  pip install 'onnx==1.16.2' 'onnx_graphsurgeon==0.5.2' 'onnx2tf==1.26.3'")
    print("  或:")
    print("  pip install onnx-tf")
    print("然后重新运行此脚本。")
    sys.exit(1)

tflite_size = os.path.getsize(TFLITE_PATH) / 1024
print(f"  ✓ Saved: {TFLITE_PATH}  ({tflite_size:.1f} KB)")

# ── 4. TFLite 验证 ──────────────────────────────────────────────────────────
print()
print("=" * 60)
print("[4/4] Verifying TFLite model ...")

import tensorflow as tf
interpreter = tf.lite.Interpreter(model_path=TFLITE_PATH)
interpreter.allocate_tensors()

input_details  = interpreter.get_input_details()
output_details = interpreter.get_output_details()

print(f"  TFLite input:  {input_details[0]['name']}  shape={input_details[0]['shape']}  dtype={input_details[0]['dtype']}")
print(f"  TFLite output: {output_details[0]['name']} shape={output_details[0]['shape']} dtype={output_details[0]['dtype']}")

# TFLite 输入可能是 NHWC 而非 NCHW, 需要转置
tflite_input_shape = input_details[0]["shape"]
if tflite_input_shape[-1] == 3:  # NHWC
    tflite_input = np.transpose(random_input_np, (0, 2, 3, 1))  # NCHW → NHWC
    print("  (Input transposed NCHW → NHWC)")
else:  # NCHW
    tflite_input = random_input_np

interpreter.set_tensor(input_details[0]["index"], tflite_input)
interpreter.invoke()
tflite_output = interpreter.get_tensor(output_details[0]["index"]).flatten()

# 余弦相似度
cos_pt_tflite = np.dot(pt_output, tflite_output) / (
    np.linalg.norm(pt_output) * np.linalg.norm(tflite_output) + 1e-8
)
cos_onnx_tflite = np.dot(onnx_output, tflite_output) / (
    np.linalg.norm(onnx_output) * np.linalg.norm(tflite_output) + 1e-8
)

print(f"  TFLite output shape: {tflite_output.shape}, norm: {np.linalg.norm(tflite_output):.6f}")
print()
print("=" * 60)
print("  VERIFICATION RESULTS")
print("=" * 60)
print(f"  Cosine similarity (PyTorch  vs ONNX):   {cos_pt_onnx:.8f}")
print(f"  Cosine similarity (PyTorch  vs TFLite): {cos_pt_tflite:.8f}")
print(f"  Cosine similarity (ONNX     vs TFLite): {cos_onnx_tflite:.8f}")
print()

# L2 距离
l2_pt_onnx   = np.linalg.norm(pt_output - onnx_output)
l2_pt_tflite = np.linalg.norm(pt_output - tflite_output)
print(f"  L2 distance (PyTorch vs ONNX):   {l2_pt_onnx:.8f}")
print(f"  L2 distance (PyTorch vs TFLite): {l2_pt_tflite:.8f}")
print()

if cos_pt_tflite > 0.999:
    print("  ✅ PASS — TFLite 模型与 PyTorch 高度一致 (cosine > 0.999)")
elif cos_pt_tflite > 0.99:
    print("  ⚠️  WARN — 轻微精度损失但可接受 (cosine > 0.99)")
else:
    print("  ❌ FAIL — 精度损失过大, 请检查转换过程")

print()
print(f"输出文件:")
print(f"  ONNX:   {ONNX_PATH}")
print(f"  TFLite: {TFLITE_PATH}")
print()
