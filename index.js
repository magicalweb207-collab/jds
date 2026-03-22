// ══════════════════════════════════════════════
// JD Social — Main Server Entry Point
// ══════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const compression= require('compression');
const morgan     = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const db         = require('./config/database');
const redisClient= require('./config/redis');
const logger     = require('./utils/logger');
const socketHandler = require('./socket');

// ── Routes ──
const authRoutes    = require('./routes/auth');
const userRoutes    = require('./routes/users');
const videoRoutes   = require('./routes/videos');
const chatRoutes    = require('./routes/chat');
const walletRoutes  = require('./routes/wallet');
const liveRoutes    = require('./routes/live');
const feedRoutes    = require('./routes/feed');
const notifRoutes   = require('./routes/notifications');
const paymentRoutes = require('./routes/payment');
const adminRoutes   = require('./routes/admin');
const uploadRoutes  = require('./routes/upload');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ── Middleware ──
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ── Rate Limiting ──
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || 100),
  message: { error: 'অনেক বেশি রিকোয়েস্ট। কিছুক্ষণ পরে চেষ্টা করুন।' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Static Files ──
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../client')));

// ── API Routes ──
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/videos',        videoRoutes);
app.use('/api/chat',          chatRoutes);
app.use('/api/wallet',        walletRoutes);
app.use('/api/live',          liveRoutes);
app.use('/api/feed',          feedRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/payment',       paymentRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/upload',        uploadRoutes);

// ── Health Check ──
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    const redisOk = await redisClient.ping();
    res.json({
      status: 'ok',
      server: 'JD Social API',
      version: '1.0.0',
      database: 'connected',
      redis: redisOk === 'PONG' ? 'connected' : 'error',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Serve React/HTML client ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ── Global Error Handler ──
app.use((err, req, res, next) => {
  logger.error(`${err.status || 500} — ${err.message} — ${req.originalUrl}`);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'সার্ভার সমস্যা হয়েছে।'
      : err.message,
  });
});

// ── Socket.IO ──
socketHandler(io, redisClient);

// ── Start Server ──
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  logger.info(`🚀 JD Social Server চলছে — Port ${PORT}`);
  try {
    await db.query('SELECT NOW()');
    logger.info('✅ PostgreSQL সংযুক্ত');
    await redisClient.connect();
    logger.info('✅ Redis সংযুক্ত');
  } catch (err) {
    logger.error('❌ সংযোগ সমস্যা:', err.message);
  }
});

module.exports = { app, io };
