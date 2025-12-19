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
    
    // Check for expired promotions every hour
    setInterval(() => {
      this.db.expirePromotions().catch(console.error);
    }, 60 * 60 * 1000);
  }

  setupHandlers() {
    // Start command
    this.bot.start(async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from.id);
        if (user) {
          await this.showMainMenu(ctx, user);
        } else {
          await this.startRegistration(ctx);
        }
      } catch (error) {
        console.error('Start error:', error);
        await ctx.reply('Welcome to SkillSwap! Use /help for commands.');
      }
    });

    // Help command
    this.bot.help((ctx) => {
      const helpText = `
🤖 **SkillSwap Bot Commands**

📝 **General:**
/start - Register or welcome back
/help - Show this help message
/profile - View your profile

🔍 **Browse Services:**
/search [keyword] - Search for services
/browse - Browse all services

💼 **For Sellers:**
/addservice - Add a new service
/myservices - View your services
/promote - Promote your services (💰 $1.99/month)

⭐ **Reviews:**
Rate services after purchase (1-5 stars)

💰 **Payments:**
All payments processed securely via our payment system
Sellers receive 85% of the final price

Need help? Contact @xiniluca
      `;
      ctx.replyWithMarkdown(helpText);
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

    this.bot.action('menu_add_service', async (ctx) => {
      await ctx.answerCbQuery();
      const user = await this.db.getUser(ctx.from.id);
      if (user.role === 'Buyer') {
        await ctx.editMessageText('❌ Only sellers can add services.\n\nContact @xiniluca to change your role.');
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

    this.bot.action('menu_about', async (ctx) => {
      await ctx.answerCbQuery();
      const aboutText = `
🚀 **Welcome to SkillSwap!** 

Turn your 10-minute skill into real cash inside Telegram.

**Got something you're good at?**
✅ Fix grammar
✅ Design a Canva post  
✅ Explain crypto basics
✅ Debug a spreadsheet
✅ Translate a paragraph
✅ Give fitness tips

You can sell it. Today. For real $$$.

💡 **How it works:**
**SELL:** Add service → describe your micro-skill (under 15 mins), set your price
**BUY:** Browse gigs → pay securely → get your result in-chat
**EARN:** Every time someone buys your skill, you get paid (minus a small 15% service fee)

We handle the payment link. You deliver the value. It's that simple.

🌟 **Why join?**
• No sign-ups — just Telegram
• Get paid in dollars — fast & easy  
• Top sellers get featured (promote your gig for just $1.99/month!)
• Build your reputation with star ratings ⭐⭐⭐⭐⭐

💬 *"I made $12 last week just by proofreading 4 texts between classes."* — Sofia, student & SkillSwap seller

✨ Your skill has value. Even if it feels "small" — someone out there needs it right now.

👉 Ready to earn? Add your first service or browse what's live today!

**SkillSwap — where tiny talents turn into real income.** 💰
      `;
      
      const aboutButtons = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add My Service', 'menu_add_service')],
        [Markup.button.callback('🔍 Browse Services', 'menu_browse')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(aboutText, { parse_mode: 'Markdown', ...aboutButtons });
    });

    this.bot.action('menu_top_sellers', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showTopSellers(ctx);
    });

    this.bot.action('menu_promote', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showPromotionOptions(ctx);
    });

    this.bot.action(/^promote_service_(\d+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      await this.handleServicePromotion(ctx, serviceId);
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

    // Registration handlers
    this.bot.action(/^role_(.+)$/, async (ctx) => {
      const role = ctx.match[1];
      const state = this.userStates.get(ctx.from.id);
      if (state && state.step === 'role') {
        state.role = role;
        state.step = 'complete';
        
        await this.db.createUser(ctx.from.id, state.name, state.username, role);
        
        await ctx.editMessageText(`✅ Registration complete!\n\n👤 Name: ${state.name}\n🎭 Role: ${role}\n\nWelcome to SkillSwap! Use /start to see the main menu.`);
        
        this.userStates.delete(ctx.from.id);
        
        if (role === 'Seller' || role === 'Both') {
          await ctx.reply('💡 As a seller, you can add services with the menu button');
        }
      }
    });

    // Buy button handler
    this.bot.action(/^buy_(.+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      await this.handlePurchase(ctx, serviceId);
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

    this.bot.action(/^decline_request_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await ctx.answerCbQuery();
      
      // Update order status
      await this.db.updateOrderStatus(orderId, 'declined');
      
      // Get order details
      const order = await this.db.getOrder(orderId);
      
      await ctx.editMessageText(
        `❌ **Request Declined**\n\n📋 Order #${orderId} has been declined.\n\nThe buyer will be notified that you cannot take on this project at this time.`
      );

      // Notify buyer
      try {
        const backButton = Markup.inlineKeyboard([
          [Markup.button.callback('🔍 Browse Other Services', 'menu_browse')],
          [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
        ]);

        await this.bot.telegram.sendMessage(
          order.buyer_id,
          `❌ **Request Declined**\n\n📋 Order #${orderId}\n\nThe seller has declined your request. This could be due to:\n• Current workload\n• Project complexity\n• Availability\n\nYou can browse other services or try a different seller.`,
          { parse_mode: 'Markdown', ...backButton }
        );
      } catch (error) {
        console.log('Could not notify buyer about declined request:', error.message);
      }
    });

    this.bot.action(/^message_buyer_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await ctx.answerCbQuery();
      
      this.userStates.set(ctx.from.id, { 
        step: 'messaging_buyer', 
        orderId: orderId 
      });
      
      await ctx.editMessageText(
        `💬 *Message Buyer*\n\nSend a message to the buyer about Order #${orderId}.\n\nYou can:\n• Ask for clarification\n• Request additional information\n• Discuss project details\n\nType your message now:`
      );
    });

    this.bot.action(/^message_seller_(\d+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      await ctx.answerCbQuery();
      
      this.userStates.set(ctx.from.id, { 
        step: 'messaging_seller', 
        orderId: orderId 
      });
      
      await ctx.editMessageText(
        `💬 *Message Seller*\n\nSend a message to the seller about Order #${orderId}.\n\nYou can:\n• Ask questions about the quote\n• Provide additional details\n• Discuss timeline\n\nType your message now:`
      );
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

      // Check if already rated
      try {
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
            `⭐ **New Rating Received!**\n\n📋 Order #${orderId}\n${stars} ${rating}/5 stars\n\n🎉 Great job! Keep up the excellent work!`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.log('Could not notify seller about rating:', error.message);
        }
      } catch (error) {
        console.error('Error submitting rating:', error);
        await ctx.editMessageText('❌ Error submitting rating. You may have already rated this order.');
      }
    });

    // Text message handler
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
        } else if (state.step === 'messaging_buyer') {
          await this.handleMessageToBuyer(ctx, state);
        } else if (state.step === 'messaging_seller') {
          await this.handleMessageToSeller(ctx, state);
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
        menuButtons.push([Markup.button.callback('📋 My Orders', 'menu_my_orders')]);
      }

      // Seller buttons
      if (isSellerOrBoth) {
        menuButtons.push([Markup.button.callback('💼 My Services', 'menu_my_services')]);
        menuButtons.push([Markup.button.callback('➕ Add Service', 'menu_add_service')]);
        menuButtons.push([Markup.button.callback('📊 Sales Dashboard', 'menu_sales')]);
        menuButtons.push([Markup.button.callback('🌟 Promote Services', 'menu_promote')]);
      }

      // Common buttons
      menuButtons.push([Markup.button.callback('🏆 Top Sellers', 'menu_top_sellers')]);
      menuButtons.push([Markup.button.callback('👤 My Profile', 'menu_profile')]);
      menuButtons.push([Markup.button.callback('🚀 What is SkillSwap?', 'menu_about')]);
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
        
        const backButton = Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
        ]);
        
        await ctx.reply(`✅ Service added successfully!\n\n💼 ${state.title}\n📝 ${state.description}\n💰 Customer pays: $${finalPrice} (you get: $${state.price.toFixed(2)})\n⏱️ Delivery: ${state.delivery}`, backButton);
        
        this.userStates.delete(ctx.from.id);
        break;
    }
  }

  async displayServicesWithMenu(ctx, services, title) {
    let message = `${title}\n\n`;
    
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      const finalPrice = (service.net_price * 1.15).toFixed(2);
      const rating = service.avg_rating > 0 ? `⭐ ${service.avg_rating.toFixed(1)}` : '⭐ New';
      const promoted = (service.is_currently_promoted || service.is_promoted) ? '🌟 ' : '';
      
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
      `📋 *Service Request: ${service.title}*\n\n👤 Seller: ${service.seller_name}\n💰 Base Price: ${(service.net_price * 1.15).toFixed(2)}\n\n📝 *Step 1: Share Your Requirements*\n\nPlease provide details about what you need:\n• Project description\n• Specific requirements\n• Files/documents\n• Deadline preferences\n\nThe seller will review and provide a custom quote.`,
      { parse_mode: 'Markdown', ...requirementsKeyboard }
    );

    await ctx.answerCbQuery('Starting request process...');
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
    let fileId = '';
    let fileType = '';
    let fileName = '';
    
    if (ctx.message.document) {
      fileInfo = `📄 Document: ${ctx.message.document.file_name}`;
      fileId = ctx.message.document.file_id;
      fileType = 'document';
      fileName = ctx.message.document.file_name;
    } else if (ctx.message.photo) {
      fileInfo = `🖼️ Image uploaded`;
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id; // Get highest resolution
      fileType = 'photo';
      fileName = 'image.jpg';
    } else if (ctx.message.video) {
      fileInfo = `🎥 Video uploaded`;
      fileId = ctx.message.video.file_id;
      fileType = 'video';
      fileName = ctx.message.video.file_name || 'video.mp4';
    }

    // Store file info in user state with file details
    if (!state.requirements) state.requirements = [];
    if (!state.files) state.files = [];
    
    state.requirements.push(fileInfo);
    state.files.push({
      fileId: fileId,
      fileType: fileType,
      fileName: fileName,
      info: fileInfo
    });

    const continueKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📎 Add More Files', `req_docs_${state.serviceId}`)],
      [Markup.button.callback('✅ Send Request', `send_request_${state.serviceId}`)],
      [Markup.button.callback('📝 Add Text', `req_text_${state.serviceId}`)]
    ]);

    await ctx.reply(
      `✅ File received and saved!\n\n📋 *Current Requirements:*\n${state.requirements.join('\n\n')}\n\nWhat would you like to do next?`,
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

    // Save uploaded files to database and forward to seller
    if (state.files && state.files.length > 0) {
      for (const file of state.files) {
        // Save file info to database
        await this.db.saveOrderFile(orderId, file.fileId, file.fileType, file.fileName, ctx.from.id);
        
        // Forward file to seller
        try {
          await this.forwardFileToSeller(service.seller_id, file, orderId, user.name);
        } catch (error) {
          console.log('Could not forward file to seller:', error.message);
        }
      }
    }

    // Notify seller with request details
    const sellerKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Send Quote', `send_quote_${orderId}`)],
      [Markup.button.callback('❌ Decline Request', `decline_request_${orderId}`)],
      [Markup.button.callback('💬 Message Buyer', `message_buyer_${orderId}`)]
    ]);

    const fileCount = state.files ? state.files.length : 0;
    const filesText = fileCount > 0 ? `\n\n📎 *Attached Files:* ${fileCount} file(s) forwarded above` : '';

    try {
      await this.bot.telegram.sendMessage(
        service.seller_id,
        `🔔 *New Service Request!*\n\n💼 Service: ${service.title}\n👤 Buyer: ${user.name} (@${user.username || 'no username'})\n📋 Request ID: ${orderId}\n\n📝 *Requirements:*\n${requirements}${filesText}\n\n💡 *Next Steps:*\n• Review the requirements and files\n• Create a custom quote\n• Or decline if not suitable`,
        { parse_mode: 'Markdown', ...sellerKeyboard }
      );
    } catch (error) {
      console.log('Could not notify seller:', error.message);
    }

    await ctx.editMessageText(
      `✅ *Request Sent!*\n\n📋 Your request has been sent to ${service.seller_name}.\n${fileCount > 0 ? `📎 ${fileCount} file(s) forwarded to seller.\n` : ''}\n⏳ *What happens next:*\n1. Seller reviews your requirements and files\n2. You'll receive a custom quote\n3. Accept quote and pay\n4. Receive your completed work\n\n📱 You'll be notified when the seller responds.`
    );

    // Clear user state
    this.userStates.delete(ctx.from.id);
    await ctx.answerCbQuery('Request sent successfully!');
  }

  async forwardFileToSeller(sellerId, file, orderId, buyerName) {
    const caption = `📎 *File from Order #${orderId}*\n👤 Buyer: ${buyerName}\n📄 File: ${file.fileName}`;
    
    try {
      if (file.fileType === 'document') {
        await this.bot.telegram.sendDocument(sellerId, file.fileId, {
          caption: caption,
          parse_mode: 'Markdown'
        });
      } else if (file.fileType === 'photo') {
        await this.bot.telegram.sendPhoto(sellerId, file.fileId, {
          caption: caption,
          parse_mode: 'Markdown'
        });
      } else if (file.fileType === 'video') {
        await this.bot.telegram.sendVideo(sellerId, file.fileId, {
          caption: caption,
          parse_mode: 'Markdown'
        });
      }
    } catch (error) {
      console.log(`Could not forward ${file.fileType} to seller:`, error.message);
    }
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
      [Markup.button.callback('❌ Decline Quote', `decline_quote_${orderId}`)]
    ]);

    try {
      await this.bot.telegram.sendMessage(
        order.buyer_id,
        `💰 *Custom Quote Received!*\n\n📋 Request ID: ${orderId}\n💵 Seller's Price: $${price.toFixed(2)}\n💳 Total (with fees): $${finalPrice}\n\n📝 *Quote Details:*\n${description}\n\n🤔 *Your Options:*\n• Accept and proceed to payment\n• Decline and look elsewhere`,
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

  async showTopSellers(ctx) {
    const topSellers = await this.db.getTopSellers();
    
    if (topSellers.length === 0) {
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Browse Services', 'menu_browse')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(
        '🏆 **Top Sellers**\n\nNo sellers yet! Be the first to add a service and start earning.',
        { parse_mode: 'Markdown', ...backButton }
      );
      return;
    }

    let message = '🏆 **Top Sellers Leaderboard**\n\n';
    
    topSellers.forEach((seller, i) => {
      const position = i + 1;
      const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `${position}.`;
      const promoted = seller.is_promoted ? '🌟 ' : '';
      const rating = seller.avg_rating > 0 ? `⭐ ${seller.avg_rating.toFixed(1)}` : '⭐ New';
      
      message += `${medal} ${promoted}**${seller.name}**\n`;
      message += `   ${rating} • ${seller.total_orders} orders • $${seller.total_earned.toFixed(2)} earned\n`;
      message += `   Active Services: ${seller.active_services}\n\n`;
    });

    message += '💡 *Want to be featured? Promote your services for just $1.99/month!*';

    const backButton = Markup.inlineKeyboard([
      [Markup.button.callback('🌟 Promote My Services', 'menu_promote')],
      [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
    ]);

    await ctx.editMessageText(message, { parse_mode: 'Markdown', ...backButton });
  }

  async showPromotionOptions(ctx) {
    const user = await this.db.getUser(ctx.from.id);
    
    if (user.role === 'Buyer') {
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(
        '❌ **Promotion Available for Sellers Only**\n\nOnly sellers can promote their services.\n\nContact @xiniluca to change your role to Seller.',
        { parse_mode: 'Markdown', ...backButton }
      );
      return;
    }

    const services = await this.db.getUserServices(ctx.from.id);
    
    if (services.length === 0) {
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Service First', 'menu_add_service')],
        [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
      ]);
      
      await ctx.editMessageText(
        '💼 **No Services to Promote**\n\nYou need to add services before you can promote them.\n\nCreate your first service to get started!',
        { parse_mode: 'Markdown', ...backButton }
      );
      return;
    }

    let message = '🌟 **Promote Your Services**\n\n💰 **Only $1.99/month per service**\n\n✨ **Benefits:**\n• 🔝 Top position in search results\n• 🌟 Featured badge on your services\n• 📈 Higher visibility to buyers\n• 🏆 Featured in Top Sellers leaderboard\n\n📋 **Your Services:**\n\n';
    
    let buttons = [];
    
    services.forEach((service, i) => {
      const promoted = service.is_promoted ? '🌟 PROMOTED' : 'Not promoted';
      const expiryText = service.is_promoted && service.promotion_expires ? 
        `(expires ${new Date(service.promotion_expires).toLocaleDateString()})` : '';
      
      message += `${i + 1}. **${service.title}**\n`;
      message += `   Status: ${promoted} ${expiryText}\n`;
      message += `   Price: $${(service.net_price * 1.15).toFixed(2)}\n\n`;
      
      if (!service.is_promoted || (service.promotion_expires && new Date(service.promotion_expires) < new Date())) {
        buttons.push([Markup.button.callback(`🌟 Promote "${service.title}"`, `promote_service_${service.id}`)]);
      }
    });

    buttons.push([Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]);

    const keyboard = Markup.inlineKeyboard(buttons);

    await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard });
  }

  async handleServicePromotion(ctx, serviceId) {
    await ctx.answerCbQuery();
    
    const services = await this.db.getUserServices(ctx.from.id);
    const service = services.find(s => s.id == serviceId);
    
    if (!service) {
      await ctx.editMessageText('❌ Service not found.');
      return;
    }

    // Generate promotion payment link
    const promotionPrice = '1.99';
    const transactionId = `PROMO_${Date.now()}_${serviceId}`;
    const paymentUrl = `${this.paymentLink}?amount=${promotionPrice}&ref=${transactionId}`;
    
    const paymentKeyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Pay $1.99 to Promote', paymentUrl)],
      [Markup.button.callback('🔙 Back to Promotion', 'menu_promote')],
      [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
    ]);

    await ctx.editMessageText(
      `🌟 **Promote "${service.title}"**\n\n💰 **Cost:** $1.99/month\n\n✨ **You'll get:**\n• 🔝 Top position in all searches\n• 🌟 Featured badge next to your service\n• 📈 3x more visibility to buyers\n• 🏆 Priority in Top Sellers leaderboard\n\n🔒 **Secure Payment:**\nClick below to pay via Stripe. Your service will be promoted immediately after payment confirmation.\n\n📅 **Duration:** 30 days from activation`,
      { parse_mode: 'Markdown', ...paymentKeyboard }
    );

    // Notify admin about promotion payment
    try {
      await this.bot.telegram.sendMessage(
        this.adminId,
        `🌟 **Promotion Payment Pending**\n\n📋 Transaction: ${transactionId}\n👤 Seller: ${ctx.from.first_name}\n💼 Service: ${service.title}\n💰 Amount: $1.99\n\n⚡ Activate promotion after payment confirmation!`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.log('Could not notify admin about promotion:', error.message);
    }

    // Simulate promotion activation (in real app, this would be triggered by payment webhook)
    setTimeout(async () => {
      try {
        // Set promotion expiry to 30 days from now
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        
        await this.db.promoteService(serviceId, expiryDate.toISOString());
        
        await this.bot.telegram.sendMessage(
          ctx.from.id,
          `🎉 **Service Promoted Successfully!**\n\n🌟 "${service.title}" is now featured!\n\n✨ **Active until:** ${expiryDate.toLocaleDateString()}\n\n📈 Your service will now appear at the top of search results and get priority visibility.\n\n🏆 Check the Top Sellers leaderboard to see your new position!`
        );
      } catch (error) {
        console.log('Could not activate promotion:', error.message);
      }
    }, 10000); // 10 seconds for demo
  }

  async handleMessageToBuyer(ctx, state) {
    const message = ctx.message.text;
    const orderId = state.orderId;
    
    // Get order details
    const order = await this.db.getOrder(orderId);
    if (!order || order.seller_id !== ctx.from.id) {
      await ctx.reply('❌ Invalid order or access denied.');
      this.userStates.delete(ctx.from.id);
      return;
    }

    // Get seller info
    const seller = await this.db.getUser(ctx.from.id);
    
    // Send message to buyer
    try {
      const messageKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`💬 Reply to Seller`, `message_seller_${orderId}`)],
        [Markup.button.callback('📋 View Order', 'menu_my_orders')]
      ]);

      await this.bot.telegram.sendMessage(
        order.buyer_id,
        `💬 **Message from Seller**\n\n📋 Order #${orderId}\n👤 From: ${seller.name}\n\n📝 **Message:**\n${message}`,
        { parse_mode: 'Markdown', ...messageKeyboard }
      );

      await ctx.reply(
        `✅ **Message Sent!**\n\n📋 Order #${orderId}\n📤 Your message has been delivered to the buyer.\n\n💬 They can reply directly through their order interface.`
      );
    } catch (error) {
      console.log('Could not send message to buyer:', error.message);
      await ctx.reply('❌ Could not deliver message. The buyer may have blocked the bot.');
    }

    this.userStates.delete(ctx.from.id);
  }

  async handleMessageToSeller(ctx, state) {
    const message = ctx.message.text;
    const orderId = state.orderId;
    
    // Get order details
    const order = await this.db.getOrder(orderId);
    if (!order || order.buyer_id !== ctx.from.id) {
      await ctx.reply('❌ Invalid order or access denied.');
      this.userStates.delete(ctx.from.id);
      return;
    }

    // Get buyer info
    const buyer = await this.db.getUser(ctx.from.id);
    
    // Send message to seller
    try {
      const messageKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`💬 Reply to Buyer`, `message_buyer_${orderId}`)],
        [Markup.button.callback('💰 Send Quote', `send_quote_${orderId}`)],
        [Markup.button.callback('📊 Sales Dashboard', 'menu_sales')]
      ]);

      await this.bot.telegram.sendMessage(
        order.seller_id,
        `💬 **Message from Buyer**\n\n📋 Order #${orderId}\n👤 From: ${buyer.name}\n\n📝 **Message:**\n${message}`,
        { parse_mode: 'Markdown', ...messageKeyboard }
      );

      await ctx.reply(
        `✅ **Message Sent!**\n\n📋 Order #${orderId}\n📤 Your message has been delivered to the seller.\n\n💬 They can reply or send you a quote through their dashboard.`
      );
    } catch (error) {
      console.log('Could not send message to seller:', error.message);
      await ctx.reply('❌ Could not deliver message. The seller may have blocked the bot.');
    }

    this.userStates.delete(ctx.from.id);
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

  launch() {
    return this.bot.launch();
  }
}

module.exports = SkillSwapBot;