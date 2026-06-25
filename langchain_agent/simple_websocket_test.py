#!/usr/bin/env python3
"""
Simple WebSocket server to test basic connectivity.
"""
import asyncio
import websockets
import json
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

async def handle_client(websocket):
    """Handle WebSocket client connections."""
    logger.info(f"New client connected from {websocket.remote_address}")
    
    try:
        # Send welcome message
        welcome = {
            "type": "connection_ack",
            "message": "Connected to simple test server"
        }
        await websocket.send(json.dumps(welcome))
        
        async for message in websocket:
            logger.info(f"Received: {message}")
            
            try:
                data = json.loads(message)
                
                if data.get("type") == "session_init":
                    response = {
                        "type": "session_initialized",
                        "session_id": "test-session-123",
                        "user_id": data.get("user_id", "anonymous")
                    }
                    await websocket.send(json.dumps(response))
                    logger.info("Sent session init response")
                
                elif data.get("type") == "chat_message":
                    response = {
                        "type": "chat_response",
                        "content": f"Echo: {data.get('content', 'No content')}",
                        "session_id": data.get("session_id"),
                        "timestamp": "2024-01-01T12:00:00Z"
                    }
                    await websocket.send(json.dumps(response))
                    logger.info("Sent chat response")
                
                else:
                    error_response = {
                        "type": "error",
                        "error_message": f"Unknown message type: {data.get('type')}"
                    }
                    await websocket.send(json.dumps(error_response))
                    
            except json.JSONDecodeError as e:
                logger.error(f"JSON decode error: {e}")
                error_response = {
                    "type": "error",
                    "error_message": "Invalid JSON"
                }
                await websocket.send(json.dumps(error_response))
                
    except websockets.exceptions.ConnectionClosed:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Error handling client: {e}")

async def main():
    """Start the simple WebSocket server."""
    logger.info("Starting simple WebSocket test server on ws://localhost:8082")
    
    async with websockets.serve(handle_client, "localhost", 8082):
        logger.info("Server started. Press Ctrl+C to stop.")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server stopped")