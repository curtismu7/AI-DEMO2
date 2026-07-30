import re

file_path = "langchain_agent/src/models/mcp.py"
with open(file_path, "r") as f:
    content = f.read()

new_content = content.replace(
    "('https://') or self.endpoint.startswith('ws://') or self.endpoint.startswith('wss://')):",
    "('https://') or self.endpoint.startswith('ws://') or self.endpoint.startswith('wss://') or self.endpoint.startswith('local://')):"
)
new_content = new_content.replace(
    'raise ValueError("endpoint must be a valid URL starting with http://, https://, ws://, or wss://")',
    'raise ValueError("endpoint must be a valid URL starting with http://, https://, ws://, wss://, or local://")'
)

with open(file_path, "w") as f:
    f.write(new_content)

test_path = "langchain_agent/tests/test_mcp_models.py"
with open(test_path, "r") as f:
    test_content = f.read()

new_test_content = test_content.replace(
    'raise ValueError("endpoint must be a valid URL starting with http://, https://, ws://, or wss://")',
    'raise ValueError("endpoint must be a valid URL starting with http://, https://, ws://, wss://, or local://")'
).replace(
    'match="endpoint must be a valid URL starting with http://, https://, ws://, or wss://"',
    'match="endpoint must be a valid URL starting with http://, https://, ws://, wss://, or local://"'
).replace(
    'match="endpoint must be a valid URL"',
    'match="endpoint must be a valid URL starting with http://, https://, ws://, wss://, or local://"'
)

with open(test_path, "w") as f:
    f.write(new_test_content)
