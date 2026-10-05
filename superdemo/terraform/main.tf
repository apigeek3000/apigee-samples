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
  ]

  mcp_roles = ["roles/run.invoker", "roles/apihub.admin"]
  app_roles = [
    "roles/secretmanager.secretAccessor",
    "roles/aiplatform.user",
    "roles/logging.viewer",
  ]
}

# Never disable on destroy: the project is likely shared (Apigee especially).
resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# apigee-mcp proxies run as this SA (deployed with --sa "$SA_EMAIL").
resource "google_service_account" "mcp" {
  account_id   = var.mcp_service_account_name
  display_name = "Apigee MCP demo runtime SA"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "mcp" {
  for_each = toset(local.mcp_roles)
  project  = var.project_id
  role     = each.value
  member   = google_service_account.mcp.member
}

# Cloud Run backend SA (deploy-superdemo-app.sh).
resource "google_service_account" "app" {
  account_id   = var.app_service_account_name
  display_name = "Superdemo app (Cloud Run) backend SA"
  depends_on   = [google_project_service.apis]
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

  depends_on = [google_project_service.apis]
}
