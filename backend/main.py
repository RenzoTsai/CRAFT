import os
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

import asyncio
from datetime import datetime
import time
import uvicorn
import json
import logging
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response
from starlette.websockets import WebSocketState
from typing import Dict, Any, List
from collections import deque
import base64
import cv2
import numpy as np
from PIL import Image

from action.update_fiction_context import FictionContextUpdater
from context.context_data import ContextData
from modules.llm.gemini_client import GeminiClient, GeminiRequestError
from modules.llm.image_generation import GeminiImageGenerator
from storage.context_storage import ContextStorage
from utils.detect_json import detect_json
from utils.location import get_current_location
# Global session state
session_mode = None

# Add request locking mechanism
from contextlib import asynccontextmanager

# Global request state management
llm_request_lock = asyncio.Lock()
active_requests = set()
last_request_timestamps = {}
REQUEST_COOLDOWN = 2.0  # 2 seconds cooldown between similar requests

@asynccontextmanager
async def llm_request_context(request_id: str):
    """Context manager for LLM requests to prevent duplicates"""
    async with llm_request_lock:
        # Check if this request type is already active
        if request_id in active_requests:
            logger.warning(f"Skipping duplicate LLM request: {request_id}")
            yield False
            return
        
        # Check cooldown period
        current_time = time.time()
        last_time = last_request_timestamps.get(request_id, 0)
        if current_time - last_time < REQUEST_COOLDOWN:
            logger.warning(f"Request too soon, cooling down: {request_id}")
            yield False
            return
        
        # Mark request as active
        active_requests.add(request_id)
        last_request_timestamps[request_id] = current_time
        logger.debug(f"Starting LLM request: {request_id}")
        
    try:
        yield True
    finally:
        # Always clean up, even if exception occurs
        active_requests.discard(request_id)
        logger.debug(f"Completed LLM request: {request_id}")


def load_task_description(task_name: str) -> str:
    """
    Load task description from file.
    
    Args:
        task_name: Name of the task description file
        
    Returns:
        Task description content
    """
    try:
        file_path = os.path.join(os.path.dirname(__file__), "modules", "llm", "task_description", task_name)
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception as e:
        logger.error(f"Failed to load task description '{task_name}': {e}")
        return ""
from core.server import create_app
from core.config import settings
from core.websocket_manager import manager
from modules.gaze.pupil_connector import PupilConnector
import io


# Initialize text embedding model
text_embedding_model = None
try:
    from sentence_transformers import SentenceTransformer, util
    text_embedding_model = SentenceTransformer(
        'all-MiniLM-L6-v2',
        cache_folder=os.getenv('CRAFT_MODEL_CACHE', str(settings.BASE_DIR.parent / '.models')),
    )
except Exception as e:
    print(f"Failed to load text embedding model: {e}")

# Variables to track last image and suggestion history for similarity checking
suggestion_history = deque(maxlen=50)  # Keep more history for text similarity
PROACTIVE_SUGGESTION_PRIORITY = "any" # Global variable for suggestion priority


# Initialize advanced FPV similarity tracker
fpv_tracker = None
try:
    from modules.vision.image_embedder import FPVSimilarityTracker
    fpv_tracker = FPVSimilarityTracker(sequence_duration=10.0)
except Exception as e:
    print(f"Failed to initialize FPV tracker: {e}")


def save_suggestion_history():
    """Save suggestion history to JSON file for persistence across restarts."""
    try:
        suggestion_history_file = os.path.join(settings.DATA_DIR, config["pid"], "suggestion_history.json")
        
        # Create the data structure to save
        history_data = {
            "suggestion_history": list(suggestion_history),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        
        with open(suggestion_history_file, 'w') as f:
            json.dump(history_data, f, indent=2, ensure_ascii=False)
        
        logger.debug(f"Suggestion history saved to {suggestion_history_file}")
        
    except Exception as e:
        logger.error(f"Error saving suggestion history: {e}")


def load_suggestion_history():
    """Load suggestion history from JSON file on startup."""
    global suggestion_history
    
    try:
        suggestion_history_file = os.path.join(settings.DATA_DIR, config["pid"], "suggestion_history.json")
        
        if not os.path.exists(suggestion_history_file):
            logger.info("No existing suggestion history file found, starting fresh")
            return
            
        with open(suggestion_history_file, 'r') as f:
            history_data = json.load(f)
        
        # Restore suggestion history
        if "suggestion_history" in history_data:
            suggestion_history.clear()
            for item in history_data["suggestion_history"]:
                # Handle both old format (string) and new format (dict)
                if isinstance(item, dict) and "suggestion" in item:
                    suggestion_history.append(item)
                elif isinstance(item, str):
                    suggestion_history.append({"suggestion": item, "env": {}}) # Add empty env for old data
        
        logger.info(f"Loaded suggestion history: {len(suggestion_history)} total")
        
    except Exception as e:
        logger.error(f"Error loading suggestion history: {e}")
        # Reset to empty if loading fails
        suggestion_history.clear()


def get_relevant_history(history: deque, max_count: int = 10) -> List[str]:
    """
    Selects relevant suggestion history. If history is long, it returns the top N
    suggestions most similar to the latest environment.

    Args:
        history (deque): The full suggestion history.
        max_count (int): The maximum number of suggestions to return.

    Returns:
        List[str]: A list of suggestion texts.
    """
    if not history:
        return []

    # If history is short, return all suggestions
    if len(history) <= max_count:
        return [item["suggestion"] for item in history if "suggestion" in item]

    # If history is long, find the most relevant ones
    latest_env = history[-1].get("env")
    if not latest_env:
        # Fallback: return the most recent N if the last entry has no env
        return [history[i]["suggestion"] for i in range(len(history) - max_count, len(history)) if "suggestion" in history[i]]

    def calculate_similarity(env1, env2):
        def tokens(env):
            return {
                f"{key}:{str(value).lower()}"
                for key, values in env.items()
                for value in (values.split() if isinstance(values, str) else values or [])
            }
        set1, set2 = tokens(env1), tokens(env2)
        intersection = len(set1.intersection(set2))
        union = len(set1.union(set2))
        return intersection / union if union > 0 else 0

    # Calculate similarity for all history entries (excluding the last one)
    similarities = []
    for i in range(len(history) - 1):
        item = history[i]
        if "env" in item and item["env"]:
            similarity = calculate_similarity(latest_env, item["env"])
            similarities.append((similarity, item["suggestion"]))

    # Sort by similarity and take the top N
    similarities.sort(key=lambda x: x[0], reverse=True)
    top_suggestions = [suggestion for similarity, suggestion in similarities[:max_count]]

    return top_suggestions


def should_skip_suggestion_due_to_similar_scene(current_frame):
    """
    Check if current scene is too similar to last suggestion scene.
    Uses the MediaPipe embedding tracker when it is available.
    
    Args:
        current_frame: Current frame from camera
        
    Returns:
        True if scene is too similar (should skip), False if different enough
    """
    global fpv_tracker
    
    if current_frame is None:
        return True
        
    try:
        # Convert frame from BGR to RGB (pupil connector provides BGR frames)
        if len(current_frame.shape) == 3 and current_frame.shape[2] == 3:
            # Convert BGR to RGB for processing and similarity calculation
            rgb_frame = cv2.cvtColor(current_frame, cv2.COLOR_BGR2RGB)
        elif len(current_frame.shape) == 3 and current_frame.shape[2] == 4:
            # BGRA to RGB
            bgr_frame = current_frame[:, :, :3]
            rgb_frame = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        else:
            logger.warning(f"Unexpected frame format: {current_frame.shape}")
            return False
            
            
        # Check both current frame similarity and sequence similarity (image sampling is handled in main_loop)
        if fpv_tracker:
            current_similar = fpv_tracker.calculate_current_similarity(rgb_frame, threshold=0.8)
            sequence_similar = fpv_tracker.calculate_sequence_similarity(threshold=0.75)
            
            if current_similar:
                logger.info("Current frame too similar to last suggestion frame")
                return True
                
            if sequence_similar:
                logger.info("Current sequence too similar to last suggestion sequence")
                return True
                
            return False
        else:
            # Fallback: simple similarity check (this won't work well without state)
            logger.debug("Using fallback similarity check")
            return False
            
    except Exception as e:
        logger.error(f"Error checking scene similarity: {e}")
        return False


def get_visual_context_from_env():
    """
    Get current visual context from env_context image_queue.
    
    Returns:
        Dictionary with visual context information
    """
    try:
        if context_data and context_data.env_context:
            queue_info = context_data.env_context.get_queue_info()
            latest_image = context_data.env_context.get_latest_image()
            image_sequence, timestamps = context_data.env_context.get_current_image_sequence()
            
            return {
                "queue_info": queue_info,
                "latest_image": latest_image,
                "sequence_length": len(image_sequence),
                "has_images": len(image_sequence) > 0,
                "duration_covered": queue_info.get("duration_covered", 0)
            }
        else:
            return {
                "queue_info": None,
                "latest_image": None, 
                "sequence_length": 0,
                "has_images": False,
                "duration_covered": 0
            }
    except Exception as e:
        logger.error(f"Error getting visual context from env: {e}")
        return None


def filter_suggestions_by_text_similarity(new_suggestions, history_list, threshold=0.7):
    """
    Filter suggestions based on text similarity with history.
    Returns suggestions that are sufficiently different from history.
    """
    if not text_embedding_model or not history_list or not new_suggestions:
        return new_suggestions
    
    try:
        # Extract just the suggestion text from the history for embedding
        history_texts = [item["suggestion"] for item in history_list if isinstance(item, dict) and "suggestion" in item]
        if not history_texts:
            return new_suggestions

        # Encode history items
        history_embeddings = text_embedding_model.encode(history_texts, convert_to_tensor=True)
        filtered_suggestions = []

        for new_suggestion in new_suggestions:
            # Encode the new suggestion
            new_embedding = text_embedding_model.encode([new_suggestion], convert_to_tensor=True)

            # Calculate cosine similarities
            similarities = util.cos_sim(new_embedding, history_embeddings)
            max_similarity = similarities.max().item()

            # Check if similarity is below threshold
            if max_similarity < threshold:
                filtered_suggestions.append(new_suggestion)
            else:
                logger.info(f"Filtered similar suggestion (similarity: {max_similarity:.3f}): {new_suggestion}")

        return filtered_suggestions
    except Exception as e:
        logger.warning(f"Error filtering suggestions by text similarity: {e}")
        return new_suggestions


def configure_app() -> Dict[str, Any]:
    """Runtime settings for the writing probe."""
    return {
        "pid": os.getenv("CRAFT_PROJECT_ID", "my-story"),
        "pupil_simulate": os.getenv("CRAFT_CAMERA", "pupil") in {"webcam", "browser"},
        "response_language": "English",
        "writing_style": "Concise but touched language",
    }


# Initialize configuration
config = configure_app()

# Create the PID folder if it doesn't exist
pid_folder = os.path.join(settings.DATA_DIR, config["pid"])
os.makedirs(pid_folder, exist_ok=True)

# Configure default logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Configure dedicated event logging for transcriptions, AI responses, and image files
event_log_file_path = os.path.join(pid_folder, "event_log.txt")
event_logger = logging.getLogger("event_logger")
event_logger.setLevel(logging.INFO)
# Clear any existing handlers (important!)
event_logger.handlers = []
file_handler = logging.FileHandler(event_log_file_path, encoding='utf-8')
file_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
event_logger.addHandler(file_handler)
event_logger.propagate = False  # Keep this line

# Create FastAPI app
app = create_app()

# Initialize modules
llm_client = GeminiClient()

# Serve static files
os.makedirs(os.path.join(settings.DATA_DIR, "static"), exist_ok=True)
app.mount("/static", StaticFiles(directory=os.path.join(settings.DATA_DIR, "static")), name="static")

# Create generated_images directory if it doesn't exist
generated_images_dir = os.path.join(settings.DATA_DIR, config["pid"], "generated_images")
os.makedirs(generated_images_dir, exist_ok=True)

app.mount("/generated", StaticFiles(directory=generated_images_dir), name="generated")

storage = ContextStorage(config["pid"])
context_data = storage.load_context() or ContextData(pid=config["pid"])


pupil_connector = PupilConnector(simulate=config["pupil_simulate"])

def save_config(pid):
    """Saves the current configuration for a given PID to a JSON file."""
    global PROACTIVE_SUGGESTION_PRIORITY
    PROACTIVE_SUGGESTION_PRIORITY = config.get("proactive_suggestion_priority", "any")
    pid_folder = os.path.join(settings.DATA_DIR, pid)
    os.makedirs(pid_folder, exist_ok=True)
    config_path = os.path.join(pid_folder, "config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump({
            "pid": pid,
            "response_language": config.get("response_language", "English"),
            "writing_style": config.get("writing_style", "Concise but touched language"),
            "proactive_suggestion_priority": config.get("proactive_suggestion_priority", "any"),
        }, f, ensure_ascii=False, indent=2)
    logger.info(f"Configuration saved for PID {pid}")

