# JD Social — Cloud Server Setup Guide

> সম্পূর্ণ প্রোডাকশন-রেডি ক্লাউড ব্যাকএন্ড

---

## 🏗️ Architecture

```
Internet → Nginx (SSL) → Node.js (PM2 Cluster) → PostgreSQL + Redis
                              ↕ Socket.IO (WebSocket)
                         AWS S3 (Video Storage)
```

---

## ☁️ উপায় ১ — ফ্রি/সস্তা Cloud Services (শুরুর জন্য)

| সার্ভিস | বিকল্প | মূল্য |
|---------|--------|-------|
| **App Server** | Railway.app / Render.com | বিনামূল্যে → $7/মাস |
| **Database** | Supabase / Neon.tech | বিনামূল্যে |
| **Redis** | Upstash.com | বিনামূল্যে |
| **Storage** | Cloudflare R2 | প্রায় বিনামূল্যে |
| **Domain** | Namecheap | ~$10/বছর |

### Railway.app-এ Deploy করুন (সহজ)

```bash
# Railway CLI ইনস্টল
npm install -g @railway/cli

# লগইন ও ডিপ্লয়
railway login
cd server
railway init
railway up

# Database যোগ করুন
railway add postgresql
railway add redis
```

---

## 🖥️ উপায় ২ — VPS Server (পূর্ণ নিয়ন্ত্রণ)

### প্রয়োজনীয়তা
- Ubuntu 22.04 VPS (DigitalOcean / Vultr / Linode)
- ন্যূনতম: 2 vCPU, 2GB RAM, 20GB Storage
- একটি Domain নাম

### এক কমান্ডে সব ইনস্টল

```bash
git clone https://github.com/yourname/jd-social.git
cd jd-social
sudo bash scripts/deploy.sh yourdomain.com
```

এই স্ক্রিপ্ট স্বয়ংক্রিয়ভাবে করবে:
- Node.js 20, PostgreSQL 16, Redis 7 ইনস্টল
- Database তৈরি ও Migration চালানো
- PM2 দিয়ে Cluster মোডে অ্যাপ চালু
- Nginx রিভার্স প্রক্সি কনফিগার
- Let's Encrypt SSL সার্টিফিকেট

---

## 🐳 উপায় ৩ — Docker (সহজ ম্যানেজমেন্ট)

```bash
# সব সার্ভিস একসাথে চালু
docker-compose up -d

# লগ দেখুন
docker-compose logs -f app

# ডাটাবেস মাইগ্রেশন
docker-compose exec app node scripts/migrate.js
```

---

## ⚙️ Environment কনফিগারেশন

`server/.env` ফাইলে নিচের তথ্য যোগ করুন:

### বিনামূল্যে সার্ভিস লিংক
| সার্ভিস | URL | কী পাবেন |
|---------|-----|---------|
| Supabase | supabase.com | `DB_HOST`, `DB_PASSWORD` |
| Upstash | upstash.com | `REDIS_URL` |
| Cloudflare R2 | cloudflare.com/r2 | `AWS_*` credentials |
| Twilio | twilio.com | SMS OTP keys |
| bKash Sandbox | developer.bka.sh | Payment keys |

---

## 📡 API Endpoints

```
POST   /api/auth/register      — নিবন্ধন
POST   /api/auth/login         — লগইন
POST   /api/auth/send-otp      — OTP পাঠান
POST   /api/auth/verify-otp    — OTP যাচাই
GET    /api/auth/me            — বর্তমান ব্যবহারকারী

GET    /api/videos/feed        — ভিডিও ফিড
POST   /api/videos             — ভিডিও আপলোড
GET    /api/videos/:id         — একটি ভিডিও
POST   /api/videos/:id/like    — লাইক/আনলাইক
POST   /api/videos/:id/comments— কমেন্ট

GET    /api/wallet             — ওয়ালেট ব্যালেন্স
POST   /api/wallet/withdraw    — উত্তোলন (bKash/Nagad)
GET    /api/wallet/stats       — আয়ের পরিসংখ্যান

GET    /api/chat/rooms         — চ্যাট রুম
POST   /api/chat/rooms         — নতুন চ্যাট
GET    /api/chat/:roomId/messages — বার্তা

POST   /api/live/start         — লাইভ শুরু
GET    /api/live/active        — চলমান লাইভ

GET    /api/health             — সার্ভার স্ট্যাটাস
```

---

## 🔌 Socket.IO Events

```javascript
// সংযোগ
socket.emit('chat:join', { roomId })
socket.emit('chat:message', { roomId, text })
socket.emit('live:start', { title })
socket.emit('live:gift', { streamId, giftType: 'rose' })
socket.emit('live:comment', { streamId, text })
socket.on('live:viewer_count', (count) => {})
socket.on('chat:message', (message) => {})
```

---

## 📊 PM2 Commands

```bash
pm2 status              # স্ট্যাটাস দেখুন
pm2 logs jd-social      # লগ দেখুন
pm2 restart jd-social   # রিস্টার্ট করুন
pm2 reload jd-social    # Zero-downtime reload
pm2 monit               # রিয়েল-টাইম মনিটর
```

---

## 💰 Revenue System

- প্রতি ১০০০ ভিউতে ৳১.২০ (CPM)
- ক্রিয়েটর পান: ৯০% = ৳১.০৮ প্রতি ১০০০ ভিউ
- প্রতিদিন মধ্যরাতে অটো বিতরণ
- সর্বনিম্ন উত্তোলন: ৳১০০
