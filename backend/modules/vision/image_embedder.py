import mediapipe as mp
import numpy as np
import time
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from collections import deque
import logging
from typing import Optional, List
import os
import urllib.request

logger = logging.getLogger(__name__)

class AdvancedImageEmbedder:
    """
    Advanced image embedder using MediaPipe's ImageEmbedder for high-quality similarity calculation.
    """
    
    def __init__(self, model_path: Optional[str] = None):
        """
        Initialize the MediaPipe ImageEmbedder.
        
        Args:
            model_path: Path to custom embedder model. If None, downloads default model.
        """
        try:
            # If no model path provided, download the default model
            if not model_path:
                model_path = self._download_default_model()
            
            # Create ImageEmbedder options
            base_options = python.BaseOptions(model_asset_path=model_path)
            
            options = vision.ImageEmbedderOptions(
                base_options=base_options,
                quantize=False,  # Use float embeddings for better accuracy
                l2_normalize=True,  # Normalize embeddings for cosine similarity
                running_mode=vision.RunningMode.IMAGE
            )
            
            self.embedder = vision.ImageEmbedder.create_from_options(options)
            self.is_available = True
            logger.info("MediaPipe ImageEmbedder initialized successfully")
            
        except Exception as e:
            logger.warning(f"Failed to initialize MediaPipe ImageEmbedder: {e}")
            self.embedder = None
            self.is_available = False
    
    def _download_default_model(self) -> str:
        """Download the default MobileNet ImageEmbedder model."""
        model_dir = os.path.join(os.getenv('CRAFT_MODEL_CACHE', os.path.join(os.path.dirname(__file__), '..', '..', '..', '.models')), 'vision')
        os.makedirs(model_dir, exist_ok=True)
        
        model_path = os.path.join(model_dir, 'mobilenet_v3_small_image_embedder.tflite')
        
        if not os.path.exists(model_path):
            logger.info("Downloading default MediaPipe ImageEmbedder model...")
            model_url = "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite"
            try:
                urllib.request.urlretrieve(model_url, model_path)
                logger.info(f"Model downloaded to {model_path}")
            except Exception as e:
                logger.error(f"Failed to download model: {e}")
                raise
        
        return model_path

    def embed_image(self, image_array: np.ndarray) -> Optional[np.ndarray]:
        """
        Generate embedding for a single image.
        
        Args:
            image_array: RGB image array (H, W, 3)
            
        Returns:
            Embedding vector as numpy array, or None if embedding fails
        """
        if not self.is_available:
            return None
            
        try:
            # Convert numpy array to MediaPipe Image
            if len(image_array.shape) == 3 and image_array.shape[2] == 3:
                # RGB image
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_array)
            else:
                logger.warning(f"Invalid image shape: {image_array.shape}")
                return None
                
            # Generate embedding
            embedding_result = self.embedder.embed(mp_image)
            
            if embedding_result.embeddings:
                return embedding_result.embeddings[0].embedding
            else:
                logger.warning("No embeddings generated")
                return None
                
        except Exception as e:
            logger.error(f"Error generating image embedding: {e}")
            return None
    
    
    def cleanup(self):
        """Clean up resources."""
        if hasattr(self, 'embedder') and self.embedder:
            self.embedder.close()
            self.embedder = None
        self.is_available = False
    
    def calculate_similarity(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """
        Calculate cosine similarity between two embeddings.
        
        Args:
            embedding1: First embedding vector
            embedding2: Second embedding vector
            
        Returns:
            Cosine similarity score (0-1, higher means more similar)
        """
        try:
            # Normalize embeddings
            norm1 = np.linalg.norm(embedding1)
            norm2 = np.linalg.norm(embedding2)
            
            if norm1 == 0 or norm2 == 0:
                return 0.0
                
            # Calculate cosine similarity
            similarity = np.dot(embedding1, embedding2) / (norm1 * norm2)
            
            # Ensure similarity is in [0, 1] range
            return max(0.0, min(1.0, float(similarity)))
            
        except Exception as e:
            logger.error(f"Error calculating similarity: {e}")
            return 0.0
    
    def calculate_sequence_similarity(self, 
                                   current_sequence: List[np.ndarray], 
                                   last_sequence: List[np.ndarray],
                                   percentile: float = 0.8) -> Optional[float]:
        """
        Calculate similarity between two image sequences.
        
        Args:
            current_sequence: List of current frame arrays
            last_sequence: List of last sent frame arrays
            percentile: Percentile of similarities to use (0.8 = 80th percentile)
            
        Returns:
            Similarity score at the specified percentile, or None if calculation fails
        """
        if not self.is_available or not current_sequence or not last_sequence:
            return None
            
        try:
            # Generate embeddings for both sequences
            current_embeddings = []
            last_embeddings = []
            
            for frame in current_sequence:
                embedding = self.embed_image(frame)
                if embedding is not None:
                    current_embeddings.append(embedding)
                    
            for frame in last_sequence:
                embedding = self.embed_image(frame)
                if embedding is not None:
                    last_embeddings.append(embedding)
            
            if not current_embeddings or not last_embeddings:
                return None
            
            # Calculate pairwise similarities
            similarities = []
            min_length = min(len(current_embeddings), len(last_embeddings))
            
            for i in range(min_length):
                sim = self.calculate_similarity(current_embeddings[i], last_embeddings[i])
                similarities.append(sim)
            
            if not similarities:
                return None
                
            # Return the specified percentile similarity
            percentile_index = int(len(similarities) * percentile)
            if percentile_index >= len(similarities):
                percentile_index = len(similarities) - 1
                
            sorted_similarities = sorted(similarities, reverse=True)
            return sorted_similarities[percentile_index]
            
        except Exception as e:
            logger.error(f"Error calculating sequence similarity: {e}")
            return None


class FPVSimilarityTracker:
    """
    Tracks FPV similarity for proactive suggestions, maintaining 10-second frame sequences.
    Samples at 0.5 second intervals to maintain a 20-frame deque representing 10 seconds.
    """
    
    def __init__(self, sequence_duration: float = 10.0, sample_interval: float = 0.5):
        """
        Initialize the FPV similarity tracker.
        
        Args:
            sequence_duration: Duration in seconds to track (default: 10 seconds)
            sample_interval: Interval in seconds between samples (default: 0.5 seconds)
        """
        self.embedder = AdvancedImageEmbedder()
        self.sequence_duration = sequence_duration
        self.sample_interval = sample_interval
        self.sequence_length = int(sequence_duration / sample_interval)  # 20 frames for 10s at 0.5s intervals
        
        # Current 10-second sequence (20 frames at 0.5s intervals)
        self.current_sequence = deque(maxlen=self.sequence_length)
        self.current_timestamps = deque(maxlen=self.sequence_length)
        
        # Last sent 10-second sequence for comparison
        self.last_sent_sequence = deque(maxlen=self.sequence_length)
        self.last_sent_timestamps = deque(maxlen=self.sequence_length)
        
        # Single frame tracking for immediate similarity
        self.last_frame = None
        self.last_embedding = None
        
        logger.info(f"FPV Similarity Tracker initialized: {self.sequence_length} frames over {sequence_duration}s at {sample_interval}s intervals (MediaPipe available: {self.embedder.is_available})")
    
    def add_frame(self, frame: np.ndarray):
        """
        Add a new frame to current sequence. 
        Time interval control is handled in the main loop.
        """
        if frame is None:
            return
            
        current_time = time.time()
        self.current_sequence.append(frame.copy())
        self.current_timestamps.append(current_time)
        
        logger.debug(f"Added frame to sequence: {len(self.current_sequence)}/{self.sequence_length} frames")
    
    def calculate_current_similarity(self, frame: np.ndarray, threshold: float = 0.8) -> bool:
        """
        Calculate similarity with last frame and determine if scene changed enough.
        
        Args:
            frame: Current frame array
            threshold: Similarity threshold (above this = too similar)
            
        Returns:
            True if scene is too similar (should skip), False if different enough
        """
        if not self.embedder.is_available or self.last_frame is None:
            return False
            
        try:
            # Generate embeddings
            current_embedding = self.embedder.embed_image(frame)
            if current_embedding is None or self.last_embedding is None:
                return False
                
            # Calculate similarity
            similarity = self.embedder.calculate_similarity(current_embedding, self.last_embedding)
            print(f"Current similarity: {similarity:.3f} (threshold: {threshold})")
            
            logger.debug(f"FPV similarity: {similarity:.3f} (threshold: {threshold})")
            return similarity > threshold
            
        except Exception as e:
            logger.error(f"Error calculating current similarity: {e}")
            return False
    
    def calculate_sequence_similarity(self, threshold: float = 0.75) -> bool:
        """
        Calculate similarity between current 10-second sequence and last sent 10-second sequence.
        Compares the current deque (last 10 seconds) with the deque from when last suggestion was sent.
        
        Args:
            threshold: Similarity threshold (above this = too similar)
            
        Returns:
            True if sequences are too similar (should skip), False if different enough
        """
        if not self.embedder.is_available or not self.last_sent_sequence:
            logger.debug("MediaPipe unavailable or no last sent sequence, allowing suggestion")
            return False
            
        # Need at least some frames in current sequence to compare
        if len(self.current_sequence) < self.sequence_length // 2:  # At least 10 frames (5 seconds)
            logger.debug(f"Not enough frames in current sequence: {len(self.current_sequence)}/{self.sequence_length}")
            return False
            
        try:
            similarity = self.embedder.calculate_sequence_similarity(
                list(self.current_sequence),
                list(self.last_sent_sequence),
                percentile=0.8
            )
            
            if similarity is None:
                logger.debug("Failed to calculate sequence similarity, allowing suggestion")
                return False
                
            logger.debug(f"FPV 10-second sequence similarity: {similarity:.3f} (threshold: {threshold})")
            print(f"Sequence similarity: {similarity:.3f} (threshold: {threshold})")
            return similarity > threshold
            
        except Exception as e:
            logger.error(f"Error calculating sequence similarity: {e}")
            return False
    
    def mark_suggestion_sent(self, frame: np.ndarray):
        """
        Mark that a suggestion was sent with this frame/sequence.
        Saves the current 10-second sequence as reference for future comparisons.
        """
        try:
            # Update last frame and embedding
            # Frame is now consistently passed as RGB format
            self.last_frame = frame.copy() if frame is not None else None
            if self.last_frame is not None:
                self.last_embedding = self.embedder.embed_image(self.last_frame)
            
            # Save current 10-second sequence as reference for next comparison
            self.last_sent_sequence.clear()
            self.last_sent_sequence.extend(self.current_sequence)
            
            self.last_sent_timestamps.clear()
            self.last_sent_timestamps.extend(self.current_timestamps)
            
            logger.debug(f"Updated FPV tracking for sent suggestion: saved {len(self.last_sent_sequence)} frames from last 10 seconds")
            print(f"Saved sequence for comparison: {len(self.last_sent_sequence)} frames from last {self.sequence_duration} seconds")
            
        except Exception as e:
            logger.error(f"Error marking suggestion sent: {e}") 