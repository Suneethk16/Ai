import React, { useState } from 'react';
import db from '../services/database';

const MindMap = ({ data, user }) => {
  const [expandedConcepts, setExpandedConcepts] = useState({});

  const toggleConcept = (index) => {
    setExpandedConcepts(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
    
    // Log mindmap interaction
    if (user) {
      db.logActivity(user.id, 'mindmap_expand', {
        conceptIndex: index,
        concept: data[index].concept,
        expanded: !expandedConcepts[index],
        timestamp: new Date().toISOString()
      });
    }
  };

  const mainTopic = data.length > 0 ? data[0].concept : 'Main Topic';

  return (
    <div className="flex flex-col items-center">
      <div className="relative p-6 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full shadow-2xl mb-12">
        <p className="text-2xl font-bold">{mainTopic}</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {data.map((concept, index) => (
          <div key={index} className="relative">
            <div 
              className="bg-white p-6 rounded-2xl shadow-lg border-l-4 border-purple-400 cursor-pointer transform transition-all duration-300 hover:scale-105"
              onClick={() => toggleConcept(index)}
            >
              <div className="flex justify-between items-center">
                <p className="font-bold text-lg text-purple-700">{concept.concept}</p>
                <span className="text-purple-500 text-xl">
                  {expandedConcepts[index] ? '−' : '+'}
                </span>
              </div>
              
              {expandedConcepts[index] && (
                <div className="mt-4 space-y-2">
                  {concept.related_concepts.map((related, rIndex) => (
                    <div 
                      key={rIndex} 
                      className="bg-purple-50 p-3 rounded-lg text-gray-700 border-l-2 border-purple-300"
                    >
                      {related}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Connection line to center */}
            <div className="absolute top-1/2 -left-4 w-4 h-0.5 bg-purple-300 hidden md:block"></div>
          </div>
        ))}
      </div>
      
      <div className="mt-8 text-center text-sm text-gray-500">
        Click on concepts to expand related topics
      </div>
    </div>
  );
};

export default MindMap;
