import React, { useState } from 'react';
import db from '../services/database';

const Flashcards = ({ data, user }) => {
  const [flippedCards, setFlippedCards] = useState({});

  const handleCardFlip = (index) => {
    setFlippedCards(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
    
    // Log flashcard interaction
    if (user) {
      db.logActivity(user.id, 'flashcard_flip', {
        cardIndex: index,
        term: data[index].term,
        flippedTo: !flippedCards[index] ? 'definition' : 'term',
        timestamp: new Date().toISOString()
      });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {data.map((card, index) => (
        <div 
          key={index} 
          className="bg-white rounded-2xl shadow-lg p-6 h-48 flex flex-col justify-between transform transition-all duration-300 hover:scale-105 cursor-pointer"
          onClick={() => handleCardFlip(index)}
        >
          <div className="flex-1 flex items-center justify-center text-center">
            {flippedCards[index] ? (
              <p className="text-gray-600 text-lg">{card.definition}</p>
            ) : (
              <p className="text-xl font-bold text-gray-800">{card.term}</p>
            )}
          </div>
          <div className="flex justify-between items-center mt-4">
            <span className="text-sm text-gray-400">Card {index + 1}</span>
            <span className="text-xs text-purple-500">
              {flippedCards[index] ? 'Definition' : 'Term'} • Click to flip
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default Flashcards;
