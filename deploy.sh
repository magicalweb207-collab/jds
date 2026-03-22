#!/bin/bash
# ══════════════════════════════════════════════
# JD Social — One-Command Cloud Deployment
# Ubuntu 22.04 VPS-এ চালান
# ব্যবহার: sudo bash deploy.sh yourdomain.com
# ══════════════════════════════════════════════

set -e
DOMAIN=${1:-"jdsocial.com"}
APP_DIR="/var/www/jdsocial"
DB_NAME="jdsocial_db"
DB_USER="jdsocial_user"
DB_PASS=$(openssl rand -base64 20 | tr -dc 'a-zA-Z0-9' | head -c 20)
JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)

echo ""
echo "═══════════════════════════════════════════"
echo "  JD Social Cloud Deployment শুরু হচ্ছে"
echo "  Domain: $DOMAIN"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: System Update ──
echo "⏳ [1/10] সিস্টেম আপডেট হচ্ছে..."
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw

# ── Step 2: Node.js 20 ──
echo "⏳ [2/10] Node.js 20 ইনস্টল হচ্ছে..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

echo "✅ Node.js $(node -v) ইনস্টল হয়েছে"

# ── Step 3: PostgreSQL ──
echo "⏳ [3/10] PostgreSQL ইনস্টল হচ্ছে..."
apt-get install -y -qq postgresql postgresql-contrib
systemctl enable postgresql && systemctl start postgresql

sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true

echo "✅ PostgreSQL সেটআপ হয়েছে — DB: $DB_NAME"

# ── Step 4: Redis ──
echo "⏳ [4/10] Redis ইনস্টল হচ্ছে..."
apt-get install -y -qq redis-server
systemctl enable redis-server && systemctl start redis-server
echo "✅ Redis চলছে"

# ── Step 5: Deploy App ──
echo "⏳ [5/10] অ্যাপ্লিকেশন ডিপ্লয় হচ্ছে..."
mkdir -p $APP_DIR
cp -r ./server $APP_DIR/
cp -r ./client $APP_DIR/
mkdir -p $APP_DIR/server/logs $APP_DIR/server/uploads/videos $APP_DIR/server/uploads/images

# ── Step 6: Environment ──
echo "⏳ [6/10] Environment কনফিগারেশন..."
cat > $APP_DIR/server/.env << ENVEOF
NODE_ENV=production
PORT=5000
CLIENT_URL=https://$DOMAIN
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_SSL=false
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=$JWT_SECRET
JWT_EXPIRE=7d
JWT_REFRESH_EXPIRE=30d
CREATOR_REVENUE_SHARE=0.90
PLATFORM_SHARE=0.10
MIN_WITHDRAWAL=100
CPM_RATE=1.20
ENVEOF

echo "✅ .env তৈরি হয়েছে"

# ── Step 7: Install Dependencies & Migrate ──
echo "⏳ [7/10] Dependencies ইনস্টল হচ্ছে..."
cd $APP_DIR/server
npm install --production
node scripts/migrate.js && echo "✅ Database migration সম্পন্ন"

# ── Step 8: PM2 Process Manager ──
echo "⏳ [8/10] PM2 দিয়ে অ্যাপ শুরু হচ্ছে..."
cat > $APP_DIR/ecosystem.config.js << PMEOF
module.exports = {
  apps: [{
    name: 'jd-social',
    cwd: '$APP_DIR/server',
    script: 'index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: { NODE_ENV: 'production' },
    error_file: '$APP_DIR/server/logs/pm2-error.log',
    out_file: '$APP_DIR/server/logs/pm2-out.log',
    max_memory_restart: '500M',
    restart_delay: 3000,
    watch: false,
  }]
};
PMEOF

pm2 start $APP_DIR/ecosystem.config.js --env production
pm2 startup systemd -u root --hp /root
pm2 save
echo "✅ PM2 দিয়ে অ্যাপ চলছে"

# ── Step 9: Nginx ──
echo "⏳ [9/10] Nginx কনফিগার হচ্ছে..."
cp ./nginx/jdsocial.conf /etc/nginx/sites-available/jdsocial
sed -i "s/jdsocial.com/$DOMAIN/g" /etc/nginx/sites-available/jdsocial
ln -sf /etc/nginx/sites-available/jdsocial /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "✅ Nginx চলছে"

# ── Step 10: SSL Certificate ──
echo "⏳ [10/10] SSL সার্টিফিকেট নিচ্ছে..."
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN
systemctl reload nginx

# ── Firewall ──
ufw allow ssh && ufw allow 'Nginx Full' && ufw --force enable

# ── Done ──
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ JD Social সফলভাবে ডিপ্লয় হয়েছে!"
echo "═══════════════════════════════════════════"
echo ""
echo "  🌐 Website: https://$DOMAIN"
echo "  📊 Health:  https://$DOMAIN/api/health"
echo "  🗄️  DB:      $DB_NAME (User: $DB_USER)"
echo "  🔑 DB Pass: $DB_PASS"
echo "  🔐 JWT:     $JWT_SECRET"
echo ""
echo "  PM2 স্ট্যাটাস দেখতে: pm2 status"
echo "  লগ দেখতে:           pm2 logs jd-social"
echo "  রিস্টার্ট করতে:     pm2 restart jd-social"
echo ""
echo "  ⚠️  .env ফাইলে আপনার API keys যোগ করুন:"
echo "     $APP_DIR/server/.env"
echo ""
echo "═══════════════════════════════════════════"
