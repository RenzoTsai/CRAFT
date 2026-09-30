import os
import base64
from datetime import datetime
import logging
from PIL import Image

# Import the Google Genai package
from google import genai
from google.genai import types

from core.config import settings
from modules.llm.gemini_client import GeminiRequestError, describe_gemini_error

logger = logging.getLogger(__name__)
from translate import Translator


class GeminiImageGenerator:
    """
    Class to handle generation of images using Gemini's image generation capabilities
    """

    def __init__(self):
        """Initialize the Gemini client with API key from environment variable"""
        try:
            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                logger.error("GEMINI_API_KEY environment variable not set")
                raise ValueError("GEMINI_API_KEY environment variable not set")

            # Initialize the Google Genai client
            self.client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(
                    attempts=3,
                    initial_delay=1.0,
                    max_delay=4.0,
                    http_status_codes=[500, 502, 503, 504],
                )),
            )
            logger.info("Gemini Image Generator initialized successfully")
            self.translator= Translator(to_lang="en")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini Image Generator: {e}")
            raise

    def create_image_prompt(self, authoring_data):
        """
        Create a prompt for image generation based on authoring data

        Args:
            authoring_data (dict): Dictionary containing transformative scene and characters

        Returns:
            str: The generated prompt for Gemini
        """
        prompt = "Transform scene or some elements in image with the following elements/prompts:\n"

        print(f"Authoring data received: {authoring_data}")

        transformative_scene = authoring_data.get("transformative_scene", "")
        transformative_scene = self.translator.translate(transformative_scene)
        if transformative_scene:
            prompt += f"Scene: {transformative_scene}\n\n"

        transformative_characters = authoring_data.get("transformative_characters", [])
        for character in transformative_characters:
            character = self.translator.translate(str(character))
        if transformative_characters:
            prompt += "Characters:\n"
            for character in transformative_characters:
                prompt += f"- {character}\n"
            prompt += "\n"

        user_input = authoring_data.get("user_input", "")
        if user_input:
            user_input = self.translator.translate(user_input)
            prompt += f"User input: {user_input}\n\n"

        prompt += ("Preserve the general composition "
                   "and only transform mentioned scene, objects and people according to the descriptions. (don't draw descriptions in text format in the image)")
        

        return prompt

    async def generate_image(self, image_array, authoring_data, pid):
        """
        Generate an image using Gemini based on an input image and authoring data

        Args:
            image_array (numpy.ndarray): The input image as a numpy array
            authoring_data (dict): Dictionary containing transformative scene and characters
            pid (str): Patient ID for file organization

        Returns:
            dict: Dictionary containing base64 image data and response text
        """
        try:
            # Create directory for generated images if it doesn't exist
            images_dir = os.path.join(settings.DATA_DIR, pid, "generated_images")
            os.makedirs(images_dir, exist_ok=True)

            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(image_array)

            # Create prompt for image generation
            text_prompt = self.create_image_prompt(authoring_data)
            logger.info(f"Using prompt for image generation: {text_prompt}")

            # Generate the image with Gemini using the new method
            response = await self.client.aio.models.generate_content(
                model=os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.0-flash-exp-image-generation"),
                contents=[text_prompt, pil_image],
                config=types.GenerateContentConfig(
                    response_modalities=['Text', 'Image']
                )
            )

            response_text = ""
            image_base64 = None

            timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
            filename = f"generated_{timestamp}.jpg"
            file_path = os.path.join(images_dir, filename)

            # A blocked or text-only response has no generated image to save.
            candidate = response.candidates[0] if response.candidates else None
            parts = candidate.content.parts if candidate and candidate.content else []
            for part in parts or []:
                if part.text is not None:
                    response_text = part.text
                elif part.inline_data is not None:
                    # Generate filename with timestamp
                    try:
                        raw_image_data = part.inline_data.data

                        # Convert raw binary image data to a base64-encoded string
                        encoded_image = base64.b64encode(raw_image_data).decode('utf-8')

                        # Save the image file for record keeping
                        with open(file_path, 'wb') as f:
                            f.write(raw_image_data)

                        image_base64 = f"data:image/jpeg;base64,{encoded_image}"
                        logger.info(f"Generated image saved to {file_path}")
                    except Exception as e:
                        logger.error(f"Error processing image data: {e}")
                        raise

            if not image_base64:
                raise GeminiRequestError("Gemini returned no image. Please try a different description.")

            return {
                "imageBase64": image_base64,
                "responseText": file_path
            }

        except Exception as e:
            error_str = str(e)
            logger.error(f"Error generating image: {error_str}")
            
            if isinstance(e, GeminiRequestError):
                raise
            raise GeminiRequestError(describe_gemini_error(e)) from e

    async def generate_roleplay_portrait(self, base_image_array, character_role, character_description, pid):
        """
        Generate a clean 1:1 portrait for role-play characters based on a base image
        
        Args:
            base_image_array (numpy.ndarray): The base image to transform
            character_role (str): The character's role (e.g., "Wise Guide", "Curious Traveler")
            character_description (str): Detailed description of the character
            pid (str): Patient ID for file organization
            
        Returns:
            str: Base64 encoded image data
        """
        try:
            # Create directory for generated images if it doesn't exist
            images_dir = os.path.join(settings.DATA_DIR, pid, "roleplay_portraits")
            os.makedirs(images_dir, exist_ok=True)

            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(base_image_array)

            # Create a clean prompt for character portrait generation
            portrait_prompt = f"""
            The user is in a role-playing conversation with an AI character named '{character_role}'.
            Your task is to generate a portrait of this AI character that the user is talking to.
            Use the base image's composition and background, but replace any person in the image with this AI character.

            Character Role: {character_role}
            Character Description (including current expression and mood): {character_description}
            
            Strict Requirements:
            - Generate a 1:1 aspect ratio square portrait.
            - The portrait must be of the AI character: '{character_role}'.
            - The character's appearance and expression should match the detailed description.
            - Focus on the character's face and upper body.
            - The style should be a clean, professional portrait.
            - The final image must not contain any text, watermarks, or overlays.
            - The character should look natural and integrated into the scene from the base image.
            - Ensure high quality and clear facial features.
            """

            logger.info(f"Generating role-play portrait for {character_role}")

            # Generate the portrait using Gemini
            response = await self.client.aio.models.generate_content(
                model=os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image-preview"),
                contents=[portrait_prompt, pil_image],
                config=types.GenerateContentConfig(
                    response_modalities=['Text', 'Image']
                )
            )

            # Extract the generated image
            image_base64 = None
            timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
            filename = f"roleplay_portrait_{timestamp}.jpg"
            file_path = os.path.join(images_dir, filename)

            candidate = response.candidates[0] if response.candidates else None
            parts = candidate.content.parts if candidate and candidate.content else []
            for part in parts or []:
                if part.inline_data is not None:
                    try:
                        raw_image_data = part.inline_data.data
                        
                        # Save the image file for record keeping
                        with open(file_path, 'wb') as f:
                            f.write(raw_image_data)
                        
                        # Convert to base64 for transmission
                        image_base64 = base64.b64encode(raw_image_data).decode('utf-8')
                        
                        logger.info(f"Role-play portrait saved to {file_path}")
                        break
                    except Exception as e:
                        logger.error(f"Error processing portrait image data: {e}")
                        raise

            if not image_base64:
                raise GeminiRequestError("Gemini returned no portrait. You can continue the conversation without it.")
            return image_base64

        except Exception as e:
            error_str = str(e)
            logger.error(f"Error generating role-play portrait: {error_str}")
            
            if isinstance(e, GeminiRequestError):
                raise
            raise GeminiRequestError(describe_gemini_error(e)) from e





