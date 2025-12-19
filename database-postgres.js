const { Pool } = require('pg');

class Database {
  constructor() {
    // Use PostgreSQL connection string from environment
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    this.init();
  }

  async init() {
    const client = await this.pool.connect();
    
    try {
      // Users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT UNIQUE,
          name TEXT NOT NULL,
          username TEXT,
          role TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Services table
      await client.query(`
        CREATE TABLE IF NOT EXISTS services (
          id SERIAL PRIMARY KEY,
          seller_id BIGINT,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          net_price DECIMAL(10,2) NOT NULL,
          delivery_time TEXT NOT NULL,
          payment_method TEXT NOT NULL,
          is_promoted BOOLEAN DEFAULT FALSE,
          promotion_expires TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (seller_id) REFERENCES users (telegram_id)
        )
      `);

      // Orders table
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          buyer_id BIGINT,
          seller_id BIGINT,
          service_id INTEGER,
          transaction_id TEXT UNIQUE,
          net_amount DECIMAL(10,2),
          total_amount DECIMAL(10,2),
          custom_price DECIMAL(10,2),
          buyer_requirements TEXT,
          seller_quote TEXT,
          status TEXT DEFAULT 'request_sent',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (buyer_id) REFERENCES users (telegram_id),
          FOREIGN KEY (seller_id) REFERENCES users (telegram_id),
          FOREIGN KEY (service_id) REFERENCES services (id)
        )
      `);

      // Order files table
      await client.query(`
        CREATE TABLE IF NOT EXISTS order_files (
          id SERIAL PRIMARY KEY,
          order_id INTEGER,
          file_id TEXT,
          file_type TEXT,
          file_name TEXT,
          uploaded_by BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders (id),
          FOREIGN KEY (uploaded_by) REFERENCES users (telegram_id)
        )
      `);

      // Reviews table
      await client.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id SERIAL PRIMARY KEY,
          order_id INTEGER,
          buyer_id BIGINT,
          seller_id BIGINT,
          rating INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders (id),
          FOREIGN KEY (buyer_id) REFERENCES users (telegram_id),
          FOREIGN KEY (seller_id) REFERENCES users (telegram_id)
        )
      `);

