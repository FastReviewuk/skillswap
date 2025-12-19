const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = new sqlite3.Database(path.join(__dirname, 'skillswap.db'));
    this.init();
  }

  init() {
    // Users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER UNIQUE,
        name TEXT NOT NULL,
        username TEXT,
        role TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Services table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id INTEGER,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        net_price REAL NOT NULL,
        delivery_time TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        is_promoted BOOLEAN DEFAULT 0,
        promotion_expires DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (seller_id) REFERENCES users (telegram_id)
      )
    `);

    // Orders table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id INTEGER,
        seller_id INTEGER,
        service_id INTEGER,
        transaction_id TEXT UNIQUE,
        net_amount REAL,
        total_amount REAL,
        custom_price REAL,
        buyer_requirements TEXT,
        seller_quote TEXT,
        status TEXT DEFAULT 'request_sent',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (buyer_id) REFERENCES users (telegram_id),
        FOREIGN KEY (seller_id) REFERENCES users (telegram_id),
        FOREIGN KEY (service_id) REFERENCES services (id)
      )
    `);

    // Reviews table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        buyer_id INTEGER,
        seller_id INTEGER,
        rating INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders (id),
        FOREIGN KEY (buyer_id) REFERENCES users (telegram_id),
        FOREIGN KEY (seller_id) REFERENCES users (telegram_id)
      )
    `);
  }

  // User methods
  createUser(telegramId, name, username, role) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO users (telegram_id, name, username, role) VALUES (?, ?, ?, ?)',
        [telegramId, name, username, role],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  getUser(telegramId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE telegram_id = ?',
        [telegramId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  // Service methods
  createService(sellerId, title, description, netPrice, deliveryTime, paymentMethod) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO services (seller_id, title, description, net_price, delivery_time, payment_method) VALUES (?, ?, ?, ?, ?, ?)',
        [sellerId, title, description, netPrice, deliveryTime, paymentMethod],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  searchServices(keyword, limit = 5) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*, u.name as seller_name, u.username as seller_username,
               COALESCE(AVG(r.rating), 0) as avg_rating,
               COUNT(r.rating) as review_count
        FROM services s
        JOIN users u ON s.seller_id = u.telegram_id
        LEFT JOIN reviews r ON r.seller_id = s.seller_id
        WHERE s.title LIKE ? OR s.description LIKE ?
        GROUP BY s.id
        ORDER BY s.is_promoted DESC, s.created_at DESC
        LIMIT ?
      `;
      this.db.all(query, [`%${keyword}%`, `%${keyword}%`, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  browseServices(limit = 5) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*, u.name as seller_name, u.username as seller_username,
               COALESCE(AVG(r.rating), 0) as avg_rating,
               COUNT(r.rating) as review_count
        FROM services s
        JOIN users u ON s.seller_id = u.telegram_id
        LEFT JOIN reviews r ON r.seller_id = s.seller_id
        GROUP BY s.id
        ORDER BY s.is_promoted DESC, avg_rating DESC, s.created_at DESC
        LIMIT ?
      `;
      this.db.all(query, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Order methods
  createOrder(buyerId, sellerId, serviceId, transactionId, netAmount, totalAmount, requirements = '') {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO orders (buyer_id, seller_id, service_id, transaction_id, net_amount, total_amount, buyer_requirements) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [buyerId, sellerId, serviceId, transactionId, netAmount, totalAmount, requirements],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  updateOrderQuote(orderId, customPrice, sellerQuote) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE orders SET custom_price = ?, seller_quote = ?, status = ? WHERE id = ?',
        [customPrice, sellerQuote, 'quote_sent', orderId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  getOrder(orderId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM orders WHERE id = ?',
        [orderId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  updateOrderStatus(orderId, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE orders SET status = ? WHERE id = ?',
        [status, orderId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  getUserOrders(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  getUserServices(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM services WHERE seller_id = ? ORDER BY created_at DESC',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  getSellerStats(sellerId) {
    return new Promise((resolve, reject) => {
      const queries = {
        totalOrders: 'SELECT COUNT(*) as count FROM orders WHERE seller_id = ?',
        completedOrders: 'SELECT COUNT(*) as count FROM orders WHERE seller_id = ? AND status = "completed"',
        pendingOrders: 'SELECT COUNT(*) as count FROM orders WHERE seller_id = ? AND status IN ("request_sent", "quote_sent", "quote_accepted")',
        totalEarned: 'SELECT SUM(custom_price) as total FROM orders WHERE seller_id = ? AND status = "completed"',
        avgRating: 'SELECT AVG(rating) as avg FROM reviews WHERE seller_id = ?',
        totalReviews: 'SELECT COUNT(*) as count FROM reviews WHERE seller_id = ?',
        activeServices: 'SELECT COUNT(*) as count FROM services WHERE seller_id = ?',
        monthlyOrders: 'SELECT COUNT(*) as count FROM orders WHERE seller_id = ? AND strftime("%Y-%m", created_at) = strftime("%Y-%m", "now")'
      };

      const stats = {};
      const promises = Object.keys(queries).map(key => 
        new Promise((res, rej) => {
          this.db.get(queries[key], [sellerId], (err, row) => {
            if (err) rej(err);
            else {
              stats[key] = row.count || row.total || row.avg || 0;
              res();
            }
          });
        })
      );

      Promise.all(promises)
        .then(() => resolve(stats))
        .catch(reject);
    });
  }

  // Review methods
  createReview(orderId, buyerId, sellerId, rating) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO reviews (order_id, buyer_id, seller_id, rating) VALUES (?, ?, ?, ?)',
        [orderId, buyerId, sellerId, rating],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  // Promotion methods
  promoteService(serviceId, expirationDate) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE services SET is_promoted = 1, promotion_expires = ? WHERE id = ?',
        [expirationDate, serviceId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // Admin stats
  getStats() {
    return new Promise((resolve, reject) => {
      const queries = [
        'SELECT COUNT(*) as total_users FROM users',
        'SELECT COUNT(*) as total_orders FROM orders',
        'SELECT COUNT(*) as active_sellers FROM users WHERE role IN ("Seller", "Both")',
        'SELECT COUNT(*) as total_services FROM services'
      ];

      Promise.all(queries.map(query => 
        new Promise((res, rej) => {
          this.db.get(query, (err, row) => {
            if (err) rej(err);
            else res(row);
          });
        })
      )).then(results => {
        resolve({
          totalUsers: results[0].total_users,
          totalOrders: results[1].total_orders,
          activeSellers: results[2].active_sellers,
          totalServices: results[3].total_services
        });
      }).catch(reject);
    });
  }
}

module.exports = Database;