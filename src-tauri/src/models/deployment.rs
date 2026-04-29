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
pub struct DeployStep {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub name: String,
    #[serde(rename = "type")]
    pub step_type: String,
    pub order: i32,
    pub timeout_seconds: Option<u64>,
    pub retry_count: Option<u32>,
    pub retry_interval_seconds: Option<u64>,
    pub failure_strategy: Option<String>,
    #[serde(default)]
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub backup_dir: Option<String>,
    #[serde(default = "default_retention_count")]
    pub retention_count: u32,
    #[serde(default)]
    pub auto_rollback: bool,
    #[serde(default)]
    pub restart_after_rollback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub project_root: String,
    pub module_id: String,
    #[serde(default)]
    pub module_path: String,
    #[serde(default)]
    pub module_artifact_id: String,
    pub local_artifact_pattern: String,
    #[serde(default)]
    pub remote_artifact_name: Option<String>,
    pub remote_deploy_path: String,
    #[serde(default)]
    pub service_description: Option<String>,
    #[serde(default)]
    pub service_alias: Option<String>,
    #[serde(default)]
    pub java_bin_path: Option<String>,
    #[serde(default)]
    pub jvm_options: Option<String>,
    #[serde(default)]
    pub spring_profile: Option<String>,
    #[serde(default)]
    pub extra_args: Option<String>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub log_path: Option<String>,
    #[serde(default = "default_log_naming_mode")]
    pub log_naming_mode: String,
    #[serde(default)]
    pub log_name: Option<String>,
    #[serde(default = "default_log_encoding")]
    pub log_encoding: String,
    #[serde(default = "default_true")]
    pub enable_deploy_log: bool,
    #[serde(default)]
    pub backup_config: BackupConfig,
    #[serde(default)]
    pub deployment_steps: Vec<DeployStep>,
    #[serde(default)]
    pub custom_commands: Vec<DeploymentCustomCommand>,
    #[serde(default)]
    pub startup_probe: Option<StartupProbeConfig>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupProbeConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default = "default_interval")]
    pub interval_seconds: u64,
    #[serde(default)]
    pub process_probe: Option<ProcessProbeConfig>,
    #[serde(default)]
    pub port_probe: Option<PortProbeConfig>,
    #[serde(default)]
    pub http_probe: Option<HttpProbeConfig>,
    #[serde(default)]
    pub log_probe: Option<LogProbeConfig>,
    #[serde(default = "default_success_policy")]
    pub success_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessProbeConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub pid_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortProbeConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_probe_host")]
    pub host: String,
    #[serde(default = "default_probe_port")]
    pub port: u16,
    #[serde(default = "default_consecutive_successes")]
    pub consecutive_successes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProbeConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default = "default_http_method")]
    pub method: String,
    #[serde(default)]
    pub expected_status_codes: Option<Vec<u16>>,
    #[serde(default)]
    pub expected_body_contains: Option<String>,
    #[serde(default = "default_consecutive_successes")]
    pub consecutive_successes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogProbeConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub log_path: Option<String>,
    #[serde(default = "default_success_keywords")]
    pub success_patterns: Vec<String>,
    #[serde(default = "default_failure_keywords")]
    pub failure_patterns: Vec<String>,
    #[serde(default = "default_warning_keywords")]
    pub warning_patterns: Vec<String>,
    #[serde(default)]
    pub use_regex: bool,
    #[serde(default = "default_true")]
    pub only_current_deploy_log: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeStatus {
    pub probe_type: String,
    pub status: String,
    pub message: Option<String>,
    pub check_count: Option<u32>,
    pub last_check_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStage {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub step_type: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub message: Option<String>,
    pub retry_count: Option<u32>,
    pub current_retry: Option<u32>,
    pub duration_ms: Option<u128>,
    #[serde(default)]
    pub logs: Vec<String>,
    #[serde(default)]
    pub probe_statuses: Vec<ProbeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub executed: bool,
    pub success: Option<bool>,
    pub message: Option<String>,
    pub restored_backup_path: Option<String>,
    pub restarted_old_version: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentTask {
    pub id: String,
    pub build_task_id: Option<String>,
    #[serde(default)]
    pub project_root: String,
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
    #[serde(default)]
    pub startup_pid: Option<String>,
    #[serde(default)]
    pub startup_log_path: Option<String>,
    #[serde(default)]
    pub probe_result: Option<String>,
    #[serde(default)]
    pub backup_path: Option<String>,
    #[serde(default)]
    pub log_offset_before_start: Option<u64>,
    #[serde(default)]
    pub rollback_result: Option<RollbackResult>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeStatusEvent {
    pub task_id: String,
    pub stage_key: String,
    pub probe_statuses: Vec<ProbeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgressEvent {
    pub task_id: String,
    pub stage_key: String,
    pub percent: f64,
    pub uploaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_second: Option<u64>,
    pub message: String,
}

fn default_true() -> bool {
    true
}

fn default_log_naming_mode() -> String {
    "date".to_string()
}

fn default_log_encoding() -> String {
    "UTF-8".to_string()
}

fn default_retention_count() -> u32 {
    5
}

fn default_timeout() -> u64 {
    120
}

fn default_interval() -> u64 {
    3
}

fn default_success_policy() -> String {
    "health_first".to_string()
}

fn default_probe_host() -> String {
    "127.0.0.1".to_string()
}

fn default_probe_port() -> u16 {
    8080
}

fn default_consecutive_successes() -> u32 {
    2
}

fn default_http_method() -> String {
    "GET".to_string()
}

fn default_success_keywords() -> Vec<String> {
    vec!["Started".to_string()]
}

fn default_failure_keywords() -> Vec<String> {
    vec![
        "APPLICATION FAILED TO START".to_string(),
        "Application run failed".to_string(),
        "Port already in use".to_string(),
        "Web server failed to start".to_string(),
        "Address already in use".to_string(),
        "BindException".to_string(),
        "OutOfMemoryError".to_string(),
        "Unable to start web server".to_string(),
        "Failed to start bean".to_string(),
        "BeanCreationException".to_string(),
        "NoClassDefFoundError".to_string(),
        "ClassNotFoundException".to_string(),
    ]
}

fn default_warning_keywords() -> Vec<String> {
    vec![
        "Exception".to_string(),
        "ERROR".to_string(),
        "WARN".to_string(),
    ]
}
