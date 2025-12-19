require('dotenv').config();
const express = require('express');
const SkillSwapBot = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize bot
const bot = new SkillSwapBot(
  process.env.BOT_TOKEN,
  process.env.ADMIN_ID,
  process.env.PAYMENT_LINK
);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'SkillSwap Bot is running!', 
    timestamp: new Date().toISOString() 
  });
});

// Webhook endpoint for Telegram
app.use('/webhook', bot.webhookCallback());

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 SkillSwap server running on port ${PORT}`);
  
  // Set webhook if WEBHOOK_URL is provided
  if (process.env.WEBHOOK_URL) {
    try {
      await bot.setWebhook(`${process.env.WEBHOOK_URL}/webhook`);
      console.log('✅ Webhook set successfully');
    } catch (error) {
      console.error('❌ Failed to set webhook:', error.message);
      // Fallback to polling for development
      console.log('🔄 Starting polling mode...');
      bot.launch();
    }
  } else {
    // Development mode with polling
    console.log('🔄 Starting in polling mode (development)');
    bot.launch();
  }
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  process.exit(0);
});

// Export for compatibility
module.exports = app;
