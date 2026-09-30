import os
import time
import json
import pathlib
from typing import List, Optional, Union

import numpy as np
from PIL import Image
from google import genai
from google.genai import types


class GeminiRequestError(RuntimeError):
    """A model request failed to produce usable content."""


def describe_gemini_error(error: Exception) -> str:
    """Translate provider failures into an actionable message for the interface."""
    detail = str(error)
    code = getattr(error, "code", None)
    if code == 429 or "RESOURCE_EXHAUSTED" in detail or "QUOTA_EXCEEDED" in detail:
        if "limit: 0" in detail:
            return ("Gemini quota for the requested model is 0. Check this project's "
                    "model quota and billing in Google AI Studio before retrying.")
        return "Gemini quota exceeded. Check your quota in Google AI Studio and retry when it is available."
    if code == 503 or "503 UNAVAILABLE" in detail:
        return "Gemini is temporarily busy (503). Please try again shortly."
    return detail


class GeminiClient:
    """
    Enhanced client for interacting with Google's Gemini API using the new SDK.
    """

    def __init__(
            self,
            api_key: Optional[str] = None,
            model: str = "gemini-2.5-flash",
            max_tokens: int = 65536,
            temperature: float = 0.7
    ):
        """
        Initialize Gemini client with configuration options.

        Args:
            api_key (str, optional): Gemini API key. Defaults to environment variable.
            model (str, optional): Gemini model to use.
            max_tokens (int, optional): Maximum tokens for generation.
            temperature (float, optional): Sampling temperature for response diversity.
        """
        # Use provided API key or load from environment
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.client = genai.Client(
            api_key=self.api_key,
            http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(
                attempts=3,
                initial_delay=1.0,
                max_delay=4.0,
                http_status_codes=[500, 502, 503, 504],
            )),
        ) if self.api_key else None

        # Store model and configuration
        self.model = os.getenv("GEMINI_TEXT_MODEL", model)
        self.generation_config = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
            top_p=0.95,
            top_k=32,
            response_mime_type="application/json",
        )

        # full_history records all conversation history (including images and audio)
        self.full_history = []
        # text_history records only text input/output between human and AI
        self.text_history = []

    def reset_history(self):
        """Reset conversation history and system instruction."""
        self.full_history = []
        self.text_history = []
        # Reset system instruction to default
        self.generation_config = types.GenerateContentConfig(
            temperature=self.generation_config.temperature,
            max_output_tokens=self.generation_config.max_output_tokens,
            top_p=0.95,
            top_k=32,
            response_mime_type="application/json",
        )

    def add_system_message(self, content: str):
        """Add a system message to the conversation history."""
        self.generation_config = types.GenerateContentConfig(
            temperature=self.generation_config.temperature,
            max_output_tokens=self.generation_config.max_output_tokens,
            top_p=0.95,
            top_k=32,
            system_instruction=content
        )

    def _process_image(self, image: Union[Image.Image, np.ndarray], max_size: int = 512) -> Image.Image:
        """
        Process and resize image.

        Args:
            image (Union[Image.Image, np.ndarray]): Input image.
            max_size (int, optional): Maximum dimension. Defaults to 512.

        Returns:
            PIL.Image: Processed image.
        """
        # Convert numpy array to PIL Image if needed
        if isinstance(image, np.ndarray):
            image = Image.fromarray(image)

        image = image.copy()
        image.thumbnail((max_size, max_size))
        return image

    async def process_prompt(
            self,
            text: Optional[str] = None,
            images: Optional[List[Union[Image.Image, np.ndarray]]] = None,
            audio_path: Optional[Union[str, pathlib.Path]] = None,
            system_instruction: Optional[str] = None,
            image_process_notes: str = "These are the user's camera frames. If there are red circle, they indicates user gaze point. Ignore the gaze if no red circle.",
            with_history: Optional[str] = "text",  # None, "text", or "img"
            max_tokens: Optional[int] = None,  # New parameter for token count,
            past_context=None,  # New parameter for past context,
            update_history=True,  # New parameter for update history
            model_name: Optional[str] = None,  # New parameter for specifying the model
            thinking_level: Optional[str] = None,
            thinking_budget: Optional[int] = None,
    ) -> str:
        """
        Generate a response from Gemini with optional text, images, and audio.

        If with_history is not None, the previous conversation history will be attached to the input.
        If with_history is "img", attach full history (including images/audio); if "text", attach only text history.

        Args:
            text (str, optional): Input text.
            images (List[Union[Image.Image, np.ndarray]], optional): List of images.
            audio_path (Union[str, pathlib.Path], optional): Path to audio file.
            system_instruction (str, optional): System-level instruction.
            image_process_notes (str, optional): Notes about images.
            with_history (str, optional): If "text", attach only text history; if "img", attach full history; if None, do not attach.
            past_context (str, optional): Past context to include in the prompt.
            model_name (str, optional): Specific model to use for this request, overriding the default.

        Returns:
            str: Generated response.
        """
        if self.client is None:
            raise ValueError("Set GEMINI_API_KEY in .env to enable AI requests.")
        start_time = time.time()
        contents = []

        # Store original input for history recording
        original_text = text

        # Process images if provided
        if images:
            processed_images = [self._process_image(img) for img in images]
            contents.extend(processed_images)

        # Process audio if provided
        if audio_path:
            audio_path = pathlib.Path(audio_path)
            if not audio_path.exists():
                raise FileNotFoundError(f"Audio file not found: {audio_path}")
            
            audio_bytes = audio_path.read_bytes()
            audio_part = types.Part(
                inline_data=types.Blob(
                    mime_type={".webm": "audio/webm", ".mp4": "audio/mp4", ".ogg": "audio/ogg"}.get(audio_path.suffix.lower(), "audio/mpeg"),
                    data=audio_bytes
                )
            )
            contents.append(audio_part)
            print(f"Loaded audio file: {audio_path}, Size: {len(audio_bytes)} bytes")

        # Build the content to send to the model
        content_text = ""

        # First add history if requested
        if with_history is not None:
            if with_history == "img":
                # For full history, format the full_history entries
                for turn in self.full_history:
                    if "human" in turn:
                        human_turn = turn["human"]
                        if isinstance(human_turn, dict):
                            human_text = human_turn.get("text", "")
                            content_text += f"Human: {human_text}\n"
                        else:
                            content_text += f"Human: {human_turn}\n"
                    if "ai" in turn:
                        content_text += f"AI: {turn['ai']}\n"
            elif with_history == "text":
                # Only include text history
                for turn in self.text_history:
                    if "human" in turn:
                        content_text += f"Human: {turn['human']}\n"
                    if "ai" in turn:
                        content_text += f"AI: {turn['ai']}\n"

        # Add past context if provided
        if past_context:
            content_text += f"Past Context: {past_context}\n"
        # Then add the current input
        if text:
            if images or audio_path:
                content_text += image_process_notes
            if audio_path:
                content_text += " Attached audio file is the original author's voice audio. Consider it if text transcription is not clear.\n"
            content_text += text

        # Add the constructed text to contents
        if content_text:
            contents.append(content_text)

        config = self.generation_config.copy()
        if system_instruction:
            config.system_instruction = system_instruction

        if max_tokens is not None:
            config.max_output_tokens = max_tokens

        # Determine which model to use for this specific request
        effective_model = model_name if model_name else self.model
        fallback_model = "gemini-2.5-flash-lite"  # Fallback model for quota issues

        if thinking_level is not None or thinking_budget is not None:
            thinking_config_cls = getattr(types, "ThinkingConfig", None)
            if thinking_config_cls is None:
                print(
                    "Warning: installed google-genai SDK does not support thinking_config. "
                    "Upgrade google-genai to use thinking_level/thinking_budget."
                )
            else:
                thinking_config_kwargs = {}
                if thinking_level is not None:
                    thinking_config_kwargs["thinking_level"] = thinking_level
                if thinking_budget is not None:
                    thinking_config_kwargs["thinking_budget"] = thinking_budget
                config.thinking_config = thinking_config_cls(**thinking_config_kwargs)
        
        async def _make_request(model_to_use: str, is_fallback: bool = False):
            """Helper function to make the actual API request"""
            try:
                if is_fallback:
                    print(f"Retrying with fallback model: {model_to_use}")
                
                response = await self.client.aio.models.generate_content(
                    model=model_to_use,
                    contents=contents,
                    config=config
                )
                print(f"Gemini Request to {model_to_use} took {time.time() - start_time:.2f}s")
                
                # Check for content filtering
                try:
                    # Attempt to access the text. If it fails, it's likely due to filtering.
                    response_text = response.text
                    print(json.dumps(response_text, indent=2, ensure_ascii=False))
                    return response_text
                except ValueError:
                    # This exception is often raised when the response is blocked.
                    print("Warning: Could not access response.text. Checking for content filtering...")
                    print(response)
                    return None

            except Exception as e:
                error_str = str(e)
                print(f"Error in Gemini generation with {model_to_use}: {error_str}")
                
                # Check if this is a quota exceeded error (429)
                if "429" in error_str or "quota" in error_str.lower() or "RESOURCE_EXHAUSTED" in error_str:
                    print(f"Detected quota exceeded error for {model_to_use}")
                    # Return the error info so we can handle fallback
                    raise Exception(f"QUOTA_EXCEEDED:{error_str}")
                else:
                    # For other errors, return the error message
                    raise e

        try:
            print("History:", self.text_history)
            print("Input Text for Gemini:", original_text)
            
            # First attempt with the primary model
            try:
                response_text = await _make_request(effective_model, is_fallback=False)
            except Exception as e:
                error_str = str(e)
                
                # Check if this is a quota exceeded error and we haven't tried fallback yet
                if error_str.startswith("QUOTA_EXCEEDED:") and effective_model != fallback_model:
                    print(f"Primary model {effective_model} quota exceeded, switching to {fallback_model}")
                    
                    # Try with fallback model
                    try:
                        response_text = await _make_request(fallback_model, is_fallback=True)
                        print(f"Successfully switched to fallback model {fallback_model}")
                    except Exception as fallback_error:
                        print(f"Fallback model {fallback_model} also failed: {fallback_error}")
                        raise
                else:
                    # Re-raise the original error if it's not a quota issue or we're already using fallback
                    raise e

            if not response_text or not response_text.strip():
                raise GeminiRequestError("Gemini returned no text. Please try rephrasing the request.")

            # Record current exchange to history AFTER getting the response
            # Store only the original input, not the input with history prepended
            if update_history:
                if with_history == "img":
                    human_entry = {
                        "text": original_text,
                        "images": images,
                        # "audio": str(audio_path) if audio_path else None
                    }
                    self.full_history.append({"human": human_entry})
                    if original_text:
                        self.text_history.append({"human": original_text})
                    self.full_history.append({"ai": response_text})
                    self.text_history.append({"ai": response_text})
                elif with_history == "text":
                    if original_text:
                        self.text_history.append({"human": original_text})
                    self.text_history.append({"ai": response_text})

            return response_text
        except Exception as e:
            print(f"Error in Gemini generation: {e}")
            if isinstance(e, GeminiRequestError):
                raise
            raise GeminiRequestError(describe_gemini_error(e)) from e

