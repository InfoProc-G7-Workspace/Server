#!/bin/bash

IOT_ENDPOINT="a36qzdxn8uvgh3-ats.iot.eu-west-2.amazonaws.com"

# ── Run ───────────────────────────────────────────────────────────────────────

export IOT_ENDPOINT

python3 robot_camera.py
