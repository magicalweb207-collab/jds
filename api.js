// client/api.js — Frontend API Client
// সব API call এখান থেকে হবে

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:5000/api'
  : '/api';

const SOCKET_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:5000'
  : window.location.origin;

// ── Token Management ──────────────────────────
const Auth = {
  getToken: () => localStorage.getItem('jd_token'),
  setToken: (t) => localStorage.setItem('jd_token', t),
  setRefresh: (t) => localStorage.setItem('jd_refresh', t),
  getRefresh: () => localStorage.getItem('jd_refresh'),
  clear: () => { localStorage.removeItem('jd_token'); localStorage.removeItem('jd_refresh'); localStorage.removeItem('jd_user'); },
  getUser: () => { try { return JSON.parse(localStorage.getItem('jd_user') || 'null'); } catch { return null; } },
  setUser: (u) => localStorage.setItem('jd_user', JSON.stringify(u)),
  isLoggedIn: () => !!localStorage.getItem('jd_token'),
};

// ── HTTP Client ───────────────────────────────
async function request(method, path, data = null, isForm = false) {
  const headers = { 'Authorization': `Bearer ${Auth.getToken()}` };
  if (!isForm) headers['Content-Type'] = 'application/json';

  const config = {
    method,
    headers,
    credentials: 'include',
  };

  if (data) {
    config.body = isForm ? data : JSON.stringify(data);
  }

  let res = await fetch(API_BASE + path, config);

  // Auto refresh token on 401
  if (res.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${Auth.getToken()}`;
      config.headers = headers;
      res = await fetch(API_BASE + path, config);
    } else {
      Auth.clear();
      window.location.reload();
      return;
    }
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'সার্ভার সমস্যা');
  return json;
}

async function refreshToken() {
  try {
    const rt = Auth.getRefresh();
    if (!rt) return false;
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    Auth.setToken(data.token);
    return true;
  } catch {
    return false;
  }
}

const get  = (path)        => request('GET',    path);
const post = (path, data)  => request('POST',   path, data);
const put  = (path, data)  => request('PUT',    path, data);
const del  = (path)        => request('DELETE', path);
const form = (path, data)  => request('POST',   path, data, true);

// ═══════════════════════════════════════════
// API MODULES
// ═══════════════════════════════════════════

const API = {

  // ── AUTH ──────────────────────────────────
  auth: {
    register: (data) => post('/auth/register', data),
    login:    (data) => post('/auth/login', data),
    sendOTP:  (phone) => post('/auth/send-otp', { phone }),
    verifyOTP:(phone, code, name) => post('/auth/verify-otp', { phone, code, name }),
    logout:   () => post('/auth/logout'),
    me:       () => get('/auth/me'),
  },

  // ── VIDEOS ────────────────────────────────
  videos: {
    feed:      (type = 'foryou', page = 1) => get(`/videos/feed?type=${type}&page=${page}`),
    get:       (id) => get(`/videos/${id}`),
    upload:    (formData) => form('/videos', formData),
    delete:    (id) => del(`/videos/${id}`),
    like:      (id) => post(`/videos/${id}/like`),
    save:      (id) => post(`/videos/${id}/save`),
    comments:  (id, page = 1) => get(`/videos/${id}/comments?page=${page}`),
    addComment:(id, text, parentId) => post(`/videos/${id}/comments`, { text, parent_id: parentId }),
    search:    (q) => get(`/videos/search/query?q=${encodeURIComponent(q)}`),
  },

  // ── USERS ─────────────────────────────────
  users: {
    profile:        (username) => get(`/users/${username}`),
    follow:         (userId)   => post(`/users/${userId}/follow`),
    updateProfile:  (formData) => form('/users/me/profile', formData),
    changePassword: (current, newPass) => put('/users/me/password', { current, newPass }),
    search:         (q) => get(`/users/search/query?q=${encodeURIComponent(q)}`),
  },

  // ── CHAT ─────────────────────────────────
  chat: {
    rooms:      () => get('/chat/rooms'),
    createRoom: (userId) => post('/chat/rooms', { userId }),
    messages:   (roomId, page = 1) => get(`/chat/${roomId}/messages?page=${page}`),
    send:       (roomId, text) => post(`/chat/${roomId}/messages`, { text }),
  },

  // ── WALLET ────────────────────────────────
  wallet: {
    get:        () => get('/wallet'),
    withdraw:   (data) => post('/wallet/withdraw', data),
    withdrawals:() => get('/wallet/withdrawals'),
    stats:      () => get('/wallet/stats'),
  },

  // ── LIVE ──────────────────────────────────
  live: {
    active: () => get('/live/active'),
    get:    (id) => get(`/live/${id}`),
  },

  // ── FEED ──────────────────────────────────
  feed: {
    trendingTags: () => get('/feed/trending-tags'),
    stats:        () => get('/feed/stats'),
  },

  // ── NOTIFICATIONS ─────────────────────────
  notifications: {
    get:     () => get('/notifications'),
    readAll: () => put('/notifications/read-all'),
  },
};

// ═══════════════════════════════════════════
// SOCKET.IO CONNECTION
// ═══════════════════════════════════════════

let socket = null;

function connectSocket() {
  if (!Auth.isLoggedIn() || socket?.connected) return;

  // Load socket.io from CDN if not loaded
  if (typeof io === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.6.0/socket.io.min.js';
    script.onload = () => initSocket();
    document.head.appendChild(script);
  } else {
    initSocket();
  }
}

function initSocket() {
  socket = io(SOCKET_URL, {
    auth: { token: Auth.getToken() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
  });

  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket.id);
    window.dispatchEvent(new CustomEvent('socket:connected'));
  });

  socket.on('disconnect', (reason) => {
    console.warn('⚠️ Socket disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.error('❌ Socket error:', err.message);
  });

  // Real-time events
  socket.on('chat:message', (msg) => {
    window.dispatchEvent(new CustomEvent('chat:message', { detail: msg }));
  });

  socket.on('chat:typing', (data) => {
    window.dispatchEvent(new CustomEvent('chat:typing', { detail: data }));
  });

  socket.on('live:new', (stream) => {
    window.dispatchEvent(new CustomEvent('live:new', { detail: stream }));
  });

  socket.on('live:removed', (data) => {
    window.dispatchEvent(new CustomEvent('live:removed', { detail: data }));
  });

  socket.on('live:comment', (data) => {
    window.dispatchEvent(new CustomEvent('live:comment', { detail: data }));
  });

  socket.on('live:viewer_count', (count) => {
    window.dispatchEvent(new CustomEvent('live:viewer_count', { detail: count }));
  });

  socket.on('live:gift', (data) => {
    window.dispatchEvent(new CustomEvent('live:gift', { detail: data }));
  });

  socket.on('live:ended', (data) => {
    window.dispatchEvent(new CustomEvent('live:ended', { detail: data }));
  });

  socket.on('video:like_update', (data) => {
    window.dispatchEvent(new CustomEvent('video:like_update', { detail: data }));
  });

  socket.on('user:online', (data) => {
    window.dispatchEvent(new CustomEvent('user:online', { detail: data }));
  });

  socket.on('user:offline', (data) => {
    window.dispatchEvent(new CustomEvent('user:offline', { detail: data }));
  });
}

// Socket action helpers
const Socket = {
  joinChat:    (roomId)             => socket?.emit('chat:join', { roomId }),
  sendMessage: (roomId, text)       => socket?.emit('chat:message', { roomId, text }),
  typing:      (roomId, isTyping)   => socket?.emit('chat:typing', { roomId, isTyping }),
  startLive:   (title)              => socket?.emit('live:start', { title }),
  joinLive:    (streamId)           => socket?.emit('live:join', { streamId }),
  liveComment: (streamId, text)     => socket?.emit('live:comment', { streamId, text }),
  sendGift:    (streamId, giftType) => socket?.emit('live:gift', { streamId, giftType }),
  endLive:     (streamId)           => socket?.emit('live:end', { streamId }),
  likeVideo:   (videoId, liked)     => socket?.emit('video:like', { videoId, liked }),
};

// ═══════════════════════════════════════════
// APP INTEGRATION — main app.js integration
// ═══════════════════════════════════════════

// Override the fake data with real API calls
async function initRealApp() {
  // Check if already logged in
  if (Auth.isLoggedIn()) {
    try {
      const { user } = await API.auth.me();
      Auth.setUser(user);
      loginSuccess(user.name, '@' + user.username, user);
      connectSocket();
    } catch {
      Auth.clear();
    }
  }

  // Override feed builder
  window.buildFeed = async (type = 'foryou') => {
    const feed = document.getElementById('videoFeed');
    feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">লোড হচ্ছে...</div>';
    try {
      const { videos } = await API.videos.feed(type);
      if (!videos.length) {
        feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">কোনো ভিডিও নেই</div>';
        return;
      }
      feed.innerHTML = videos.map((v, i) => buildVideoCard(v, i)).join('');
    } catch (err) {
      feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red)">লোড ব্যর্থ। রিফ্রেশ করুন।</div>';
    }
  };

  // Real login
  window.doLogin = async () => {
    const identifier = document.getElementById('loginUser').value.trim();
    const password   = document.getElementById('loginPass').value;
    if (!identifier || !password) { showToast('সব তথ্য দিন'); return; }
    try {
      const data = await API.auth.login({ identifier, password });
      Auth.setToken(data.token);
      Auth.setRefresh(data.refreshToken);
      Auth.setUser(data.user);
      loginSuccess(data.user.name, '@' + data.user.username, data.user);
      connectSocket();
      showToast('লগইন সফল! স্বাগতম 🎉');
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  };

  // Real register
  window.doRegister = async () => {
    const name  = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pass  = document.getElementById('regPass').value;
    if (!name || !phone) { showToast('নাম ও ফোন আবশ্যক'); return; }
    const username = name.replace(/\s+/g,'_').toLowerCase() + '_' + Math.random().toString(36).slice(2,5);
    try {
      const data = await API.auth.register({ name, username, email: email || undefined, phone, password: pass });
      Auth.setToken(data.token);
      Auth.setRefresh(data.refreshToken);
      Auth.setUser(data.user);
      loginSuccess(data.user.name, '@' + data.user.username, data.user);
      connectSocket();
      showToast('স্বাগতম JD Social-এ! 🎉');
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  };

  // Real logout
  document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      await API.auth.logout();
      Auth.clear();
      socket?.disconnect();
      window.location.reload();
    }
  });

  // Real wallet
  window.openWithdrawModal = async () => {
    document.getElementById('withdrawModal').classList.add('open');
    try {
      const { wallet } = await API.wallet.get();
      document.getElementById('modalBal').textContent = '৳ ' + parseFloat(wallet.balance).toFixed(2);
      APP.balance = parseFloat(wallet.balance);
    } catch {}
  };

  window.confirmWithdraw = async () => {
    const amt    = parseFloat(document.getElementById('withdrawAmt').value) || 0;
    const acct   = document.getElementById('withdrawAcct').value.trim();
    if (amt < 100) { showToast('সর্বনিম্ন ৳১০০'); return; }
    if (!acct)     { showToast('অ্যাকাউন্ট নম্বর দিন'); return; }
    try {
      const data = await API.wallet.withdraw({ amount: amt, method: APP.payMethod || 'bkash', account_number: acct });
      document.getElementById('withdrawTxId').textContent = 'TX: ' + data.tx_id;
      document.getElementById('withdrawSuccess').style.display = 'block';
      APP.balance -= amt;
      updateWalletDisplay();
      showToast('উত্তোলন সফল! ✅');
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  };

  // Real like
  window.toggleLike = async (vid, btn) => {
    try {
      const { liked } = await API.videos.like(vid);
      const v = VIDEOS.find(x => x.id === vid);
      if (v) { liked ? v.likes++ : v.likes--; }
      if (liked) {
        APP.likes.add(vid);
        btn.classList.add('liked');
        Socket.likeVideo(vid, true);
        showToast('লাইক দেওয়া হয়েছে ❤️');
      } else {
        APP.likes.delete(vid);
        btn.classList.remove('liked');
        Socket.likeVideo(vid, false);
      }
      const lc = document.getElementById('lc-' + vid);
      if (lc && v) lc.textContent = fmtNum(v.likes);
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  };

  // Load real feed on start
  await buildFeed('foryou');

  // Load real wallet data
  try {
    const { wallet } = await API.wallet.get();
    APP.balance = parseFloat(wallet.balance);
    updateWalletDisplay();
  } catch {}
}

// Real-time event listeners
window.addEventListener('live:comment', (e) => {
  const { name, text, color, system } = e.detail;
  if (APP.liveActive) addLiveComment(name || 'সিস্টেম', text, color || '#06b6d4');
});

window.addEventListener('live:viewer_count', (e) => {
  APP.liveViewers = e.detail;
  const el = document.getElementById('liveViewerCount');
  if (el) el.textContent = e.detail;
});

window.addEventListener('live:gift', (e) => {
  const { sender, giftType, creatorEarn } = e.detail;
  APP.liveEarnings += parseFloat(creatorEarn || 5);
  const el = document.getElementById('liveEarnDisplay');
  if (el) el.textContent = '৳ ' + APP.liveEarnings.toFixed(2);
  addLiveComment(sender, `🎁 ${giftType} গিফট পাঠালেন!`, '#ec4899');
});

window.addEventListener('chat:message', (e) => {
  const msg = e.detail;
  if (APP.currentChat && msg.room_id === APP.currentChat) {
    APP.messages[APP.currentChat] = APP.messages[APP.currentChat] || [];
    APP.messages[APP.currentChat].push({ text: msg.text, mine: false, time: 'এখন' });
    renderMessages();
  }
});

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRealApp);
} else {
  initRealApp();
}

window.API    = API;
window.Auth   = Auth;
window.Socket = Socket;
