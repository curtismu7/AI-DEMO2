#!/usr/bin/env python3
"""
Minimal version of main.py to test WebSocket functionality.
"""
import asyncio
import logging
import sys
from pathlib import Path
import websockets
import json
import uuid
from datetime import datetime, timezone

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

# Setup basic logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class MinimalWebSocketHandler:
    """Minimal WebSocket handler for testing."""
    
    def __init__(self):
        self._connections = {}
        self._connection_metadata = {}
        
    async def handle_connection(self, websocket):
        """Handle WebSocket connection."""
        connection_id = str(uuid.uuid4())
        logger.info(f"New connection: {connection_id}")
        
        try:
            # Register connection
            self._connections[connection_id] = websocket
            self._connection_metadata[connection_id] = {
                "connected_at": datetime.now(timezone.utc),
                "path": "/",
                "session_id": None
            }
            
            # Send connection ack
            await websocket.send(json.dumps({
                "type": "connection_ack",
                "connection_id": connection_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }))
            
            # Handle messages
            async for message in websocket:
                try:
                    data = json.loads(message)
                    logger.info(f"Received: {data}")
                    
                    if data.get("type") == "session_init":
                        session_id = str(uuid.uuid4())
                        self._connection_metadata[connection_id]["session_id"] = session_id
                        
                        await websocket.send(json.dumps({
                            "type": "session_initialized",
                            "session_id": session_id,
                            "user_id": data.get("user_id"),
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }))
                        
                    elif data.get("type") == "chat_message":
                        await websocket.send(json.dumps({
                            "type": "chat_response",
                            "content": f"Echo: {data.get('content', 'No content')}",
                            "session_id": data.get("session_id"),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "metadata": {}
                        }))
                        
                except json.JSONDecodeError as e:
                    logger.error(f"JSON decode error: {e}")
                    await websocket.send(json.dumps({
                        "type": "error",
                        "error_message": "Invalid JSON"
                    }))
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    await websocket.send(json.dumps({
                        "type": "error", 
                        "error_message": str(e)
                    }))
                    
        except Exception as e:
            logger.error(f"Connection error: {e}")
        finally:
            # Cleanup
            if connection_id in self._connections:
                del self._connections[connection_id]
            if connection_id in self._connection_metadata:
                del self._connection_metadata[connection_id]
            logger.info(f"Connection {connection_id} cleaned up")

async def main():
    """Run minimal WebSocket server."""
    handler = MinimalWebSocketHandler()
    
    logger.info("Starting minimal WebSocket server on ws://localhost:18889")
    
    async with websockets.serve(
        handler.handle_connection,
        "0.0.0.0",
        18889,
        ping_interval=30,
        ping_timeout=10,
        close_timeout=10
    ):
        logger.info("✅ Minimal WebSocket server started")
        logger.info("📡 WebSocket endpoint: ws://localhost:18889")
        logger.info("Press Ctrl+C to stop")
        
        try:
            await asyncio.Future()  # Run forever
        except KeyboardInterrupt:
            logger.info("Shutting down...")

if __name__ == "__main__":
    asyncio.run(main())