      console.log('✅ Database tables initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
    } finally {
      client.release();
    }
  }

  // User methods
  async createUser(telegramId, name, username, role) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO users (telegram_id, name, username, role) VALUES ($1, $2, $3, $4) ON CONFLICT (telegram_id) DO UPDATE SET name = $2, username = $3, role = $4 RETURNING id',
        [telegramId, name, username, role]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getUser(telegramId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Service methods
  async createService(sellerId, title, description, netPrice, deliveryTime, paymentMethod) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO services (seller_id, title, description, net_price, delivery_time, payment_method) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [sellerId, title, description, netPrice, deliveryTime, paymentMethod]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async searchServices(keyword, limit = 5) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT s.*, u.name as seller_name, u.username as seller_username,
               COALESCE(AVG(r.rating), 0) as avg_rating,
               COUNT(r.rating) as review_count,
               CASE WHEN s.is_promoted = TRUE AND s.promotion_expires > NOW() THEN TRUE ELSE FALSE END as is_currently_promoted
        FROM services s
        JOIN users u ON s.seller_id = u.telegram_id
        LEFT JOIN reviews r ON r.seller_id = s.seller_id
        WHERE s.title ILIKE $1 OR s.description ILIKE $1
        GROUP BY s.id, u.name, u.username
        ORDER BY is_currently_promoted DESC, avg_rating DESC, s.created_at DESC
        LIMIT $2
      `, [`%${keyword}%`, limit]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async browseServices(limit = 5) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT s.*, u.name as seller_name, u.username as seller_username,
               COALESCE(AVG(r.rating), 0) as avg_rating,
               COUNT(r.rating) as review_count,
               CASE WHEN s.is_promoted = TRUE AND s.promotion_expires > NOW() THEN TRUE ELSE FALSE END as is_currently_promoted
        FROM services s
        JOIN users u ON s.seller_id = u.telegram_id
        LEFT JOIN reviews r ON r.seller_id = s.seller_id
        GROUP BY s.id, u.name, u.username
        ORDER BY is_currently_promoted DESC, avg_rating DESC, s.created_at DESC
        LIMIT $1
      `, [limit]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Order methods
  async createOrder(buyerId, sellerId, serviceId, transactionId, netAmount, totalAmount, requirements = '') {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO orders (buyer_id, seller_id, service_id, transaction_id, net_amount, total_amount, buyer_requirements) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [buyerId, sellerId, serviceId, transactionId, netAmount, totalAmount, requirements]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async updateOrderQuote(orderId, customPrice, sellerQuote) {
    const client = await this.pool.connect();
    try {
      await client.query(
        'UPDATE orders SET custom_price = $1, seller_quote = $2, status = $3 WHERE id = $4',
        [customPrice, sellerQuote, 'quote_sent', orderId]
      );
    } finally {
      client.release();
    }
  }

  async getOrder(orderId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM orders WHERE id = $1',
        [orderId]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async updateOrderStatus(orderId, status) {
    const client = await this.pool.connect();
    try {
      await client.query(
        'UPDATE orders SET status = $1 WHERE id = $2',
        [status, orderId]
      );
    } finally {
      client.release();
    }
  }

  async getUserOrders(userId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getUserServices(userId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM services WHERE seller_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getSellerStats(sellerId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          COUNT(DISTINCT o.id) as totalOrders,
          COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) as completedOrders,
          COUNT(DISTINCT CASE WHEN o.status IN ('request_sent', 'quote_sent', 'quote_accepted') THEN o.id END) as pendingOrders,
          COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.custom_price END), 0) as totalEarned,
          COALESCE(AVG(r.rating), 0) as avgRating,
          COUNT(DISTINCT r.id) as totalReviews,
          COUNT(DISTINCT s.id) as activeServices,
          COUNT(DISTINCT CASE WHEN DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', NOW()) THEN o.id END) as monthlyOrders
        FROM users u
        LEFT JOIN services s ON u.telegram_id = s.seller_id
        LEFT JOIN orders o ON u.telegram_id = o.seller_id
        LEFT JOIN reviews r ON u.telegram_id = r.seller_id
        WHERE u.telegram_id = $1
        GROUP BY u.telegram_id
      `, [sellerId]);
      
      return result.rows[0] || {
        totalOrders: 0, completedOrders: 0, pendingOrders: 0,
        totalEarned: 0, avgRating: 0, totalReviews: 0,
        activeServices: 0, monthlyOrders: 0
      };
    } finally {
      client.release();
    }
  }

  async getTopSellers(limit = 10) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          u.name,
          u.telegram_id,
          COALESCE(AVG(r.rating), 0) as avg_rating,
          COUNT(DISTINCT o.id) as total_orders,
          COALESCE(SUM(o.custom_price), 0) as total_earned,
          COUNT(DISTINCT s.id) as active_services,
          MAX(CASE WHEN s.is_promoted = TRUE AND s.promotion_expires > NOW() THEN 1 ELSE 0 END) as is_promoted
        FROM users u
        LEFT JOIN services s ON u.telegram_id = s.seller_id
        LEFT JOIN orders o ON u.telegram_id = o.seller_id AND o.status = 'completed'
        LEFT JOIN reviews r ON u.telegram_id = r.seller_id
        WHERE u.role IN ('Seller', 'Both')
        GROUP BY u.telegram_id, u.name
        HAVING COUNT(DISTINCT s.id) > 0
        ORDER BY 
          is_promoted DESC,
          avg_rating DESC,
          total_orders DESC,
          total_earned DESC
        LIMIT $1
      `, [limit]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async expirePromotions() {
    const client = await this.pool.connect();
    try {
      await client.query(
        'UPDATE services SET is_promoted = FALSE WHERE is_promoted = TRUE AND promotion_expires <= NOW()'
      );
    } finally {
      client.release();
    }
  }

  async saveOrderFile(orderId, fileId, fileType, fileName, uploadedBy) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO order_files (order_id, file_id, file_type, file_name, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [orderId, fileId, fileType, fileName, uploadedBy]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getOrderFiles(orderId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM order_files WHERE order_id = $1 ORDER BY created_at ASC',
        [orderId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async createReview(orderId, buyerId, sellerId, rating) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO reviews (order_id, buyer_id, seller_id, rating) VALUES ($1, $2, $3, $4) RETURNING id',
        [orderId, buyerId, sellerId, rating]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async promoteService(serviceId, expirationDate) {
    const client = await this.pool.connect();
    try {
      await client.query(
        'UPDATE services SET is_promoted = TRUE, promotion_expires = $1 WHERE id = $2',
        [expirationDate, serviceId]
      );
    } finally {
      client.release();
    }
  }

  async getStats() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM orders) as total_orders,
          (SELECT COUNT(*) FROM users WHERE role IN ('Seller', 'Both')) as active_sellers,
          (SELECT COUNT(*) FROM services) as total_services
      `);
      
      return {
        totalUsers: result.rows[0].total_users,
        totalOrders: result.rows[0].total_orders,
        activeSellers: result.rows[0].active_sellers,
        totalServices: result.rows[0].total_services
      };
    } finally {
      client.release();
    }
  }
}

module.exports = Database;