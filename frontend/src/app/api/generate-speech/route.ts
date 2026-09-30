// File: /app/api/generate-speech/route.ts

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Rate limiter to prevent overwhelming the API
const RATE_LIMIT = {
  maxRequests: 10, // Maximum requests per minute
  windowMs: 60 * 1000, // 1 minute in milliseconds
  requests: new Map<string, number[]>(), // Map to store timestamps of requests
};

// Function to check rate limit per IP
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = RATE_LIMIT.requests.get(ip) || [];

  // Filter out timestamps older than the window
  const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT.windowMs);

  // Update the timestamps for this IP with the current timestamp
  RATE_LIMIT.requests.set(ip, [...recentTimestamps, now]);

  // Return true if number of recent requests exceeds the limit
  return recentTimestamps.length >= RATE_LIMIT.maxRequests;
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Set OPENAI_API_KEY to enable speech playback.' }, { status: 503 });
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // Get client IP for rate limiting (via proxy headers if available)
    const ip = request.headers.get('x-forwarded-for') || 'unknown';

    // Check if the request exceeds the rate limit
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse the request body (expects JSON)
    const body = await request.json();
    const { text, voice, model, instructions } = body;

    // Validate that the text field is present
    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Check text length against OpenAI's character limit
    if (text.length > 4096) {
      return NextResponse.json(
        { error: 'Text exceeds maximum allowed length (4096 characters)' },
        { status: 400 }
      );
    }

    // Set default values if not provided
    const speechModel = model || 'gpt-4o-mini-tts';
    const speechVoice = voice || 'coral';
    const speechInstructions = instructions || 'Speak in a natural and clear tone.';

    // Setup a timeout using AbortController (30 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // Call the OpenAI audio speech API with the configured parameters
      const mp3Response = await openai.audio.speech.create({
        model: speechModel,
        voice: speechVoice,
        input: text,
        instructions: speechInstructions,
      }, { signal: controller.signal });

      clearTimeout(timeoutId);

      // Convert the API response to an ArrayBuffer (audio data)
      const audioBuffer = await mp3Response.arrayBuffer();

      // Return the audio data in the response with appropriate headers
      return new NextResponse(audioBuffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': audioBuffer.byteLength.toString(),
          'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        },
      });
    } catch (err: any) {
      clearTimeout(timeoutId);

      // If the request is aborted (timeout), return a timeout error
      if (err.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request timed out. Please try with shorter text.' },
          { status: 408 }
        );
      }

      // Re-throw any other errors for the outer catch block
      throw err;
    }
  } catch (error: any) {
    console.error('Speech generation error:', error);

    // Return an error response with the appropriate status code and message
    const statusCode = error.status || 500;
    const errorMessage = error.message || 'Failed to generate speech';

    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}

