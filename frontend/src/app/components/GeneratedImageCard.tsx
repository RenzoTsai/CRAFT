'use client';

import React, { useRef, useEffect } from 'react';

interface TransformativeCharacter {
  name: string;
  description_in_scene: string;
  status: string;
}

interface GeneratedImageCardProps {
  imageBase64: string | null;
  transformativeScene: string;
  plot: string;
  transformativeCharacters: (string | TransformativeCharacter)[];
  cardOpacity: number;
}

const GeneratedImageCard: React.FC<GeneratedImageCardProps> = ({
  imageBase64,
  transformativeScene,
  plot,
  transformativeCharacters,
  cardOpacity,
}) => {
  // Add ref for the text content
  const textRef = useRef<HTMLDivElement>(null);

  // Scroll to top whenever the content changes
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = 0;
    }
  }, [transformativeScene, plot, transformativeCharacters]);


  useEffect(() => {
    const startDelay = 15000; 
    const scrollStep = 1; 
    const scrollInterval = 100;

    let intervalId: NodeJS.Timeout | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    timeoutId = setTimeout(() => {
      if (!textRef.current) return;
      intervalId = setInterval(() => {
        const el = textRef.current!;
        if (el.scrollTop + el.clientHeight < el.scrollHeight) {
          el.scrollTop = Math.min(el.scrollTop + scrollStep, el.scrollHeight - el.clientHeight);
        } else {
          // if (intervalId) clearInterval(intervalId);
        }
      }, scrollInterval);
    }, startDelay);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [transformativeScene, plot, transformativeCharacters]);

  return (
    <div
      className="min-w-0 transition-opacity duration-200"
      style={{ opacity: cardOpacity }}
    >
      <div className="craft-transformation-card bg-black/80 backdrop-blur-md
                      rounded-lg p-6
                      text-green-400 shadow-xl border border-green-500 gap-6">

        {/* Left side (text content) */}
        <div className="craft-transformation-text flex min-w-0 flex-col overflow-y-auto pr-2" ref={textRef}>
          <h3 className="text-xl sm:text-2xl font-bold mb-4">Transformation</h3>

          

          <div className="mb-5">
            <div className="mb-3 text-base uppercase tracking-wide font-semibold">Scene</div>
            <p className="text-lg leading-relaxed">{transformativeScene}</p>
          </div>

          {plot && (
            <div className="mb-5">
              <div className="mb-3 text-base uppercase tracking-wide font-semibold">Plot</div>
              <p className="text-lg leading-relaxed">{plot}</p>
            </div>
          )}

          {transformativeCharacters.length > 0 && (
            <div className="mb-5">
              <div className="mb-3 text-base uppercase tracking-wide font-semibold">Characters</div>
              <ul className="list-disc pl-6 text-base leading-relaxed">
                {transformativeCharacters.map((character, index) => (
                  <li key={index}>
                    {typeof character === 'string' ? (
                      character
                    ) : (
                      <div>
                        <strong>{character.name}:</strong> {character.description_in_scene}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right side (image or empty placeholder) */}
        <div className="min-w-0 flex flex-col items-center justify-center">
          {imageBase64 ? (
            <img
              src={imageBase64}
              alt="Generated sci-fi scene"
              className="max-w-full max-h-[215px] rounded-md border border-green-500 shadow-lg"
            />
          ) : (
            <div className="w-full h-[200px] rounded-md border border-green-500 flex items-center justify-center">
              <p className="text-green-400 text-opacity-50 text-base">Loading Image</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeneratedImageCard;

<style jsx>{`
  .hide-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .hide-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
`}</style>
