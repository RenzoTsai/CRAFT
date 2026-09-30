//frontend/src/app/components/PhotoCard.tsx
'use client';

import React from 'react';

interface PhotoCardProps {
  photo: string | null;
  photoTranscription: string;
  photoCardOpacity: number;
  answer?: string;
}

export default function PhotoCard({
  photo,
  photoTranscription,
  photoCardOpacity,
  answer,
}: PhotoCardProps) {
  // if (!photo) return null;

  const containerClasses = "absolute top-20 right-10 bg-black border-2 border-green-500 rounded-lg p-3 w-64 transition-opacity duration-200";

  return (
    <div
      className={containerClasses}
      style={{ opacity: photoCardOpacity }}
    >
      {/* Answer Section */}
      {answer && (
        <div className="mb-4 p-3 bg-gray-800 bg-opacity-80 rounded-lg border border-cyan-400 flex-shrink-0">
          <div className="text-cyan-400 font-semibold mb-2">💡 Answer:</div>
          <div className="text-white text-sm">{answer}</div>
        </div>
      )}

      <div className="text-green-500 font-semibold mb-2 flex-shrink-0">Any Comments?</div>
      {photo && (
        <div className="flex-grow rounded overflow-hidden mb-2">
            <img src={photo} alt="Captured" className="w-full h-full object-cover" />
        </div>
      )}
      {photoTranscription ? (
        <div className="text-white mt-2 flex-shrink-0">
          <strong>You said:</strong> {photoTranscription}
        </div>
      ) : (
        <div className="text-gray-400 text-sm italic flex-shrink-0">Listening...</div>
      )}
    </div>
  );
}