def load_config_for_pid(pid):
    """Loads configuration for a given PID, creating a default if none exists."""
    global PROACTIVE_SUGGESTION_PRIORITY
    pid_folder = os.path.join(settings.DATA_DIR, pid)
    config_path = os.path.join(pid_folder, "config.json")
    
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            try:
                user_config = json.load(f)
                config.update(user_config)
                PROACTIVE_SUGGESTION_PRIORITY = user_config.get("proactive_suggestion_priority", "any")
                logger.info(f"Loaded config for PID {pid}")
            except json.JSONDecodeError:
                logger.error(f"Error decoding config.json for PID {pid}. Using defaults.")
                create_default_config(pid, config_path)
    else:
        logger.info(f"No config found for PID {pid}. Creating default config.")
        create_default_config(pid, config_path)

def create_default_config(pid, config_path):
    """Creates a default configuration file."""
    global PROACTIVE_SUGGESTION_PRIORITY
    default_config = {
        "pid": pid,
        "response_language": "English",
        "writing_style": "Concise but touched language",
        "proactive_suggestion_priority": "any",
    }
    config.update(default_config)
    PROACTIVE_SUGGESTION_PRIORITY = "any"
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(default_config, f, ensure_ascii=False, indent=2)

async def main_loop() -> None:
    global fpv_tracker, context_data
    
    last_img_queue_time = 0  # Time tracking for image queue sampling
    
    while True:
        current_frame = pupil_connector.get_recent_frame()
        context_data.env_context.fpv = current_frame
        
        # Add frame to image queues at 0.5 second intervals
        current_time = time.time()
        should_add_to_queue = current_time - last_img_queue_time > 0.5
        if should_add_to_queue and current_frame is not None:
            last_img_queue_time = current_time
            
            # Convert BGR to RGB for storage
            if len(current_frame.shape) == 3 and current_frame.shape[2] == 3:
                rgb_frame = cv2.cvtColor(current_frame, cv2.COLOR_BGR2RGB)
            elif len(current_frame.shape) == 3 and current_frame.shape[2] == 4:
                # BGRA to RGB
                bgr_frame = current_frame[:, :, :3]
                rgb_frame = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
            else:
                rgb_frame = current_frame
            
            # Add to fpv_tracker for similarity calculations
            if fpv_tracker:
                fpv_tracker.add_frame(rgb_frame)
                logger.debug("Added frame to fpv_tracker sequence queue (0.5s interval)")
            
            # Add to env_context for unified access to visual context
            if context_data and context_data.env_context:
                context_data.env_context.add_image_to_queue(rgb_frame)
                queue_info = context_data.env_context.get_queue_info()
                logger.debug(f"Added frame to env_context image_queue: {queue_info['queue_length']}/{queue_info.get('target_duration', 10)}s queue")

        await asyncio.sleep(0.1)


