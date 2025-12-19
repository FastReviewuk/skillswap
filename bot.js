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
        await this.showMainMenu(ctx, user);
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

    // Order management handlers
    this.bot.action(/^accept_order_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await this.handleOrderAcceptance(ctx, orderId, true);
    });

    this.bot.action(/^decline_order_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await this.handleOrderAcceptance(ctx, orderId, false);
    });

    this.bot.action(/^contact_buyer_(\d+)$/, async (ctx) => {
      const buyerId = ctx.match[1];
      await ctx.answerCbQuery();
      
      try {
        await this.bot.telegram.sendMessage(
          buyerId,
          `💬 The seller wants to discuss your order.\n\nYou can now chat directly with them about the requirements.`
        );
        
        await ctx.editMessageText(
          `✅ Contact request sent to buyer!\n\nYou can now chat with them about the order details.`
        );
      } catch (error) {
        await ctx.answerCbQuery('Could not contact buyer');
      }
    });

    // Menu handlers
    this.bot.action('menu_browse', async (ctx) => {
      await ctx.answerCbQuery();
      const services = await this.db.browseServices();
      if (services.length === 0) {
        await ctx.editMessageText('No services available yet 😔\n\nBe the first to add a service!');
        return;
      }
      await this.displayServicesWithMenu(ctx, services, '📋 Available Services');
    });

    this.bot.action('menu_search', async (ctx) => {
      await ctx.answerCbQuery();
      this.userStates.set(ctx.from.id, { step: 'search_keyword' });
      await ctx.editMessageText('🔎 What service are you looking for?\n\nType keywords (e.g., "web design", "logo", "writing")');
    });

    this.bot.action('menu_add_service', async (ctx) => {
      await ctx.answerCbQuery();
      const user = await this.db.getUser(ctx.from.id);
      if (user.role === 'Buyer') {
        await ctx.editMessageText('❌ Only sellers can add services.\n\nContact support to change your role.');
        return;
      }
      this.userStates.set(ctx.from.id, { step: 'service_title' });
      await ctx.editMessageText('💼 Let\'s add your service!\n\n📝 First, what\'s the title of your service?\n(Keep it short and descriptive)');
    });

    this.bot.action('menu_profile', async (ctx) => {
      await ctx.answerCbQuery();
      const user = await this.db.getUser(ctx.from.id);
      const profileText = `
👤 **Your Profile**

📝 Name: ${user.name}
🆔 Username: ${user.username || 'Not set'}
🎭 Role: ${user.role}
📅 Joined: ${new Date(user.created_at).toLocaleDateString()}

🔄 Want to change your role or update info? Contact support.
      `;
      
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(profileText, { parse_mode: 'Markdown', ...backButton });
    });

    this.bot.action('menu_help', async (ctx) => {
      await ctx.answerCbQuery();
      const helpText = `
🤖 **SkillSwap Help**

**🛒 For Buyers:**
• Browse or search services
• Purchase with secure payment
• Receive files via chat
• Rate sellers after completion

**💼 For Sellers:**
• Add your services
• Receive order notifications
• Deliver files via chat
• Get paid (85% of total)

**💰 How Payments Work:**
1. Customer pays via Stripe link
2. You get notified of new order
3. Deliver service via chat/files
4. Customer rates your work
5. You receive 85% of payment

**📁 File Sharing:**
• Send files directly in chat
• Supports images, documents, videos
• Secure and private delivery

Need more help? Contact @support
      `;
      
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(helpText, { parse_mode: 'Markdown', ...backButton });
    });

    this.bot.action('back_to_menu', async (ctx) => {
      await ctx.answerCbQuery();
      const user = await this.db.getUser(ctx.from.id);
      await this.showMainMenu(ctx, user);
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

  async showMainMenu(ctx, user) {
    const isSellerOrBoth = user.role === 'Seller' || user.role === 'Both';
    const isBuyerOrBoth = user.role === 'Buyer' || user.role === 'Both';

    let menuButtons = [];

    // Buyer buttons
    if (isBuyerOrBoth) {
      menuButtons.push(
        [Markup.button.callback('🔍 Browse Services', 'menu_browse')],
        [Markup.button.callback('🔎 Search Services', 'menu_search')],
        [Markup.button.callback('📋 My Orders', 'menu_my_orders')]
      );
    }

    // Seller buttons
    if (isSellerOrBoth) {
      menuButtons.push(
        [Markup.button.callback('💼 My Services', 'menu_my_services')],
        [Markup.button.callback('➕ Add Service', 'menu_add_service')],
        [Markup.button.callback('📊 Sales Dashboard', 'menu_sales')]
      );
    }

    // Common buttons
    menuButtons.push(
      [Markup.button.callback('👤 My Profile', 'menu_profile')],
      [Markup.button.callback('❓ Help', 'menu_help')]
    );

    const keyboard = Markup.inlineKeyboard(menuButtons);

    const welcomeText = `Welcome back, ${user.name}! 👋\n\n🎯 **SkillSwap Dashboard**\n\nRole: ${user.role}\nWhat would you like to do today?`;

    await ctx.reply(welcomeText, { parse_mode: 'Markdown', ...keyboard });
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

  async displayServicesWithMenu(ctx, services, title) {
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

    let buttons = services.map((service, index) => [
      Markup.button.callback(`🛒 Buy #${index + 1}`, `buy_${service.id}`)
    ]);
    
    buttons.push([Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]);

    const keyboard = Markup.inlineKeyboard(buttons);

    await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard });
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

    // Notify seller with action buttons
    try {
      const sellerKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Accept Order', `accept_order_${orderId}`)],
        [Markup.button.callback('❌ Decline Order', `decline_order_${orderId}`)],
        [Markup.button.callback('💬 Contact Buyer', `contact_buyer_${ctx.from.id}`)]
      ]);

      await this.bot.telegram.sendMessage(
        service.seller_id,
        `🔔 *New Order Request!*\n\n💼 Service: ${service.title}\n👤 Buyer: ${user.name} (@${user.username || 'no username'})\n💰 You'll receive: $${service.net_price.toFixed(2)}\n📋 Order ID: ${orderId}\n\n⚠️ Customer will pay after you accept the order.\n\n📋 *Next Steps:*\n1. Accept or decline the order\n2. Wait for payment confirmation\n3. Deliver service via chat\n4. Get paid!`,
        { parse_mode: 'Markdown', ...sellerKeyboard }
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

  async handleOrderAcceptance(ctx, orderId, accepted) {
    await ctx.answerCbQuery();
    
    const order = await this.db.getOrder(orderId);
    if (!order || order.seller_id !== ctx.from.id) {
      await ctx.editMessageText('❌ Order not found or access denied.');
      return;
    }

    if (accepted) {
      // Update order status
      await this.db.updateOrderStatus(orderId, 'accepted');
      
      // Notify buyer with payment link
      const finalPrice = order.total_amount.toFixed(2);
      const paymentUrl = `${this.paymentLink}?amount=${finalPrice}&ref=${order.transaction_id}`;
      
      const paymentKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('💳 Pay Now', paymentUrl)],
        [Markup.button.callback('💬 Contact Seller', `contact_seller_${order.seller_id}`)]
      ]);

      try {
        await this.bot.telegram.sendMessage(
          order.buyer_id,
          `✅ *Order Accepted!*\n\n🎉 Great news! The seller has accepted your order.\n\n💼 Service: Order #${orderId}\n💰 Total: $${finalPrice}\n\n🔒 Click below to complete payment securely:\n\n📋 *After Payment:*\n• Seller will be notified\n• Work will begin\n• You'll receive files via chat\n• Rate the seller when done`,
          { parse_mode: 'Markdown', ...paymentKeyboard }
        );
      } catch (error) {
        console.log('Could not notify buyer:', error.message);
      }

      await ctx.editMessageText(
        `✅ *Order Accepted!*\n\nThe buyer has been notified and can now make payment.\n\n📋 *Next Steps:*\n1. Wait for payment confirmation\n2. Start working on the order\n3. Deliver files via chat\n4. Get paid automatically!`
      );

    } else {
      // Order declined
      await this.db.updateOrderStatus(orderId, 'declined');
      
      try {
        await this.bot.telegram.sendMessage(
          order.buyer_id,
          `❌ *Order Declined*\n\nSorry, the seller has declined your order.\n\nYou can:\n• Browse other similar services\n• Contact the seller for more info\n• Try a different service provider`
        );
      } catch (error) {
        console.log('Could not notify buyer:', error.message);
      }

      await ctx.editMessageText(`❌ Order declined and buyer notified.`);
    }
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