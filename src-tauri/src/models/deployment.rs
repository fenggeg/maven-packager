use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub private_key_path: Option<String>,
    pub group: Option<String>,
    pub password_configured: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveServerProfilePayload {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentCustomCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub enabled: bool,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentProfile {
    pub id: String,
    pub name: String,
    pub module_id: String,
    pub local_artifact_pattern: String,
    pub remote_deploy_path: String,
    #[serde(default)]
    pub custom_commands: Vec<DeploymentCustomCommand>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStage {
    pub key: String,
    pub label: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentTask {
    pub id: String,
    pub build_task_id: Option<String>,
    pub deployment_profile_id: String,
    pub deployment_profile_name: Option<String>,
    pub server_id: String,
    pub server_name: Option<String>,
    pub module_id: String,
    pub artifact_path: String,
    pub artifact_name: String,
    pub status: String,
    #[serde(default)]
    pub log: Vec<String>,
    #[serde(default)]
    pub stages: Vec<DeploymentStage>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDeploymentPayload {
    pub deployment_profile_id: String,
    pub server_id: String,
    pub local_artifact_path: String,
    pub build_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentLogEvent {
    pub task_id: String,
    pub stage_key: Option<String>,
    pub line: String,
}
