import requests

url = "http://127.0.0.1:8090/v1/chat/completions"
headers = {"Content-Type": "application/json"}
data = {
    "model": "phi-4-mini-instruct",
    "messages": [
        {"role": "user", "content": "hi"}
    ]
}

response = requests.post(url, headers=headers, json=data)
print(response.status_code)
print(response.json())
