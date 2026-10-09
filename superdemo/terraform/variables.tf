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

# Set in terraform.tfvars (gitignored; copy terraform.tfvars.example).

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "mcp_service_account_name" {
  description = "apigee-mcp proxy runtime SA. Must match MCP_SERVICE_ACCOUNT_NAME."
  type        = string
  default     = "apigee-mcp-svc-acct"
}

variable "llm_security_service_account_name" {
  description = "llm-security-v2 proxy runtime SA. Must match SERVICE_ACCOUNT_NAME."
  type        = string
  default     = "llm-security-v2-svc-acct"
}

variable "app_service_account_name" {
  description = "Cloud Run backend SA. Must match APP_SERVICE_ACCOUNT_NAME."
  type        = string
  default     = "superdemo-app-svc-acct"
}

variable "enable_semantic_cache" {
  description = "Create the Vector Search index for the semantic-cache demo (~20-30 min, billed hourly)."
  type        = bool
  default     = false
}

variable "propagation_wait" {
  description = "Pause after enabling APIs and after IAM grants so they propagate before use (first create only)."
  type        = string
  default     = "180s"
}
