# Mesop Frontend | Productizing LLMs
This is a frontend for the Productizing LLMs demo. It will deploy a localhost UI.

## Prereqs
You already have the llm-token-limits deployed

You need to redeploy the endpoint to call the target with ai-client SA. Also, create a new product, ai-product-partner, that is a mirror of ai-product-bronze with half the entitlements. Update ai-consumer-app with this product, use the newly created API Key for this demo.

## Local Development
From within this mesop/productizing-llms folder, create a .env file with the following contents
```
MESOP_STATIC_FOLDER=static
MESOP_STATIC_URL_PATH=/static
APIGEE_HOST=YOUR_APIGEE_DOMAIN
PROJECT_ID=YOUR_GCP_PROJECT
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