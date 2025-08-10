import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

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

// API Routes
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

app.get('/api/users', (req, res) => {
  const data = readData();
  res.json({ success: true, users: Object.values(data.users) });
});

app.get('/api/activities', (req, res) => {
  const data = readData();
  res.json({ success: true, activities: data.activities });
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built. Run npm run build first.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});