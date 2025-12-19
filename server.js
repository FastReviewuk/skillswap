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

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 SkillSwap server running on port ${PORT}`);
  
  // Always use polling mode (no webhook)
  console.log('🔄 Starting in polling mode...');
  bot.launch();
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