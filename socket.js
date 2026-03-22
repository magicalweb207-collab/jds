// socket.js — Real-time Socket.IO Handler

const jwt    = require('jsonwebtoken');
const db     = require('./config/database');
const logger = require('./utils/logger');

module.exports = function socketHandler(io, redis) {

  // Auth middleware for sockets
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      let user = await redis.getJSON(`user:${decoded.id}`);
      if (!user) {
        const { rows } = await db.query('SELECT id, name, username, avatar_url FROM users WHERE id=$1', [decoded.id]);
        user = rows[0];
      }
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // Track online users
  const onlineUsers = new Map();

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    onlineUsers.set(userId, socket.id);
    await redis.setEx(`online:${userId}`, 300, '1');

    logger.info(`🟢 ${socket.user.name} সংযুক্ত হয়েছেন`);

    // Broadcast online status
    socket.broadcast.emit('user:online', { userId, name: socket.user.name });

    // ─────────────────────────────────────────
    // CHAT EVENTS
    // ─────────────────────────────────────────

    socket.on('chat:join', async ({ roomId }) => {
      // Verify participant
      const { rows } = await db.query(
        'SELECT 1 FROM chat_participants WHERE room_id=$1 AND user_id=$2', [roomId, userId]
      );
      if (rows.length > 0) {
        socket.join(`chat:${roomId}`);
        // Mark messages as read
        await db.query(
          'UPDATE messages SET is_read=true WHERE room_id=$1 AND sender_id!=$2',
          [roomId, userId]
        );
        await db.query(
          'UPDATE chat_participants SET unread_count=0 WHERE room_id=$1 AND user_id=$2',
          [roomId, userId]
        );
      }
    });

    socket.on('chat:message', async ({ roomId, text, mediaUrl, mediaType }) => {
      try {
        if (!text?.trim() && !mediaUrl) return;

        // Verify participant
        const { rows: pRows } = await db.query(
          'SELECT 1 FROM chat_participants WHERE room_id=$1 AND user_id=$2', [roomId, userId]
        );
        if (!pRows.length) return;

        // Save to DB
        const { rows } = await db.query(
          `INSERT INTO messages (room_id, sender_id, text, media_url, media_type)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [roomId, userId, text?.trim() || null, mediaUrl || null, mediaType || null]
        );

        const message = {
          ...rows[0],
          sender: { id: userId, name: socket.user.name, username: socket.user.username, avatar_url: socket.user.avatar_url },
        };

        // Update room last message
        await db.query(
          'UPDATE chat_rooms SET last_message=$1, last_message_at=NOW() WHERE id=$2',
          [text?.substring(0,100), roomId]
        );

        // Increment unread for others
        await db.query(
          'UPDATE chat_participants SET unread_count=unread_count+1 WHERE room_id=$1 AND user_id!=$2',
          [roomId, userId]
        );

        // Emit to room
        io.to(`chat:${roomId}`).emit('chat:message', message);

        // Push notification to offline recipients
        const { rows: participants } = await db.query(
          'SELECT user_id FROM chat_participants WHERE room_id=$1 AND user_id!=$2',
          [roomId, userId]
        );
        for (const p of participants) {
          if (!onlineUsers.has(p.user_id)) {
            await db.query(
              `INSERT INTO notifications (user_id, type, title, body, data)
               VALUES ($1,'message',$2,$3,$4)`,
              [p.user_id, socket.user.name, text?.substring(0,100), JSON.stringify({ roomId })]
            );
          }
        }
      } catch (err) {
        logger.error('Chat message error:', err.message);
        socket.emit('error', { message: 'মেসেজ পাঠানো যায়নি।' });
      }
    });

    socket.on('chat:typing', ({ roomId, isTyping }) => {
      socket.to(`chat:${roomId}`).emit('chat:typing', { userId, name: socket.user.name, isTyping });
    });

    // ─────────────────────────────────────────
    // LIVE STREAM EVENTS
    // ─────────────────────────────────────────

    socket.on('live:start', async ({ title }) => {
      try {
        const streamKey = 'sk_' + Math.random().toString(36).slice(2, 12);
        const { rows } = await db.query(
          `INSERT INTO live_streams (user_id, title, stream_key, status)
           VALUES ($1,$2,$3,'live') RETURNING *`,
          [userId, title || 'আমার লাইভ', streamKey]
        );
        socket.join(`live:${rows[0].id}`);
        await redis.setJSON(`live:${userId}`, rows[0], 3600);
        socket.emit('live:started', rows[0]);
        io.emit('live:new', { ...rows[0], host: socket.user });
        logger.info(`🔴 ${socket.user.name} লাইভ শুরু করেছেন`);
      } catch (err) {
        socket.emit('error', { message: 'লাইভ শুরু হয়নি।' });
      }
    });

    socket.on('live:join', async ({ streamId }) => {
      socket.join(`live:${streamId}`);
      await db.query(
        'UPDATE live_streams SET viewer_count=viewer_count+1, peak_viewers=GREATEST(peak_viewers,viewer_count+1) WHERE id=$1',
        [streamId]
      );
      const { rows } = await db.query('SELECT viewer_count FROM live_streams WHERE id=$1', [streamId]);
      io.to(`live:${streamId}`).emit('live:viewer_count', rows[0]?.viewer_count || 0);
      io.to(`live:${streamId}`).emit('live:comment', {
        system: true, text: `${socket.user.name} যোগ দিয়েছেন`, color: '#06b6d4',
      });
    });

    socket.on('live:comment', async ({ streamId, text }) => {
      if (!text?.trim()) return;
      io.to(`live:${streamId}`).emit('live:comment', {
        userId, name: socket.user.name, text: text.trim(),
        color: ['#3b82f6','#22c55e','#ec4899','#f97316'][Math.floor(Math.random()*4)],
      });
    });

    socket.on('live:gift', async ({ streamId, giftType }) => {
      try {
        const GIFT_VALUES = { rose: 5, heart: 10, crown: 50, diamond: 100 };
        const amount = GIFT_VALUES[giftType] || 5;
        const creatorEarn = +(amount * 0.9).toFixed(2);

        // Get stream owner
        const { rows } = await db.query('SELECT user_id FROM live_streams WHERE id=$1', [streamId]);
        if (rows[0]) {
          await db.query(
            'UPDATE wallets SET balance=balance+$1, total_earned=total_earned+$1 WHERE user_id=$2',
            [creatorEarn, rows[0].user_id]
          );
          await db.query(
            `INSERT INTO transactions (user_id, type, amount, description) VALUES ($1,'live_gift',$2,$3)`,
            [rows[0].user_id, creatorEarn, `${socket.user.name} থেকে ${giftType} গিফট`]
          );
          await db.query(
            'UPDATE live_streams SET earnings=earnings+$1, gift_count=gift_count+1 WHERE id=$2',
            [creatorEarn, streamId]
          );
          await redis.del(`wallet:${rows[0].user_id}`);
        }

        io.to(`live:${streamId}`).emit('live:gift', {
          sender: socket.user.name, giftType, amount, creatorEarn,
        });
      } catch (err) {
        logger.error('Gift error:', err.message);
      }
    });

    socket.on('live:end', async ({ streamId }) => {
      try {
        await db.query(
          `UPDATE live_streams SET status='ended', ended_at=NOW(), viewer_count=0 WHERE id=$1`,
          [streamId]
        );
        await redis.del(`live:${userId}`);
        io.to(`live:${streamId}`).emit('live:ended', { streamId });
        io.emit('live:removed', { streamId });
        logger.info(`⚫ ${socket.user.name} লাইভ শেষ করেছেন`);
      } catch (err) {
        logger.error('End live error:', err.message);
      }
    });

    // ─────────────────────────────────────────
    // VIDEO EVENTS (real-time likes)
    // ─────────────────────────────────────────
    socket.on('video:like', ({ videoId, liked }) => {
      socket.broadcast.emit('video:like_update', { videoId, liked, userId });
    });

    // ─────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────
    socket.on('disconnect', async () => {
      onlineUsers.delete(userId);
      await redis.del(`online:${userId}`);
      await db.query('UPDATE users SET last_seen=NOW() WHERE id=$1', [userId]);
      socket.broadcast.emit('user:offline', { userId });
      logger.info(`🔴 ${socket.user.name} বিচ্ছিন্ন হয়েছেন`);
    });
  });
};
