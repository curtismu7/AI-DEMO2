docker stop ai-demo-langchain-agent
docker cp langchain_agent/src/models/mcp.py ai-demo-langchain-agent:/app/src/models/mcp.py
docker start ai-demo-langchain-agent
sleep 4
docker logs ai-demo-langchain-agent --tail 50
