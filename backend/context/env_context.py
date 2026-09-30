# create a env context, including location, audio, fpv, and image_queue

import time
from collections import deque
from typing import Optional, List, Tuple
import numpy as np

class EnvContext:
    def __init__(self, location=None, audio=None, fpv=None, image_queue_duration=10.0):
        """
        Create a class for environment context, including location, audio, fpv, and image_queue.

        :param location: Current location information
        :param audio: Audio context information  
        :param fpv: First-person view information
        :param image_queue_duration: Duration in seconds for image queue (default: 10 seconds)
        :param image_queue_max_length: Maximum length of image queue (default: 20 frames)
        """
        self.location = location
        self.audio = audio
        self.fpv = fpv
        
        # Image queue for maintaining 10-second visual context
        self.image_queue_duration = image_queue_duration
        self.image_queue = deque(maxlen=20)  # 20 frames for 10 seconds at 0.5s intervals
        self.image_timestamps = deque(maxlen=20)
        self.user_capture_fpv_sequence = deque(maxlen=20)  # Store user captured FPV sequence



    
    def add_image_to_queue(self, image: np.ndarray, timestamp: Optional[float] = None):
        """
        Add an image frame to the queue with timestamp.
        
        Args:
            image: RGB image array
            timestamp: Timestamp when image was captured (defaults to current time)
        """
        if timestamp is None:
            timestamp = time.time()
            
        self.image_queue.append(image.copy())
        self.image_timestamps.append(timestamp)
    
    def get_current_image_sequence(self) -> Tuple[List[np.ndarray], List[float]]:
        """
        Get current image sequence and timestamps.
        
        Returns:
            Tuple of (image_list, timestamp_list)
        """
        return list(self.image_queue), list(self.image_timestamps)
    
    def get_latest_image(self) -> Optional[np.ndarray]:
        """Get the most recent image from the queue."""
        return self.image_queue[-1] if self.image_queue else None
    
    def get_queue_info(self) -> dict:
        """
        Get information about the current image queue status.
        
        Returns:
            Dictionary with queue statistics
        """
        if not self.image_queue:
            return {
                "queue_length": 0,
                "duration_covered": 0,
                "oldest_timestamp": None,
                "newest_timestamp": None
            }
            
        oldest_time = self.image_timestamps[0]
        newest_time = self.image_timestamps[-1]
        duration = newest_time - oldest_time
        
        return {
            "queue_length": len(self.image_queue),
            "duration_covered": duration,
            "oldest_timestamp": oldest_time,
            "newest_timestamp": newest_time,
            "target_duration": self.image_queue_duration
        }
    
    
    def to_dict(self) -> dict:
        """
        Convert environment context to dictionary format.
        Note: image_queue is not included in dict due to size, use get_queue_info() instead.
        """
        return {
            "location": self.location,
            "audio": self.audio, 
            "fpv": self.fpv,
            "image_queue_info": self.get_queue_info()
        }

    def set_user_capture_fpv_sequence_from_image_queue(self):
        """
        Set user capture FPV sequence from image queue copy.
        """
        self.user_capture_fpv_sequence = self.image_queue.copy()

    def get_user_capture_fpv_sequence(self):
        return self.user_capture_fpv_sequence