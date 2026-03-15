# Robot Cloud Controller — EC2 Deployment Guide

## Architecture

```
Browser (phone/desktop)
  │
  │  HTTP / WSS
  ▼
┌─────────────────────────────┐
│  Nginx (port 80/443)        │  ← reverse proxy
│  └─► Node.js (port 3000)   │  ← Express backend
│       ├── /api/*            │     API routes (DynamoDB, S3, IoT signing)
│       └── /*                │     Static frontend files
└─────────────────────────────┘
  │
  │  AWS SDK
  ▼
AWS IoT Core / DynamoDB / S3 / KVS
```

**Frontend** (`frontend/`): Vanilla JS, served as static files by Express.
**Backend** (`backend/`): Express server, handles all AWS API calls. Credentials never reach the browser.

---

## Prerequisites

- AWS EC2 instance running **Ubuntu 24.04**
- Security group allows inbound: **TCP 22 (SSH)**, **TCP 80 (HTTP)**, **TCP 443 (HTTPS, optional)**
- AWS IAM user with permissions: `AWSIoTFullAccess`, `AmazonDynamoDBFullAccess`, `AmazonS3FullAccess`, `AmazonKinesisVideoStreamsFullAccess`
- AWS resources already created (IoT Core endpoint, DynamoDB tables: `robots`, `sessions`, S3 buckets)

---

## Step 1 — SSH into EC2

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

---

## Step 2 — Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should show v20.x
npm -v
```

---

## Step 3 — Install Nginx

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
```

---

## Step 4 — Install PM2 (process manager)

```bash
sudo npm install -g pm2
```

---

## Step 5 — Clone the repo

```bash
cd ~
git clone <YOUR_REPO_URL> Server
cd Server
```

---

## Step 6 — Configure keys

```bash
cp keys.txt.example ~/keys.txt
nano ~/keys.txt
```

Fill in your real values:

```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=wJal...
AWS_REGION=eu-west-2
IOT_ENDPOINT=a36qzdxn8uvgh3-ats.iot.eu-west-2.amazonaws.com
IMAGE_BUCKET=robot-raw-images-eu-west-2
SCENE_BUCKET=robot-3d-scenes-eu-west-2
PORT=3000
```

---

## Step 7 — Install dependencies

```bash
cd ~/Server/backend
npm install
```

---

## Step 8 — Test locally

```bash
node server.js
# Should print: Server running on http://0.0.0.0:3000
# Ctrl+C to stop
```

Verify the health endpoint:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","timestamp":"..."}
```

---

## Step 9 — Start with PM2

```bash
cd ~/Server
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# Run the command PM2 prints (sudo env PATH=... pm2 startup ...)
```

Useful PM2 commands:

```bash
pm2 status          # check running processes
pm2 logs robot-cloud  # view logs
pm2 restart robot-cloud
pm2 stop robot-cloud
```

---

## Step 10 — Configure Nginx reverse proxy

```bash
sudo cp ~/Server/nginx.conf /etc/nginx/sites-available/robot-cloud
sudo ln -sf /etc/nginx/sites-available/robot-cloud /etc/nginx/sites-enabled/robot-cloud
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t        # test config
sudo systemctl restart nginx
```

Now visit `http://<EC2_PUBLIC_IP>` in your browser — you should see the Robot Controller UI.

---

## Step 11 — (Optional) HTTPS with Let's Encrypt

If you have a domain name pointed at your EC2 IP:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# Follow the prompts; certbot will auto-configure Nginx for HTTPS
```

---

## Updating the app

```bash
cd ~/Server
git pull
cd backend && npm install
pm2 restart robot-cloud
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `~/keys.txt not found` | Copy `keys.txt.example` to `~/keys.txt` and fill in values |
| MQTT connection fails | Check IoT endpoint in `~/keys.txt`; verify IAM permissions |
| 502 Bad Gateway | PM2 process crashed — check `pm2 logs robot-cloud` |
| Can't reach port 80 | Check EC2 security group inbound rules |
| DynamoDB errors | Verify tables `robots` and `sessions` exist in your region |

---

## File Structure

```
Server/
├── backend/
│   ├── server.js          # Express entry point
│   ├── config.js           # Loads ~/keys.txt
│   ├── aws.js              # Shared AWS SDK clients
│   ├── routes/
│   │   ├── robots.js       # GET/POST /api/robots
│   │   ├── sessions.js     # CRUD /api/sessions
│   │   ├── mqtt.js         # GET /api/mqtt/signed-url
│   │   ├── stream.js       # GET /api/stream/images, /scene-url
│   │   └── kvs.js          # GET /api/kvs/viewer-config
│   └── package.json
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js           # Fetch wrapper for backend API
│       ├── app.js           # Stage navigation + connect
│       ├── mqtt.js          # MQTT via backend-signed URL
│       ├── controls.js      # D-pad + keyboard
│       ├── stream.js        # Video frame display
│       └── sessions.js      # Session UI
├── ecosystem.config.js      # PM2 config
├── nginx.conf               # Nginx reverse proxy config
├── keys.txt.example         # Template — copy to ~/keys.txt
├── DEPLOY.md                # This file
└── .gitignore
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/mqtt/signed-url` | SigV4-signed WSS URL for MQTT |
| GET | `/api/robots` | List all robots |
| GET | `/api/robots/:id` | Get single robot |
| POST | `/api/robots` | Create robot |
| GET | `/api/sessions?robot_id=` | List sessions |
| GET | `/api/sessions/:id` | Get single session |
| POST | `/api/sessions` | Create session |
| PUT | `/api/sessions/:id/end` | End session |
| GET | `/api/stream/images?prefix=` | List session images (signed URLs) |
| GET | `/api/stream/scene-url?key=` | Get signed URL for 3D scene |
| GET | `/api/kvs/viewer-config?channel=` | KVS WebRTC viewer config |
