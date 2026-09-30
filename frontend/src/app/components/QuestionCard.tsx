//frontend/src/app/components/QuestionCard.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';

interface TransformativeCharacter {
  name: string;
  description_in_scene: string;
  status: string;
}

interface QuestionCardProps {
  questionText: string;
  transformativeScene: string;
  plot: string;
  transformativeCharacters: (string | TransformativeCharacter)[];
  answer?: string;
  questionCardOpacity: number;
  onSpeechEnd?: () => void;
  onSpeechProgress?: (current: number, total: number) => void;
  isMuted?: boolean;
  currentTranscription?: string; // New prop for real-time transcription
  isRecording?: boolean;
}

export default function QuestionCard({
  questionText,
  transformativeScene,
  plot,
  transformativeCharacters,
  answer,
  questionCardOpacity,
  onSpeechEnd,
  onSpeechProgress,
  isMuted = false,
  currentTranscription = '', // Default to empty string
  isRecording = false,
}: QuestionCardProps) {
  
  // Helper function to convert characters to string for speech generation
  const charactersToString = (characters: (string | TransformativeCharacter)[]): string => {
    return characters.map(character => 
      typeof character === 'string' ? character : `${character.name}: ${character.description_in_scene}`
    ).join(', ');
  };
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<string[]>([]);
  const currentAudioIndexRef = useRef(0);
  const speechCompletedRef = useRef(false);

  // Create a stable ID for the current text content to prevent duplicate generation
  const contentIdRef = useRef("");

  // Function to generate speech using OpenAI TTS
  const generateSpeech = async (text: string): Promise<string | null> => {
    try {
      console.log(`Generating speech for: "${text}"`);

      const response = await fetch('/api/generate-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          voice: 'nova',
          model: 'tts-1',
          speed: 1.0, // Add explicit speed parameter
          instructions: 'Speak in a natural, engaging tone. Sound interested in the content.'
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`API error: ${response.status}`, errorData);
        return null;
      }

      // Get the audio blob from the response
      const audioBlob = await response.blob();

      // Create a URL for the blob
      return URL.createObjectURL(audioBlob);
    } catch (error) {
      console.error('Speech generation error:', error);
      return null;
    }
  };

  // Function to prepare all audio content
  const prepareAudio = async () => {
    // Prevent concurrent generation
    if (isGenerating) {
      console.log("Already generating audio, skipping");
      return;
    }

    // If already completed or muted, don't generate audio
    if (speechCompletedRef.current || isMuted) {
      console.log("Speech already completed or muted, skipping generation");
      if (isMuted && onSpeechEnd && !speechCompletedRef.current) {
        speechCompletedRef.current = true;
        onSpeechEnd();
      }
      return;
    }

    // Create a content ID to check for duplicates
    const newContentId = `${answer}|${transformativeScene}|${plot}|${charactersToString(transformativeCharacters)}|${questionText}`;
    if (contentIdRef.current === newContentId) {
      console.log("Content unchanged, using existing audio");
      if (audioUrlsRef.current.length > 0 && !isPlaying) {
        // If we have audio but it's not playing, start playback
        currentAudioIndexRef.current = 0;
        playNextAudio();
      }
      return;
    }

    // Update content ID and mark as generating
    contentIdRef.current = newContentId;
    setIsGenerating(true);

    // Clean up any previous audio URLs
    audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    audioUrlsRef.current = [];
    currentAudioIndexRef.current = 0;

    // Generate speech for each text segment
    console.log("Generating new audio for updated content");
    setIsGenerating(true);
    
    const textSegments = [
      answer,
      transformativeScene,
      plot,
      charactersToString(transformativeCharacters),
      questionText
    ].filter((text): text is string => Boolean(text)); // Filter out empty strings

    const audioPromises = textSegments.map(async (text, index) => {
      console.log(`Generating speech for segment ${index + 1}: "${text.substring(0, 50)}..."`);
      const audioUrl = await generateSpeech(text);
      if (!audioUrl) {
        console.warn(`Failed to generate audio for segment ${index + 1}`);
      }
      return audioUrl;
    });

    try {
      const newAudioUrls = await Promise.all(audioPromises);
      
      // Filter out null/invalid URLs
      const validAudioUrls = newAudioUrls.filter((url): url is string => url !== null && url !== 'null' && url !== '');
      
      if (validAudioUrls.length === 0) {
        console.warn("No valid audio URLs generated, completing speech without audio");
    setIsGenerating(false);
        if (onSpeechEnd && !speechCompletedRef.current) {
          speechCompletedRef.current = true;
          onSpeechEnd();
        }
        return;
      }
      
      // Clean up previous audio URLs
      audioUrlsRef.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn("Error revoking URL:", e);
        }
      });

      audioUrlsRef.current = validAudioUrls;
      contentIdRef.current = newContentId;
      currentAudioIndexRef.current = 0;
      setIsGenerating(false);

      console.log(`Starting playback of ${validAudioUrls.length} audio segments`);
      playNextAudio();
    } catch (error) {
      console.error('Error preparing audio:', error);
      setIsGenerating(false);
      // Complete speech even if audio generation failed
      if (onSpeechEnd && !speechCompletedRef.current) {
      speechCompletedRef.current = true;
      onSpeechEnd();
      }
    }
  };

  // Function to play the next audio in the queue
  const playNextAudio = () => {
    if (!audioRef.current) return;

    if (currentAudioIndexRef.current < audioUrlsRef.current.length) {
      const audioUrl = audioUrlsRef.current[currentAudioIndexRef.current];
      
      // Check if the audio URL is valid
      if (!audioUrl || audioUrl === 'null' || audioUrl === '') {
        console.warn(`Invalid audio URL at segment ${currentAudioIndexRef.current + 1}, skipping`);
        handleAudioEnded(); // Skip to next segment
        return;
      }

      console.log(`Playing audio segment ${currentAudioIndexRef.current + 1}/${audioUrlsRef.current.length}`);

      // Report progress to parent component
      if (onSpeechProgress) {
        onSpeechProgress(currentAudioIndexRef.current + 1, audioUrlsRef.current.length);
      }

      // Set up the audio element with Safari-specific handling
      audioRef.current.onended = handleAudioEnded;
      audioRef.current.onerror = handleAudioError;
      
      // Safari-specific audio loading
      if (typeof navigator !== 'undefined' && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
        console.log("Safari detected - using enhanced audio loading");
        audioRef.current.preload = 'auto';
        audioRef.current.src = audioUrl;
        audioRef.current.load(); // Force Safari to load the audio
        
        // Wait a bit for Safari to load the audio
        const safariLoadTimeout = setTimeout(() => {
          console.log("Safari load timeout, proceeding with playback");
        }, 200);
        
        audioRef.current.onloadeddata = () => {
          clearTimeout(safariLoadTimeout);
          console.log("Safari audio loaded successfully");
        };
      } else {
        audioRef.current.src = audioUrl;
      }

      // Play the audio with Safari-specific handling
      const playPromise = audioRef.current.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log(`Audio segment ${currentAudioIndexRef.current + 1} started successfully`);
            setIsPlaying(true);
          })
          .catch(error => {
            console.warn('Audio playback failed:', error);
            
            // Safari-specific retry logic
            if (typeof navigator !== 'undefined' && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
              console.log("Safari audio failed, attempting retry with delay");
              setTimeout(() => {
                if (audioRef.current && audioRef.current.src) {
                  audioRef.current.load(); // Reload the audio element
                  audioRef.current.play()
                    .then(() => {
                      console.log("Safari retry successful");
                      setIsPlaying(true);
                    })
                    .catch(retryError => {
                      console.warn("Safari retry also failed:", retryError);
                      handleAudioEnded(); // Continue to next audio
                    });
                }
              }, 100);
            } else {
              handleAudioEnded(); // Try to continue to next audio
            }
          });
      } else {
        // Fallback for older browsers
        setIsPlaying(true);
      }
    } else {
      // We've played all audio segments
      console.log("All audio segments completed");
      setIsPlaying(false);

      if (!speechCompletedRef.current) {
        speechCompletedRef.current = true;

        // Call the callback to start fading
        if (onSpeechEnd) {
          console.log("Calling onSpeechEnd callback");
          onSpeechEnd();
        }
      }
    }
  };

  // Handle audio ended event
  const handleAudioEnded = () => {
    console.log(`Audio segment ${currentAudioIndexRef.current + 1} ended`);
    currentAudioIndexRef.current++;
    playNextAudio();
  };

  // Handle audio error event
  const handleAudioError = (e: string | Event) => {
    // Only log meaningful errors, not empty objects
    if (e && (typeof e === 'string' || Object.keys(e).length > 0)) {
      console.warn(`Audio playback issue in segment ${currentAudioIndexRef.current + 1}:`, e);
    } else {
      console.warn(`Audio playback issue in segment ${currentAudioIndexRef.current + 1}: Audio source may be invalid`);
    }
    
    // If there are more audio segments, try to continue
    if (currentAudioIndexRef.current < audioUrlsRef.current.length - 1) {
    handleAudioEnded(); // Try to continue to next audio
    } else {
      // If this was the last segment or there are no more segments, complete the speech
      console.log("Audio error on last segment, completing speech");
      setIsPlaying(false);
      if (onSpeechEnd && !speechCompletedRef.current) {
        speechCompletedRef.current = true;
        onSpeechEnd();
      }
    }
  };

  // Reset speech completed state when component unmounts or when content changes
  useEffect(() => {
    speechCompletedRef.current = false;
    currentAudioIndexRef.current = 0;
    return () => {
      speechCompletedRef.current = false;
    };
  }, [questionText, transformativeScene, plot, transformativeCharacters, answer]);

  // Initialize audio element and prepare audio
  useEffect(() => {
    // Create audio element if it doesn't exist
    if (!audioRef.current) {
      console.log("Creating audio element");
      audioRef.current = new Audio();
      
      // Safari-specific audio setup
      if (typeof navigator !== 'undefined' && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
        console.log("Safari detected - setting up audio with preload");
        audioRef.current.preload = 'auto';
        audioRef.current.muted = false;
        
        // Try to prime the audio context for Safari
        const primeAudio = () => {
          if (audioRef.current) {
            audioRef.current.play().then(() => {
              audioRef.current?.pause();
              audioRef.current!.currentTime = 0;
              console.log("Safari audio context primed");
            }).catch(e => {
              console.log("Safari audio priming failed (expected):", e.message);
            });
          }
        };
        
        // Prime on user interaction
        const primeOnInteraction = () => {
          primeAudio();
          document.removeEventListener('click', primeOnInteraction);
          document.removeEventListener('touchstart', primeOnInteraction);
        };
        
        document.addEventListener('click', primeOnInteraction);
        document.addEventListener('touchstart', primeOnInteraction);
      }
    }

    // Add global event listener for stopping audio
  const stopAudio = () => {
    console.log("QuestionCard received stop audio event - forcing stop");
    if (audioRef.current) {
      // Force stop audio playback
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = '';
      audioRef.current.load(); // Force reload to clear any buffered audio
      
      // Remove event listeners to prevent further callbacks
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      
      setIsPlaying(false);

      // Clean up any audio URLs
      audioUrlsRef.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn("Error revoking URL:", e);
        }
      });
      audioUrlsRef.current = [];
      currentAudioIndexRef.current = 0;
      
      // Reset speech completion state
      speechCompletedRef.current = true; // Mark as completed to prevent further processing
      setIsGenerating(false);
      
      console.log("QuestionCard audio forcefully stopped and cleaned up");
    }
  };

  window.addEventListener('stopAllAudio', stopAudio);

    // Only prepare audio if not muted and we have question text
    if (questionText && !isMuted) {
      prepareAudio();
    } else if (isMuted && onSpeechEnd && !speechCompletedRef.current) {
      // If muted, still trigger the speech end callback
      console.log("Muted, directly calling onSpeechEnd");
      speechCompletedRef.current = true;
      setTimeout(() => {
        if (onSpeechEnd) onSpeechEnd();
      }, 500);
    }

    // Cleanup function
    return () => {
      window.removeEventListener('stopAllAudio', stopAudio);
      console.log("Cleaning up QuestionCard audio resources");
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, [questionText, transformativeScene, plot, transformativeCharacters, isMuted, answer]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("Component unmounting, releasing all audio URLs");
      // Release object URLs
      audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      audioUrlsRef.current = [];

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
      }
    };
  }, []);

  if (!questionText) return null;

  const containerClasses = "craft-question-card flex min-w-0 flex-col bg-black border-2 border-green-500 rounded-lg p-3 transition-opacity duration-200";

  return (
    <div
      className={containerClasses}
      style={{ opacity: questionCardOpacity }}
    >
      <div className="flex-grow break-words">
        {/* Answer Section */}
        {answer && (
          <div className="mb-4 p-3 bg-gray-800 bg-opacity-80 rounded-lg border border-cyan-400">
            <div className="text-cyan-400 font-semibold mb-2">💡 Answer:</div>
            <div className="text-white text-sm">{answer}</div>
          </div>
        )}

        <div className="text-green-500 font-semibold mb-2">Question:</div>
        <div className="text-green-500 font-l mb-2">{questionText}</div>

        {/* Real-time transcription display */}
        {currentTranscription && (
          <>
            <div className="text-green-500 font-semibold mt-4 mb-2">Your response:</div>
            <div className="text-white mb-2 italic">{currentTranscription}</div>
          </>
        )}
      </div>

      <div className="text-gray-400 text-sm italic flex-shrink-0 mt-2">
        {isGenerating ? 'Preparing audio...' :
         isPlaying ? `Speaking (${currentAudioIndexRef.current + 1}/${audioUrlsRef.current.length})` :
         isRecording ? 'Listening for your answer...' :
         speechCompletedRef.current ? 'Press right to record your answer.' :
         'Loading...'}
      </div>
    </div>
  );
}
