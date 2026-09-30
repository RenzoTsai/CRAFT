import zmq
import logging
import asyncio
import threading
import msgpack
import cv2
import numpy as np
import base64
from typing import Dict, Any, Optional
from core.config import settings
from core.websocket_manager import manager

# Configure logging
logger = logging.getLogger(__name__)


class PupilConnector:
    """
    Connector for Pupil Labs eye tracker via ZMQ with frame streaming.
    If simulate is True, uses cv2.VideoCapture(0) to provide frames.
    """

    def __init__(self, simulate: bool = False):
        self.simulate = simulate
        self.ctx = zmq.Context()
        self.pupil_remote = None
        self.subscriber = None
        self.connected = False
        self.running = False
        self.thread = None
        self.stop_event = threading.Event()
        self.gaze_position = None
        self.fixation_detected = False

        # Frame-related attributes
        self.recent_world = None
        self.gaze_x_list = []
        self.gaze_y_list = []
        self.send_frame_on_request = False

        if self.simulate:
            self.cap = cv2.VideoCapture(0)
            if not self.cap.isOpened():
                logger.error("Failed to open video capture device for simulation.")
            else:
                logger.info("Simulation mode enabled: Video capture device opened successfully.")
        else:
            self.cap = None

    def recv_from_sub(self):
        """
        Recv a message with topic, payload.
        Topic is a utf-8 encoded string. Returned as unicode object.
        Payload is a msgpack serialized dict. Returned as a python dict.
        Any additional message frames will be added as a list
        in the payload dict with key: '__raw_data__'.
        """
        topic = self.subscriber.recv_string()
        payload = msgpack.unpackb(self.subscriber.recv(), raw=False)
        extra_frames = []
        while self.subscriber.get(zmq.RCVMORE):
            extra_frames.append(self.subscriber.recv())
        if extra_frames:
            payload["__raw_data__"] = extra_frames
        return topic, payload

    def connect(self) -> bool:
        """
        Connect to Pupil Capture via ZMQ

        Returns:
            bool: Success status of connection
        """
        if self.simulate:
            if self.cap is None or not self.cap.isOpened():
                self.cap = cv2.VideoCapture(0)
            logger.info("Simulation mode enabled, skipping connection to Pupil Capture.")
            self.connected = True
            return True

        self._close_sockets()
        if self.ctx.closed:
            self.ctx = zmq.Context()
        try:
            # Connect to Pupil Remote
            self.pupil_remote = self.ctx.socket(zmq.REQ)
            self.pupil_remote.setsockopt(zmq.RCVTIMEO, 1500)
            self.pupil_remote.setsockopt(zmq.SNDTIMEO, 1500)
            self.pupil_remote.setsockopt(zmq.LINGER, 0)
            self.pupil_remote.connect(f'tcp://{settings.PUPIL_HOST}:{settings.PUPIL_PORT}')

            # Request SUB_PORT for subscribing to data
            self.pupil_remote.send_string('SUB_PORT')
            sub_port = self.pupil_remote.recv_string()

            # Connect to the subscription port
            self.subscriber = self.ctx.socket(zmq.SUB)
            self.subscriber.setsockopt(zmq.RCVTIMEO, 1500)
            self.subscriber.setsockopt(zmq.LINGER, 0)
            self.subscriber.connect(f'tcp://{settings.PUPIL_HOST}:{int(sub_port)}')

            # Subscribe to all relevant topics
            self.subscriber.setsockopt_string(zmq.SUBSCRIBE, '')  # Subscribe to all topics

            self.connected = True
            logger.info("Successfully connected to Pupil Capture")
            return True

        except Exception as e:
            logger.error(f"Error connecting to Pupil Capture: {e}")
            self._close_sockets()
            return False

    def _close_sockets(self):
        for name in ("subscriber", "pupil_remote"):
            sock = getattr(self, name)
            if sock is not None:
                sock.close(linger=0)
                setattr(self, name, None)
        self.connected = False

    def _close_resources(self):
        self._close_sockets()
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        if not self.ctx.closed:
            self.ctx.term()

    def start(self) -> bool:
        """
        Start the pupil data collection thread

        Returns:
            bool: Success status
        """
        if self.running or (self.thread and self.thread.is_alive()):
            logger.warning("Pupil connector is already running")
            return False

        if not self.connected:
            success = self.connect()
            if not success:
                return False

        self.stop_event.clear()
        self.running = True
        self.thread = threading.Thread(target=self._run)
        self.thread.daemon = True
        self.thread.start()
        logger.info("Pupil connector thread started")
        return True

    def stop(self) -> None:
        """Stop the pupil data collection thread"""
        self.running = False
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=5.0)
            if self.thread.is_alive():
                logger.warning("Pupil connector is still stopping; its thread will close the resources.")
                return
            logger.info("Pupil connector thread stopped")
        self.thread = None
        self._close_resources()

    def _run(self) -> None:
        """Main thread loop for processing pupil data"""
        try:
            while self.running:
                try:
                    if self.simulate:
                        ret, frame = self.cap.read()
                        if ret:
                            # Store the frame
                            self.recent_world = frame

                            if self.send_frame_on_request:
                                print("Sending simulated frame")
                                asyncio.run(self._broadcast_world_frame(frame))
                                self.send_frame_on_request = False
                        self.stop_event.wait(0.03)  # Roughly 30 FPS
                    else:
                        if not self.connected:
                            logger.warning("Lost connection to Pupil Capture, attempting to reconnect...")
                            if self.stop_event.wait(1.0):
                                break
                            self.connect()
                            continue

                        # Check for new data with timeout
                        if self.subscriber.poll(timeout=100):
                            # Use recv_from_sub to get topic and payload
                            topic, message = self.recv_from_sub()

                            # Process different message types
                            if topic.startswith('gaze.3d.1.'):
                                self._process_gaze(message)
                            elif topic == 'fixations':
                                self._process_fixation(message)
                            elif topic == 'frame.world':
                                self._process_world_frame(message)

                except Exception as e:
                    if self.stop_event.is_set():
                        break
                    logger.error(f"Error in pupil connector thread: {e}")
                    self.connected = False
                    self.stop_event.wait(1.0)
        finally:
            self.running = False
            self._close_resources()


    def _process_world_frame(self, message: Dict[str, Any]) -> None:
        """
        Process world frame from Pupil Capture

        Args:
            message: The world frame message
        """
        if '__raw_data__' in message:
            # Reconstruct the frame
            frame = np.frombuffer(
                message['__raw_data__'][0],
                dtype=np.uint8
            ).reshape(message['height'], message['width'], 3).copy()

            # Process gaze data if available
            if self.gaze_x_list and self.gaze_y_list:
                frame_height, frame_width = frame.shape[:2]
                gaze_x = float(np.array(self.gaze_x_list).mean())
                gaze_y = 1 - float(np.array(self.gaze_y_list).mean())
                self.gaze_x_list = self.gaze_y_list = []

                # Convert normalized coordinates to pixel coordinates
                gaze_position = (int(gaze_x * frame_width), int(gaze_y * frame_height))

                # Draw gaze point on frame
                cv2.circle(frame, gaze_position, 20, (0, 0, 255), 4)

            # Store the frame
            self.recent_world = frame
            # print(self.recent_world.shape)

            # Broadcast frame if requested
            if self.send_frame_on_request:
                print("Sending frame")
                asyncio.run(self._broadcast_world_frame(frame))
                self.send_frame_on_request = False

    def _process_gaze(self, message: Dict[str, Any]) -> None:
        """
        Process gaze data from Pupil Capture

        Args:
            message: The gaze data message
        """
        if 'norm_pos' in message:
            self.gaze_position = message['norm_pos']
            self.gaze_x_list.append(self.gaze_position[0])
            self.gaze_y_list.append(self.gaze_position[1])

    def _process_fixation(self, message: Dict[str, Any]) -> None:
        """
        Process fixation data from Pupil Capture

        Args:
            message: The fixation data message
        """
        if 'norm_pos' in message and 'confidence' in message:
            if message['confidence'] > 0.6:  # Confidence threshold
                self.fixation_detected = True
                asyncio.run(self._broadcast_fixation_data(message))
            else:
                self.fixation_detected = False

    async def _broadcast_world_frame(self, frame: np.ndarray) -> None:
        """
        Broadcast world frame to all WebSocket clients

        Args:
            frame: The world frame as a numpy array
        """
        # Convert frame to base64 for transmission
        _, buffer = cv2.imencode('.jpg', frame)
        frame_base64 = base64.b64encode(buffer).decode('utf-8')

        await manager.broadcast_json({
            'type': 'world_frame',
            'frame': frame_base64,
            'timestamp': time.time()
        })


    async def _broadcast_fixation_data(self, fixation: Dict[str, Any]) -> None:
        """
        Broadcast fixation data to all WebSocket clients

        Args:
            fixation: The fixation data
        """
        await manager.broadcast_json({
            'type': 'fixation',
            'position': fixation['norm_pos'],
            'duration': fixation.get('duration', 0),
            'confidence': fixation.get('confidence', 0),
            'timestamp': time.time()
        })



    def get_recent_frame(self) -> Optional[np.ndarray]:
        """
        Get the most recent world frame

        Returns:
            numpy array of the world frame or None
        """
        return self.recent_world
