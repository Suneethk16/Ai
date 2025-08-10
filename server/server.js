import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import pool, { initDB } from './database.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Initialize database
await initDB();

// User registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, hashedPassword]
    );
    
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// User login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    
    if (user && await bcrypt.compare(password, user.password)) {
      await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
      res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
    } else {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Log activity
app.post('/api/activity', async (req, res) => {
  try {
    const { userId, action, data } = req.body;
    
    await pool.query(
      'INSERT INTO activities (user_id, action, data) VALUES ($1, $2, $3)',
      [userId, action, JSON.stringify(data)]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get user activities
app.get('/api/activities/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM activities WHERE user_id = $1 ORDER BY timestamp DESC',
      [userId]
    );
    
    res.json({ success: true, activities: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all users (admin)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, created_at, last_login FROM users');
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all activities (admin)
app.get('/api/activities', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.username 
      FROM activities a 
      JOIN users u ON a.user_id = u.id 
      ORDER BY a.timestamp DESC 
      LIMIT 100
    `);
    res.json({ success: true, activities: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});