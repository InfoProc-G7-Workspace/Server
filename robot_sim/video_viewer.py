"""
Robot Video Viewer — live MJPEG stream from AWS IoT Core MQTT
==============================================================
Connects to IoT Core via MQTT-over-WebSocket (SigV4-signed with
IAM credentials from ~/keys.txt) and displays incoming base64-
encoded JPEG frames in an OpenCV window.

Install: pip install awsiotsdk opencv-python numpy
Usage:   python video_viewer.py
"""

import os
import sys
import json
import time
import base64
import random
import signal
import threading

import cv2
import numpy as np
from awscrt import mqtt, auth
from awsiot import mqtt_connection_builder

KEYS_PATH = os.path.join(os.path.expanduser('~'), 'keys.txt')
VIDEO_TOPIC = 'robot/video'
STATUS_TOPIC = 'robot/status'


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


# ---------------------------------------------------------------------------
# Shared state between MQTT callback thread and main display thread
# ---------------------------------------------------------------------------
frame_lock = threading.Lock()
latest_frame = None
new_frame_event = threading.Event()
shutdown_event = threading.Event()

frame_count = 0
fps_start = time.monotonic()
current_fps = 0.0

robot_status = {}
status_lock = threading.Lock()


def on_video_message(topic, payload, **kwargs):
    """Decode an incoming base64 JPEG frame and store it."""
    global latest_frame, frame_count
    try:
        jpeg_bytes = base64.b64decode(payload)
        np_arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if frame is not None:
            with frame_lock:
                latest_frame = frame
            frame_count += 1
            new_frame_event.set()
    except Exception as e:
        print(f'[viewer] Frame decode error: {e}')


def on_status_message(topic, payload, **kwargs):
    """Handle robot status JSON messages."""
    global robot_status
    try:
        data = json.loads(payload.decode('utf-8'))
        with status_lock:
            robot_status = data
        print(f"[status] Robot {data.get('robot_id', '?')}: {data.get('status', '?')}")
    except Exception as e:
        print(f'[viewer] Status parse error: {e}')


def on_connection_interrupted(connection, error, **kwargs):
    print(f'[viewer] Connection interrupted: {error}')


def on_connection_resumed(connection, return_code, session_present, **kwargs):
    print(f'[viewer] Connection resumed (session_present={session_present})')
    if not session_present:
        connection.subscribe(VIDEO_TOPIC, mqtt.QoS.AT_MOST_ONCE, on_video_message)
        connection.subscribe(STATUS_TOPIC, mqtt.QoS.AT_LEAST_ONCE, on_status_message)


def signal_handler(sig, frame):
    print('\n[viewer] Shutting down...')
    shutdown_event.set()


def main():
    global current_fps, frame_count, fps_start

    keys = load_keys()
    iot_endpoint = os.getenv('IOT_ENDPOINT', keys.get('IOT_ENDPOINT', ''))
    aws_region = os.getenv('AWS_REGION', keys.get('AWS_REGION', 'eu-west-2'))
    access_key = os.getenv('AWS_ACCESS_KEY_ID', keys.get('AWS_ACCESS_KEY_ID', ''))
    secret_key = os.getenv('AWS_SECRET_ACCESS_KEY', keys.get('AWS_SECRET_ACCESS_KEY', ''))

    if not iot_endpoint:
        sys.exit('[viewer] IOT_ENDPOINT not set in ~/keys.txt or environment')
    if not access_key or not secret_key:
        sys.exit('[viewer] AWS credentials not set in ~/keys.txt or environment')

    credentials_provider = auth.AwsCredentialsProvider.new_static(
        access_key_id=access_key,
        secret_access_key=secret_key,
    )

    client_id = f'python-viewer-{random.randint(0, 9999)}'
    connection = mqtt_connection_builder.websockets_with_default_aws_signing(
        endpoint=iot_endpoint,
        region=aws_region,
        credentials_provider=credentials_provider,
        client_id=client_id,
        clean_session=True,
        keep_alive_secs=30,
        on_connection_interrupted=on_connection_interrupted,
        on_connection_resumed=on_connection_resumed,
    )

    print(f'[viewer] Connecting to {iot_endpoint} as {client_id}...')
    connection.connect().result()
    print('[viewer] Connected — subscribing to topics')

    sub1, _ = connection.subscribe(VIDEO_TOPIC, mqtt.QoS.AT_MOST_ONCE, on_video_message)
    sub1.result()
    sub2, _ = connection.subscribe(STATUS_TOPIC, mqtt.QoS.AT_LEAST_ONCE, on_status_message)
    sub2.result()
    print(f'[viewer] Subscribed to {VIDEO_TOPIC} and {STATUS_TOPIC}')
    print('[viewer] Press q or ESC in the window to quit')

    signal.signal(signal.SIGINT, signal_handler)

    cv2.namedWindow('Robot Video', cv2.WINDOW_AUTOSIZE)

    while not shutdown_event.is_set():
        new_frame_event.wait(timeout=0.03)
        new_frame_event.clear()

        with frame_lock:
            display_frame = latest_frame

        # Update FPS counter
        now = time.monotonic()
        if now - fps_start >= 1.0:
            current_fps = frame_count / (now - fps_start)
            frame_count = 0
            fps_start = now

        if display_frame is not None:
            overlay = display_frame.copy()
            cv2.putText(overlay, f'{current_fps:.1f} fps', (10, 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

            with status_lock:
                status = robot_status.copy()
            if status:
                color = (0, 255, 0) if status.get('status') == 'online' else (0, 0, 255)
                cv2.putText(overlay,
                            f"Robot: {status.get('robot_id', '?')} [{status.get('status', '?')}]",
                            (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

            cv2.imshow('Robot Video', overlay)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == 27:
            break

    print('[viewer] Disconnecting...')
    connection.unsubscribe(VIDEO_TOPIC)
    connection.unsubscribe(STATUS_TOPIC)
    connection.disconnect().result()
    cv2.destroyAllWindows()
    print('[viewer] Done.')


if __name__ == '__main__':
    main()
