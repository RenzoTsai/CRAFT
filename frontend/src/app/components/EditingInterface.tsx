'use client';

import React, { useState, useEffect } from 'react';
import { Button, Typography } from '@mui/material';

interface EditingInterfaceProps {
  isVisible: boolean;
  onClose: () => void;
  aiGeneratedContent: string;
  savedContent: string;
  onGenerateNew: () => void;
  onSaveAndUpdate: (content: string) => void;
  onRegenerateWithFeedback: (originalContent: string, feedback: string) => void;
  onShowPlot: () => void;
  isGenerating: boolean;
}

const EditingInterface: React.FC<EditingInterfaceProps> = ({
  isVisible,
  onClose,
  aiGeneratedContent,
  savedContent,
  onGenerateNew,
  onSaveAndUpdate,
  onRegenerateWithFeedback,
  onShowPlot,
  isGenerating,
}) => {
  const [editableContent, setEditableContent] = useState(savedContent);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setEditableContent(savedContent);
  }, [savedContent]);

  const handleSaveAndUpdate = () => {
    onSaveAndUpdate(editableContent);
  };

  const handleRegenerateWithFeedback = () => {
    if (feedback.trim()) {
      onRegenerateWithFeedback(aiGeneratedContent, feedback);
      setFeedback('');
    }
  };

  if (!isVisible) return null;

  

  // Original fullscreen overlay
  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
      <div className="craft-editor w-full max-w-7xl h-5/6 min-h-0 overflow-hidden bg-gray-900 rounded-lg border border-green-500 flex flex-col" role="dialog" aria-modal="true" aria-label="Story Editing Interface">
        {/* Header */}
        <div className="p-4 shrink-0 border-b border-green-500 flex justify-between items-center gap-3">
          <Typography variant="h6" className="text-green-400">
            Story Editing Interface
          </Typography>
          <div className="flex items-center gap-3">
            <Button
              onClick={onShowPlot}
              variant="contained"
              sx={{
                backgroundColor: '#10b981',
                color: 'white',
                '&:hover': { backgroundColor: '#059669' },
                textTransform: 'none',
                fontWeight: 600,
                px: 3
              }}
            >
              SHOW PLOT
            </Button>
            <Button
              onClick={onClose}
              className="text-blue-400 hover:text-blue-300"
              variant="text"
              sx={{ color: '#60a5fa', '&:hover': { color: '#93c5fd' } }}
            >
              CLOSE
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="craft-editor-columns flex-1 min-h-0 grid">
          {/* Left Side - AI Generated Content */}
          <div className="craft-editor-column min-w-0 min-h-0 p-4 border-r border-green-500 flex flex-col">
            <div className="mb-4 flex-1 min-h-0 flex flex-col">
              <Typography variant="h6" className="text-green-400 mb-2 shrink-0">
                AI Generated Content
              </Typography>
              <div
                className="flex-1 min-h-0 p-4 rounded overflow-auto break-words"
                style={{ 
                  backgroundColor: '#1f2937',
                  border: '1px solid #4b5563',
                  color: '#f9fafb'
                }}
              >
                <Typography
                  variant="body1"
                  className="whitespace-pre-wrap"
                  style={{ 
                    fontSize: '14px', 
                    lineHeight: '1.6',
                    color: '#f9fafb'
                  }}
                >
                  {aiGeneratedContent || 'No AI generated content available. Click "Generate New Content" to create new content based on your recent interactions.'}
                </Typography>
              </div>
            </div>
            
            {/* Left Side Button */}
            <Button
              variant="contained"
              onClick={onGenerateNew}
              disabled={isGenerating}
              fullWidth
              sx={{
                backgroundColor: '#2563eb',
                color: 'white',
                py: 2,
                flexShrink: 0,
                '&:hover': { backgroundColor: '#1d4ed8' },
                '&:disabled': { backgroundColor: '#374151', color: '#9ca3af' },
                textTransform: 'none',
                fontWeight: 600
              }}
            >
              {isGenerating ? 'Generating...' : 'GENERATE NEW CONTENT BASED ON NEW INTERACTIONS'}
            </Button>
          </div>

          {/* Middle - Feedback Input */}
          <div className="craft-editor-column min-w-0 min-h-0 p-4 border-r border-green-500 flex flex-col">
            <div className="mb-4 flex-1 min-h-0 flex flex-col">
              <Typography variant="h6" className="text-green-400 mb-2 shrink-0">
                Modification Feedback
              </Typography>
              <textarea
                aria-label="Modification Feedback"
                value={feedback}
                onChange={event => setFeedback(event.target.value)}
                placeholder={"Enter your modification suggestions here...\n\nExamples:\n- Make the story more dramatic\n- Change the character's personality\n- Add more dialogue\n- Adjust the pacing\n- Modify the ending"}
                className="craft-editor-input focus:border-amber-500"
              />
            </div>
            
            {/* Middle Button */}
            <Button
              variant="contained"
              onClick={handleRegenerateWithFeedback}
              disabled={isGenerating || !feedback.trim()}
              fullWidth
              sx={{
                backgroundColor: '#f59e0b',
                color: 'white',
                py: 2,
                flexShrink: 0,
                '&:hover': { backgroundColor: '#d97706' },
                '&:disabled': { backgroundColor: '#374151', color: '#9ca3af' },
                textTransform: 'none',
                fontWeight: 600
              }}
            >
              {isGenerating ? 'Regenerating...' : 'REGENERATE WITH FEEDBACK'}
            </Button>
          </div>

          {/* Right Side - Editable Saved Content */}
          <div className="craft-editor-column min-w-0 min-h-0 p-4 flex flex-col">
            <div className="mb-4 flex-1 min-h-0 flex flex-col">
              <Typography variant="h6" className="text-green-400 mb-2 shrink-0">
                Your Saved Content
              </Typography>
              <textarea
                aria-label="Your Saved Content"
                value={editableContent}
                onChange={event => setEditableContent(event.target.value)}
                placeholder="Your saved story content will appear here. Edit and modify as needed..."
                className="craft-editor-input focus:border-emerald-500"
              />
            </div>
            
            {/* Right Side Button */}
            <Button
              variant="contained"
              onClick={handleSaveAndUpdate}
              fullWidth
              sx={{
                backgroundColor: '#2563eb',
                color: 'white',
                py: 2,
                flexShrink: 0,
                '&:hover': { backgroundColor: '#1d4ed8' },
                textTransform: 'none',
                fontWeight: 600
              }}
            >
              SAVE AND UPDATE CONTEXT
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditingInterface;  