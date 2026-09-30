import json
import os
from datetime import datetime
from typing import Optional
from context.context_data import ContextData
from core.config import settings
import logging

logger = logging.getLogger(__name__)

class ContextStorage:
    """Handles saving and loading of context data"""
    
    def __init__(self, pid: str):
        self.pid = pid
        self.storage_dir = os.path.join(settings.DATA_DIR, pid)
        self.context_file = os.path.join(self.storage_dir, "context_data.json")
        os.makedirs(self.storage_dir, exist_ok=True)
    
    def save_context(self, context_data: ContextData) -> bool:
        """
        Save the current context data to a JSON file
        
        Args:
            context_data (ContextData): The context data to save
            
        Returns:
            bool: True if save was successful, False otherwise
        """
        try:
            # Convert context data to dictionary
            context_dict = {
                "fiction_context": {
                    "main_plot": context_data.fiction_context.main_plot,
                    "plot": context_data.fiction_context.plot,
                    "characters": context_data.fiction_context.characters,
                    "setting": context_data.fiction_context.setting,
                    "scenes": context_data.fiction_context.scenes,
                    "style": context_data.fiction_context.style,
                    "plot_connection": context_data.fiction_context.plot_connection,
                    "writing_preferences": context_data.fiction_context.writing_preferences
                },
                "user_context": {
                    "pid": context_data.user_context.pid,
                    "personal_interests": context_data.user_context.personal_interests
                },
                "env_context": {
                    "location": context_data.env_context.location,
                    "audio": context_data.env_context.audio,
                    "fpv": None  # Don't save image data
                },
                "last_updated": datetime.now().isoformat()
            }
            
            # Save to file
            with open(self.context_file, 'w') as f:
                json.dump(context_dict, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Context data saved successfully to {self.context_file}")
            return True
            
        except Exception as e:
            logger.error(f"Error saving context data: {str(e)}")
            return False
    
    def load_context(self) -> Optional[ContextData]:
        """
        Load the context data from the JSON file
        
        Returns:
            Optional[ContextData]: The loaded context data, or None if loading failed
        """
        try:
            if not os.path.exists(self.context_file):
                logger.info(f"No existing context file found at {self.context_file}")
                return None
                
            with open(self.context_file, 'r') as f:
                context_dict = json.load(f)
            
            # Create new ContextData instance
            context_data = ContextData(
                pid=context_dict["user_context"]["pid"],
                personal_interests=context_dict["user_context"]["personal_interests"],
                location=context_dict["env_context"]["location"],
                audio=context_dict["env_context"]["audio"],
                fpv=None,
                main_plot=context_dict["fiction_context"]["main_plot"],
                plot=context_dict["fiction_context"].get("plot", []),
                characters=context_dict["fiction_context"]["characters"],
                setting=context_dict["fiction_context"]["setting"],
                scenes=context_dict["fiction_context"].get("scenes", []),
                style=context_dict["fiction_context"]["style"],
                plot_connection=context_dict["fiction_context"].get("plot_connection"),
                writing_preferences=context_dict["fiction_context"].get("writing_preferences")
            )
            
            logger.info(f"Context data loaded successfully from {self.context_file}")
            return context_data
            
        except Exception as e:
            logger.error(f"Error loading context data: {str(e)}")
            return None 