import json
from typing import Dict, Any, Optional
from datetime import datetime
from context.context_data import ContextData
from modules.llm.gemini_client import GeminiClient
from storage.context_storage import ContextStorage
import logging

logger = logging.getLogger(__name__)

class FictionContextUpdater:
    """
    A class to handle updating the context of fictional content through LLM interactions.
    This includes processing user inputs and updating context based on LLM responses.
    """
    
    def __init__(self, context_data: ContextData, llm_client: GeminiClient):
        self.context_data = context_data
        self.llm_client = llm_client
        self.last_updated: Optional[datetime] = None
        self.storage = ContextStorage(context_data.user_context.pid)
    
    
    
    
    

    
    
    async def update_full_context(self, context_update: Dict[str, Any]) -> bool:
        """
        Update all aspects of the fiction context based on user input and AI response.
        
        Args:
            context_update (Dict[str, Any]): Dictionary containing both user input and AI response
                {
                    "user_input": {
                        "transcription": str,
                        "image_description": str,
                        "location": str,
                        "timestamp": str
                    },
                    "ai_response": Dict[str, Any]
                }
            
        Returns:
            bool: True if update was successful, False otherwise
        """
        try:
            user_input = context_update["user_input"]
            ai_response = context_update["ai_response"]

            print("Updating full context with user input and AI response")
            
            prompt = f"""
            Based on the following user input and AI response, update all aspects of the fiction context:
            
            User Input:
            - Transcription: {user_input['transcription']}
            - Image Description: {user_input['image_description']}
            - Location: {user_input['location']}
            - Timestamp: {user_input['timestamp']}
            
            Current Context:
            - Plot: {self.context_data.fiction_context.plot}
            - Characters: {json.dumps(self.context_data.fiction_context.characters, indent=2, ensure_ascii=False)}
            - Setting: {self.context_data.fiction_context.setting}
            - Scenes: {json.dumps(self.context_data.fiction_context.scenes, indent=2, ensure_ascii=False)}
            - Style: {self.context_data.fiction_context.style}
            - Writing Preferences: {self.context_data.fiction_context.writing_preferences}
            
            AI Response:
            {json.dumps(ai_response, indent=2)}
            
            **Your Task: Intelligent Context Update**
            Analyze the user's input and the AI's response to perform a smart update of the fiction's context. First, determine the user's intent.

            **Step 1: Analyze User Intent**
            - **Is the user ADDING new content?** (e.g., "What happens next?", "I want the protagonist to meet a new character.")
            - **Is the user CORRECTING/REVISING existing content?** This is a critical step. Look for specific instructions like:
                - **Update/Rename:** "Change the character 'Detective Li' to 'Inspector Zhang'."
                - **Delete:** "I think 'Suspect C' is unnecessary, please remove him."
                - **Merge:** "Actually, 'Mo' and 'Black Hand' are the same person, merge them."
                - **Revise Scene/Plot:** "I don't like this plot point, change it to..."
            
            **Step 2: Update Context Based on Intent**
            - If the user is **revising**, apply the specific changes to the context. Update, delete, or merge elements as requested. Do NOT simply add new, conflicting information.
            - If the user is **adding**, integrate the new information from the user's input and the AI's response into the existing context.

            **Requirements for each aspect:**
            1. Scenes:
                - Structure each scene as a comprehensive object.
                - Each scene should have a unique `scene_id`, a `description`, and a `status`.
                - Inside each scene, include `characters` present in that scene and `plot_elements` that occur.
                - The `characters` object in a scene should specify the character's `name` and their `description_in_scene` (behavior, mood, or actions specific to that scene).
                - Structure `dialogue` as a list of objects, each with `order`, `character`, `line`, and `type` ('dialogue' or 'monologue').
                - Only create new scenes for genuinely new events; otherwise, update existing ones.
                - Keep scene descriptions concise (under 15 words) and visual.
                - Track user engagement with status: "user_proposed", "ai_proposed", "user_interested", "user_elaborated".
            
            2. Characters (Global):
               - Maintain a global list of all characters in the story for easy reference.
               - Update this list if new characters are introduced in any scene.
               - Each character should have a `name` and a general `description`.
            
            3. Setting:
               - Focus on physical environment
               - Include key visual elements
               - Keep descriptions concise and matchable
               - Update existing setting details rather than creating new descriptions
            
            4. Plot:
               - Maintain story consistency
               - Focus on key events and transitions
               - Keep narrative flow logical
               - Update existing plot points rather than creating redundant ones
            
            5. Style:
               - Maintain consistent tone
               - Focus on narrative approach
               - Keep style elements clear and actionable

            Return the response in the following JSON format:
            ```json
            {{
                "plot": "Updated plot description",
                "characters": [
                    {{
                        "name": "Character Name",
                        "description": "General character description."
                    }}
                ],
                "setting": "Updated setting description",
                "scenes": [
                    {{
                        "scene_id": "scene_1",
                        "description": "A concise, visual description of the scene.",
                        "status": "user_proposed",
                        "characters": [
                            {{
                                "name": "Character Name",
                                "description_in_scene": "Character's behavior and actions in this specific scene."
                            }}
                        ],
                        "dialogue": [
                            {{
                                "order": 1,
                                "character": "Character Name",
                                "line": "The character's dialogue.",
                                "type": "dialogue"
                            }}
                        ],
                        "plot_elements": [
                            "A key event that happens in this scene."
                        ]
                    }}
                ],
                "style": "Updated writing style description"
            }}
            ```
            """
            
            response = await self.llm_client.process_prompt(
                prompt,
                with_history="text",
                system_instruction="Update all aspects of the fiction context while maintaining clear distinction between user inputs and AI suggestions.",
                update_history=False,
            )
            
            # Clean the response by removing markdown code block markers
            cleaned_response = response.strip()
            if cleaned_response.startswith("```json"):
                cleaned_response = cleaned_response[7:]  # Remove ```json
            if cleaned_response.startswith("```"):
                cleaned_response = cleaned_response[3:]  # Remove ```
            if cleaned_response.endswith("```"):
                cleaned_response = cleaned_response[:-3]  # Remove trailing ```
            cleaned_response = cleaned_response.strip()
            
            if not cleaned_response:
                logger.error("Empty response after cleaning")
                return False
                
            try:
                # Parse the JSON response
                context_updates = json.loads(cleaned_response)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parsing error: {str(e)}")
                return False
            except Exception as e:
                logger.error(f"Unexpected error during JSON parsing: {str(e)}")
                return False
            
            # Update all aspects of the context
            updated_fields = []
            
            if "plot" in context_updates:
                self.context_data.fiction_context.plot = context_updates["plot"]
                updated_fields.append("plot")
                
            if "characters" in context_updates:
                # Validate characters data structure
                if isinstance(context_updates["characters"], list):
                    self.context_data.fiction_context.characters = context_updates["characters"]
                    updated_fields.append(f"characters({len(context_updates['characters'])})")
                else:
                    logger.error(f"Expected characters to be a list, got {type(context_updates['characters'])}")
                    
            if "setting" in context_updates:
                self.context_data.fiction_context.setting = context_updates["setting"]
                updated_fields.append("setting")
                
            if "scenes" in context_updates:
                # Validate scenes data structure
                if isinstance(context_updates["scenes"], list):
                    self.context_data.fiction_context.scenes = context_updates["scenes"]
                    updated_fields.append(f"scenes({len(context_updates['scenes'])})")
                else:
                    logger.error(f"Expected scenes to be a list, got {type(context_updates['scenes'])}")
                    
            if "style" in context_updates:
                self.context_data.fiction_context.style = context_updates["style"]
            
            if "writing_preferences" in context_updates:
                self.context_data.fiction_context.writing_preferences = context_updates["writing_preferences"]
            
            self.last_updated = datetime.now()
            
            # Save the updated context
            if not self.storage.save_context(self.context_data):
                return False
            
            logger.info(f"Updated full context: {', '.join(updated_fields)}")
            return True
            
        except Exception as e:
            import traceback
            logger.error(f"Error updating full context: {str(e)}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            logger.error(f"Context update that caused error: {json.dumps(context_update, indent=2)}")
            return False
    
    
    async def update_plot_connection(self, plot_connection: Dict[str, Any]) -> bool:
        """
        Update the fiction context (scenes, plot, attributes) based on a new plot connection graph.
        This will:
        - Remove scenes not present in the new connection
        - Update scene/plot/attributes to match the new structure
        - Use the LLM to ensure narrative consistency
        """
        try:
            # Extract current context
            current_scenes = self.context_data.fiction_context.scenes
            current_plot = self.context_data.fiction_context.main_plot
            current_characters = self.context_data.fiction_context.characters
            current_setting = self.context_data.fiction_context.setting
            current_style = self.context_data.fiction_context.style
            current_writing_preferences = self.context_data.fiction_context.writing_preferences
            current_plot_connection = self.context_data.fiction_context.plot_connection

            # Clean the plot connection data by removing temporal fields
            cleaned_plot_connection = {
                "nodes": [
                    {
                        "id": node["id"],
                        "data": {
                            k: v for k, v in node["data"].items() 
                            if k != "relevantToCurrentEnvironment"
                        },
                        "position": node["position"]
                    }
                    for node in plot_connection["nodes"]
                ],
                "edges": plot_connection["edges"]
            }

            # Build JSON blocks as strings to avoid Invalid format specifier error
            context_json = json.dumps({
                "plot": current_plot,
                "characters": current_characters,
                "setting": current_setting,
                "scenes": current_scenes,
                "style": current_style,
                "writing_preferences": current_writing_preferences,
                "plot_connection": current_plot_connection,
            }, indent=2)
            plot_connection_json = json.dumps(cleaned_plot_connection, indent=2)

            # Prepare the prompt for the LLM
            prompt = f"""
            You are updating a fictional story's context based on a new plot connection graph (nodes and edges).
            
            Current Context:
            {context_json}

            New Plot Connection after user update (graph):
            {plot_connection_json}

            Instructions:
            1. Analyze the new plot connection graph and compare it to the current context.
            2. Remove any scenes/moments from the context that are not present in the new connection (i.e., deleted nodes).
            3. Update the plot, scenes, and any relevant attributes to match the new structure and relationships in the graph.
            4. If the plot structure changes (e.g., new branches, merges), update the plot summary to reflect this.
            5. Ensure all changes are consistent and maintain narrative logic.
            6. Return the updated context in the following JSON format:
            ```json
            {{
                "plot": "Updated plot description",
                "characters": [...],
                "setting": "...",
                "scenes": [...],
                "style": "...",
                "writing_preferences": "..."
            }}
            ```
            """

            response = await self.llm_client.process_prompt(
                    prompt,
                    with_history=None,
                    system_instruction="Update the fiction context to match the new plot connection graph. Remove deleted moments, update plot and scenes, and ensure consistency."
                )

            # Clean the response
            cleaned_response = response.strip()
            if cleaned_response.startswith("```json"):
                cleaned_response = cleaned_response[7:]
            if cleaned_response.startswith("```"):
                cleaned_response = cleaned_response[3:]
            if cleaned_response.endswith("```"):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()

            # Parse and update context
            context_updates = json.loads(cleaned_response)
            if "plot" in context_updates:
                self.context_data.fiction_context.main_plot = context_updates["plot"]
            if "characters" in context_updates:
                self.context_data.fiction_context.characters = context_updates["characters"]
            if "setting" in context_updates:
                self.context_data.fiction_context.setting = context_updates["setting"]
            if "scenes" in context_updates:
                self.context_data.fiction_context.scenes = context_updates["scenes"]
            if "style" in context_updates:
                self.context_data.fiction_context.style = context_updates["style"]
            if "writing_preferences" in context_updates:
                self.context_data.fiction_context.writing_preferences = context_updates["writing_preferences"]
            # Add cleaned plot_connection to the context
            self.context_data.fiction_context.plot_connection = cleaned_plot_connection

            # print the updated context
            print("Updated context:")
            print(self.context_data.fiction_context)
            # Save the updated context
            if not self.storage.save_context(self.context_data):
                return False
            logger.info("Fiction context updated based on new plot connection.")
            return True
        except Exception as e:
            logger.error(f"Error updating plot connection: {str(e)}")
            return False

    async def update_img_path_for_moment(self, img_path: str, authoring_data: Dict[str, Any]) -> bool:
        """
        Update the image path for a suitable moment in the scene array using LLM.
        
        Args:
            img_path (str): The path to the generated image (relative URL for frontend)
            authoring_data (Dict[str, Any]): The authoring data containing context for the image
            
        Returns:
            bool: True if update was successful, False otherwise
        """
        try:
            # Get current scene array
            current_scenes = self.context_data.fiction_context.scenes
            
            if not current_scenes:
                logger.error("No scene data available")
                return False

            # Prepare the prompt for the LLM
            prompt = f"""
            Based on the following image path and authoring data, determine which moment in the scene array
            should be associated with this image.

            Current Scene Array:
            {json.dumps(current_scenes, indent=2)}

            Image Path:
            {img_path}

            Authoring Data:
            {json.dumps(authoring_data, indent=2)}

            Instructions:
            1. Analyze the authoring data and image path to understand the context
            2. Review all moments in the scene array
            3. Identify the most suitable moment to associate with this image based on:
               - Content relevance
               - Temporal sequence
               - Narrative flow
            4. Return the moment index and a brief explanation in JSON format:
            ```json
            {{
                "moment_index": "index of the most suitable moment",
                "explanation": "Brief explanation of why this moment was chosen"
            }}
            ```
            """

            response = await self.llm_client.process_prompt(
                prompt,
                with_history=None,
                system_instruction="Identify the most suitable moment in the scene array to associate with the given image."
            )

            # Clean and parse the response
            cleaned_response = response.strip()
            if cleaned_response.startswith("```json"):
                cleaned_response = cleaned_response[7:]
            if cleaned_response.startswith("```"):
                cleaned_response = cleaned_response[3:]
            if cleaned_response.endswith("```"):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()

            result = json.loads(cleaned_response)
            moment_index = int(result["moment_index"])

            # Update the moment with the image path
            if 0 <= moment_index < len(current_scenes):
                current_scenes[moment_index]["img_path"] = img_path
                self.context_data.fiction_context.scenes = current_scenes

                # Save the updated context
                if not self.storage.save_context(self.context_data):
                    return False
                
                logger.info(f"Updated image path for scene moment {moment_index}: {img_path}")
                return True
            else:
                logger.error(f"Invalid moment index: {moment_index}")
                return False

        except Exception as e:
            logger.error(f"Error updating image path for scene moment: {str(e)}")
            return False
            
    async def analyze_and_update_from_revision(self, revised_content: str, previous_content: str = None) -> bool:
        """
        Analyze user's story revision and update context to reflect the changes.
        This method is specifically designed for user-edited content, not real-time interactions.
        
        Args:
            revised_content (str): The revised story content from user
            previous_content (str): Previous content for comparison (optional)
            
        Returns:
            bool: True if update was successful, False otherwise
        """
        try:
            # Get current context for reference
            current_context = {
                "plot": self.context_data.fiction_context.main_plot,
                "characters": self.context_data.fiction_context.characters,
                "setting": self.context_data.fiction_context.setting,
                "scenes": self.context_data.fiction_context.scenes,
                "style": self.context_data.fiction_context.style,
                "writing_preferences": self.context_data.fiction_context.writing_preferences
            }
            
            # Build the specialized revision analysis prompt
            prompt = f"""
            You are performing REVISION ANALYSIS to detect what the user specifically changed in their story.
            Your task is to identify changes and update the context to reflect those revisions.
            
            CURRENT STORY CONTEXT:
            {json.dumps(current_context, indent=2, ensure_ascii=False)}
            
            USER'S REVISED STORY CONTENT:
            {revised_content}
            
            REVISION DETECTION PROCESS:
            
            Step 1: EXTRACT ELEMENTS FROM REVISED CONTENT
            - Extract a list of all `scenes` from the revised content. Each scene should be an object containing:
                - `scene_id`, `description`, `status`
                - `characters`: a list of characters in the scene with their `name` and `description_in_scene`.
                - `dialogue`: a structured list with `order`, `character`, `line`, and `type`.
                - `plot_elements`: a list of key events in the scene.
            - Extract a global list of all `characters` with their `name` and general `description`.
            - Extract the main `plot` summary, `setting`, and `style`.

            Step 2: COMPARE WITH CURRENT CONTEXT
            - Compare the extracted elements with the current context to identify specific changes.
            - Look for new or updated scenes, characters, and plot points.
            - Pay close attention to changes in character descriptions within scenes and dialogue updates.

            Step 3: IDENTIFY SPECIFIC CHANGES
            - Detect new characters, locations, or plot developments.
            - Note any modifications in scene descriptions, character behaviors, or dialogue sequences.

            Step 4: UPDATE CONTEXT BASED ON DETECTED CHANGES
            - Replace outdated information with the revised elements.
            - Ensure all updated elements are marked as "user_proposed".
            
            CRITICAL DETECTION RULES:
            1. Pay extreme attention to name variations and changes
            2. Look for location name changes or new locations
            3. Be sensitive to even minor spelling or formatting differences
            4. When in doubt about a change, update to match the revised content
            5. Focus on CONCRETE elements (names, places) over abstract concepts
            6. Handle both English and Chinese text appropriately
            7. Preserve the original language and formatting of character/location names as they appear in the revised content
            
            For scenes, create brief visual descriptions (under 10 words each):
            - Use present tense and active voice
            - Focus on visual elements that can be matched with first-person view
            - Include key objects, actions, and environments
            
            Return the COMPLETE updated context in this JSON format:
            ```json
            {{
                "plot": "Plot summary based on the revised content",
                "characters": [
                    {{
                        "name": "Character Name",
                        "description": "General character description."
                    }}
                ],
                "setting": "Locations and environments from the revised story",
                "scenes": [
                    {{
                        "scene_id": "scene_1",
                        "description": "A concise, visual description of the scene.",
                        "status": "user_proposed",
                        "characters": [
                            {{
                                "name": "Character Name",
                                "description_in_scene": "Character's behavior and actions in this specific scene."
                            }}
                        ],
                        "dialogue": [
                            {{
                                "order": 1,
                                "character": "Character Name",
                                "line": "The character's dialogue.",
                                "type": "dialogue"
                            }}
                        ],
                        "plot_elements": [
                            "A key event that happens in this scene."
                        ]
                    }}
                ],
                "style": "Writing style and narrative approach",
                "writing_preferences": "Updated writing preferences"
            }}
            ```
            """
            
            # Get LLM response
            response = await self.llm_client.process_prompt(
                prompt,
                with_history=None,
                system_instruction="You are a revision detection specialist. Your primary task is to identify specific changes the user made to their story (character names, location names, plot details) and update the context accordingly. Be especially sensitive to name changes and location changes, even if they seem minor.",
                update_history=False
            )
            
            # Clean the response
            cleaned_response = response.strip()
            if cleaned_response.startswith("```json"):
                cleaned_response = cleaned_response[7:]
            if cleaned_response.startswith("```"):
                cleaned_response = cleaned_response[3:]
            if cleaned_response.endswith("```"):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()
            
            if not cleaned_response:
                logger.error("Empty response after cleaning")
                return False
            
            # Parse the JSON response
            try:
                context_updates = json.loads(cleaned_response)
                logger.info("Parsed revision context updates successfully")
            except json.JSONDecodeError as e:
                logger.error(f"JSON parsing error for revision analysis: {str(e)}")
                return False
            
            # Update the context with validated data
            updated_fields = []
            if "plot" in context_updates and context_updates["plot"]:
                self.context_data.fiction_context.main_plot = context_updates["plot"]
                updated_fields.append("plot")
                
            if "characters" in context_updates and isinstance(context_updates["characters"], list):
                self.context_data.fiction_context.characters = context_updates["characters"]
                updated_fields.append(f"characters({len(context_updates['characters'])})")
                
            if "setting" in context_updates and context_updates["setting"]:
                self.context_data.fiction_context.setting = context_updates["setting"]
                updated_fields.append("setting")
                
            if "scenes" in context_updates and isinstance(context_updates["scenes"], list):
                self.context_data.fiction_context.scenes = context_updates["scenes"]
                updated_fields.append(f"scenes({len(context_updates['scenes'])})")
                
            if "style" in context_updates and context_updates["style"]:
                self.context_data.fiction_context.style = context_updates["style"]
            
            if "writing_preferences" in context_updates and context_updates["writing_preferences"]:
                self.context_data.fiction_context.writing_preferences = context_updates["writing_preferences"]
            
            self.last_updated = datetime.now()
            
            # Save the updated context
            success = self.storage.save_context(self.context_data)
            
            if success:
                logger.info(f"Updated context from revision: {', '.join(updated_fields)}")
                return True
            else:
                logger.error("Failed to save revised context")
                return False
                
        except Exception as e:
            import traceback
            logger.error(f"Error analyzing revision and updating context: {str(e)}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            return False 
    
    