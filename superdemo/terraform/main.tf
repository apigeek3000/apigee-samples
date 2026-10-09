# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

locals {
  apis = [
    "apigee.googleapis.com",
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com",
    "modelarmor.googleapis.com",
    "run.googleapis.com",
    "apihub.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "integrations.googleapis.com",
  ]

  mcp_roles = ["roles/run.invoker", "roles/apihub.admin"]
  app_roles = [
    "roles/secretmanager.secretAccessor",
    "roles/aiplatform.user",
    "roles/logging.viewer",
    "roles/datastore.user",
  ]
}

# Never disable on destroy: the project is likely shared (Apigee especially).
resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# Newly enabled APIs and new SAs/grants take ~3 min to propagate; until then
# dependents (and the deploy scripts run after apply) fail intermittently.
# Create-only: an apply with nothing new to create doesn't wait.
resource "time_sleep" "apis_propagation" {
  create_duration = var.propagation_wait
  depends_on      = [google_project_service.apis]
}

resource "time_sleep" "iam_propagation" {
  create_duration = var.propagation_wait
  depends_on = [
    google_project_iam_member.mcp,
    google_project_iam_member.app,
    google_project_iam_member.ai_client,
    google_project_iam_member.compute_run_builder,
    google_service_account_iam_member.apigee_ai_client_token_creator,
    google_service_account_iam_member.apigee_mcp_token_creator,
    google_project_iam_member.llm_security,
    google_service_account_iam_member.apigee_llm_security_token_creator,
  ]
}

data "google_project" "this" {}

# Cloud Run source deploys (apigee-mcp stubs) build as the default compute SA,
# which newer projects no longer grant Editor — it can't read the source bucket.
resource "google_project_iam_member" "compute_run_builder" {
  project    = var.project_id
  role       = "roles/run.builder"
  member     = "serviceAccount:${data.google_project.this.number}-compute@developer.gserviceaccount.com"
  depends_on = [time_sleep.apis_propagation]
}

# apigee-mcp proxies run as this SA (deployed with --sa "$SA_EMAIL").
resource "google_service_account" "mcp" {
  account_id   = var.mcp_service_account_name
  display_name = "Apigee MCP demo runtime SA"
  depends_on   = [time_sleep.apis_propagation]
}

resource "google_project_iam_member" "mcp" {
  for_each = toset(local.mcp_roles)
  project  = var.project_id
  role     = each.value
  member   = google_service_account.mcp.member
}

# Lets Apigee mint the proxy's Google tokens as this SA (see apigee_ai_client_token_creator).
resource "google_service_account_iam_member" "apigee_mcp_token_creator" {
  service_account_id = google_service_account.mcp.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-apigee.iam.gserviceaccount.com"
}

# Cloud Run backend SA (deploy-superdemo-app.sh).
resource "google_service_account" "app" {
  account_id   = var.app_service_account_name
  display_name = "Superdemo app (Cloud Run) backend SA"
  depends_on   = [time_sleep.apis_propagation]
}

resource "google_project_iam_member" "app" {
  for_each = toset(local.app_roles)
  project  = var.project_id
  role     = each.value
  member   = google_service_account.app.member
}

# Container only; deploy-superdemo.sh writes the versions.
resource "google_secret_manager_secret" "config" {
  secret_id = "superdemo-config"

  replication {
    auto {}
  }

  depends_on = [time_sleep.apis_propagation]
}

# Access allowlist (backend/allowlist_store.py, which hardcodes this name).
# ABANDON: destroy removes it from state but keeps the data.
resource "google_firestore_database" "superdemo" {
  name            = "superdemo"
  location_id     = var.region
  type            = "FIRESTORE_NATIVE"
  deletion_policy = "ABANDON"
  depends_on      = [time_sleep.apis_propagation]
}
