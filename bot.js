const { Telegraf, Markup } = require('telegraf');
const Database = require('./database');

class SkillSwapBot {
  constructor(token, adminId, paymentLink) {
    this.bot = new Telegraf(token);
    this.db = new Database();
    this.adminId = adminId;
    this.paymentLink = paymentLink;
    this.userStates = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    // Start command
    this.bot.start(async (ctx) => {
      const user = await this.db.getUser(ctx.from.id);
      if (user) {
        await ctx.reply(`Welcome back, ${user.name}! 👋\n\nUse /help to see available commands.`);
      } else {
        await this.startRegistration(ctx);
      }
    });

    // Help command
    this.bot.help((ctx) => {
      const helpText = `
🤖 *SkillSwap Bot Commands*

📝 *General:*
/start - Register or welcome back
/help - Show this help message
/profile - View your profile

🔍 *Browse Services:*
/search [keyword] - Search for services
/browse - Browse all services

💼 *For Sellers:*
/addservice - Add a new service
/myservices - View your services
/promote - Promote your services (💰 $1.99/month)

⭐ *Reviews:*
Rate services after purchase (1-5 stars)

💰 *Payments:*
All payments processed securely via our payment system
Sellers receive 85% of the final price

Need help? Contact our support team!
      `;
      ctx.replyWithMarkdown(helpText);
    });

    // Registration handlers
    this.bot.action(/^role_(.+)$/, async (ctx) => {
      const role = ctx.match[1];
      const state = this.userStates.get(ctx.from.id);
      if (state && state.step === 'role') {
        state.role = role;
        state.step = 'complete';
        
        await this.db.createUser(ctx.from.id, state.name, state.username, role);
        
        await ctx.editMessageText(`✅ Registration complete!\n\n👤 Name: ${state.name}\n🎭 Role: ${role}\n\nWelcome to SkillSwap! Use /help to get started.`);
        
        this.userStates.delete(ctx.from.id);
        
        if (role === 'Seller' || role === 'Both') {
          await ctx.reply('💡 As a seller, you can add services with /addservice');
        }
      }
    });

    // Search command
    this.bot.command('search', async (ctx) => {
      const keyword = ctx.message.text.split(' ').slice(1).join(' ');
      if (!keyword) {
        await ctx.reply('Please provide a search keyword.\nExample: /search web design');
        return;
      }

      const services = await this.db.searchServices(keyword);
      if (services.length === 0) {
        await ctx.reply(`No services found for "${keyword}" 😔\n\nTry /browse to see all available services.`);
        return;
      }

      await this.displayServices(ctx, services, `🔍 Search results for "${keyword}"`);
    });

    // Browse command
    this.bot.command('browse', async (ctx) => {
      const services = await this.db.browseServices();
      if (services.length === 0) {
        await ctx.reply('No services available yet 😔\n\nBe the first to add a service with /addservice!');
        return;
      }

      await this.displayServices(ctx, services, '📋 Available Services');
    });

    // Add service command
    this.bot.command('addservice', async (ctx) => {
      const user = await this.db.getUser(ctx.from.id);
      if (!user) {
        await ctx.reply('Please register first with /start');
        return;
      }

      if (user.role === 'Buyer') {
        await ctx.reply('Only sellers can add services. Contact support to change your role.');
        return;
      }

      this.userStates.set(ctx.from.id, { step: 'service_title' });
      await ctx.reply('💼 Let\'s add your service!\n\nFirst, what\'s the title of your service?\n(Keep it short and descriptive)');
    });

    // Profile command
    this.bot.command('profile', async (ctx) => {
      const user = await this.db.getUser(ctx.from.id);
      if (!user) {
        await ctx.reply('Please register first with /start');
        return;
      }

      const profileText = `
👤 *Your Profile*

📝 Name: ${user.name}
🆔 Username: ${user.username || 'Not set'}
🎭 Role: ${user.role}
📅 Joined: ${new Date(user.created_at).toLocaleDateString()}
      `;

      await ctx.replyWithMarkdown(profileText);
    });

    // Admin stats
    this.bot.command('admin', async (ctx) => {
      if (ctx.from.id.toString() !== this.adminId) {
        await ctx.reply('❌ Access denied. Admin only.');
        return;
      }

      const args = ctx.message.text.split(' ').slice(1);
      if (args[0] === 'stats') {
        const stats = await this.db.getStats();
        const statsText = `
📊 *SkillSwap Statistics*

👥 Total Users: ${stats.totalUsers}
💼 Active Sellers: ${stats.activeSellers}
🛍️ Total Orders: ${stats.totalOrders}
⚡ Total Services: ${stats.totalServices}
        `;
        await ctx.replyWithMarkdown(statsText);
      }
    });

    // Text message handler for registration flow
    this.bot.on('text', async (ctx) => {
      const state = this.userStates.get(ctx.from.id);
      if (!state) return;

      await this.handleRegistrationFlow(ctx, state);
    });

    // Buy button handler
    this.bot.action(/^buy_(.+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      await this.handlePurchase(ctx, serviceId);
    });

    // Rating buttons
    this.bot.action(/^rate_(\d+)_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      const rating = parseInt(ctx.match[2]);
      
      const order = await this.db.getOrder(orderId);
      if (!order || order.buyer_id !== ctx.from.id) {
        await ctx.answerCbQuery('Invalid order');
        return;
      }

      await this.db.createReview(orderId, ctx.from.id, order.seller_id, rating);
      await ctx.editMessageText(`⭐ Thank you for rating! You gave ${rating} stars.`);
      await ctx.answerCbQuery('Rating submitted!');
    });
  }

  async startRegistration(ctx) {
    this.userStates.set(ctx.from.id, { step: 'name' });
    await ctx.reply(`Welcome to SkillSwap! 🎉\n\nLet's get you registered. First, what's your name?`);
  }

  async handleRegistrationFlow(ctx, state) {
    const text = ctx.message.text;

    switch (state.step) {
      case 'name':
        state.name = text;
        state.username = ctx.from.username;
        state.step = 'role';
        
        const roleKeyboard = Markup.inlineKeyboard([
          [Markup.button.callback('🛒 Buyer', 'role_Buyer')],
          [Markup.button.callback('💼 Seller', 'role_Seller')],
          [Markup.button.callback('🔄 Both', 'role_Both')]
        ]);

        await ctx.reply(`Nice to meet you, ${text}! 👋\n\nWhat's your role on SkillSwap?`, roleKeyboard);
        break;

      case 'service_title':
        state.title = text;
        state.step = 'service_description';
        await ctx.reply('Great! Now provide a description (max 120 characters):');
        break;

      case 'service_description':
        if (text.length > 120) {
          await ctx.reply('Description too long! Please keep it under 120 characters.');
          return;
        }
        state.description = text;
        state.step = 'service_price';
        await ctx.reply('What\'s your net price in USD? (e.g., 5.00)\nNote: Customers will pay this + 15% commission');
        break;

      case 'service_price':
        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) {
          await ctx.reply('Please enter a valid price (e.g., 5.00)');
          return;
        }
        state.price = price;
        state.step = 'service_delivery';
        await ctx.reply('How long will delivery take? (e.g., "24 hours", "3 days")');
        break;

      case 'service_delivery':
        state.delivery = text;
        state.step = 'service_payment';
        await ctx.reply('What\'s your payment method for receiving payments?\n(e.g., "PayPal: email@example.com", "USDT wallet: 0x123...")');
        break;

      case 'service_payment':
        state.paymentMethod = text;
        
        await this.db.createService(
          ctx.from.id,
          state.title,
          state.description,
          state.price,
          state.delivery,
          state.paymentMethod
        );

        const finalPrice = (state.price * 1.15).toFixed(2);
        
        await ctx.reply(`✅ Service added successfully!\n\n💼 ${state.title}\n📝 ${state.description}\n💰 Customer pays: $${finalPrice} (you get: $${state.price.toFixed(2)})\n⏱️ Delivery: ${state.delivery}`);
        
        this.userStates.delete(ctx.from.id);
        break;
    }
  }

  async displayServices(ctx, services, title) {
    let message = `${title}\n\n`;
    
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      const finalPrice = (service.net_price * 1.15).toFixed(2);
      const rating = service.avg_rating > 0 ? `⭐ ${service.avg_rating.toFixed(1)}` : '⭐ New';
      const promoted = service.is_promoted ? '🌟 ' : '';
      
      message += `${i + 1}. ${promoted}*${service.title}*\n`;
      message += `👤 ${service.seller_name} ${rating}\n`;
      message += `📝 ${service.description}\n`;
      message += `💰 $${finalPrice} • ⏱️ ${service.delivery_time}\n\n`;
    }

    const keyboard = Markup.inlineKeyboard(
      services.map((service, index) => [
        Markup.button.callback(`🛒 Buy #${index + 1}`, `buy_${service.id}`)
      ])
    );

    await ctx.replyWithMarkdown(message, keyboard);
  }

  async handlePurchase(ctx, serviceId) {
    const user = await this.db.getUser(ctx.from.id);
    if (!user) {
      await ctx.answerCbQuery('Please register first with /start');
      return;
    }

    // Get service details
    const services = await this.db.searchServices('');
    const service = services.find(s => s.id == serviceId);
    
    if (!service) {
      await ctx.answerCbQuery('Service not found');
      return;
    }

    const finalPrice = (service.net_price * 1.15).toFixed(2);
    const transactionId = `TXN_${Date.now()}_${serviceId}`;

    // Create order
    await this.db.createOrder(
      ctx.from.id,
      service.seller_id,
      serviceId,
      transactionId,
      service.net_price,
      parseFloat(finalPrice)
    );

    // Payment link with amount
    const paymentUrl = `${this.paymentLink}?amount=${finalPrice}&ref=${transactionId}`;
    
    const purchaseKeyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Pay Now', paymentUrl)]
    ]);

    await ctx.editMessageText(
      `🛒 *Purchase Summary*\n\n💼 Service: ${service.title}\n👤 Seller: ${service.seller_name}\n💰 Total: $${finalPrice}\n⏱️ Delivery: ${service.delivery_time}\n\n🔒 Click below to complete payment securely:`,
      { parse_mode: 'Markdown', ...purchaseKeyboard }
    );

    // Notify seller
    try {
      await this.bot.telegram.sendMessage(
        service.seller_id,
        `🔔 *New Order Request!*\n\n💼 Service: ${service.title}\n👤 Buyer: ${user.name}\n💰 You'll receive: $${service.net_price.toFixed(2)}\n📋 Transaction: ${transactionId}\n\n⚠️ Please wait for payment confirmation before starting work.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.log('Could not notify seller:', error.message);
    }

    // Notify admin
    try {
      await this.bot.telegram.sendMessage(
        this.adminId,
        `💰 *New Order - Payment Required*\n\n📋 Transaction: ${transactionId}\n👤 Seller: ${service.seller_name}\n💰 Transfer to seller: $${service.net_price.toFixed(2)}\n💳 Payment method: ${service.payment_method}\n\n⚡ Process payment after confirmation!`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.log('Could not notify admin:', error.message);
    }

    await ctx.answerCbQuery('Order created! Complete payment to proceed.');

    // Simulate order completion for demo (in real app, this would be triggered by payment webhook)
    setTimeout(async () => {
      try {
        const ratingKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('⭐ 1', `rate_${transactionId}_1`),
            Markup.button.callback('⭐ 2', `rate_${transactionId}_2`),
            Markup.button.callback('⭐ 3', `rate_${transactionId}_3`),
            Markup.button.callback('⭐ 4', `rate_${transactionId}_4`),
            Markup.button.callback('⭐ 5', `rate_${transactionId}_5`)
          ]
        ]);

        await this.bot.telegram.sendMessage(
          ctx.from.id,
          `✅ Service completed!\n\n💼 ${service.title}\n👤 Seller: ${service.seller_name}\n\nHow would you rate this service?`,
          ratingKeyboard
        );
      } catch (error) {
        console.log('Could not send rating request:', error.message);
      }
    }, 30000); // 30 seconds for demo
  }

  setWebhook(url) {
    return this.bot.telegram.setWebhook(url);
  }

  webhookCallback() {
    return this.bot.webhookCallback('/webhook');
  }

  launch() {
    return this.bot.launch();
  }
}

module.exports = SkillSwapBot;