async def proactive_suggestion_loop() -> None:
    """Periodically provides proactive writing suggestions to the user."""
    global suggestion_history, fpv_tracker


    while True:
        await asyncio.sleep(30)  # Wait for 30 seconds between suggestions
        
        if not manager.proactive_allowed():
            continue
        interaction_revision = manager.interaction_revision

        # Use request context to prevent duplicate suggestions
        async with llm_request_context("proactive_suggestion") as should_proceed:
            if not should_proceed:
                continue
                
        logger.info("Generating proactive writing suggestion...")

        try:
            # Get the most recent frame from the pupil connector
            current_frame = pupil_connector.get_recent_frame()
            if current_frame is None or should_skip_suggestion_due_to_similar_scene(current_frame):
                # Skip if no frame or scene is too similar to last suggestion
                continue

            # Prepare context for the LLM prompt
            fiction_context_str = json.dumps(context_data.fiction_context_to_dict(), indent=2, ensure_ascii=False)
            visual_context = get_visual_context_from_env()
            if visual_context and visual_context["has_images"]:
                logger.info(f"Visual context available: {visual_context['sequence_length']} frames covering {visual_context['duration_covered']:.1f}s")
            else:
                logger.info("No visual context available in env_context")

            # Get current location
            location = get_current_location()

            # Prepare history for the prompt
            interaction_history_str = ""
            if suggestion_history:
                # Get relevant history based on length and similarity
                relevant_history_texts = get_relevant_history(suggestion_history, max_count=10)
                if relevant_history_texts:
                    formatted_history = "\n- ".join(relevant_history_texts)
                    interaction_history_str = f"Interaction History:\n- {formatted_history}"

            # Build the LLM prompt
            text_prompt = f"""Given the user's story so far, produce a JSON per the system instruction.

Story Context:
{fiction_context_str}

User's Current Location: {location}

{interaction_history_str}

Instructions for this turn:
- From the Interaction History above, extract the already-covered themes as a concise list (max 10) and output them in 'topics_already_covered'. If none, use an empty list.
- Then generate a NEW suggestion that strictly avoids these topics and is grounded in the CURRENT FPV images (If there is red dot/circle on the image, it indicates user gaze position.).
- Choose a concrete triggering_element that is visibly present now.
- Keep environment_element.desc under 30 words.

Current Suggestion Priority: [{PROACTIVE_SUGGESTION_PRIORITY}] - prioritize suggestions related to this theme."""

            # if config has "response_language", add it to the prompt
            if "response_language" in config and config["response_language"]:
                text_prompt += f"\n\nPlease respond in {config['response_language']}."

            # Get image sequence for Gemini
            images_for_gemini = []
            if context_data and context_data.env_context:
                current_sequence, timestamps = context_data.env_context.get_current_image_sequence()
                images_for_gemini = current_sequence.copy() if current_sequence else []
            if not images_for_gemini:
                frame_for_gemini = cv2.cvtColor(current_frame, cv2.COLOR_BGR2RGB)
                images_for_gemini = [frame_for_gemini]

            # Load the system instruction for proactive suggestion
            proactive_instruction = load_task_description("proactive_suggestion")

            # Call Gemini to get the suggestion
            suggestion = await llm_client.process_prompt(
                text=text_prompt,
                images=images_for_gemini,
                model_name=os.getenv("GEMINI_TEXT_MODEL", "gemini-2.5-flash"),
                system_instruction=proactive_instruction,
                update_history=False,
                with_history="text",
                thinking_budget=256,
            )

            # Discard replies from an idle period that ended while the request ran.
            if not manager.proactive_allowed() or manager.interaction_revision != interaction_revision:
                continue

            # Parse the LLM output as JSON
            if suggestion is None:
                logger.warning("LLM returned None. This might be due to content filtering or an API error.")
                continue
            parsed = detect_json(suggestion)
            if not isinstance(parsed, dict):
                logger.warning("Proactive suggestion: LLM did not return valid JSON, skipping...")
                continue

            # print the suggestion (JSON with acsii false)
            print(suggestion)

            # Check if the suggestion is valid and not 'none'
            suggestion_text = str(parsed.get("suggestion", "")).strip().lower()
            if not suggestion_text or suggestion_text == "none":
                logger.info(f"Proactive suggestion: No suggestion at this moment. Rationale: {parsed.get('rationale','')}")
                continue

            # Filter out suggestions that are too similar to history or duplicates
            filtered = filter_suggestions_by_text_similarity(
                [parsed["suggestion"]], list(suggestion_history), threshold=0.8
            )
            if not filtered:
                logger.info("Proactive suggestion: Duplicate or too similar, skipping...")
                continue

            # Update suggestion history
            parsed["suggestion"] = filtered[0]
            logger.info(f"Proactive suggestion: {parsed['suggestion']}")
            
            # Save suggestion and environment context
            suggestion_entry = {
                "suggestion": parsed["suggestion"],
                "env": parsed.get("environment_element", {}),
                "topics_already_covered": parsed.get("topics_already_covered", []),
                "triggering_element": parsed.get("triggering_element", ""),
                "similarity_type": parsed.get("similarity_type", ""),
                "authenticity_scores": parsed.get("authenticity_scores", {}),
                "rationale": parsed.get("rationale", ""),
                "interruptibility": parsed.get("interruptibility", 0)
            }
            suggestion_history.append(suggestion_entry)
            save_suggestion_history()
            if fpv_tracker:
                rgb_frame = cv2.cvtColor(current_frame, cv2.COLOR_BGR2RGB)
                fpv_tracker.mark_suggestion_sent(rgb_frame)

            # Broadcast only the suggestion text to the frontend
            await manager.broadcast_json({
                "type": "suggestion",
                "message": parsed["suggestion"],
                "timestamp": time.time()
            })

        except GeminiRequestError as e:
            logger.warning(f"Proactive suggestion skipped: {e}")
        except Exception as e:
            logger.error(f"Error generating proactive suggestion: {e}", exc_info=True)


def refresh_system_instruction():
    """Use the selected project's saved preferences and latest draft."""
    system_message = load_task_description("fiction_assistant.txt")
    latest_story = ""
    history_path = os.path.join(settings.DATA_DIR, config["pid"], "story_history.json")
    if os.path.exists(history_path):
        with open(history_path, encoding="utf-8") as handle:
            history = json.load(handle).get("history", [])
        if history:
            latest_story = history[-1].get("content", "")
    for placeholder, value in {
        "STORY_HISTORY": latest_story,
        "RESPONSE_LANGUAGE": config["response_language"],
        "WRITING_STYLE": config["writing_style"],
        "PROACTIVE_SUGGESTION_PRIORITY": config.get("proactive_suggestion_priority", "any"),
    }.items():
        system_message = system_message.replace(f"[{placeholder}]", str(value))
    llm_client.add_system_message(system_message)


@app.on_event("startup")
async def startup_event():
    """Initialize components on app startup"""

    global fiction_context_updater
    fiction_context_updater = FictionContextUpdater(context_data, llm_client)
    
    # Load suggestion history for persistence across restarts
    load_suggestion_history()

    load_config_for_pid(config["pid"])
    story_history_file = os.path.join(settings.DATA_DIR, config["pid"], "story_history.json")
    if not os.path.exists(story_history_file):
        with open(story_history_file, "w", encoding="utf-8") as handle:
            json.dump({"history": []}, handle)
    refresh_system_instruction()

    # Start pupil connector in a separate thread
    try:
        if os.getenv("CRAFT_CAMERA", "pupil") != "off":
            pupil_connector.start()
    except Exception as e:
        logger.error(f"Failed to start pupil connector: {e}")

    global image_generator
    image_generator = None
    try:
        image_generator = GeminiImageGenerator()
    except Exception as e:
        logger.error(f"Failed to initialize image generator: {e}")

    app.state.background_tasks = [
        asyncio.create_task(main_loop()),
        asyncio.create_task(proactive_suggestion_loop()),
    ]


@app.on_event("shutdown")
async def shutdown_event():
    """Save data and clean up resources on app shutdown"""
    logger.info("Application shutting down, saving suggestion history...")
    tasks = getattr(app.state, "background_tasks", [])
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    app.state.background_tasks = []
    save_suggestion_history()
    
    # Close OpenCV debug windows if they were opened
    try:
        cv2.destroyAllWindows()
    except Exception as e:
        logger.debug(f"Error closing OpenCV windows: {e}")
    
    # Stop pupil connector
    try:
        await asyncio.to_thread(pupil_connector.stop)
    except Exception as e:
        logger.error(f"Error stopping pupil connector: {e}")

    if fpv_tracker is not None:
        try:
            fpv_tracker.embedder.cleanup()
        except Exception as e:
            logger.error(f"Error closing image embedder: {e}")

    for owner in (llm_client, image_generator):
        client = getattr(owner, "client", None)
        if client is not None:
            try:
                await client.aio.aclose()
            except Exception as e:
                logger.error(f"Error closing asynchronous AI client: {e}")
            finally:
                try:
                    client.close()
                except Exception as e:
                    logger.error(f"Error closing AI client: {e}")


@app.get("/")
async def root():
    """Root endpoint to check if API is running"""
    return {"status": "ok", "message": f"{settings.PROJECT_NAME} API is running"}


@app.get("/image")
async def get_image():
    """
    Return the most recent frame captured by the pupil connector as a JPEG image.
    This endpoint is intended to be consumed by your Next.js app.
    """
    frame = pupil_connector.get_recent_frame()
    if frame is None:
        return Response(content="No camera frame. Check Pupil Capture or the configured webcam.", status_code=503)
    # Encode the image as JPEG
    success, buffer = cv2.imencode('.jpg', frame)

    context_data.env_context.set_user_capture_fpv_sequence_from_image_queue()

    if not success:
        return Response(content="Image encoding failed", status_code=500)
    # Return the in-memory bytes as a response with the appropriate media type
    return Response(content=buffer.tobytes(), media_type="image/jpeg")


