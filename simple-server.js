import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
const PORT = 3001;

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// Simple file-based storage
const DATA_FILE = './data.json';

const readData = () => {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: {}, activities: [] };
  }
};

const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// Register user
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  const data = readData();
  
  const existingUser = Object.values(data.users).find(u => u.username === username);
  if (existingUser) {
    return res.status(400).json({ success: false, error: 'Username already exists' });
  }
  
  const userId = Date.now().toString();
  data.users[userId] = {
    id: userId,
    username,
    email,
    password,
    created_at: new Date().toISOString(),
    last_login: null
  };
  
  writeData(data);
  res.json({ success: true, user: data.users[userId] });
});

// Login user
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = readData();
  
  const user = Object.values(data.users).find(u => u.username === username && u.password === password);
  if (user) {
    user.last_login = new Date().toISOString();
    writeData(data);
    res.json({ success: true, user });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// Log activity
app.post('/api/activity', (req, res) => {
  const { userId, action, data: activityData } = req.body;
  const data = readData();
  
  data.activities.push({
    id: Date.now().toString(),
    user_id: userId,
    action,
    data: activityData,
    timestamp: new Date().toISOString()
  });
  
  writeData(data);
  res.json({ success: true });
});

// Get users
app.get('/api/users', (req, res) => {
  const data = readData();
  res.json({ success: true, users: Object.values(data.users) });
});

// Get activities
app.get('/api/activities', (req, res) => {
  const data = readData();
  res.json({ success: true, activities: data.activities });
});

app.listen(PORT, () => {
  console.log(`Simple server running on port ${PORT}`);
});