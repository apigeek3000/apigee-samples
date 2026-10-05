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

# Vector Search resources for llm-semantic-cache-v2. The sibling deploy script
# and lib.sh's is_semantic_cache_index_ready look these up by the exact display
# names and deployed-index id below — don't rename them.

locals {
  semantic_cache_count = var.enable_semantic_cache ? 1 : 0
}

# The sibling proxy is deployed with --sa ai-client@<project>.
resource "google_service_account" "ai_client" {
  count        = local.semantic_cache_count
  account_id   = "ai-client"
  display_name = "Apigee semantic-cache runtime SA"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "ai_client" {
  count   = local.semantic_cache_count
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = google_service_account.ai_client[0].member
}

resource "google_vertex_ai_index" "semantic_cache" {
  count               = local.semantic_cache_count
  display_name        = "semantic-cache-index"
  description         = "semantic-cache-index"
  region              = var.region
  index_update_method = "STREAM_UPDATE"

  metadata {
    config {
      dimensions                  = 768
      approximate_neighbors_count = 150
      distance_measure_type       = "DOT_PRODUCT_DISTANCE"
      feature_norm_type           = "NONE"
      shard_size                  = "SHARD_SIZE_MEDIUM"

      algorithm_config {
        tree_ah_config {
          leaf_node_embedding_count    = 10000
          leaf_nodes_to_search_percent = 5
        }
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_vertex_ai_index_endpoint" "semantic_cache" {
  count                   = local.semantic_cache_count
  display_name            = "semantic-cache-index-endpoint"
  region                  = var.region
  public_endpoint_enabled = true
  depends_on              = [google_project_service.apis]
}

# Deploying takes ~20-30 min.
resource "google_vertex_ai_index_endpoint_deployed_index" "semantic_cache" {
  count             = local.semantic_cache_count
  index_endpoint    = google_vertex_ai_index_endpoint.semantic_cache[0].id
  deployed_index_id = "semantic_cache_index_endpoint_deployment"
  display_name      = "semantic-cache-index-endpoint-deployment"
  index             = google_vertex_ai_index.semantic_cache[0].id

  timeouts {
    create = "60m"
  }
}