async def store_img(image_array):
    """Store image to file and log its path"""
    images_dir = os.path.join(settings.DATA_DIR, config["pid"], "images")
    os.makedirs(images_dir, exist_ok=True)
    fmt_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    image_path = os.path.join(images_dir, f"{fmt_time}.jpg")
    # Convert BGR to RGB and save
    image_array = cv2.cvtColor(image_array, cv2.COLOR_BGR2RGB)
    cv2.imwrite(image_path, image_array)
    event_logger.info(f"Image saved at: {image_path}")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global storage, context_data, session_mode, PROACTIVE_SUGGESTION_PRIORITY
    await manager.connect(websocket)
    try:
        while (manager.is_connected(websocket)
               and websocket.application_state == WebSocketState.CONNECTED
               and websocket.client_state == WebSocketState.CONNECTED):
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                command = message.get("command")
                payload = message.get("payload", {})

                logger.info(f"Received command: {command}")


                if command == "interaction_state":
                    if isinstance(payload.get("idle"), bool):
                        manager.set_interaction_idle(websocket, payload["idle"])
                    continue

                if command in {"authoring_submit", "authoring_answer", "user speaking", "photo", "select_moments", "generate_image", "generate_new_content", "regenerate_with_feedback", "save_and_update_context", "save_plot_connection"}:
                    manager.set_interaction_idle(websocket, False)

                if command == "authoring_submit":
                    # Use request context to prevent duplicate authoring submissions
                    request_id = f"authoring_submit_{hash(str(payload))}"
                    async with llm_request_context(request_id) as should_proceed:
                        if not should_proceed:
                            logger.info("Skipping duplicate authoring submit request")
                            continue
                    
                    print("Authoring submit received")
                    audio_path = None
                    try:
                        # Process photo and transcription from front-end
                        photo_base64 = payload.get("photo")
                        transcription = payload.get("transcription", "")
                        audio_base64 = payload.get("audio_base64", "")

                        if audio_base64:
                            try:
                                # Ensure temp directory exists
                                temp_dir = os.path.join(settings.DATA_DIR, config["pid"], "temp")
                                os.makedirs(temp_dir, exist_ok=True)
                                
                                # Decode and save the audio file with timestamp
                                audio_bytes = base64.b64decode(audio_base64)
                                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]
                                audio_filename = f"user_audio_{timestamp}.webm"
                                audio_path = os.path.join(temp_dir, audio_filename)
                                with open(audio_path, "wb") as f:
                                    f.write(audio_bytes)
                                
                                logger.info(f"User audio for authoring_submit saved to: {audio_path}")

                            except Exception as e:
                                logger.error(f"Error processing user audio for authoring_submit: {e}")
                                audio_path = None

                        # Log the received transcription
                        event_logger.info(f"Authoring transcription: {transcription}")
                        images = None
                        image_array = None
                        if photo_base64:
                            try:
                                if photo_base64.startswith('data:image'):
                                    photo_base64 = photo_base64.split(',')[1]
                                image_bytes = base64.b64decode(photo_base64)
                                pil_image = Image.open(io.BytesIO(image_bytes))
                                image_array = np.array(pil_image)
                                images = [image_array]
                            except Exception as e:
                                logger.error(f"Error processing photo in authoring_submit: {e}")
                                images = None
                        # Call Gemini with transcription and photo as image input

                        img_desc = await llm_client.process_prompt(
                            system_instruction="Describe User Environment, Vibe, and Behavior. Find interesting thing in the image (If there is red dot/circle on the image, it indicates user`s gaze position.).",
                            images=context_data.env_context.get_user_capture_fpv_sequence(),
                            max_tokens=200,
                            with_history=None,
                            model_name=os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash-lite-preview-06-17") # Using the fast model
                        )
                        # Log the image description response
                        event_logger.info(f"Gemini image description: {img_desc}")
                        location = get_current_location()
                        response = await llm_client.process_prompt(
                            text=str({
                                "request mode": "authoring mode",
                                "img_desc": img_desc,
                                "user_transcript": transcription,
                                "location": location,
                                "date & time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "note": "Text may have errors. If audio provided, prioritize audio for correction."
                            }),
                            images=images,
                            audio_path=audio_path,
                            past_context=context_data.fiction_context_to_dict(),
                        )
                        # Log the AI response for authoring_submit
                        event_logger.info(f"AI response for authoring_submit: {response}")
                        try:
                            parsed_response = detect_json(response)
                            
                            # Check for suggestion priority mode
                            if parsed_response.get("mode") == "set_suggestion_priority":
                                new_priority = parsed_response.get("response", {}).get("priority")
                                if new_priority:
                                    PROACTIVE_SUGGESTION_PRIORITY = new_priority
                                    logger.info(f"Proactive suggestion priority updated to: {new_priority}")
                                    save_config(config["pid"]) # Save config after priority update
                                    # Send confirmation back to the user
                                    await manager.broadcast_json({
                                        "type": "notification",
                                        "message": parsed_response.get("response", {}).get("confirmation", "Priority updated."),
                                        "timestamp": time.time()
                                    })
                                continue # Skip the default response handler at the end
                            
                            # add timestamp to the response [JSON]
                            parsed_response["timestamp"] = time.time()
                            parsed_response["user_input"] = transcription
                            print(json.dumps(parsed_response, indent=2, ensure_ascii=False))
                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(parsed_response, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })

                            # Create a combined context
                            context_update = {
                                "user_input": {
                                    "transcription": transcription,
                                    "image_description": img_desc,
                                    "location": location,
                                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                                },
                                "ai_response": parsed_response["response"]
                            }

                            # Log the context update structure
                            logger.info(
                                f"Sending context update to fiction context updater: {json.dumps(context_update, indent=2, ensure_ascii=False)}")

                            await fiction_context_updater.update_full_context(context_update)
                            if image_array is not None:
                                await store_img(image_array)
                        except Exception as e:
                            logger.error(f"Error parsing Gemini response: {e}")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to parse authoring response from Gemini"
                            })
                    finally:
                        # Audio file is kept for future use
                        pass

                elif command == "generate_image":
                    # Process image generation request
                    photo_base64 = payload.get("image")
                    authoring_data = payload.get("authoringData")
                    if not photo_base64 or not authoring_data:
                        await manager.send_json(websocket, {
                            "type": "error",
                            "message": "Missing image data or authoring data"
                        })
                        continue
                    try:
                        # Extract base64 data if it's a data URL
                        if photo_base64.startswith('data:image'):
                            photo_base64 = photo_base64.split(',')[1]
                        # Convert base64 to image array
                        image_bytes = base64.b64decode(photo_base64)
                        image = Image.open(io.BytesIO(image_bytes))
                        image_array = np.array(image)

                        # Send message that generation has started
                        await manager.send_json(websocket, {
                            "type": "system",
                            "message": "Image generation started",
                            "status": "generating"
                        })
                        # Generate image
                        result = await image_generator.generate_image(image_array, authoring_data, config["pid"])
                        img_path = result.get("responseText", "")
                        if not result.get("imageBase64") or not img_path or not os.path.isfile(img_path):
                            raise GeminiRequestError("Image generation did not produce a saved image. Please try again.")
                        # Send result via WebSocket - focus on the base64 data which works directly in browsers
                        await manager.broadcast_json({
                            "type": "pong",
                            "message": json.dumps({
                                "mode": "image_generation",
                                "response": {
                                    "imageBase64": result.get("imageBase64"),
                                    "responseText": result.get("responseText", "")
                                }
                            }, ensure_ascii=False),
                            "timestamp": time.time()
                        })

                        # Log the generation
                        event_logger.info(f"Generated image successfully")

                        # Update the moment with the image path
                        if img_path:
                            event_logger.info(f"Generated image at: {img_path}")
                            await fiction_context_updater.update_img_path_for_moment(img_path, authoring_data)

                    except Exception as e:

                        logger.error(f"Error generating image: {e}")

                        await manager.send_json(websocket, {

                            "type": "error",

                            "message": f"Error generating image: {str(e)}"

                        })


                elif command == "authoring_answer":
                    # Process answer from user for the question
                    audio_path = None
                    try:
                        answer = payload.get("answer", "")
                        audio_base64 = payload.get("audio_base64", "")

                        if audio_base64:
                            try:
                                # Ensure temp directory exists
                                temp_dir = os.path.join(settings.DATA_DIR, config["pid"], "temp")
                                os.makedirs(temp_dir, exist_ok=True)
                                
                                # Decode and save the audio file with timestamp
                                audio_bytes = base64.b64decode(audio_base64)
                                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]
                                audio_filename = f"user_audio_{timestamp}.webm"
                                audio_path = os.path.join(temp_dir, audio_filename)
                                with open(audio_path, "wb") as f:
                                    f.write(audio_bytes)
                                
                                logger.info(f"User audio for authoring_answer saved to: {audio_path}")

                            except Exception as e:
                                logger.error(f"Error processing user audio for authoring_answer: {e}")
                                audio_path = None

                        logger.info(f"Received authoring answer: {answer}")
                        # Log the answer transcription
                        event_logger.info(f"Authoring answer transcription: {answer}")

                        response = await llm_client.process_prompt(
                            text=str({
                                "user_answer_transcript": answer,
                                "context": "user answer/request on current moments",
                "note": "Text may have errors. If audio provided, prioritize audio for correction."
                            }),
                            past_context=context_data.fiction_context_to_dict(),
                            audio_path=audio_path,
                        )
                        # Log the AI response for authoring_answer
                        event_logger.info(f"AI response for authoring_answer: {response}")
                        try:
                            parsed_response = detect_json(response)
                            print("Hi", json.dumps(parsed_response, indent=2, ensure_ascii=False))
                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(parsed_response, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })

                            # Create context update with user input and AI response
                            context_update = {
                                "user_input": {
                                    "transcription": answer,
                                    "image_description": "",
                                    "location": get_current_location(),
                                    "timestamp": time.strftime("%Y-m-d %H:%M:%S")
                                },
                                "ai_response": parsed_response["response"]
                            }

                            await fiction_context_updater.update_full_context(context_update)
                        except Exception as e:
                            logger.error(f"Error parsing Gemini response: {e}")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to parse authoring response from Gemini"
                            })

                        # Optionally, update conversation history with the answer here
                        await manager.send_json(websocket, {
                            "type": "system",
                            "message": "Authoring answer received and conversation updated.",
                            "timestamp": time.time()
                        })
                    finally:
                        # Audio file is kept for future use
                        pass

                elif command == "select_moments":
                    print("Select moments received")
                    event_logger.info("Select moments command received")
                    response = await llm_client.process_prompt(
                        text=str({"system": "Now Generate a list of moments from the content."}),
                        past_context=context_data.fiction_context_to_dict(),
                    )
                    try:
                        parsed_response = detect_json(response)
                        parsed_response["timestamp"] = time.time()
                        event_logger.info(f"Select moments response: {json.dumps(parsed_response, indent=2, ensure_ascii=False)}")
                        await manager.broadcast_json({
                            "type": "pong",
                            "message": json.dumps(parsed_response, indent=2, ensure_ascii=False),
                            "timestamp": time.time()
                        })
                    except Exception as e:
                        logger.error(f"Error parsing Gemini response: {e}")
                        await manager.send_json(websocket, {
                            "type": "error",
                            "message": "Failed to parse authoring response from Gemini"
                        })

                elif command == "user speaking":
                    # Use request context to prevent duplicate user speaking processing
                    transcription = payload.get("transcription", "")
                    request_id = f"user_speaking_{hash(transcription)}"
                    async with llm_request_context(request_id) as should_proceed:
                        if not should_proceed:
                            logger.info("Skipping duplicate user speaking request")
                            continue
                    
                    audio_base64 = payload.get("audio_base64", "")
                    audio_path = None
                    
                    if audio_base64:
                        try:
                            # Ensure temp directory exists
                            temp_dir = os.path.join(settings.DATA_DIR, config["pid"], "temp")
                            os.makedirs(temp_dir, exist_ok=True)
                            
                            # Decode and save the audio file with timestamp
                            audio_bytes = base64.b64decode(audio_base64)
                            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]
                            audio_filename = f"user_audio_{timestamp}.webm"
                            audio_path = os.path.join(temp_dir, audio_filename)
                            with open(audio_path, "wb") as f:
                                f.write(audio_bytes)
                            
                            logger.info(f"User audio saved to: {audio_path}")

                        except Exception as e:
                            logger.error(f"Error processing user audio: {e}")
                            audio_path = None

                    # Log the transcription from the user
                    event_logger.info(f"User speaking transcription: {transcription}")
                    
                    if any(phrase in transcription.lower() for phrase in ["show plot"]):
                        try:
                            # Get recent frame and convert to base64
                            recent_frame = pupil_connector.get_recent_frame()
                            if recent_frame is not None:
                                _, buffer = cv2.imencode('.jpg', recent_frame)
                                image_base64 = base64.b64encode(buffer).decode('utf-8')
                                # Convert BGR to RGB for Gemini
                                recent_frame_rgb = cv2.cvtColor(recent_frame, cv2.COLOR_BGR2RGB)
                            else:
                                image_base64 = None
                                recent_frame_rgb = None
                            response = await llm_client.process_prompt(
                                text=json.dumps({
                                    "mode": "plot_demonstration",
                                    "Current Location": get_current_location(),
                                    "Response Language": config["response_language"],
                                }, ensure_ascii=False),
                                images=[recent_frame_rgb] if recent_frame_rgb is not None else None,
                                audio_path=audio_path,
                                update_history=False,
                                past_context=context_data.fiction_context_to_dict(),
                                system_instruction="""
Organize the plot into a timeline of moments (blocks), supporting both sequential and parallel (branching) events.
If the plot is not organized, make it organized in a meaningful way. If the plot was organized before, return the current plot with modifications with new user interaction history.
For each moment:
1. Share the moment's story concisely (max 20 words) as the block's main text.
2. If an image is available for the moment based on the history, include its file path. set null if not available.
3. Analyze if a moment is already elaborated in the plot, if so, set "currentDetailLevel": "high". Otherwise, set "currentDetailLevel": "low".
4. Analyze if the moment is happens in current environment. If the descriptive moment looks like happening in the current environment (i.e., the image frame I send to you), include "relevantToCurrentEnvironment": "yes". Otherwise, include "relevantToCurrentEnvironment": "no". For example, if the moment is about Locked room mystery, and the current environment is a (small) bedroom, it is relevant. If the moment is about coding in office and the current environment is a bedroom, it is not relevant.
5. Allow for some moments to happen at the same time (i.e., parallel/branching moments). Indicate this by including a 'parents' array (IDs of previous moments this moment follows).
6. Arrange moments so that blocks with the same parents are on the same level (row), and connect them visually in the output structure.
7. Output a JSON structure like:
{
  "currentFPV": "short description of current frame's environment",
  "moments": [
    { "id": "1", "description": "...", "imageUrl": null, "currentDetailLevel": "low/high", "relevantToCurrentEnvironment": "yes/no", "parents": [] },
    { "id": "2", "description": "...", "imageUrl": null, "currentDetailLevel": "low/high", "relevantToCurrentEnvironment": "yes/no", "parents": ["1"] },
    { "id": "3", "description": "...", "imageUrl": "generated_images/scene.jpg", "currentDetailLevel": "low/high", "relevantToCurrentEnvironment": "yes/no", "parents": ["1"] },
    { "id": "4", "description": "...", "imageUrl": null, "currentDetailLevel": "low/high", "relevantToCurrentEnvironment": "yes/no", "parents": ["2", "3"] }
  ]
}
Return only the JSON structure.
"""
                            )
                            parsed_response = detect_json(response)
                            # Add timestamp to the response
                            parsed_response["timestamp"] = time.time()
                            # Add mode identifier
                            parsed_response["mode"] = "plot_demonstration"
                            print(json.dumps(parsed_response, indent=2, ensure_ascii=False))
                            # Log the plot demonstration response
                            event_logger.info(f"Plot demonstration response: {json.dumps(parsed_response, indent=2, ensure_ascii=False)}")
                            # Broadcast the successful response
                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(parsed_response, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })
                        except Exception as e:
                            logger.error(f"Error parsing plot demonstration response: {e}")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to parse plot demonstration response"
                            })

                    elif transcription.strip().lower() == 'start role-playing':
                        # Logic to start role-playing
                        logger.info("Starting role-playing mode...")
                        session_mode = 'role-play' # Set session mode
                        
                        # Generate role-play scenario using existing LLM client
                        role_play_prompt = f"""
                        Create a role-playing scenario based on the current fiction context. 
                        Think: 1. How many characters are in the scene? 2. If more than 1, AI should play which role and author should play which role? 3. If there is only one character, it will be monologue mode which author will play the single character.
                        Generate:
                        
                        1. User Role: Character's Name and 1-2 descriptive adjectives (e.g., "Angry Vincent")
                        2. AI Role: Character's Name and 1-2 descriptive adjectives. If there is only one character, it will be monologue mode and AI role is "Monologue".
                        3. AI Opening Dialogue: A natural, engaging opening line that the AI character would say
                        4. Image Prompt: A detailed physical description for generating the AI character's portrait, including their current expression and mood based on their opening dialogue.
                        

                        Response_language: {config["response_language"]}
                        
                        Return as JSON:
                        {{
                            "user_role": "Role Name",
                            "ai_role": "Role Name",
                            "ai_dialogue": "Opening dialogue...",
                            "image_prompt": "Detailed physical description of the AI character, including clothing, facial features, hair, and their current expression/mood."
                        }}
                        """
                        
                        try:
                            # Generate text content first using existing LLM client
                            response = await llm_client.process_prompt(
                                text=role_play_prompt,
                                with_history="text",
                                audio_path=audio_path,
                                past_context=context_data.fiction_context_to_dict()
                            )
                            
                            parsed_response = detect_json(response)
                            
                            # Send initial role-play data immediately without waiting for image
                            role_play_data = {
                                "mode": "role_play",
                                "response": {
                                    "user_role": parsed_response.get("user_role", "N.A."),
                                    "ai_role": parsed_response.get("ai_role", "N.A."),
                                    "ai_dialogue": parsed_response.get("ai_dialogue", "N.A."),
                                    "ai_image_base64": None  # Will be sent separately
                                }
                            }
                            
                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(role_play_data, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })

                            # Generate character portrait asynchronously using the new method
                            image_prompt = parsed_response.get("image_prompt")
                            if image_prompt:
                                try:
                                    # Get the most recent generated image as base
                                    base_image = None
                                    try:
                                        # Try to get recent camera frame first
                                        base_image = pupil_connector.get_recent_frame()
                                        if base_image is not None:
                                            base_image = cv2.cvtColor(base_image, cv2.COLOR_BGR2RGB)
                                    except Exception as e:
                                        logger.warning(f"Could not get camera frame: {e}")
                                    
                                    # If no camera frame, try to get the last generated image
                                    if base_image is None:
                                        # Look for the most recent generated image file
                                        images_dir = os.path.join(settings.DATA_DIR, config["pid"], "generated_images")
                                        if os.path.exists(images_dir):
                                            image_files = [f for f in os.listdir(images_dir) if f.endswith(('.jpg', '.jpeg', '.png'))]
                                            if image_files:
                                                # Get the most recent image file
                                                latest_image = max(image_files, key=lambda x: os.path.getctime(os.path.join(images_dir, x)))
                                                image_path = os.path.join(images_dir, latest_image)
                                                pil_image = Image.open(image_path)
                                                base_image = np.array(pil_image)
                                                logger.info(f"Using previous generated image as base: {latest_image}")
                                    
                                    if base_image is not None:
                                        logger.info(f"Generating role-play portrait for {parsed_response.get('ai_role', 'character')}")
                                        
                                        # Generate the character portrait
                                        portrait_base64 = await image_generator.generate_roleplay_portrait(
                                            base_image_array=base_image,
                                            character_role=parsed_response.get("ai_role", "Wise Guide"),
                                            character_description=image_prompt,
                                            pid=config["pid"]
                                        )
                                        
                                        if portrait_base64:
                                            # Send image update
                                            image_update = {
                                                "mode": "role_play",
                                                "response": {
                                                    "ai_image_base64": portrait_base64
                                                }
                                            }
                                            await manager.broadcast_json({
                                                "type": "pong",
                                                "message": json.dumps(image_update, indent=2, ensure_ascii=False),
                                                "timestamp": time.time()
                                            })
                                        else:
                                            logger.warning("Failed to generate role-play portrait")
                                    else:
                                        logger.warning("No base image available for role-play portrait generation")
                                        
                                except Exception as img_error:
                                    logger.error(f"Error generating role-play character portrait: {img_error}")
                                    await manager.send_json(websocket, {
                                        "type": "notification",
                                        "message": f"Portrait unavailable: {img_error} You can continue the conversation."
                                    })

                        except Exception as e:
                            logger.error(f"Error processing role-play start: {e}")
                            session_mode = None
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": f"Could not start role-play: {e}"
                            })

                    elif session_mode == 'role-play':
                        # Handle ongoing role-play dialogue
                        logger.info("Continuing role-play dialogue...")
                        response = await llm_client.process_prompt(
                            text=f"""You are an expert role-play AI. Analyze the user's input, which may contain both out-of-character instructions and in-character dialogue.

- The user's input is: '{transcription}'. This may be in-character dialogue, out-of-character instructions, or a mix.
- Your task is to:
  1. Determine the user's role and your (the AI's) role based on the ongoing conversation.
  2. **Extract and refine the user's in-character dialogue from their input.** Clean up any speech-to-text errors and remove out-of-character phrases (e.g., 'I want to say...').
  3. Generate an appropriate in-character response for the AI. If it's monologue mode, "ai_dialogue" should return author's speech for reference.
  4. Create a detailed image prompt for the AI character's portrait that reflects the dialogue's content and emotion.

The response should be in {config["response_language"]}.

Return ONLY a JSON object with the following structure:
{{
    "user_role": "The user's determined character (e.g., 'Vincent')",
    "user_dialogue": "The user's in-character dialogue, corrected and extracted from their input.",
    "ai_role": "The AI's determined character (e.g., 'Happy Alice')",
    "ai_dialogue": "The AI character's in-character response. (if it's monologue mode, here should return author's request/speech.)",
    "image_prompt": "Detailed physical description for the AI character's portrait, including clothing, facial features, expression, and mood based on the dialogue."
}}""",
                            audio_path=audio_path,
                        )
                        try:
                            parsed_response = detect_json(response)
                            portrait_base64 = None
                            
                            image_prompt = parsed_response.get("image_prompt")
                            if image_prompt:
                                try:
                                    # Get the most recent generated image as base
                                    base_image = None
                                    try:
                                        # Try to get recent camera frame first
                                        base_image = pupil_connector.get_recent_frame()
                                        if base_image is not None:
                                            base_image = cv2.cvtColor(base_image, cv2.COLOR_BGR2RGB)
                                    except Exception as e:
                                        logger.warning(f"Could not get camera frame: {e}")

                                    if base_image is None:
                                        images_dir = os.path.join(settings.DATA_DIR, config["pid"], "generated_images")
                                        if os.path.exists(images_dir):
                                            image_files = [f for f in os.listdir(images_dir) if f.endswith(('.jpg', '.jpeg', '.png'))]
                                            if image_files:
                                                latest_image = max(image_files, key=lambda x: os.path.getctime(os.path.join(images_dir, x)))
                                                image_path = os.path.join(images_dir, latest_image)
                                                pil_image = Image.open(image_path)
                                                base_image = np.array(pil_image)
                                                logger.info(f"Using previous generated image as base: {latest_image}")
                                    
                                    if base_image is not None:
                                        logger.info(f"Generating role-play portrait for {parsed_response.get('ai_role', 'character')}")
                                        portrait_base64 = await image_generator.generate_roleplay_portrait(
                                            base_image_array=base_image,
                                            character_role=parsed_response.get("ai_role", "Wise Guide"),
                                            character_description=image_prompt,
                                            pid=config["pid"]
                                        )
                                    else:
                                        logger.warning("No base image available for role-play portrait generation")
                                except Exception as img_error:
                                    logger.error(f"Error generating role-play character portrait: {img_error}")
                                    await manager.send_json(websocket, {
                                        "type": "notification",
                                        "message": f"Portrait unavailable: {img_error} You can continue the conversation."
                                    })

                            role_play_update = {
                                "mode": "role_play",
                                "response": {
                                    "ai_dialogue": parsed_response.get("ai_dialogue", "I'm not sure what to say."),
                                    "user_role": parsed_response.get("user_role", "Curious Traveler"),
                                    "ai_role": parsed_response.get("ai_role", "Wise Guide"),
                                    "ai_image_base64": portrait_base64
                                }
                            }

                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(role_play_update, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })

                            # Automatically update the main fiction context with the role-play dialogue
                            logger.info("Updating fiction context with role-play dialogue...")
                            
                            # Use the refined user_dialogue from the AI if available, otherwise fall back to raw transcription
                            refined_user_transcription = parsed_response.get("user_dialogue", transcription)

                            context_update = {
                                "user_input": {
                                    "transcription": refined_user_transcription,
                                    "image_description": "",  # No image description in role-play dialogue
                                    "location": get_current_location(),
                                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                                },
                                "ai_response": parsed_response
                            }
                            await fiction_context_updater.update_full_context(context_update)
                        except Exception as e:
                            logger.error(f"Error processing role-play dialogue: {e}")

                    else:
                        # Normal user speaking processing
                        response = await llm_client.process_prompt(
                            text=str({
                                "user_text_transcript": transcription,
                "note": "Text may have errors. If audio provided, prioritize audio for correction."
                            }),
                            audio_path=audio_path,
                            past_context=context_data.fiction_context_to_dict()
                        )
                        # Log the AI response for user speaking
                        event_logger.info(f"AI response for user speaking: {response}")
                        try:
                            parsed_response = detect_json(response)
                            print(json.dumps(parsed_response, indent=2, ensure_ascii=False))
                            if parsed_response.get("mode") == "full":
                                # check if the history file exists, if not create it
                                if not os.path.exists(
                                        os.path.join(settings.DATA_DIR, config["pid"], "story_history.json")):
                                    with open(os.path.join(settings.DATA_DIR, config["pid"], "story_history.json"),
                                              "w") as f:
                                        json.dump({"history": []}, f, indent=2, ensure_ascii=False)
                                with open(os.path.join(settings.DATA_DIR, config["pid"], "story_history.json"),
                                          "r") as f:
                                    story_history = json.load(f)
                                story_history["history"].append({
                                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                                    "content": parsed_response["response"]["full writing"]
                                })
                                with open(os.path.join(settings.DATA_DIR, config["pid"], "story_history.json"),
                                          "w") as f:
                                    json.dump(story_history, f, indent=2, ensure_ascii=False)
                            elif parsed_response.get("mode") == "set_suggestion_priority":
                                new_priority = parsed_response.get("response", {}).get("priority")
                                if new_priority:
                                    PROACTIVE_SUGGESTION_PRIORITY = new_priority
                                    logger.info(f"Proactive suggestion priority updated to: {new_priority}")
                                    config["proactive_suggestion_priority"] = new_priority
                                    save_config(config["pid"])
                                    refresh_system_instruction()
                                    # Send confirmation back to the user
                                    await manager.broadcast_json({
                                        "type": "notification",
                                        "message": parsed_response.get("response", {}).get("confirmation", "Priority updated."),
                                        "timestamp": time.time()
                                    })
                                continue # Skip the default response handler at the end
                                
                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(parsed_response, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })

                            # Create context update with user input and AI response
                            context_update = {
                                "user_input": {
                                    "transcription": transcription,
                                    "image_description": "",
                                    "location": get_current_location(),
                                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                                },
                                "ai_response": parsed_response["response"]
                            }

                            await fiction_context_updater.update_full_context(context_update)
                        except Exception as e:
                            logger.error(f"Error parsing Gemini response: {e}")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to parse authoring response from Gemini"
                            })

                    # Audio file is kept for future use


                elif command == "reset_system":
                    print("System reset received")
                    event_logger.info("System reset command received")
                    # This is already handled by the frontend, just acknowledge
                    await manager.send_json(websocket, {
                        "type": "system",
                        "status": "success",
                        "message": "System reset acknowledged"
                    })

                elif command == "photo":
                    event_logger.info("Photo command received")
                    await manager.send_json(websocket, {
                        "type": "photo_ack",
                        "message": f"Sending photo to LLM for processing",
                        "timestamp": time.time()
                    })

                elif command == "save_plot_connection":
                    plot_connection = payload.get("plot_connection")
                    event_logger.info(f"Save plot connection: {json.dumps(plot_connection, ensure_ascii=False)}")
                    try:
                        success = await fiction_context_updater.update_plot_connection(plot_connection)
                        if success:
                            event_logger.info("Plot connection saved successfully")
                            await manager.send_json(websocket, {
                                "type": "system",
                                "status": "success",
                                "message": "Plot connections saved! Deleted moments have been removed."
                            })
                        else:
                            event_logger.info("Failed to save plot connection")
                            await manager.send_json(websocket, {
                                "type": "system",
                                "status": "error",
                                "message": "Failed to update plot connections."
                            })
                    except Exception as e:
                        logger.error(f"Failed to update plot_connection: {e}")
                        event_logger.info(f"Error saving plot connection: {str(e)}")
                        await manager.send_json(websocket, {
                            "type": "system",
                            "status": "error",
                            "message": "Failed to save plot connections."
                        })

                elif command == "generate_new_content":
                    print("Generate new content received")
                    try:
                        # Get current frame for context
                        recent_frame = pupil_connector.get_recent_frame()
                        # Convert BGR to RGB for Gemini
                        recent_frame_rgb = cv2.cvtColor(recent_frame, cv2.COLOR_BGR2RGB) if recent_frame is not None else None
                        
                        # Get the latest user_saved story content
                        latest_story_content = ""
                        try:
                            story_history_file = os.path.join(settings.DATA_DIR, config["pid"], "story_history.json")
                            if os.path.exists(story_history_file):
                                with open(story_history_file, "r") as f:
                                    story_history = json.load(f)
                                
                                # Find the latest user_saved entry
                                user_saved_entries = [
                                    entry for entry in story_history.get("history", [])
                                    if entry.get("type") == "user_saved"
                                ]
                                
                                if user_saved_entries:
                                    latest_story_content = user_saved_entries[-1].get("content", "")
                                    logger.info(f"Found latest user_saved story content: {len(latest_story_content)} characters")
                        except Exception as e:
                            logger.error(f"Error reading story history: {e}")
                        
                        # Generate new content based on recent interactions and current context
                        response = await llm_client.process_prompt(
                            text=json.dumps({
                                "mode": "generate_new_content",
                                "request": "Generate new full story content based on all recent interactions and current context",
                                "current_location": get_current_location(),
                                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                                "latest_user_saved_story": latest_story_content
                            }, ensure_ascii=False),
                            images=[recent_frame_rgb] if recent_frame_rgb is not None else None,
                            past_context=context_data.fiction_context_to_dict(),
                            model_name=os.getenv("GEMINI_DRAFT_MODEL", "gemini-2.5-pro"),
                            system_instruction=f"""
Generate a comprehensive story or narrative content that logically connects to the user's existing story while incorporating their recent interactions and current context.

IMPORTANT REQUIREMENTS:
1. **Logical Connection**: If there's existing user_saved story content, your new content must logically continue from where that story left off. Maintain narrative coherence and flow.

2. **Logical Authenticity**: Ensure all events, character actions, and plot developments follow logical cause-and-effect relationships. Avoid plot holes or inconsistent behavior.

3. **Human Authenticity**: Write characters and dialogue that feel natural and human. Include realistic behaviors, speech patterns, psychological responses, and emotional reactions that readers can relate to. Emotions should arise naturally from the situations and character experiences.

4. **Factual Authenticity**: When describing professional fields, industries, historical events, or technical subjects, ensure accuracy and adherence to real-world facts. Research and incorporate authentic details about specific professions, historical contexts, cultural practices, or technical processes to maintain credibility.

5. **Grounded in Details**: Base your narrative on specific details from user observations and emotional expressions. Use concrete sensory details and specific emotional states rather than vague descriptions.

6. **Seamless Integration**: If continuing an existing story, make the transition smooth and natural. The new content should feel like a natural continuation, not a disconnected addition.

[EXISTING STORY CONTEXT]:
{latest_story_content if latest_story_content else "No existing user_saved story content found."}

APPROACH:
- If there's existing content: Continue/Expand the story naturally, building upon established characters, setting, and plot elements. **The output should Keep original user written or confirmed content. Only very a few minor revision is allowed if you truly believe it's needed for new logic flow**
- If no existing content: Create a new story that incorporates current context and recent interactions
- Always maintain the established tone, style, and narrative voice
- Ensure new elements integrate seamlessly with existing story elements (note: the output should contain the updated full story with orginal [EXISTING STORY CONTEXT])

Return the content in a JSON format with the following structure:
{{
    "mode": "new_content_generated",
    "response": {{
        "content": "Your generated story content here...",
        "title": "Optional title for the content",
        "connection_note": "Brief explanation of how this connects to the existing story (if applicable)"
    }}
}}
"""
                        )
                        
                        # Log the content generation
                        event_logger.info(f"Generated new content: {response}")
                        
                        if not response:
                            logger.error("Received empty response from Gemini for new content generation.")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to generate new content: AI service returned an empty response."
                            })
                            continue
                        try:
                            parsed_response = detect_json(response)
                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(parsed_response, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })
                        except Exception as e:
                            logger.error(f"Error parsing new content response: {e}")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to parse new content response"
                            })
                    except Exception as e:
                        logger.error(f"Error generating new content: {e}")
                        await manager.send_json(websocket, {
                            "type": "error",
                            "message": f"Failed to generate new content: {str(e)}"
                        })

                elif command == "regenerate_with_feedback":
                    print("Regenerate with feedback received")
                    try:
                        original_content = payload.get("original_content", "")
                        feedback = payload.get("feedback", "")
                        
                        if not original_content and not feedback:
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Both original content and feedback are required"
                            })
                            continue
                        # Get the latest user_saved story content for context
                        latest_story_content = ""
                        try:
                            story_history_file = os.path.join(settings.DATA_DIR, config["pid"], "story_history.json")
                            if os.path.exists(story_history_file):
                                with open(story_history_file, "r") as f:
                                    story_history = json.load(f)
                                
                                # Find the latest user_saved entry
                                user_saved_entries = [
                                    entry for entry in story_history.get("history", [])
                                    if entry.get("type") == "user_saved"
                                ]
                                
                                if user_saved_entries:
                                    latest_story_content = user_saved_entries[-1].get("content", "")
                                    logger.info(f"Found latest user_saved story content for regeneration: {len(latest_story_content)} characters")
                        except Exception as e:
                            logger.error(f"Error reading story history for regeneration: {e}")
                        
                        # Get current frame for context
                        recent_frame = pupil_connector.get_recent_frame()
                        # Convert BGR to RGB for Gemini
                        recent_frame_rgb = cv2.cvtColor(recent_frame, cv2.COLOR_BGR2RGB) if recent_frame is not None else None
                        
                        # Generate new content based on original content and user feedback
                        response = await llm_client.process_prompt(
                            text=json.dumps({
                                "mode": "regenerate_with_feedback",
                                "request": "Regenerate story content based on user feedback",
                                "original_content": original_content,
                                "user_feedback": feedback,
                                "current_location": get_current_location(),
                                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                                "latest_user_saved_story": latest_story_content
                            }, ensure_ascii=False),
                            images=[recent_frame_rgb] if recent_frame_rgb is not None else None,
                            past_context=context_data.fiction_context_to_dict(),
                            model_name=os.getenv("GEMINI_DRAFT_MODEL", "gemini-2.5-pro"),
                            system_instruction=f"""
You are tasked with regenerating story content based on user feedback.

IMPORTANT: Regeneration here means to **modify** the AI-generated article (original_content) according to the user's feedback and requirements. If the AI-generated content is not available, use the user's last saved story (latest_user_saved_story) as the base for modification.

This is NOT a continuation or extension, but a revision or rewrite of the given content, addressing the user's feedback and requirements.

Your output should be a revised version of the original content (or last saved story), making only the necessary changes to address the feedback, while preserving the core narrative, style, and logic.

IMPORTANT REQUIREMENTS:
1. **Modification, not continuation**: Do NOT simply continue the story. Instead, revise the provided content (original_content or latest_user_saved_story) as needed.
2. **Logical Connection**: If there's existing user_saved story content, your regenerated content must logically connect to that story. Maintain narrative coherence and flow.
3. **Logical Authenticity**: Ensure all events, character actions, and plot developments follow logical cause-and-effect relationships. Avoid plot holes or inconsistent behavior.
4. **Human Authenticity**: Write characters and dialogue that feel natural and human. Include realistic behaviors, speech patterns, psychological responses, and emotional reactions that readers can relate to. Emotions should arise naturally from the situations and character experiences.
5. **Factual Authenticity**: When describing professional fields, industries, historical events, or technical subjects, ensure accuracy and adherence to real-world facts. Research and incorporate authentic details about specific professions, historical contexts, cultural practices, or technical processes to maintain credibility.
6. **Grounded in Details**: Base your narrative on specific details from user observations and emotional expressions. Use concrete sensory details and specific emotional states rather than vague descriptions.

ORIGINAL CONTENT TO REGENERATE:
{original_content}

USER FEEDBACK:
{feedback}

EXISTING STORY CONTEXT:
{latest_story_content if latest_story_content else 'No existing user_saved story content found.'}

APPROACH:
- Incorporate the user's feedback while maintaining the core narrative and style
- If there's existing story content, ensure the regenerated content logically connects to it
- Address the specific modifications requested by the user
- Maintain emotional and logical authenticity throughout
- Ensure the regenerated content feels like a natural part of the ongoing story
- If original_content is empty, use latest_user_saved_story as the base for modification

Return the content in a JSON format with the following structure:
{{
    "mode": "new_content_generated",
    "response": {{
        "content": "Your regenerated story content here...",
        "title": "Optional title for the content",
        "summary": "Brief summary of the content",
        "feedback_addressed": "Brief description of how the feedback was incorporated",
        "connection_note": "Brief explanation of how this connects to the existing story (if applicable)"
    }}
}}
"""
                        )
                        
                        # Log the content regeneration
                        event_logger.info(f"Regenerated content with feedback: {response}")
                        
                        if not response:
                            logger.error("Received empty response from Gemini for content regeneration.")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to regenerate content: AI service returned an empty response."
                            })
                            continue
                        try:
                            parsed_response = detect_json(response)
                            await manager.broadcast_json({
                                "type": "pong",
                                "message": json.dumps(parsed_response, indent=2, ensure_ascii=False),
                                "timestamp": time.time()
                            })
                        except Exception as e:
                            logger.error(f"Error parsing regenerated content response: {e}")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to parse regenerated content response"
                            })
                    except Exception as e:
                        logger.error(f"Error regenerating content with feedback: {e}")
                        await manager.send_json(websocket, {
                            "type": "error",
                            "message": f"Failed to regenerate content with feedback: {str(e)}"
                        })

                elif command == "update_settings":
                    new_pid = payload.get("pid")
                    new_lang = payload.get("response_language")
                    new_style = payload.get("writing_style")
                    new_proactive_suggestion_priority = payload.get("proactive_suggestion_priority")
                    if new_pid:
                        config["pid"] = new_pid
                        reload_pid_related_resources(new_pid)
                        logger.info(f"PID updated to {new_pid}")
                    if new_lang:
                        config["response_language"] = new_lang
                        logger.info(f"Response language updated to {new_lang}")
                    if new_style:
                        config["writing_style"] = new_style
                        logger.info(f"Writing style updated to {new_style}")
                    if new_proactive_suggestion_priority:
                        config["proactive_suggestion_priority"] = new_proactive_suggestion_priority
                        logger.info(f"Proactive suggestion priority updated to {new_proactive_suggestion_priority}")
                    # Save config to disk for this PID
                    save_config(config["pid"])
                    refresh_system_instruction()

                elif command == "save_and_update_context":
                    content = payload.get("content", "")
                    
                    if not content:
                        await manager.send_json(websocket, {
                            "type": "error",
                            "message": "No content provided to save"
                        })
                        continue
                    try:
                        # Log the saved content
                        event_logger.info(f"Saving content: {content}")
                        
                        # Save to story history
                        story_history_file = os.path.join(settings.DATA_DIR, config["pid"], "story_history.json")
                        
                        try:
                            if not os.path.exists(story_history_file):
                                with open(story_history_file, 'w') as f:
                                    json.dump({"history": []}, f, ensure_ascii=False)
                            
                            with open(story_history_file, "r") as f:
                                story_history = json.load(f)
                        except (json.JSONDecodeError, FileNotFoundError) as e:
                            logger.error(f"Error reading story_history.json: {e}. Creating new file.")
                            story_history = {"history": []}
                            with open(story_history_file, 'w') as f:
                                json.dump(story_history, f, ensure_ascii=False)

                        # Ensure story_history has the correct structure
                        if not isinstance(story_history, dict):
                            logger.warning(f"story_history is not a dict, resetting to default structure.")
                            story_history = {"history": []}
                        elif "history" not in story_history:
                            story_history["history"] = []
                        elif not isinstance(story_history["history"], list):
                            logger.warning(f"story_history['history'] is not a list, resetting to empty list.")
                            story_history["history"] = []
                        
                        story_history["history"].append({
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                            "content": content,
                            "type": "user_saved"
                        })
                        
                        with open(story_history_file, "w") as f:
                            json.dump(story_history, f, indent=2, ensure_ascii=False)

                        logger.info("Story content saved to history")

                        # Ensure context data is properly structured before updating
                        if context_data.fiction_context.scenes is None:
                            context_data.fiction_context.scenes = []
                        if context_data.fiction_context.characters is None:
                            context_data.fiction_context.characters = []
                        
                        # Analyze user's story revision and update context accordingly
                        logger.info("Analyzing user story revision to update context...")
                        
                        # Use the specialized revision analysis method
                        success = await fiction_context_updater.analyze_and_update_from_revision(content)
                        if not success:
                            logger.error("Failed to update fiction context")
                            await manager.send_json(websocket, {
                                "type": "error",
                                "message": "Failed to update context after saving content"
                            })
                            continue
                    except Exception as e:
                        logger.error(f"Error saving and updating context: {e}")
                        await manager.send_json(websocket, {
                            "type": "error",
                            "message": f"Failed to save and update context: {str(e)}"
                        })

                elif command == "get_settings":
                    # Support searching for another PID's settings
                    search_pid = payload.get("pid")
                    if search_pid:
                        # Try to load config for the searched PID
                        pid_folder = os.path.join(settings.DATA_DIR, search_pid)
                        config_path = os.path.join(pid_folder, "config.json")
                        if os.path.exists(config_path):
                            with open(config_path, "r", encoding="utf-8") as f:
                                pid_config = json.load(f)
                            await manager.send_json(websocket, {
                                "type": "settings",
                                "pid": search_pid,
                                "response_language": pid_config.get("response_language", "English"),
                                "writing_style": pid_config.get("writing_style", "Concise but touched language"),
                                "proactive_suggestion_priority": pid_config.get("proactive_suggestion_priority", "any"),
                            })
                        else:
                            await manager.send_json(websocket, {
                                "type": "settings_error",
                                "message": f"PID '{search_pid}' not found."
                            })
                    else:
                        await manager.send_json(websocket, {
                            "type": "settings",
                            "pid": config["pid"],
                            "response_language": config["response_language"],
                            "writing_style": config["writing_style"],
                            "proactive_suggestion_priority": PROACTIVE_SUGGESTION_PRIORITY,
                        })

                elif command == "reset_session":
                    logger.info("Resetting session state.")
                    session_mode = None
                    # Clear all request states
                    active_requests.clear()
                    last_request_timestamps.clear()


                else:
                    await manager.send_json(websocket, {
                        "type": "error",
                        "message": f"Unknown command: {command}"
                    })

            except WebSocketDisconnect:
                break
            except GeminiRequestError as error:
                logger.warning(f"Model request failed: {error}")
                await manager.send_json(websocket, {"type": "error", "message": str(error)})
            except json.JSONDecodeError:
                logger.error("Invalid JSON received")
                await manager.send_json(websocket, {
                    "type": "error",
                    "message": "Invalid JSON format"
                })
            except Exception as error:
                logger.exception("Request failed")
                await manager.send_json(websocket, {"type": "error", "message": str(error)})

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


