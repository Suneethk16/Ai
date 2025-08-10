import React, { useState, useEffect } from 'react';
import { Database, Users, Activity } from 'lucide-react';
import db from '../services/database';

const AdminPanel = ({ onClose }) => {
  const [users, setUsers] = useState({});
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [usersData, activitiesData] = await Promise.all([
          db.getUsers(),
          db.getActivities()
        ]);
        setUsers(usersData.reduce((acc, user) => ({ ...acc, [user.id]: user }), {}));
        setActivities(activitiesData);
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };
    loadData();
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="text-purple-600" />
            Database Admin Panel
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Users Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="text-blue-600" size={20} />
              Users ({Object.keys(users).length})
            </h3>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {Object.values(users).map(user => (
                <div key={user.id} className="bg-gray-50 p-3 rounded-lg">
                  <p><strong>Username:</strong> {user.username}</p>
                  <p><strong>Email:</strong> {user.email}</p>
                  <p><strong>Created:</strong> {new Date(user.created_at).toLocaleDateString()}</p>
                  <p><strong>Last Login:</strong> {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Activities Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Activity className="text-green-600" size={20} />
              Activities ({activities.length})
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {activities.slice(0, 10).map(activity => (
                <div key={activity.id} className="bg-gray-50 p-2 rounded text-sm">
                  <p><strong>{activity.action}</strong></p>
                  <p>User: {activity.username || users[activity.user_id]?.username || 'Unknown'}</p>
                  <p>{new Date(activity.timestamp).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-4">
          <button 
            onClick={() => {
              localStorage.clear();
              setUsers({});
              setActivities([]);
            }}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            Clear All Data
          </button>
          <button 
            onClick={() => {
              const data = { users, activities };
              console.log('Database Export:', data);
              alert('Data exported to console');
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Export Data
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;