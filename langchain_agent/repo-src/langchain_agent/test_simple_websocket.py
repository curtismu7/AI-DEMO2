#!/usr/bin/env python3
"""
Test the simple WebSocket server.
"""
import asyncio
import websockets
import json

async def test_simple_websocket():
    uri = "ws://localhost:8082"
    
    try:
        print(f"Connecting to {uri}...")
        async with websockets.connect(uri) as websocket:
            print("✅ Connected successfully!")
            
            # Wait for welcome message
            response = await websocket.recv()
            print(f"📨 Welcome: {response}")
            
            # Send session initialization
            session_init = {
                "type": "session_init",
                "user_id": "test-user-123"
            }
            print(f"📤 Sending: {json.dumps(session_init)}")
            await websocket.send(json.dumps(session_init))
            
            # Wait for session response
            response = await websocket.recv()
            print(f"📨 Session response: {response}")
            
            session_data = json.loads(response)
            session_id = session_data.get("session_id")
            
            # Send a test message
            test_message = {
                "type": "chat_message",
                "content": "Hello, test!",
                "session_id": session_id
            }
            print(f"📤 Sending: {json.dumps(test_message)}")
            await websocket.send(json.dumps(test_message))
            
            # Wait for response
            response = await websocket.recv()
            print(f"📨 Chat response: {response}")
            print("✅ Test completed successfully!")
                
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_simple_websocket())