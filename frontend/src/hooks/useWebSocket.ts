// frontend/src/hooks/useWebSocket.js
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export const useWebSocket = () => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [gazePosition, setGazePosition] = useState<{ x: number; y: number } | null>(null);
  const [fixationDetected, setFixationDetected] = useState<boolean>(false);
  const [llmResponse, setLlmResponse] = useState<string>('');
  const [worldFrame, setWorldFrame] = useState<any>(null);
  const [lastPong, setLastPong] = useState<any>(null);
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  
  // Image generation states
  const [generatedImageBase64, setGeneratedImageBase64] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);

  // State for authoring question received from backend
  const [authoringQuestion, setAuthoringQuestion] = useState<string>('');

  const [systemNotification, setSystemNotification] = useState<string>('');
  const [suggestionMessage, setSuggestionMessage] = useState<{ message: string; timestamp: number } | null>(null);
  
  // Editing interface states
  const [aiGeneratedContent, setAiGeneratedContent] = useState<string>('');
  const [savedContent, setSavedContent] = useState<string>('');

  // Plot demonstration states
  const [plotData, setPlotData] = useState<any>(null);
  const [showPlotDemonstration, setShowPlotDemonstration] = useState<boolean>(false);

  // Reconnection state
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const maxReconnectAttempts = 5;

  // Refs for WebSocket and reconnection logic
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const interactionIdleRef = useRef<boolean | null>(null);
  const setInteractionIdle = useCallback((idle: boolean) => {
    interactionIdleRef.current = idle;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ command: 'interaction_state', payload: { idle } }));
    }
  }, []);

  // Exponential backoff for reconnection (reduced delays)
  const getReconnectDelay = useCallback((attempts: number) => {
    return Math.min(5000, Math.pow(2, attempts) * 500); // Max 5s, start with 500ms
  }, []);

  // Establish WebSocket connection
  const connectWebSocket = useCallback(() => {
    // Clear any existing reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    // Reset connection state
    setIsConnected(false);

    // Create new WebSocket connection
    const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/backend/ws`;
    const ws = new WebSocket(wsUrl);

    // Connection opened
    ws.onopen = () => {
      console.log('WebSocket connection established');
      setIsConnected(true);
      setReconnectAttempts(0);
      if (interactionIdleRef.current !== null) {
        ws.send(JSON.stringify({ command: 'interaction_state', payload: { idle: interactionIdleRef.current } }));
      }
    };

    // Connection closed
    ws.onclose = (event) => {
      console.log('WebSocket connection closed', event.code, event.reason);
      setIsConnected(false);
      setIsProcessing(false);
      setIsGeneratingImage(false);

      // Attempt reconnection with exponential backoff
      if (reconnectAttempts < maxReconnectAttempts) {
        const delay = getReconnectDelay(reconnectAttempts);
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectAttempts(prev => prev + 1);
          connectWebSocket();
        }, delay);
      } else {
        console.error('Max reconnection attempts reached');
      }
    };

    // Connection error
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      ws.close();
    };

    // Incoming message handler
    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // Update messages list
        setMessages((prev: any[]) => [...prev, data]);

        // Handle different message types
        switch (data.type) {
          case 'gaze':
            if (data.position) {
              setGazePosition({
                x: data.position[0],
                y: data.position[1]
              });
            }
            break;

          case 'photo_frame':
            if (data.frame) {
              setWorldFrame(data.frame);
              console.log('Captured photo frame:', data.frame);
            }
            break;

          case 'fixation':
            setFixationDetected(true);
            setTimeout(() => setFixationDetected(false), 500);
            break;

          case 'llm_stream':
          case 'pong':
            if (data.message) {
              console.log('LLM response:', data.message);
              setLlmResponse(data.message);
              setLastPong(data.message);
              
              // Clear processing state when receiving response
              setIsProcessing(false);

              try {
                const parsed = JSON.parse(data.message);
                
                // Handle plot demonstration mode
                if (parsed.mode === 'plot_demonstration') {
                  setPlotData(parsed);
                  setShowPlotDemonstration(true);
                }
                // Handle image generation response
                else if (parsed.mode === 'image_generation' && parsed.response) {
                  console.log('Received image generation response with base64 data');
                  setIsGeneratingImage(false);
                  if (parsed.response.imageBase64) {
                    setGeneratedImageBase64(parsed.response.imageBase64);
                  } else {
                    console.error('No image data in response:', parsed.response);
                    setSystemNotification('Image generation returned no image. Please try again.');
                  }
                }
                // Handle new content generation response
                else if (parsed.mode === 'new_content_generated' && parsed.response) {
                  console.log('Received new content generation response');
                  if (parsed.response.content) {
                    setAiGeneratedContent(parsed.response.content);
                  }
                }
              } catch (err) {
                // Not JSON or not a handled response type
                console.log('Not a handled response type or error parsing:', err);
              }
            }
            break;

          case 'world_frame':
            if (data.frame) {
              setWorldFrame(data.frame);
            }
            break;
          case 'photo_ack':
            clearLlmResponse();
            break;

          case 'authoring_question':
            if (data.question) {
              setAuthoringQuestion(data.question);
            }
            break;

            case 'notification':
              setSystemNotification(data.message);
              break;

            case 'suggestion':
              console.log('Suggestion message:', data.message);
              if (interactionIdleRef.current === true) {
                setSuggestionMessage({ message: data.message, timestamp: data.timestamp });
              }
              break;

          case 'error':
            setIsProcessing(false);
            setIsGeneratingImage(false);
            setSystemNotification(data.message || 'The request failed. Please try again.');
            break;

          case 'system':
            console.log('System message:', data.message);
            if (data.status === 'generating') {
              setIsGeneratingImage(true);
            }
            // Clear processing state for system messages
            setIsProcessing(false);
            break;

          case 'ai_generated_content':
            if (data.content) {
              setAiGeneratedContent(data.content);
            }
            // Clear processing state
            setIsProcessing(false);
            break;

          case 'saved_content':
            if (data.content) {
              setSavedContent(data.content);
            }
            // Clear processing state
            setIsProcessing(false);
            break;

          case 'content_generation_complete':
            // Handle completion of content generation
            console.log('Content generation completed');
            // Clear processing state
            setIsProcessing(false);
            break;

          case 'settings':
            if (data.pid) {
              setCurrentPid(data.pid);
              // Clear frontend state when PID changes
              setLlmResponse('');
              setGeneratedImageBase64(null);
              setAuthoringQuestion('');
              setSuggestionMessage({ message: '', timestamp: 0 });
              setSystemNotification('');
              setAiGeneratedContent('');
              setSavedContent('');
              // Clear recent messages to prevent conflicts
              recentMessages.current.clear();
            }
            if (data.response_language) setCurrentResponseLanguage(data.response_language);
            if (data.writing_style) setCurrentWritingStyle(data.writing_style);
            if (data.proactive_suggestion_priority) setCurrentProactiveSuggestionPriority(data.proactive_suggestion_priority);
            break;

          default:
            console.warn('Unhandled message type:', data.type);
            // Clear processing state for any unhandled message types
            setIsProcessing(false);
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    // Store WebSocket reference
    wsRef.current = ws;

    // Cleanup function
    return () => {
      // Clear reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Close WebSocket if open
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [reconnectAttempts, getReconnectDelay]);

  // Initial connection and cleanup
  useEffect(() => {
    const cleanup = connectWebSocket();
    return cleanup;
  }, [connectWebSocket]);

  // Track recent messages to prevent duplicates
  const recentMessages = useRef<Map<string, number>>(new Map());
  const MESSAGE_COOLDOWN = 2000; // 2 seconds cooldown between duplicate messages

  // Send message to WebSocket server
  const sendMessage = useCallback((command: string, payload: any = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        // Create message hash for duplicate detection
        const messageKey = `${command}_${JSON.stringify(payload)}`;
        const currentTime = Date.now();
        
        // Check for recent duplicate
        const lastSentTime = recentMessages.current.get(messageKey);
        if (lastSentTime && (currentTime - lastSentTime) < MESSAGE_COOLDOWN) {
          console.warn('Preventing duplicate message:', command);
          return false;
        }
        
        const message = JSON.stringify({
          command,
          payload,
          timestamp: currentTime
        });
        
        console.log('Sending WebSocket message:', command, 'at', new Date().toISOString());
        wsRef.current.send(message);
        
        // Set processing state for most commands (except some system commands)
        const processingCommands = [
          'text_input', 'authoring_submit', 'authoring_answer', 'user speaking',
          'generate_image', 'generate_new_content', 'regenerate_with_feedback',
          'save_and_update_context', 'select_moments'
        ];
        
        if (processingCommands.includes(command)) {
          setSystemNotification('');
          setIsProcessing(true);
          
          // Set a timeout to clear processing state after 30 seconds (fallback)
          setTimeout(() => {
            setIsProcessing(false);
          }, 30000);
        }
        
        // Store message timestamp
        recentMessages.current.set(messageKey, currentTime);
        
        // Clean up old entries (keep only recent messages)
        if (recentMessages.current.size > 50) {
          const entries = Array.from(recentMessages.current.entries());
          entries.sort((a, b) => b[1] - a[1]); // Sort by timestamp desc
          recentMessages.current = new Map(entries.slice(0, 30)); // Keep only 30 most recent
        }

        // Set image generation flag if generating image
        if (command === 'generate_image') {
          setIsGeneratingImage(true);
        }
        
        return true;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        return false;
      }
    } else {
      console.warn('WebSocket not connected, message not sent:', command, 'ReadyState:', wsRef.current?.readyState);
      
      // Try to reconnect if not already attempting
      if (wsRef.current?.readyState === WebSocket.CLOSED && reconnectAttempts < maxReconnectAttempts) {
        console.log('Attempting immediate reconnection...');
        connectWebSocket();
      }
      
      return false;
    }
  }, [connectWebSocket, reconnectAttempts, maxReconnectAttempts]);

  // Generate image based on photo and authoring data
  const generateImage = useCallback((photo: any, authoringData: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const payload = {
          image: photo,
          authoringData: authoringData
        };

        sendMessage('generate_image', payload);
        setIsGeneratingImage(true);

        return true;
      } catch (error) {
        console.error('Error sending image generation request:', error);
        return false;
      }
    } else {
      console.error('WebSocket not connected for image generation');
      return false;
    }
  }, [sendMessage]);

  // Clear LLM response
  const clearLlmResponse = useCallback(() => {
    setLlmResponse('');
  }, []);

  // Clear generated image
  const clearGeneratedImage = useCallback(() => {
    setGeneratedImageBase64(null);
  }, []);

  // Force reconnection method
  const forceReconnect = useCallback(() => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
    }

    // Reset state and reconnect
    setReconnectAttempts(0);
    connectWebSocket();
  }, [connectWebSocket]);

  const [currentPid, setCurrentPid] = useState<string | null>(null);
  const [currentResponseLanguage, setCurrentResponseLanguage] = useState<string | null>(null);
  const [currentWritingStyle, setCurrentWritingStyle] = useState<string | null>(null);
  const [currentProactiveSuggestionPriority, setCurrentProactiveSuggestionPriority] = useState<string | null>(null);

  return {
    isConnected,
    setInteractionIdle,
    messages,
    gazePosition,
    fixationDetected,
    llmResponse,
    lastPong,
    worldFrame,
    sendMessage,
    clearLlmResponse,
    forceReconnect,
    reconnectAttempts,
    authoringQuestion,
    systemNotification,
    suggestionMessage,
    setSuggestionMessage, // Export this
    // Processing state
    isProcessing,
    // Image generation properties
    generatedImageBase64,
    isGeneratingImage,
    generateImage,
    clearGeneratedImage,
    // Plot demonstration properties
    plotData,
    showPlotDemonstration,
    setShowPlotDemonstration,
    // Editing interface properties
    aiGeneratedContent,
    savedContent,
    setSavedContent,
    // Expose the WebSocket object for advanced usage if needed
    ws: wsRef.current,
    currentPid,
    currentResponseLanguage,
    setCurrentPid,
    setCurrentResponseLanguage,
    currentWritingStyle,
    setCurrentWritingStyle,
    currentProactiveSuggestionPriority
  };
};
