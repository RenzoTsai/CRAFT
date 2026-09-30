import asyncio

from fastapi import WebSocket, WebSocketDisconnect
from typing import List, Dict, Any
import logging

# Set up logging
logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    WebSocket connection manager for handling client connections
    """

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.interaction_idle: Dict[WebSocket, bool] = {}
        self.interaction_revision = 0
        self.loop = asyncio.get_event_loop()  # Explicitly get the event loop

    async def connect(self, websocket: WebSocket):
        """Accept and store a new WebSocket connection"""
        try:
            await websocket.accept()
            if websocket not in self.active_connections:
                self.active_connections.append(websocket)
            logger.info(f"Client connected. Active connections: {len(self.active_connections)}")
        except Exception as e:
            logger.error(f"Error accepting WebSocket connection: {e}")
            raise

    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        if websocket in self.interaction_idle:
            del self.interaction_idle[websocket]
            self.interaction_revision += 1
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Active connections: {len(self.active_connections)}")
    
    def set_interaction_idle(self, websocket: WebSocket, idle: bool):
        if websocket in self.active_connections and self.interaction_idle.get(websocket) != idle:
            self.interaction_idle[websocket] = idle
            self.interaction_revision += 1

    def proactive_allowed(self) -> bool:
        return bool(self.interaction_idle) and all(self.interaction_idle.values())

    def is_connected(self, websocket: WebSocket) -> bool:
        """Check if a WebSocket is still connected and active"""
        return websocket in self.active_connections

    async def send_json(self, websocket: WebSocket, data: Dict[str, Any]):
        """Send JSON data to a specific client"""
        try:
            if websocket in self.active_connections:
                await websocket.send_json(data)
        except WebSocketDisconnect:
            self.disconnect(websocket)
        except Exception as e:
            logger.error(f"Error sending data to client: {e}")
            self.disconnect(websocket)

    async def broadcast_json(self, data: Dict[str, Any]):
        """Broadcast JSON data to all connected clients"""
        disconnected_clients = []

        for connection in self.active_connections[:]:  # Create a copy to safely iterate
            try:
                await connection.send_json(data)
            except WebSocketDisconnect:
                disconnected_clients.append(connection)
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")
                disconnected_clients.append(connection)

        # Remove disconnected clients
        for client in disconnected_clients:
            self.disconnect(client)


# Create instance of WebSocketManager
manager = WebSocketManager()
