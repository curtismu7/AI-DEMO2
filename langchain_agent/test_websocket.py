#!/usr/bin/env python3
"""
Simple WebSocket client to test the backend connection.
"""
import asyncio
import websockets
import json
import sys

async def test_websocket():
    uri = "ws://localhost:8080"
    
    try:
        print(f"Connecting to {uri}...")
        async with websockets.connect(uri) as websocket:
            print("✅ Connected successfully!")
            
            # Wait for connection acknowledgment
            response = await websocket.recv()
            print(f"📨 Received: {response}")
            
            # Send session initialization
            session_init = {
                "type": "session_init",
                "user_id": "test-user-123"
            }
            print(f"📤 Sending session init: {json.dumps(session_init)}")
            await websocket.send(json.dumps(session_init))
            
            # Wait for session response
            response = await websocket.recv()
            print(f"📨 Session response: {response}")
            
            session_data = json.loads(response)
            if session_data.get("type") == "session_initialized":
                session_id = session_data.get("session_id")
                print(f"✅ Session initialized: {session_id}")
                
                # Send a test message
                test_message = {
                    "type": "chat_message",
                    "content": "Hello, this is a test message!",
                    "session_id": session_id
                }
                print(f"📤 Sending test message: {json.dumps(test_message)}")
                await websocket.send(json.dumps(test_message))
                
                # Wait for response
                print("⏳ Waiting for response...")
                response = await asyncio.wait_for(websocket.recv(), timeout=30)
                print(f"📨 Chat response: {response}")
                
            else:
                print("❌ Session initialization failed")
                
    except websockets.exceptions.ConnectionClosed as e:
        print(f"❌ Connection closed: {e}")
    except asyncio.TimeoutError:
        print("❌ Timeout waiting for response")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket())