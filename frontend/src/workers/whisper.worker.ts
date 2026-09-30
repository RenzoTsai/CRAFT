import { pipeline, WhisperTextStreamer, type WhisperTokenizer } from "@huggingface/transformers";

// Define model factories
// Ensures only one model is created of each type
class PipelineFactory {
    static task = "automatic-speech-recognition" as const;
    static model: string | null = null;
    static instance: ReturnType<typeof pipeline<"automatic-speech-recognition">> | null = null;

    static async getInstance(progress_callback?: (progress: any) => void) {
        if (this.instance === null) {
            if (!this.model) throw new Error("A Whisper model must be selected.");
            this.instance = pipeline<"automatic-speech-recognition">(this.task, this.model, {
                dtype: {
                    encoder_model:
                        this.model === "onnx-community/whisper-large-v3-turbo"
                            ? "fp16"
                            : "fp32",
                    decoder_model_merged: "q4", // or 'fp32' ('fp16' is broken)
                },
                device: "webgpu",
                progress_callback,
            });
        }

        return this.instance;
    }
}

self.addEventListener("message", async (event) => {
    const message = event.data;
    console.log('Whisper worker received message:', message);

    // For initial loading, audio is undefined.
    if (message.audio === undefined) {
        // Just load the model and return
        await transcribe(message);
        return;
    }

    try {
        let transcript = await transcribe(message);
        if (transcript === null) return;

        console.log('Whisper transcription completed:', transcript);
        // Send the result back to the main thread
        self.postMessage({
            status: "complete",
            data: transcript,
        });
    } catch (error) {
        console.error('Whisper worker error:', error);
        self.postMessage({
            status: "error",
            data: { message: error instanceof Error ? error.message : String(error) },
        });
    }
});

class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
    static task = "automatic-speech-recognition" as const;
    static model: string | null = null;
}

const transcribe = async ({ audio, model, subtask, language }: any) => {
    // Check if audio data is available. If not, it's a pre-loading request.
    if (audio === undefined) {
        console.log('Pre-loading Whisper model...');
    }

    console.log('Starting transcription with:', { model, subtask, language, audioLength: audio?.length });
    
    const isDistilWhisper = model.startsWith("distil-whisper/");

    const p = AutomaticSpeechRecognitionPipelineFactory;
    if (p.model !== model) {
        console.log('Model changed, invalidating previous instance. New model:', model);
        // Invalidate model if different
        p.model = model;

        if (p.instance !== null) {
            console.log('Disposing previous model instance');
            (await p.getInstance()).dispose();
            p.instance = null;
        }
    }

    console.log('Loading transcriber model...');
    // Load transcriber model
    const transcriber = await p.getInstance((data: any) => {
        console.log('Model loading progress:', data);
        self.postMessage(data);
    });
    
    console.log('Transcriber model loaded successfully');

    // If there is no audio, we're done with pre-loading.
    if (audio === undefined) {
        console.log('Whisper model pre-loading complete.');
        return null;
    }

    const time_precision =
        transcriber.processor.feature_extractor!.config.chunk_length /
        (transcriber.model.config as unknown as { max_source_positions: number }).max_source_positions;

    // Storage for chunks to be processed. Initialise with an empty chunk.
    const chunks: { text: string; offset: number, timestamp: [number, number | null]; finalised?: boolean }[] = [];

    const chunk_length_s = isDistilWhisper ? 20 : 30;
    const stride_length_s = isDistilWhisper ? 3 : 5;

    let chunk_count = 0;
    let start_time: number | null = null;
    let num_tokens = 0;
    let tps = 0;
    const streamer = new WhisperTextStreamer(transcriber.tokenizer as WhisperTokenizer, {
        time_precision,
        on_chunk_start: (x: number) => {
            const offset = (chunk_length_s - stride_length_s) * chunk_count;
            chunks.push({
                text: "",
                timestamp: [offset + x, null],
                finalised: false,
                offset,
            });
        },
        token_callback_function: () => {
            start_time ??= performance.now();
            if (num_tokens++ > 0) {
                tps = (num_tokens / (performance.now() - start_time)) * 1000;
            }
        },
        callback_function: (x: string) => {
            if (chunks.length === 0) return;
            // Append text to the last chunk
            chunks.at(-1)!.text += x;

            self.postMessage({
                status: "update",
                data: {
                    text: "", // No need to send full text yet
                    chunks,
                    tps,
                },
            });
        },
        on_chunk_end: (x: number) => {
            const current = chunks.at(-1)!;
            current.timestamp[1] = x + current.offset;
            current.finalised = true;
        },
        on_finalize: () => {
            start_time = null;
            num_tokens = 0;
            ++chunk_count;
        },
    });

    console.log('Starting transcription with parameters:', {
        chunk_length_s,
        stride_length_s,
        language,
        task: subtask,
        top_k: 0,
        do_sample: false,
        return_timestamps: true,
        force_full_sequences: false
    });

    // Actually run transcription
    const output = await transcriber(audio, {
        // Greedy
        top_k: 0,
        do_sample: false,

        // Sliding window
        chunk_length_s,
        stride_length_s,

        // Language and task
        language,
        task: subtask,

        // Return timestamps
        return_timestamps: true,
        force_full_sequences: false,

        // Callback functions
        streamer, // after each generation step
    }).catch((error: any) => {
        console.error('Transcription error:', error);
        self.postMessage({
            status: "error",
            data: error,
        });
        return null;
    });

    console.log('Transcription output:', output);

    return {
        tps,
        ...output,
    };
};

// Required for worker context
export {};
