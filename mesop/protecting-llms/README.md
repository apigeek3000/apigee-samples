# Mesop Frontend | Protecting LLMs
This is an alternative frontend to use if you do not wish to use the unathenticated agent HTML chat window provided by a conversational agent. This frontend will make API Key authenticated calls to an API directly

## Prereqs
You already have the llm-security and llm-logging samples deployed

Then redeploy llm-logging to enable Google Auth on the target backend, and add the roles Vertex AI User and Service Account User to the logging SA.

## Local Development
From within this mesop/protecting-llms folder, create a .env file with the following contents
```
MESOP_STATIC_FOLDER=static
MESOP_STATIC_URL_PATH=/static
APIGEE_HOST=YOUR_APIGEE_DOMAIN
APIGEE_KEY=YOUR_APIGEE_API_KEY
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