@app.get("/api/get-latest-saved-content")
async def get_latest_saved_content():
    """Get the latest user-saved story content from story history"""
    try:
        story_history_file = os.path.join(settings.DATA_DIR, config["pid"], "story_history.json")
        
        if not os.path.exists(story_history_file):
            return {"content": "", "timestamp": None}
        
        with open(story_history_file, "r") as f:
            story_history = json.load(f)
        
        # Find the latest user_saved entry
        user_saved_entries = [
            entry for entry in story_history.get("history", [])
            if entry.get("type") == "user_saved"
        ]
        
        if not user_saved_entries:
            return {"content": "", "timestamp": None}
        
        # Get the most recent entry (assuming they're in chronological order)
        latest_entry = user_saved_entries[-1]
        
        return {
            "content": latest_entry.get("content", ""),
            "timestamp": latest_entry.get("timestamp")
        }
        
    except Exception as e:
        logger.error(f"Error getting latest saved content: {e}")
        return {"content": "", "timestamp": None, "error": str(e)}

def reload_pid_related_resources(new_pid):
    print(f"Reloading resources for new PID: {new_pid}")
    global storage, context_data, event_logger, event_log_file_path, fiction_context_updater, llm_client, suggestion_history
    
    # Save current context before switching (if needed)
    if context_data:
        storage.save_context(context_data)
    
    # Update config PID
    config["pid"] = new_pid
    
    # Reload storage and context for new PID
    storage = ContextStorage(new_pid)
    context_data = storage.load_context() or ContextData(pid=new_pid)

    # Serve generated images from the selected project.
    generated_dir = os.path.join(settings.DATA_DIR, new_pid, "generated_images")
    os.makedirs(generated_dir, exist_ok=True)
    for route in app.routes:
        if getattr(route, "name", None) == "generated":
            route.app = StaticFiles(directory=generated_dir)
            break
    
    # Reconfigure event logger for new PID
    event_log_file_path = os.path.join(settings.DATA_DIR, new_pid, "event_log.txt")
    for handler in event_logger.handlers[:]:
        event_logger.removeHandler(handler)
        handler.close()
    file_handler = logging.FileHandler(event_log_file_path, encoding='utf-8')
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
    event_logger.addHandler(file_handler)
    event_logger.propagate = False
    
    # Clean ALL LLM history and reload system message for new PID
    llm_client.reset_history()
    
    load_config_for_pid(new_pid)
    refresh_system_instruction()

    # Clean and reload suggestion history for new PID
    suggestion_history.clear()
    load_suggestion_history()
    
    # Re-initialize fiction_context_updater with new context_data
    fiction_context_updater = FictionContextUpdater(context_data, llm_client)
    
    # Clear active requests to prevent conflicts
    active_requests.clear()
    last_request_timestamps.clear()
    
    logger.info(f"Successfully reloaded all resources for PID: {new_pid}")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True
    )
