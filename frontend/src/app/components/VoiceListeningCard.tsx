//frontend/src/app/components/VoiceListeningCard.tsx
'use client';

import React from 'react';

interface VoiceListeningCardProps {
  visible: boolean;
  docked?: boolean;
  currentTranscription?: string; // New prop for real-time transcription
}

export default function VoiceListeningCard({
  visible,
  docked = false,
  currentTranscription = '', // Default to empty string
}: VoiceListeningCardProps) {
  if (!visible) return null;

  const containerClasses = `${docked ? 'craft-roleplay-listening min-w-0 w-full' : 'absolute top-20 right-10 w-64'} bg-black border-2 border-green-500 rounded-lg p-3`;

  return (
    <div className={containerClasses}>
      <div className="text-green-500 font-semibold mb-2">Voice Input:</div>
      <div className="mb-2 text-green-500">I am listening...</div>

      {/* Real-time transcription display */}
      {currentTranscription && (
        <div className="mt-3">
          <div className="text-green-500 font-semibold mb-2">Current transcription:</div>
          <div className="text-white italic max-h-full overflow-auto break-words">{currentTranscription}</div>
        </div>
      )}
    </div>
  );
}