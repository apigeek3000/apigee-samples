# Intelligent Model Routing

This sample routes each request to a fast model or a capable model based on the semantic
complexity of the prompt, decided inside Apigee with no LLM call in the decision path.

Let's get started!

---

## Prepare project dependencies

### 1. Select the project with an active Apigee instance

<walkthrough-project-setup></walkthrough-project-setup>

### 2. Ensure you have an active GCP account selected in the Cloud Shell

```sh
gcloud auth login
```

### 3. Set the project

```sh
gcloud config set project <walkthrough-project-id/>
```

### 4. Enable the services required to deploy this sample

```sh
gcloud services enable aiplatform.googleapis.com apigee.googleapis.com --project <walkthrough-project-id/>
```

## Set environment variables

### 1. Edit the following variables in the `env.sh` file

Open the environment variables file <walkthrough-editor-open-file filePath="llm-intelligent-routing/env.sh">env.sh</walkthrough-editor-open-file> and set the following variables:

* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="PROJECT_ID_TO_SET">PROJECT_ID</walkthrough-editor-select-regex>. The value should be <walkthrough-project-id/>.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="APIGEE_ENV_TO_SET">APIGEE_ENV</walkthrough-editor-select-regex> to deploy the sample Apigee artifacts. For example, `dev-env`.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="APIGEE_HOST_TO_SET">APIGEE_HOST</walkthrough-editor-select-regex> of your Apigee instance. For example, `my-test.nip.io`.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="REGION_TO_SET">REGION</walkthrough-editor-select-regex> to deploy the Vector Search index. It should be the same region as your Apigee instance.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="SERVICE_ACCOUNT_NAME_TO_SET">SERVICE_ACCOUNT_NAME</walkthrough-editor-select-regex> the proxy will run as. For example, `ai-client`.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="SIMPLE_MODEL_TO_SET">SIMPLE_MODEL</walkthrough-editor-select-regex> used for prompts that are not classified as complex. For example, `gemini-2.5-flash`.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="COMPLEX_MODEL_TO_SET">COMPLEX_MODEL</walkthrough-editor-select-regex> used for prompts that are classified as complex. For example, `gemini-2.5-pro`.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="EMBEDDINGS_MODEL_ID_TO_SET">EMBEDDINGS_MODEL_ID</walkthrough-editor-select-regex> used to embed prompts and exemplars. For example, `text-embedding-005`.
* Set the <walkthrough-editor-select-regex filePath="llm-intelligent-routing/env.sh" regex="ROUTING_MIN_SIMILARITY_TO_SET">ROUTING_MIN_SIMILARITY</walkthrough-editor-select-regex>, the similarity a prompt must reach against a complex exemplar to be routed to the complex model. Higher means stricter. For example, `0.75`. This is a starting point — the notebook shows you real distances so you can tune it.

### 2. Set environment variables

```sh
cd llm-intelligent-routing && source ./env.sh
```

## Create and deploy a Vector Search index

### 1. Create the index

The index stores the complex exemplars. Streaming updates are required — the deploy script
upserts the exemplars into it.

```sh
ACCESS_TOKEN=$(gcloud auth print-access-token) && curl --location --request POST "https://$REGION-aiplatform.googleapis.com/v1/projects/$PROJECT_ID/locations/$REGION/indexes" --header "Authorization: Bearer $ACCESS_TOKEN" --header 'Content-Type: application/json' --data-raw '{"displayName": "llm-routing-index", "description": "Complex prompt exemplars for LLM intelligent routing", "metadata": {"config": {"dimensions": "768","approximateNeighborsCount": 150,"distanceMeasureType": "DOT_PRODUCT_DISTANCE","featureNormType": "NONE","algorithmConfig": {"treeAhConfig": {"leafNodeEmbeddingCount": "10000","fractionLeafNodesToSearch": 0.05}},"shardSize": "SHARD_SIZE_SMALL"},},"indexUpdateMethod": "STREAM_UPDATE"}'
```

### 2. Create an index endpoint

```sh
gcloud ai index-endpoints create --display-name=llm-routing-index-endpoint --public-endpoint-enabled --region=$REGION --project=$PROJECT_ID
```

### 3. Deploy the index to the endpoint

```sh
INDEX_ENDPOINT_ID=$(gcloud ai index-endpoints list --project=$PROJECT_ID --region=$REGION --format="json" | jq -c -r '.[] | select(.displayName=="llm-routing-index-endpoint") | .name | split("/") | .[5]') && INDEX_ID=$(gcloud ai indexes list --project=$PROJECT_ID --region=$REGION --format="json" | jq -c -r '.[] | select(.displayName=="llm-routing-index") | .name | split("/") | .[5]') && gcloud ai index-endpoints deploy-index $INDEX_ENDPOINT_ID --deployed-index-id=llm_routing_index_endpoint_deployment --display-name=llm-routing-index-endpoint-deployment --index=$INDEX_ID --region=$REGION --project=$PROJECT_ID
```

**Important:** Initial deployment of an index to an endpoint typically takes between 20 and
30 minutes. You can check the status of the operation using the command provided in the
output from the previous step. Wait for it to finish before continuing — the deploy script
will exit with an error if the index is not ready.

## Deploy sample artifacts

### 1. Execute the deployment script

The script creates the service account, embeds and upserts the 18 complex exemplars,
deploys the proxy, and creates the API product, developer, and app.

```sh
./deploy-llm-intelligent-routing.sh
```

## Congratulations

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

You're all set!

You can now go back to the [notebook](https://github.com/GoogleCloudPlatform/apigee-samples/blob/main/llm-intelligent-routing/llm_intelligent_routing_v1.ipynb) to test the sample.

**Don't forget to clean up after yourself**. Execute the following script to remove the
Apigee artifacts. It prints, but does not run, the commands to delete the Vector Search
index and endpoint.

```sh
./undeploy-llm-intelligent-routing.sh
```
