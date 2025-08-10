import React from 'react';
import { Book, Lightbulb, Brain } from 'lucide-react';

const GeneratorForm = ({ topic, setTopic, loading, activeTab, setActiveTab, onGenerate }) => {
  return (
    <>
      <div className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-4 mb-8">
        <div className="relative flex-grow w-full">
          <input
            type="text"
            className="w-full p-4 pl-12 rounded-full border-2 border-purple-200 focus:outline-none focus:ring-4 focus:ring-purple-300 transition-all duration-300 text-lg"
            placeholder="E.g., The circulatory system"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onGenerate()}
          />
          <Book className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400" size={24} />
        </div>
        <button
          onClick={onGenerate}
          disabled={loading}
          className={`w-full md:w-auto px-8 py-4 rounded-full text-white font-bold text-lg transition-all duration-300 ease-in-out transform shadow-lg
            ${loading ? 'bg-purple-300 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 active:scale-95'}
          `}
        >
          {loading ? 'Generating...' : 'Generate'}
        </button>
      </div>
      
      <div className="flex justify-center mb-12">
        <div className="flex bg-gray-100 rounded-full p-1 shadow-inner">
          <button
            onClick={() => setActiveTab('quiz')}
            className={`flex-1 flex items-center justify-center py-2 px-6 rounded-full font-medium transition-all duration-300
              ${activeTab === 'quiz' ? 'bg-purple-500 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}
            `}
          >
            <Lightbulb size={20} className="mr-2" /> Quiz
          </button>
          <button
            onClick={() => setActiveTab('flashcards')}
            className={`flex-1 flex items-center justify-center py-2 px-6 rounded-full font-medium transition-all duration-300
              ${activeTab === 'flashcards' ? 'bg-purple-500 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}
            `}
          >
            <Book size={20} className="mr-2" /> Flashcards
          </button>
          <button
            onClick={() => setActiveTab('mindmap')}
            className={`flex-1 flex items-center justify-center py-2 px-6 rounded-full font-medium transition-all duration-300
              ${activeTab === 'mindmap' ? 'bg-purple-500 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}
            `}
          >
            <Brain size={20} className="mr-2" /> Mind Map
          </button>
        </div>
      </div>
    </>
  );
};

export default GeneratorForm;
