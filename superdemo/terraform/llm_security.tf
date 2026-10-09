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

# Runtime SA for llm-security-v2. The sibling deploy script also creates this SA
# (skipped when it exists) and grants these roles, but its grant helper relies on
# bash 4.3 namerefs and silently grants nothing under macOS's /bin/bash 3.2.

locals {
  # Must match REQUIRED_ROLES in llm-security-v2/deploy-llm-security-v2.sh.
  llm_security_roles = [
    "roles/apigee.analyticsEditor",
    "roles/logging.logWriter",
    "roles/aiplatform.user",
    "roles/modelarmor.admin",
    "roles/iam.serviceAccountUser",
  ]
}

resource "google_service_account" "llm_security" {
  account_id   = var.llm_security_service_account_name
  display_name = "For Apigee LLM Security v2 Example"
  # The sibling's clean-up deletes this SA and its deploy recreates it, so it can
  # exist outside state; adopt it rather than failing with 409.
  create_ignore_already_exists = true
  depends_on                   = [time_sleep.apis_propagation]
}

resource "google_project_iam_member" "llm_security" {
  for_each = toset(local.llm_security_roles)
  project  = var.project_id
  role     = each.value
  member   = google_service_account.llm_security.member
}

# Lets Apigee mint the proxy's Model Armor and Vertex tokens as this SA (see
# apigee_ai_client_token_creator).
resource "google_service_account_iam_member" "apigee_llm_security_token_creator" {
  service_account_id = google_service_account.llm_security.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-apigee.iam.gserviceaccount.com"
}
