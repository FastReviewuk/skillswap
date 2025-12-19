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

    // Text message handler for registration flow and requirements
    this.bot.on('text', async (ctx) => {
      try {
        const state = this.userStates.get(ctx.from.id);
        if (!state) return;

        if (state.step === 'typing_requirements') {
          await this.handleRequirementsText(ctx, state);
        } else if (state.step === 'creating_quote') {
          await this.handleQuoteCreation(ctx, state);
        } else if (state.step === 'search_keyword') {
          await this.handleSearchKeyword(ctx, state);
        } else {
          await this.handleRegistrationFlow(ctx, state);
        }
      } catch (error) {
        console.error('Error in text handler:', error);
        await ctx.reply('Sorry, something went wrong. Please try /start again.');
      }
    });

    // File handler for document uploads
    this.bot.on(['document', 'photo', 'video'], async (ctx) => {
      try {
        const state = this.userStates.get(ctx.from.id);
        if (state && state.step === 'uploading_docs') {
          await this.handleDocumentUpload(ctx, state);
        }
      } catch (error) {
        console.error('Error in file handler:', error);
        await ctx.reply('Error processing file. Please try again.');
      }
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

    // Requirements collection handlers
    this.bot.action(/^req_text_(\d+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      await ctx.answerCbQuery();
      
      this.userStates.set(ctx.from.id, { 
        step: 'typing_requirements', 
        serviceId: serviceId 
      });
      
      await ctx.editMessageText(
        `📝 *Describe Your Requirements*\n\nPlease type your detailed requirements:\n\n• What exactly do you need?\n• Any specific instructions?\n• Preferred timeline?\n• Special requests?\n\nType your message now:`
      );
    });

    this.bot.action(/^req_docs_(\d+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      await ctx.answerCbQuery();
      
      this.userStates.set(ctx.from.id, { 
        step: 'uploading_docs', 
        serviceId: serviceId 
      });
      
      await ctx.editMessageText(
        `📎 *Upload Documents*\n\nSend any files, images, or documents related to your project:\n\n• Reference materials\n• Existing files\n• Examples\n• Specifications\n\nSend your files now (one by one):`
      );
    });

    this.bot.action(/^send_request_(\d+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      await this.sendRequestToSeller(ctx, serviceId);
    });

    // Quote management handlers
    this.bot.action(/^accept_quote_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await this.handleQuoteResponse(ctx, orderId, true);
    });

    this.bot.action(/^decline_quote_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await this.handleQuoteResponse(ctx, orderId, false);
    });

    this.bot.action(/^send_quote_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await ctx.answerCbQuery();
      
      this.userStates.set(ctx.from.id, { 
        step: 'creating_quote', 
        orderId: orderId 
      });
      
      await ctx.editMessageText(
        `💰 *Create Custom Quote*\n\nPlease provide:\n\n1. **Your price** (in USD)\n2. **Brief explanation** of what's included\n3. **Estimated delivery time**\n\nFormat: [Price] [Description]\nExample: 25.00 Logo design with 3 revisions, delivered in 2 days\n\nType your quote now:`
      );
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
      
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(
        '🔎 **Search Services**\n\nWhat service are you looking for?\n\nType keywords like:\n• "web design"\n• "logo creation"\n• "content writing"\n• "data entry"\n\nSend your search term now:',
        { parse_mode: 'Markdown', ...backButton }
      );
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

🔄 Want to change your role or update info? Contact @xiniluca
      `;
      
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(profileText, { parse_mode: 'Markdown', ...backButton });
    });

    this.bot.action('menu_my_orders', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showMyOrders(ctx);
    });

    this.bot.action('menu_my_services', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showMyServices(ctx);
    });

    this.bot.action('menu_sales', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showSalesDashboard(ctx);
    });

    this.bot.action('menu_help', async (ctx) => {
      await ctx.answerCbQuery();
      const helpText = `
🤖 **SkillSwap Help**

**🛒 For Buyers:**
• Browse or search services
• Share requirements & documents
• Get custom quotes
• Pay securely via Stripe
• Receive completed work
• Rate sellers

**💼 For Sellers:**
• Add your services
• Receive requests with files
• Create custom quotes
• Get paid after delivery
• Build your reputation

**💰 How It Works:**
1. Buyer selects service & shares requirements
2. Seller reviews & sends custom quote
3. Buyer accepts & pays (seller gets 85%)
4. Seller delivers work via chat
5. Buyer rates the experience

**📁 File Sharing:**
• Upload documents, images, videos
• Share requirements easily
• Receive completed work directly

Need help? Contact @xiniluca
      `;
      
      const helpButtons = Markup.inlineKeyboard([
        [Markup.button.url('💬 Contact Support', 'https://t.me/xiniluca')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(helpText, { parse_mode: 'Markdown', ...helpButtons });
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
      
      await ctx.answerCbQuery();
      
      const order = await this.db.getOrder(orderId);
      if (!order || order.buyer_id !== ctx.from.id) {
        await ctx.editMessageText('❌ Invalid order or access denied.');
        return;
      }

      // Create review
      await this.db.createReview(orderId, ctx.from.id, order.seller_id, rating);
      
      // Update order status
      await this.db.updateOrderStatus(orderId, 'completed');

      const stars = '⭐'.repeat(rating);
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('📋 My Orders', 'menu_my_orders')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);

      await ctx.editMessageText(
        `✅ **Rating Submitted!**\n\n${stars} You gave ${rating} stars\n\nThank you for your feedback! This helps other buyers make informed decisions.\n\n🎉 Order completed successfully!`,
        { parse_mode: 'Markdown', ...backButton }
      );

      // Notify seller about rating
      try {
        await this.bot.telegram.sendMessage(
          order.seller_id,
          `⭐ **New Rating Received!**\n\n📋 Order #${orderId}\n${stars} ${rating}/5 stars\n\n🎉 Great job! Keep up the excellent work!`
        );
      } catch (error) {
        console.log('Could not notify seller about rating:', error.message);
      }
    });
  }

  async showMainMenu(ctx, user) {
    try {
      const isSellerOrBoth = user.role === 'Seller' || user.role === 'Both';
      const isBuyerOrBoth = user.role === 'Buyer' || user.role === 'Both';

      let menuButtons = [];

      // Buyer buttons
      if (isBuyerOrBoth) {
        menuButtons.push([Markup.button.callback('🔍 Browse Services', 'menu_browse')]);
        menuButtons.push([Markup.button.callback('🔎 Search Services', 'menu_search')]);
      }

      // Seller buttons
      if (isSellerOrBoth) {
        menuButtons.push([Markup.button.callback('➕ Add Service', 'menu_add_service')]);
      }

      // Common buttons
      menuButtons.push([Markup.button.callback('👤 My Profile', 'menu_profile')]);
      menuButtons.push([Markup.button.callback('❓ Help', 'menu_help')]);

      const keyboard = Markup.inlineKeyboard(menuButtons);

      const welcomeText = `Welcome back, ${user.name}! 👋\n\n🎯 SkillSwap Dashboard\n\nRole: ${user.role}\nWhat would you like to do today?`;

      await ctx.reply(welcomeText, keyboard);
    } catch (error) {
      console.error('Error in showMainMenu:', error);
      await ctx.reply(`Welcome back, ${user.name}! 👋\n\nUse /help to see available commands.`);
    }
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

    // Start requirements collection process
    this.userStates.set(ctx.from.id, { 
      step: 'collect_requirements', 
      serviceId: serviceId,
      service: service 
    });

    const requirementsKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📝 Add Text Requirements', `req_text_${serviceId}`)],
      [Markup.button.callback('📎 Upload Documents', `req_docs_${serviceId}`)],
      [Markup.button.callback('✅ Send Request', `send_request_${serviceId}`)]
    ]);

    await ctx.editMessageText(
      `📋 *Service Request: ${service.title}*\n\n👤 Seller: ${service.seller_name}\n💰 Base Price: $${(service.net_price * 1.15).toFixed(2)}\n\n📝 *Step 1: Share Your Requirements*\n\nPlease provide details about what you need:\n• Project description\n• Specific requirements\n• Files/documents\n• Deadline preferences\n\nThe seller will review and provide a custom quote.`,
      { parse_mode: 'Markdown', ...requirementsKeyboard }
    );

    await ctx.answerCbQuery('Starting request process...');
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

  async handleRequirementsText(ctx, state) {
    const requirements = ctx.message.text;
    
    // Store requirements in user state
    if (!state.requirements) state.requirements = [];
    state.requirements.push(`📝 ${requirements}`);
    
    const continueKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📎 Add Documents', `req_docs_${state.serviceId}`)],
      [Markup.button.callback('✅ Send Request', `send_request_${state.serviceId}`)],
      [Markup.button.callback('📝 Add More Text', `req_text_${state.serviceId}`)]
    ]);

    await ctx.reply(
      `✅ Requirements added!\n\n📋 *Current Requirements:*\n${state.requirements.join('\n\n')}\n\nWhat would you like to do next?`,
      { parse_mode: 'Markdown', ...continueKeyboard }
    );
  }

  async handleDocumentUpload(ctx, state) {
    let fileInfo = '';
    
    if (ctx.message.document) {
      fileInfo = `📄 Document: ${ctx.message.document.file_name}`;
    } else if (ctx.message.photo) {
      fileInfo = `🖼️ Image uploaded`;
    } else if (ctx.message.video) {
      fileInfo = `🎥 Video uploaded`;
    }

    // Store file info in user state
    if (!state.requirements) state.requirements = [];
    state.requirements.push(fileInfo);

    const continueKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📎 Add More Files', `req_docs_${state.serviceId}`)],
      [Markup.button.callback('✅ Send Request', `send_request_${state.serviceId}`)],
      [Markup.button.callback('📝 Add Text', `req_text_${state.serviceId}`)]
    ]);

    await ctx.reply(
      `✅ File received!\n\n📋 *Current Requirements:*\n${state.requirements.join('\n\n')}\n\nWhat would you like to do next?`,
      { parse_mode: 'Markdown', ...continueKeyboard }
    );
  }

  async sendRequestToSeller(ctx, serviceId) {
    const state = this.userStates.get(ctx.from.id);
    const user = await this.db.getUser(ctx.from.id);
    
    // Get service details
    const services = await this.db.searchServices('');
    const service = services.find(s => s.id == serviceId);
    
    const requirements = state.requirements ? state.requirements.join('\n\n') : 'No specific requirements provided.';
    const transactionId = `REQ_${Date.now()}_${serviceId}`;

    // Create order with requirements
    const orderId = await this.db.createOrder(
      ctx.from.id,
      service.seller_id,
      serviceId,
      transactionId,
      service.net_price,
      service.net_price * 1.15,
      requirements
    );

    // Notify seller
    const sellerKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Send Quote', `send_quote_${orderId}`)],
      [Markup.button.callback('❌ Decline Request', `decline_request_${orderId}`)],
      [Markup.button.callback('💬 Ask Questions', `contact_buyer_${ctx.from.id}`)]
    ]);

    try {
      await this.bot.telegram.sendMessage(
        service.seller_id,
        `🔔 *New Service Request!*\n\n💼 Service: ${service.title}\n👤 Buyer: ${user.name} (@${user.username || 'no username'})\n📋 Request ID: ${orderId}\n\n📝 *Requirements:*\n${requirements}\n\n💡 *Next Steps:*\n• Review the requirements\n• Create a custom quote\n• Or ask for clarification`,
        { parse_mode: 'Markdown', ...sellerKeyboard }
      );
    } catch (error) {
      console.log('Could not notify seller:', error.message);
    }

    await ctx.editMessageText(
      `✅ *Request Sent!*\n\n📋 Your request has been sent to ${service.seller_name}.\n\n⏳ *What happens next:*\n1. Seller reviews your requirements\n2. You'll receive a custom quote\n3. Accept quote and pay\n4. Receive your completed work\n\n📱 You'll be notified when the seller responds.`
    );

    // Clear user state
    this.userStates.delete(ctx.from.id);
    await ctx.answerCbQuery('Request sent successfully!');
  }

  async handleQuoteCreation(ctx, state) {
    const quoteText = ctx.message.text;
    const orderId = state.orderId;
    
    // Parse quote (expecting format: "25.00 Description of work")
    const parts = quoteText.split(' ');
    const price = parseFloat(parts[0]);
    
    if (isNaN(price) || price <= 0) {
      await ctx.reply('❌ Invalid price format. Please use: [Price] [Description]\nExample: 25.00 Logo design with revisions');
      return;
    }

    const description = parts.slice(1).join(' ');
    const finalPrice = (price * 1.15).toFixed(2);

    // Update order with quote
    await this.db.updateOrderQuote(orderId, price, quoteText);

    // Get order details
    const order = await this.db.getOrder(orderId);

    // Send quote to buyer
    const quoteKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Accept Quote', `accept_quote_${orderId}`)],
      [Markup.button.callback('❌ Decline Quote', `decline_quote_${orderId}`)],
      [Markup.button.callback('💬 Ask Questions', `contact_seller_${order.seller_id}`)]
    ]);

    try {
      await this.bot.telegram.sendMessage(
        order.buyer_id,
        `💰 *Custom Quote Received!*\n\n📋 Request ID: ${orderId}\n💵 Seller's Price: $${price.toFixed(2)}\n💳 Total (with fees): $${finalPrice}\n\n📝 *Quote Details:*\n${description}\n\n🤔 *Your Options:*\n• Accept and proceed to payment\n• Decline and look elsewhere\n• Ask questions for clarification`,
        { parse_mode: 'Markdown', ...quoteKeyboard }
      );
    } catch (error) {
      console.log('Could not notify buyer:', error.message);
    }

    await ctx.reply(
      `✅ *Quote Sent!*\n\n💰 Your quote: $${price.toFixed(2)}\n💳 Customer pays: $${finalPrice}\n💵 You receive: $${price.toFixed(2)}\n\n📱 The buyer will be notified and can accept or decline your quote.`
    );

    this.userStates.delete(ctx.from.id);
  }

  async handleQuoteResponse(ctx, orderId, accepted) {
    await ctx.answerCbQuery();
    
    const order = await this.db.getOrder(orderId);
    if (!order || order.buyer_id !== ctx.from.id) {
      await ctx.editMessageText('❌ Order not found or access denied.');
      return;
    }

    if (accepted) {
      // Update order status
      await this.db.updateOrderStatus(orderId, 'quote_accepted');
      
      // Generate payment link
      const finalPrice = (order.custom_price * 1.15).toFixed(2);
      const paymentUrl = `${this.paymentLink}?amount=${finalPrice}&ref=${order.transaction_id}`;
      
      const paymentKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('💳 Pay Now', paymentUrl)],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);

      await ctx.editMessageText(
        `✅ *Quote Accepted!*\n\n💰 Total Amount: $${finalPrice}\n\n🔒 Click below to complete payment securely:\n\n📋 *After Payment:*\n• Seller will be notified\n• Work will begin\n• You'll receive completed work via chat\n• Rate the seller when satisfied`,
        { parse_mode: 'Markdown', ...paymentKeyboard }
      );

      // Notify seller
      try {
        await this.bot.telegram.sendMessage(
          order.seller_id,
          `🎉 *Quote Accepted!*\n\n📋 Order ID: ${orderId}\n💰 Amount: $${order.custom_price.toFixed(2)}\n\n⏳ *Status:* Waiting for payment\n\n📱 You'll be notified once payment is confirmed. Then you can start working!`
        );
      } catch (error) {
        console.log('Could not notify seller:', error.message);
      }

      // Simulate payment completion and rating request
      setTimeout(async () => {
        try {
          const ratingKeyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('⭐ 1', `rate_${orderId}_1`),
              Markup.button.callback('⭐ 2', `rate_${orderId}_2`),
              Markup.button.callback('⭐ 3', `rate_${orderId}_3`),
              Markup.button.callback('⭐ 4', `rate_${orderId}_4`),
              Markup.button.callback('⭐ 5', `rate_${orderId}_5`)
            ],
            [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
          ]);

          await this.bot.telegram.sendMessage(
            ctx.from.id,
            `✅ **Work Completed!**\n\n📋 Order ID: ${orderId}\n\nThe seller has delivered your work. How would you rate this service?`,
            { parse_mode: 'Markdown', ...ratingKeyboard }
          );
        } catch (error) {
          console.log('Could not send rating request:', error.message);
        }
      }, 30000); // 30 seconds for demo

    } else {
      // Quote declined
      await this.db.updateOrderStatus(orderId, 'quote_declined');
      
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(
        `❌ *Quote Declined*\n\nYou can:\n• Browse other services\n• Contact the seller for a revised quote\n• Look for different providers`,
        { parse_mode: 'Markdown', ...backButton }
      );

      // Notify seller
      try {
        await this.bot.telegram.sendMessage(
          order.seller_id,
          `❌ *Quote Declined*\n\n📋 Order ID: ${orderId}\n\nThe buyer has declined your quote. You can:\n• Offer a revised quote\n• Contact them for clarification`
        );
      } catch (error) {
        console.log('Could not notify seller:', error.message);
      }
    }
  }

  async showMyOrders(ctx) {
    const orders = await this.db.getUserOrders(ctx.from.id);
    
    if (orders.length === 0) {
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Browse Services', 'menu_browse')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(
        '📋 **My Orders**\n\nYou haven\'t placed any orders yet.\n\nStart by browsing available services!',
        { parse_mode: 'Markdown', ...backButton }
      );
      return;
    }

    let message = '📋 **My Orders**\n\n';
    
    orders.forEach((order, i) => {
      const status = this.getOrderStatusEmoji(order.status);
      const price = order.custom_price ? `$${(order.custom_price * 1.15).toFixed(2)}` : `$${order.total_amount.toFixed(2)}`;
      
      message += `${i + 1}. ${status} Order #${order.id}\n`;
      message += `   💰 ${price} • 📅 ${new Date(order.created_at).toLocaleDateString()}\n`;
      message += `   Status: ${order.status.replace('_', ' ')}\n\n`;
    });

    const backButton = Markup.inlineKeyboard([
      [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
    ]);

    await ctx.editMessageText(message, { parse_mode: 'Markdown', ...backButton });
  }

  async showMyServices(ctx) {
    const services = await this.db.getUserServices(ctx.from.id);
    
    if (services.length === 0) {
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Service', 'menu_add_service')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(
        '💼 **My Services**\n\nYou haven\'t added any services yet.\n\nStart by creating your first service!',
        { parse_mode: 'Markdown', ...backButton }
      );
      return;
    }

    let message = '💼 **My Services**\n\n';
    
    services.forEach((service, i) => {
      const promoted = service.is_promoted ? '🌟 ' : '';
      const price = (service.net_price * 1.15).toFixed(2);
      
      message += `${i + 1}. ${promoted}**${service.title}**\n`;
      message += `   💰 $${price} • ⏱️ ${service.delivery_time}\n`;
      message += `   📝 ${service.description}\n\n`;
    });

    const backButton = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add Service', 'menu_add_service')],
      [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
    ]);

    await ctx.editMessageText(message, { parse_mode: 'Markdown', ...backButton });
  }

  async showSalesDashboard(ctx) {
    const stats = await this.db.getSellerStats(ctx.from.id);
    
    const message = `
📊 **Sales Dashboard**

💰 **Earnings:**
• Total Orders: ${stats.totalOrders}
• Completed: ${stats.completedOrders}
• Pending: ${stats.pendingOrders}
• Total Earned: $${stats.totalEarned.toFixed(2)}

⭐ **Reputation:**
• Average Rating: ${stats.avgRating > 0 ? stats.avgRating.toFixed(1) : 'No ratings yet'}
• Total Reviews: ${stats.totalReviews}

📈 **Performance:**
• Active Services: ${stats.activeServices}
• This Month: ${stats.monthlyOrders} orders
    `;

    const backButton = Markup.inlineKeyboard([
      [Markup.button.callback('💼 My Services', 'menu_my_services')],
      [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
    ]);

    await ctx.editMessageText(message, { parse_mode: 'Markdown', ...backButton });
  }

  async handleSearchKeyword(ctx, state) {
    const keyword = ctx.message.text;
    const services = await this.db.searchServices(keyword);
    
    this.userStates.delete(ctx.from.id);
    
    if (services.length === 0) {
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Browse All', 'menu_browse')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.reply(
        `🔍 **Search Results**\n\nNo services found for "${keyword}" 😔\n\nTry different keywords or browse all services.`,
        { parse_mode: 'Markdown', ...backButton }
      );
      return;
    }

    await this.displayServicesWithMenu(ctx, services, `🔍 Search: "${keyword}"`);
  }

  getOrderStatusEmoji(status) {
    const statusEmojis = {
      'request_sent': '📤',
      'quote_sent': '💰',
      'quote_accepted': '✅',
      'quote_declined': '❌',
      'paid': '💳',
      'completed': '🎉',
      'cancelled': '🚫'
    };
    return statusEmojis[status] || '📋';
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