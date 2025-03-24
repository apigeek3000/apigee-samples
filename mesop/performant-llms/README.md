# Mesop Frontend | Performant LLMs
This is an alternative frontend to use if you do not wish to use the unathenticated agent HTML chat window provided by a conversational agent. This frontend will make API Key authenticated calls to an API directly

## Prereqs
You already have the llm-semantic-cache deployed

## Local Development
From within this mesop/performant-llms folder, create a .env file with the following contents
```
MESOP_STATIC_FOLDER=static
MESOP_STATIC_URL_PATH=/static
APIGEE_HOST=YOUR_APIGEE_DOMAIN
PROJECT_ID=YOUR_GCP_PROJECT
```

Then start your venv and install requirements
```
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Finally, run your mesop app
```
mesop main.py
```