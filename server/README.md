# PostgreSQL Setup Instructions

## 1. Install PostgreSQL
```bash
# macOS
brew install postgresql
brew services start postgresql

# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

## 2. Create Database
```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE ai_study_companion;
CREATE USER your_username WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ai_study_companion TO your_username;
\q
```

## 3. Update Environment Variables
Edit `server/.env`:
```
DATABASE_URL=postgresql://your_username:your_password@localhost:5432/ai_study_companion
PORT=3001
```

## 4. Install Dependencies & Run
```bash
cd server
npm install
npm start
```

## 5. Run Frontend
```bash
cd ..
npm run dev
```

Your app will now use PostgreSQL database!