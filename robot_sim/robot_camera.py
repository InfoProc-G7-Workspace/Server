"""
Robot Camera — MJPEG frame publisher via AWS IoT Core MQTT
==========================================================
Captures 320x240 frames and publishes base64-encoded JPEGs
to the IoT Core topic robot/video using X.509 certificate auth.

Install: pip install opencv-python awsiotsdk
Usage:
    IOT_ENDPOINT=<your-ats-endpoint> python robot_camera.py
"""

import os
import time
import base64
import cv2
from awscrt import mqtt
from awsiot import mqtt_connection_builder

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
CERTS_DIR    = os.path.join(SCRIPT_DIR, '..', 'certs')
KEYS_PATH    = os.path.join(os.path.expanduser('~'), 'keys.txt')


def load_keys():
    """Load KEY=VALUE pairs from ~/keys.txt."""
    keys = {}
    if os.path.isfile(KEYS_PATH):
        with open(KEYS_PATH) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    k, v = line.split('=', 1)
                    keys[k.strip()] = v.strip()
    return keys

_keys = load_keys()
IOT_ENDPOINT = os.getenv('IOT_ENDPOINT', _keys.get('IOT_ENDPOINT', ''))
CAMERA_ID    = int(os.getenv('CAMERA_ID', '0'))
JPEG_QUALITY = int(os.getenv('JPEG_QUALITY', '40'))
TARGET_FPS   = float(os.getenv('TARGET_FPS', '30'))
FRAME_DELAY  = 1.0 / TARGET_FPS
TOPIC        = 'robot/video'


def main():
    if not IOT_ENDPOINT:
        raise RuntimeError('Set IOT_ENDPOINT env var')

    cert_path = os.path.join(CERTS_DIR, 'device-cert.pem')
    key_path  = os.path.join(CERTS_DIR, 'private-key.pem')
    ca_path   = os.path.join(CERTS_DIR, 'root-ca.pem')

    for p in (cert_path, key_path, ca_path):
        if not os.path.isfile(p):
            raise RuntimeError(f'Missing certificate: {p}')

    connection = mqtt_connection_builder.mtls_from_path(
        endpoint=IOT_ENDPOINT,
        cert_filepath=cert_path,
        pri_key_filepath=key_path,
        ca_filepath=ca_path,
        client_id='robot-camera-' + str(int(time.time())),
        clean_session=True,
        keep_alive_secs=30,
    )

    connection.connect().result()
    print(f'[camera] Connected to IoT Core — publishing to {TOPIC} at {TARGET_FPS:.0f} fps')

    cap = cv2.VideoCapture(CAMERA_ID, cv2.CAP_V4L2)
    if not cap.isOpened():
        raise RuntimeError(f'Cannot open camera {CAMERA_ID}')

    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)

    encode_params = [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]

    try:
        while True:
            t0 = time.monotonic()

            ok, frame = cap.read()
            if not ok:
                print('[camera] Frame read failed — retrying...')
                time.sleep(0.5)
                continue

            _, buf = cv2.imencode('.jpg', frame, encode_params)
            payload = base64.b64encode(buf.tobytes()).decode('ascii')

            connection.publish(
                topic=TOPIC,
                payload=payload,
                qos=mqtt.QoS.AT_MOST_ONCE,
            )

            elapsed = time.monotonic() - t0
            sleep_for = FRAME_DELAY - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)

    except KeyboardInterrupt:
        print('[camera] Stopped.')
    finally:
        cap.release()
        connection.disconnect().result()


if __name__ == '__main__':
    main()
