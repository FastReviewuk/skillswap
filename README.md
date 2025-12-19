# SkillSwap Telegram Bot

A complete marketplace bot for buying and selling micro-skills via Telegram.

## Features

- 👤 User registration with roles (Buyer/Seller/Both)
- 🔍 Service search and browsing
- 💰 Payment processing with 15% commission
- ⭐ Rating and review system
- 🌟 Service promotion ($1.99/month)
- 📊 Admin statistics
- 🔔 Real-time notifications

## Quick Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in your details:

```bash
cp .env.example .env
```

Edit `.env`:
```
BOT_TOKEN=your_telegram_bot_token_from_botfather
WEBHOOK_URL=https://yourdomain.com
ADMIN_ID=your_telegram_user_id
PAYMENT_LINK=https://buy.stripe.com/your_payment_link
PORT=3000
```

### 3. Get Your Bot Token
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`
3. Follow instructions to create your bot
4. Copy the token to your `.env` file

### 4. Get Your Admin ID
1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. Copy your user ID to the `.env` file

### 5. Run the Bot

**Development (polling mode):**
```bash
npm run dev
```

**Production (webhook mode):**
```bash
npm start
```

## IONOS Deployment

### 1. Upload Files
Upload all files to your IONOS hosting directory via FTP/SFTP.

### 2. Install Dependencies
SSH into your IONOS server and run:
```bash
cd /path/to/your/bot
npm install --production
```

### 3. Set Environment Variables
Create `.env` file on the server with your production values.

### 4. Configure Webhook
Set `WEBHOOK_URL` in `.env` to your domain:
```
WEBHOOK_URL=https://yourdomain.com
```

### 5. Start the Bot
```bash
node server.js
```

### 6. Setup Process Manager (Optional)
For production, use PM2 to keep the bot running:
```bash
npm install -g pm2
pm2 start server.js --name skillswap-bot
pm2 startup
pm2 save
```

## Bot Commands

### User Commands
- `/start` - Register or welcome back
- `/help` - Show help message
- `/search [keyword]` - Search for services
- `/browse` - Browse all services
- `/profile` - View your profile

### Seller Commands
- `/addservice` - Add a new service
- `/myservices` - View your services (coming soon)
- `/promote` - Promote services (coming soon)

### Admin Commands
- `/admin stats` - View bot statistics

## Payment Flow

1. **Customer Purchase:**
   - Customer clicks "Buy" on a service
   - Bot generates payment link with total amount (net + 15%)
   - Customer completes payment via your payment processor

2. **Manual Processing:**
   - You receive payment notification
   - Bot notifies you which seller to pay and how much
   - You manually transfer 85% to the seller
   - You keep 15% as commission

3. **Service Delivery:**
   - Seller delivers the service
   - Customer rates the seller (1-5 stars)
   - Rating affects seller's visibility in search results

## Database Schema

The bot uses SQLite with these tables:
- `users` - User profiles and roles
- `services` - Service listings
- `orders` - Purchase transactions
- `reviews` - Ratings and feedback

## Customization

### Adding New Features
Edit `bot.js` to add new commands or modify existing functionality.

### Changing Commission Rate
Modify the `1.15` multiplier in the code (currently 15% commission).

### Payment Integration
Replace the static payment link with dynamic payment processing by integrating with Stripe, PayPal, or other processors.

## Support

For issues or questions:
1. Check the logs for error messages
2. Verify your `.env` configuration
3. Ensure your bot token is valid
4. Test webhook connectivity

## License

MIT License - feel free to modify and use for your projects!