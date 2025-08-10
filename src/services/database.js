// PostgreSQL database service
class DatabaseService {
  constructor() {
    this.baseURL = process.env.NODE_ENV === 'production' 
      ? '/api'
      : 'http://localhost:3002/api';
  }

  async createUser(username, email, password) {
    const response = await fetch(`${this.baseURL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.user.id;
  }

  async loginUser(username, password) {
    const response = await fetch(`${this.baseURL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await response.json();
    return result.success ? result.user : null;
  }

  async logActivity(userId, action, data) {
    await fetch(`${this.baseURL}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action, data })
    });
  }

  async getUserActivities(userId) {
    const response = await fetch(`${this.baseURL}/activities/${userId}`);
    const result = await response.json();
    return result.success ? result.activities : [];
  }

  async getUsers() {
    const response = await fetch(`${this.baseURL}/users`);
    const result = await response.json();
    return result.success ? result.users : [];
  }

  async getActivities() {
    const response = await fetch(`${this.baseURL}/activities`);
    const result = await response.json();
    return result.success ? result.activities : [];
  }
}

export default new DatabaseService();